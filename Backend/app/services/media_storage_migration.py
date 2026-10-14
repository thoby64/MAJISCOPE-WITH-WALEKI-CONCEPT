"""Idempotently move legacy report media into the configured object store."""

from __future__ import annotations

import base64
import hashlib
import logging
import re
import uuid
from urllib.parse import unquote_to_bytes

from sqlalchemy import cast, func, or_, select, Text, update
from sqlalchemy.orm import Session

from botocore.exceptions import ClientError, ResponseStreamingError
from app.config import settings
from app.models import ImageUpload, MediaStorageDeletion, Report
from app.models.uploads import ImageTypeEnum
from app.services.media_storage import get_object, put_object

UPLOAD_REF = re.compile(r"/api/uploads/([0-9a-fA-F-]{36})(?:$|[?#])")
logger = logging.getLogger(__name__)


def _decode_data_uri(value: str) -> tuple[bytes, str]:
    header, separator, body = value.partition(",")
    if not separator or not header.startswith("data:"):
        raise ValueError("Malformed report data URI")
    parts = header[5:].split(";")
    mime_type = (parts[0] or "text/plain").lower()
    if not (mime_type.startswith("image/") or mime_type.startswith("video/")):
        raise ValueError("Report data URI is not an image or video")
    if any(part.lower() == "base64" for part in parts[1:]):
        payload = base64.b64decode(body, validate=True)
    else:
        payload = unquote_to_bytes(body)
    if not payload:
        raise ValueError("Report data URI contains no media bytes")
    return payload, mime_type


def migrate_report_media(db: Session, *, purge_binary: bool = True) -> dict[str, int]:
    """Copy, read back, checksum, and repoint every DB-backed report media item.

    Per-item commits make the operation resumable. Object keys are deterministic
    for legacy rows, so a crash between object upload and DB commit is harmless.
    Inline report data URIs are converted to ImageUpload records and rewritten to
    the normal authenticated upload endpoint. Other URL references are retained.
    """
    target_backend = settings.media_storage_backend
    if target_backend not in {"http", "s3"}:
        raise RuntimeError("Report media migration requires a remote object-storage backend")

    counts = {
        "uploads_seen": 0,
        "database_payloads": 0,
        "objects_verified": 0,
        "objects_already_migrated": 0,
        "source_objects_missing": 0,
        "source_objects_unreadable": 0,
        "inline_photos_converted": 0,
        "payloads_purged": 0,
        "deletion_queue_repointed": 0,
    }
    counts["uploads_seen"] = db.execute(select(func.count(ImageUpload.id))).scalar_one()
    counts["database_payloads"] = db.execute(
        select(func.count(ImageUpload.id)).where(ImageUpload.file_data.is_not(None))
    ).scalar_one()
    counts["objects_already_migrated"] = db.execute(
        select(func.count(ImageUpload.id)).where(
            ImageUpload.file_data.is_(None),
            ImageUpload.storage_backend == target_backend,
            ImageUpload.storage_key.is_not(None),
            ImageUpload.sha256.is_not(None),
        )
    ).scalar_one()
    pending_conditions = [
        ImageUpload.storage_key.is_(None),
        ImageUpload.storage_backend.is_(None),
        ImageUpload.storage_backend != target_backend,
        ImageUpload.sha256.is_(None),
    ]
    if purge_binary:
        pending_conditions.append(ImageUpload.file_data.is_not(None))
    pending = or_(*pending_conditions)
    missing_source_ids: set[str] = set()
    pending_count = db.execute(
        select(func.count(ImageUpload.id)).where(pending)
    ).scalar_one()
    print(
        "   Report media backfill inventory: "
        f"uploads={counts['uploads_seen']}, database_payloads={counts['database_payloads']}, "
        f"pending={pending_count}, "
        f"already_migrated={counts['objects_already_migrated']}"
    )
    while True:
        # Bounded pages keep startup memory and transaction sizes predictable.
        images = db.execute(
            select(ImageUpload)
            .where(pending)
            .where(ImageUpload.id.not_in(missing_source_ids))
            .order_by(ImageUpload.id)
            .limit(100)
        ).scalars().all()
        if not images:
            break

        for image in images:
            if image.file_data is None and not image.storage_key:
                raise RuntimeError(f"Media row {image.id} has neither a database payload nor an object key")

            source_backend = image.storage_backend or settings.media_storage_backend
            if image.file_data is not None:
                payload = bytes(image.file_data)
            else:
                try:
                    payload = get_object(image.storage_key, source_backend)
                except (ClientError, ResponseStreamingError) as exc:
                    if source_backend != "s3":
                        raise
                    if isinstance(exc, ClientError):
                        error_code = str(exc.response.get("Error", {}).get("Code", ""))
                        if error_code not in {"NoSuchKey", "404", "NotFound"}:
                            raise
                        counts["source_objects_missing"] += 1
                        reason = "its legacy S3 object is missing"
                    else:
                        counts["source_objects_unreadable"] += 1
                        reason = "its legacy S3 object could not be read completely"
                    missing_source_ids.add(image.id)
                    logger.warning(
                        "Skipping media row %s during backfill: database payload is empty and %s",
                        image.id,
                        reason,
                    )
                    continue

            digest = hashlib.sha256(payload).hexdigest()
            if image.sha256 and image.sha256 != digest:
                raise RuntimeError(f"Media row {image.id} database checksum does not match its payload")

            if source_backend in {"s3", "http"} and image.storage_key:
                object_key = image.storage_key
            else:
                object_key = f"reports/{image.id}"

            # Re-putting deterministic bytes is safe and repairs a partially written
            # or stale object. Confirm a fresh read before moving the DB reference.
            put_object(object_key, payload, image.mime_type)
            copied = get_object(object_key, target_backend)
            if hashlib.sha256(copied).hexdigest() != digest:
                raise RuntimeError(f"Object readback checksum mismatch for media row {image.id}")

            image.storage_backend = target_backend
            image.storage_key = object_key
            image.sha256 = digest
            if purge_binary and image.file_data is not None:
                image.file_data = None
                counts["payloads_purged"] += 1
            db.commit()
            counts["objects_verified"] += 1
        print(
            "   Report media backfill progress: "
            f"verified={counts['objects_verified']}, "
            f"source_objects_missing={counts['source_objects_missing']}, "
            f"source_objects_unreadable={counts['source_objects_unreadable']}/{pending_count}"
        )

    # Legacy mobile clients could embed report photos as data URIs instead of
    # first creating an upload row. Convert these references to the same object
    # backed endpoint used by all modern report and engineer evidence flows.
    reports = db.execute(
        select(Report).where(cast(Report.photos, Text).like("%data:%"))
    ).scalars().all()
    for report in reports:
        photos = report.photos or []
        if not isinstance(photos, list):
            raise RuntimeError(f"Report {report.id} has an unsupported photo list format")
        changed = False
        created_keys: list[str] = []
        rewritten: list[str] = []
        try:
            for reference in photos:
                if not isinstance(reference, str) or not reference.startswith("data:"):
                    rewritten.append(reference)
                    match = UPLOAD_REF.search(reference) if isinstance(reference, str) else None
                    if match:
                        image = db.get(ImageUpload, match.group(1))
                        if not image:
                            raise RuntimeError(f"Report {report.id} references missing media row {match.group(1)}")
                        if image.report_id is None:
                            image.report_id = report.id
                            changed = True
                    continue

                payload, mime_type = _decode_data_uri(reference)
                image = ImageUpload(
                    id=str(uuid.uuid4()),
                    file_data=None,
                    file_name=f"legacy-inline-{uuid.uuid4().hex[:12]}",
                    file_type=mime_type,
                    file_size=len(payload),
                    mime_type=mime_type,
                    image_type=ImageTypeEnum.REPORT,
                    report_id=report.id,
                    sha256=hashlib.sha256(payload).hexdigest(),
                )
                db.add(image)
                db.flush()
                object_key = f"reports/{image.id}"
                put_object(object_key, payload, mime_type)
                created_keys.append(object_key)
                copied = get_object(object_key, target_backend)
                if hashlib.sha256(copied).hexdigest() != image.sha256:
                    raise RuntimeError(f"Object readback checksum mismatch for inline media in report {report.id}")
                image.storage_backend = target_backend
                image.storage_key = object_key
                rewritten.append(f"/api/uploads/{image.id}")
                changed = True
                counts["inline_photos_converted"] += 1

            if changed:
                report.photos = rewritten
                db.commit()
        except Exception:
            db.rollback()
            # The rows are rolled back too. Remove their objects; deterministic
            # keys make a failed cleanup harmless to the next retry.
            from app.services.media_storage import delete_object

            for key in created_keys:
                try:
                    delete_object(key, target_backend)
                except Exception:
                    logger.exception("Failed to remove partially migrated media object %s", key)
            raise

    result = db.execute(
        update(MediaStorageDeletion)
        .where(MediaStorageDeletion.storage_backend == "s3")
        .values(storage_backend=target_backend)
    )
    counts["deletion_queue_repointed"] = result.rowcount or 0
    db.commit()

    return counts

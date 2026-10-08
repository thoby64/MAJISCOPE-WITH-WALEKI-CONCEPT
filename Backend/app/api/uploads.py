"""
Media Upload Routes
API endpoints for image and video upload and retrieval.
"""

import logging
import hashlib
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import ImageUpload, MediaStorageDeletion, Report, Team
from app.config import settings
from app.models.uploads import ImageTypeEnum
from app.security.dependencies import CurrentUser, get_current_user
from app.services.activity_logs import audit_log
from app.services.image_service import compress_image_if_needed, validate_image
from app.services.media_storage import delete_object, get_object, new_storage_key, put_object

logger = logging.getLogger(__name__)

uploads_router = APIRouter(prefix="/api/uploads", tags=["uploads"])

MAX_VIDEO_SIZE = 25 * 1024 * 1024  # 25MB


def _build_upload_response(image_upload: ImageUpload):
    return {
        "id": image_upload.id,
        "fileName": image_upload.file_name,
        "fileSize": image_upload.file_size,
        "width": image_upload.width,
        "height": image_upload.height,
        "storage_backend": image_upload.storage_backend,
        "storage_key": image_upload.storage_key,
        "sha256": image_upload.sha256,
        "mimeType": image_upload.mime_type,
        "imageType": image_upload.image_type,
        "createdAt": image_upload.created_at,
        "downloadUrl": f"/api/uploads/{image_upload.id}",
    }


def _upload_audit_snapshot(image_upload: ImageUpload):
    return {
        "id": image_upload.id,
        "file_name": image_upload.file_name,
        "file_size": image_upload.file_size,
        "mime_type": image_upload.mime_type,
        "image_type": image_upload.image_type,
        "report_id": image_upload.report_id,
        "user_id": image_upload.user_id,
        "engineer_id": image_upload.engineer_id,
        "width": image_upload.width,
        "height": image_upload.height,
        "created_at": image_upload.created_at,
    }


def _validate_media_upload(file: UploadFile, file_data: bytes) -> Tuple[bytes, str, Optional[int], Optional[int]]:
    if not file.content_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is missing a content type",
        )

    if file.content_type.startswith("image/"):
        try:
            validate_image(file_data, file.content_type)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Image validation failed: {str(exc)}",
            )

        compressed_data, mime_type, final_width, final_height = compress_image_if_needed(
            file_data,
            file.content_type,
            max_width=1920,
            max_height=1920,
        )
        return compressed_data, mime_type, final_width, final_height

    if file.content_type.startswith("video/"):
        if len(file_data) > MAX_VIDEO_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Video too large: {len(file_data) / 1024 / 1024:.1f}MB (max {MAX_VIDEO_SIZE / 1024 / 1024:.1f}MB)",
            )
        return file_data, file.content_type, None, None

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="File must be an image or video",
    )


def _store_media(db: Session, **fields) -> ImageUpload:
    data = fields.pop("file_data")
    key = new_storage_key()
    put_object(key, data, fields["mime_type"])
    image_upload = ImageUpload(
        file_data=None,
        storage_backend=settings.media_storage_backend,
        storage_key=key,
        sha256=hashlib.sha256(data).hexdigest(),
        **fields,
    )
    try:
        db.add(image_upload)
        db.flush()
        return image_upload
    except Exception:
        db.rollback()
        try:
            delete_object(key, settings.media_storage_backend)
        except Exception:
            logger.exception("Failed to clean up object after media metadata write failed")
        raise


def _read_media_payload(image_upload: ImageUpload) -> bytes:
    payload = image_upload.file_data
    if payload is None and image_upload.storage_key:
        payload = get_object(image_upload.storage_key, image_upload.storage_backend)
    if payload is None:
        raise HTTPException(status_code=410, detail="Media payload is unavailable")
    payload = bytes(payload)
    if image_upload.sha256 and hashlib.sha256(payload).hexdigest() != image_upload.sha256:
        logger.error("Media checksum mismatch for upload %s", image_upload.id)
        raise HTTPException(status_code=502, detail="Media integrity verification failed")
    return payload


@uploads_router.post("", status_code=status.HTTP_201_CREATED)
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    report_id: str = Form(None),
    image_type: str = Form("report"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Upload an image or video file and store media bytes in configured object storage.
    """
    try:
        file_data = await file.read()
        stored_data, mime_type, final_width, final_height = _validate_media_upload(file, file_data)

        if report_id:
            report = db.query(Report).filter(Report.id == report_id).first()
            if not report:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Report not found",
                )
            if current_user.user_type == "engineer":
                is_team_leader = bool(
                    db.query(Team.id)
                    .filter(Team.id == report.team_id, Team.leader_id == current_user.id)
                    .first()
                )
                is_team_member = bool(
                    current_user.team_id and report.team_id == current_user.team_id
                )
                if not report.team_id or not (is_team_leader or is_team_member):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Report is outside your assigned team")
                if (
                    current_user.role != "team_leader"
                    and report.assigned_engineer_id
                    and report.assigned_engineer_id != current_user.id
                ):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Report is assigned to another engineer")
                if image_type not in {ImageTypeEnum.SUBMISSION_BEFORE.value, ImageTypeEnum.SUBMISSION_AFTER.value}:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Engineers may upload only before/after repair evidence",
                    )

        image_upload = _store_media(db,
            file_data=stored_data,
            file_name=file.filename,
            file_type=file.content_type,
            file_size=len(stored_data),
            mime_type=mime_type,
            image_type=image_type,
            report_id=report_id,
            user_id=current_user.id if current_user.user_type == "user" else None,
            engineer_id=current_user.id if current_user.user_type == "engineer" else None,
            width=final_width,
            height=final_height,
        )

        db.add(image_upload)
        db.flush()
        audit_log(
            db,
            request=request,
            actor=current_user,
            action="media.upload",
            event_type="media",
            status="success",
            entity="image_upload",
            entity_id=image_upload.id,
            target_name=image_upload.file_name,
            after_data=_upload_audit_snapshot(image_upload),
            utility_id=getattr(report, "utility_id", None) if report_id else None,
            dma_id=getattr(report, "dma_id", None) if report_id else None,
            metadata={"image_type": image_type, "content_type": file.content_type},
        )
        db.commit()
        db.refresh(image_upload)

        logger.info("Media uploaded: %s (%s)", image_upload.id, mime_type)
        return _build_upload_response(image_upload)

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        if "image_upload" in locals() and image_upload.storage_key:
            row_exists = db.query(ImageUpload.id).filter(ImageUpload.id == image_upload.id).first()
            if not row_exists:
                try:
                    delete_object(image_upload.storage_key, image_upload.storage_backend)
                except Exception:
                    logger.exception("Failed to clean up object after upload transaction failed")
        logger.error("Media upload error: %s", str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Media upload failed",
        )


@uploads_router.post("/public", status_code=status.HTTP_201_CREATED)
async def upload_public_image(
    request: Request,
    file: UploadFile = File(...),
    image_type: str = Form("report"),
    db: Session = Depends(get_db),
):
    """Anonymous/public image or video upload for the public reporting app."""
    try:
        file_data = await file.read()
        stored_data, mime_type, final_width, final_height = _validate_media_upload(file, file_data)

        image_upload = _store_media(db,
            file_data=stored_data,
            file_name=file.filename,
            file_type=file.content_type,
            file_size=len(stored_data),
            mime_type=mime_type,
            image_type=image_type,
            report_id=None,
            user_id=None,
            engineer_id=None,
            width=final_width,
            height=final_height,
        )

        db.add(image_upload)
        db.flush()
        audit_log(
            db,
            request=request,
            actor=None,
            action="media.public_upload",
            event_type="media",
            status="success",
            entity="image_upload",
            entity_id=image_upload.id,
            target_name=image_upload.file_name,
            after_data=_upload_audit_snapshot(image_upload),
            user_name="Anonymous reporter",
            user_role="anonymous_reporter",
            metadata={"image_type": image_type, "content_type": file.content_type},
        )
        db.commit()
        db.refresh(image_upload)

        logger.info("Public media uploaded: %s (%s)", image_upload.id, mime_type)
        return _build_upload_response(image_upload)

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        if "image_upload" in locals() and image_upload.storage_key:
            row_exists = db.query(ImageUpload.id).filter(ImageUpload.id == image_upload.id).first()
            if not row_exists:
                try:
                    delete_object(image_upload.storage_key, image_upload.storage_backend)
                except Exception:
                    logger.exception("Failed to clean up object after public upload transaction failed")
        logger.error("Public media upload error: %s", str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Public media upload failed",
        )


@uploads_router.get("/{image_id}")
async def download_image(image_id: str, db: Session = Depends(get_db)):
    """
    Download/retrieve a stored media payload.
    """
    try:
        image = db.query(ImageUpload).filter(ImageUpload.id == image_id).first()

        if not image:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Image not found",
            )

        payload = _read_media_payload(image)
        return {
            "id": image.id,
            "fileName": image.file_name,
            "mimeType": image.mime_type,
            "data": payload.hex(),
            "width": image.width,
            "height": image.height,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Media download error: %s", str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image download failed",
        )


@uploads_router.get("/{image_id}/content")
async def download_image_content(image_id: str, db: Session = Depends(get_db)):
    """Stream the original media bytes for first-party clients."""
    image = db.query(ImageUpload).filter(ImageUpload.id == image_id).first()
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    try:
        payload = _read_media_payload(image)
        return Response(
            content=payload,
            media_type=image.mime_type,
            headers={
                "Content-Disposition": "inline",
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Media content download failed: %s", str(exc))
        raise HTTPException(status_code=502, detail="Media storage is temporarily unavailable")


@uploads_router.delete("/{image_id}")
async def delete_image(
    image_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Delete an uploaded media file (auth required).
    """
    try:
        image = db.query(ImageUpload).filter(ImageUpload.id == image_id).first()

        if not image:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Image not found",
            )

        if current_user.user_type == "engineer" and image.engineer_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to delete this image",
            )

        before_data = _upload_audit_snapshot(image)
        report = db.query(Report).filter(Report.id == image.report_id).first() if image.report_id else None
        audit_log(
            db,
            request=request,
            actor=current_user,
            action="media.delete",
            event_type="media",
            status="success",
            entity="image_upload",
            entity_id=image.id,
            target_name=image.file_name,
            before_data=before_data,
            utility_id=getattr(report, "utility_id", None),
            dma_id=getattr(report, "dma_id", None),
            metadata={"image_type": image.image_type},
        )
        if image.storage_key and image.storage_backend:
            db.add(MediaStorageDeletion(storage_key=image.storage_key, storage_backend=image.storage_backend))
        db.delete(image)
        db.commit()

        # Fast path; the committed queue entry remains available for background retry.
        try:
            from app.services.media_storage_cleanup import drain_media_deletion_queue
            drain_media_deletion_queue(limit=20)
        except Exception:
            logger.exception("Media deletion queued for retry")

        logger.info("Media deleted: %s", image_id)
        return {"message": "Image deleted successfully"}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Media deletion error: %s", str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image deletion failed",
        )

"""Drain durable object deletion requests."""

import logging

from sqlalchemy import select

from app.database.session import SessionLocal
from app.models import MediaStorageDeletion
from app.services.media_storage import delete_object

logger = logging.getLogger(__name__)


def drain_media_deletion_queue(limit: int = 100) -> int:
    completed = 0
    with SessionLocal() as db:
        rows = db.execute(
            select(MediaStorageDeletion)
            .order_by(MediaStorageDeletion.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        ).scalars().all()
        for row in rows:
            try:
                delete_object(row.storage_key, row.storage_backend)
                db.delete(row)
                completed += 1
            except Exception as exc:
                row.attempts += 1
                row.last_error = str(exc)[:2000]
                logger.warning("Could not remove media object %s; retry queued", row.storage_key)
        db.commit()
    return completed

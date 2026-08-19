"""
Media Upload Routes
API endpoints for image and video upload and retrieval.
"""

import logging
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import ImageUpload, Report
from app.models.uploads import ImageTypeEnum
from app.security.dependencies import CurrentUser, get_current_user
from app.services.activity_logs import audit_log
from app.services.image_service import compress_image_if_needed, validate_image

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
    Upload an image or video file and store it in PostgreSQL.
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

        image_upload = ImageUpload(
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

        image_upload = ImageUpload(
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

        return {
            "id": image.id,
            "fileName": image.file_name,
            "mimeType": image.mime_type,
            "data": image.file_data.hex(),
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
        db.delete(image)
        db.commit()

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

"""
Activity log helpers for auditable workflow events.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import ActivityLog, Report
from app.security.dependencies import CurrentUser


SENSITIVE_KEYS = {
    "password",
    "confirm_password",
    "current_password",
    "new_password",
    "token",
    "access_token",
    "refresh_token",
    "invite_token",
    "invite_token_hash",
    "password_reset_token_hash",
    "secret",
    "secret_key",
}


def _safe_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key)
            if key_str.lower() in SENSITIVE_KEYS:
                sanitized[key_str] = "[redacted]"
            else:
                sanitized[key_str] = _safe_json_value(item)
        return sanitized
    if isinstance(value, (list, tuple, set)):
        return [_safe_json_value(item) for item in value]
    return str(value)


def _request_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _actor_identity(actor: Optional[Any]) -> dict[str, Optional[str]]:
    user_id = utility_mgr_id = dma_mgr_id = engineer_id = None
    user_name = "System"
    user_role = "system"

    if actor is None:
        return {
            "user_id": user_id,
            "utility_mgr_id": utility_mgr_id,
            "dma_mgr_id": dma_mgr_id,
            "engineer_id": engineer_id,
            "user_name": user_name,
            "user_role": user_role,
        }

    actor_id = getattr(actor, "id", None)
    actor_type = getattr(actor, "user_type", None)
    actor_role = getattr(actor, "role", None)

    user_name = (
        getattr(actor, "name", None)
        or getattr(actor, "email", None)
        or str(actor_id or "Unknown user")
    )
    user_role = str(actor_role or ("admin" if actor_type == "user" else actor_type) or "unknown")

    if actor_type == "user":
        user_id = actor_id
    elif actor_type == "utility_manager":
        utility_mgr_id = actor_id
    elif actor_type == "dma_manager":
        dma_mgr_id = actor_id
    elif actor_type in {"engineer", "team_leader"}:
        engineer_id = actor_id

    return {
        "user_id": user_id,
        "utility_mgr_id": utility_mgr_id,
        "dma_mgr_id": dma_mgr_id,
        "engineer_id": engineer_id,
        "user_name": user_name,
        "user_role": user_role,
    }


def create_activity_log(
    db: Session,
    *,
    action: str,
    user_name: str,
    user_role: str,
    entity: str,
    entity_id: str,
    details: Optional[str] = None,
    event_type: Optional[str] = None,
    status: Optional[str] = None,
    target_name: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    request_method: Optional[str] = None,
    request_path: Optional[str] = None,
    before_data: Optional[dict[str, Any]] = None,
    after_data: Optional[dict[str, Any]] = None,
    metadata_json: Optional[dict[str, Any]] = None,
    error_message: Optional[str] = None,
    user_id: Optional[str] = None,
    utility_mgr_id: Optional[str] = None,
    dma_mgr_id: Optional[str] = None,
    engineer_id: Optional[str] = None,
    utility_id: Optional[str] = None,
    dma_id: Optional[str] = None,
    flush: bool = True,
) -> ActivityLog:
    log = ActivityLog(
        action=action,
        user_id=user_id,
        utility_mgr_id=utility_mgr_id,
        dma_mgr_id=dma_mgr_id,
        engineer_id=engineer_id,
        user_name=user_name,
        user_role=user_role,
        entity=entity,
        entity_id=entity_id,
        details=details,
        event_type=event_type,
        status=status,
        target_name=target_name,
        ip_address=ip_address,
        user_agent=user_agent,
        request_method=request_method,
        request_path=request_path,
        before_data=_safe_json_value(before_data),
        after_data=_safe_json_value(after_data),
        metadata_json=_safe_json_value(metadata_json),
        error_message=error_message,
        utility_id=utility_id,
        dma_id=dma_id,
    )
    db.add(log)
    if flush:
        db.flush()
    return log


def audit_log(
    db: Session,
    *,
    request: Optional[Request] = None,
    actor: Optional[CurrentUser] = None,
    action: str,
    event_type: str,
    status: str,
    entity: str,
    entity_id: str,
    target_name: Optional[str] = None,
    details: Optional[str] = None,
    before_data: Optional[dict[str, Any]] = None,
    after_data: Optional[dict[str, Any]] = None,
    metadata: Optional[dict[str, Any]] = None,
    error_message: Optional[str] = None,
    utility_id: Optional[str] = None,
    dma_id: Optional[str] = None,
    user_id: Optional[str] = None,
    utility_mgr_id: Optional[str] = None,
    dma_mgr_id: Optional[str] = None,
    engineer_id: Optional[str] = None,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
    flush: bool = True,
) -> Optional[ActivityLog]:
    identity = _actor_identity(actor)
    try:
        with db.begin_nested():
            return create_activity_log(
                db,
                action=action,
                user_name=user_name or identity["user_name"] or "System",
                user_role=user_role or identity["user_role"] or "system",
                entity=entity,
                entity_id=entity_id,
                details=details,
                event_type=event_type,
                status=status,
                target_name=target_name,
                ip_address=_request_ip(request),
                user_agent=request.headers.get("user-agent") if request else None,
                request_method=request.method if request else None,
                request_path=str(request.url.path) if request else None,
                before_data=before_data,
                after_data=after_data,
                metadata_json=metadata,
                error_message=error_message,
                user_id=user_id or identity["user_id"],
                utility_mgr_id=utility_mgr_id or identity["utility_mgr_id"],
                dma_mgr_id=dma_mgr_id or identity["dma_mgr_id"],
                engineer_id=engineer_id or identity["engineer_id"],
                utility_id=utility_id or getattr(actor, "utility_id", None),
                dma_id=dma_id or getattr(actor, "dma_id", None),
                flush=flush,
            )
    except Exception:
        return None


def log_report_activity(
    db: Session,
    *,
    report: Report,
    action: str,
    details: Optional[str],
    request: Optional[Request] = None,
    actor: Optional[Any] = None,
    actor_name: Optional[str] = None,
    actor_role: Optional[str] = None,
    before_data: Optional[dict[str, Any]] = None,
    after_data: Optional[dict[str, Any]] = None,
    metadata: Optional[dict[str, Any]] = None,
    flush: bool = True,
) -> ActivityLog:
    user_id = None
    utility_mgr_id = None
    dma_mgr_id = None
    engineer_id = None

    inferred_name = actor_name or "System"
    inferred_role = actor_role or "system"

    if actor is not None:
        inferred_name = getattr(actor, "name", None) or inferred_name
        inferred_role = (
            getattr(actor, "role", None)
            or getattr(actor, "user_type", None)
            or inferred_role
        )
        actor_type = getattr(actor, "user_type", None)
        actor_id = getattr(actor, "id", None)

        if actor_type == "user":
            user_id = actor_id
        elif actor_type == "utility_manager":
            utility_mgr_id = actor_id
        elif actor_type == "dma_manager":
            dma_mgr_id = actor_id
        elif actor_type in {"engineer", "team_leader"}:
            engineer_id = actor_id

    report_snapshot = {
        "id": getattr(report, "id", None),
        "tracking_id": getattr(report, "tracking_id", None),
        "description": getattr(report, "description", None),
        "address": getattr(report, "address", None),
        "region_name": getattr(report, "region_name", None),
        "district_name": getattr(report, "district_name", None),
        "latitude": getattr(report, "latitude", None),
        "longitude": getattr(report, "longitude", None),
        "priority": getattr(getattr(report, "priority", None), "value", getattr(report, "priority", None)),
        "report_type": getattr(getattr(report, "report_type", None), "value", getattr(report, "report_type", None)),
        "leakage_type": getattr(getattr(report, "leakage_type", None), "value", getattr(report, "leakage_type", None)),
        "status": getattr(getattr(report, "status", None), "value", getattr(report, "status", None)),
        "utility_id": getattr(report, "utility_id", None),
        "dma_id": getattr(report, "dma_id", None),
        "team_id": getattr(report, "team_id", None),
        "assigned_engineer_id": getattr(report, "assigned_engineer_id", None),
        "reporter_name": getattr(report, "reporter_name", None),
        "reporter_phone": getattr(report, "reporter_phone", None),
        "notes": getattr(report, "notes", None),
        "engineer_submission_notes": getattr(report, "engineer_submission_notes", None),
        "team_leader_review_notes": getattr(report, "team_leader_review_notes", None),
        "dma_review_notes": getattr(report, "dma_review_notes", None),
        "sla_deadline": getattr(report, "sla_deadline", None),
        "resolved_at": getattr(report, "resolved_at", None),
        "created_at": getattr(report, "created_at", None),
        "updated_at": getattr(report, "updated_at", None),
    }
    merged_metadata = {
        "tracking_id": getattr(report, "tracking_id", None),
        "audit_source": "report_workflow",
        "report": report_snapshot,
    }
    if metadata:
        merged_metadata.update(metadata)

    return create_activity_log(
        db,
        action=action,
        user_name=inferred_name,
        user_role=str(inferred_role),
        entity="report",
        entity_id=report.id,
        details=details,
        event_type="report",
        status="success",
        target_name=getattr(report, "tracking_id", None),
        ip_address=_request_ip(request),
        user_agent=request.headers.get("user-agent") if request else None,
        request_method=request.method if request else None,
        request_path=str(request.url.path) if request else None,
        before_data=before_data,
        after_data=after_data or report_snapshot,
        metadata_json=merged_metadata,
        user_id=user_id,
        utility_mgr_id=utility_mgr_id,
        dma_mgr_id=dma_mgr_id,
        engineer_id=engineer_id,
        utility_id=report.utility_id,
        dma_id=report.dma_id,
        flush=flush,
    )

"""
Dashboard screen-oriented REST endpoints.

These endpoints do not replace the normal CRUD API. They provide compact,
role-scoped bundles for frontend screens that otherwise need several
independent requests during startup.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import DMA, Notification, Report, ReportStatusEnum, Utility
from app.security.dependencies import CurrentUser, get_current_user
from app.api.dmas import transform_dma
from app.api.notifications import _apply_notification_scope, _serialize_notification
from app.api.reports import _build_report_list_item
from app.api.utilities import _build_utility_response, _resolve_current_user_utility_id

dashboard_router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _scope_utilities(query, current_user: CurrentUser, db: Session):
    if current_user.user_type == "utility_manager" and current_user.utility_id:
        return query.filter(Utility.id == current_user.utility_id)
    if current_user.user_type in {"dma_manager", "engineer"}:
        scoped_utility_id = _resolve_current_user_utility_id(current_user, db)
        if scoped_utility_id:
            return query.filter(Utility.id == scoped_utility_id)
        return query.filter(Utility.id == "__no_access__")
    return query


def _scope_dmas(query, current_user: CurrentUser):
    if current_user.user_type == "utility_manager" and current_user.utility_id:
        return query.filter(DMA.utility_id == current_user.utility_id)
    if current_user.user_type == "dma_manager" and current_user.dma_id:
        return query.filter(DMA.id == current_user.dma_id)
    if current_user.user_type == "engineer" and current_user.dma_id:
        return query.filter(DMA.id == current_user.dma_id)
    return query


def _scope_reports(query, current_user: CurrentUser):
    if current_user.user_type == "utility_manager" and current_user.utility_id:
        return query.filter(Report.utility_id == current_user.utility_id)
    if current_user.user_type == "dma_manager" and current_user.dma_id:
        return query.filter(Report.dma_id == current_user.dma_id)
    if current_user.user_type == "engineer":
        if current_user.team_id:
            return query.filter(Report.team_id == current_user.team_id)
        return query.filter(Report.team_id == "__unassigned_team__")
    return query


def _report_status_value(value):
    return getattr(value, "value", value)


@dashboard_router.get("/bootstrap")
async def dashboard_bootstrap(
    map_report_limit: int = Query(500, ge=50, le=1000),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return compact, role-scoped data used by the dashboard shell."""
    utility_query = _scope_utilities(db.query(Utility), current_user, db)
    utilities = utility_query.order_by(Utility.name.asc()).limit(500).all()

    dma_query = _scope_dmas(db.query(DMA), current_user)
    dmas = dma_query.order_by(DMA.name.asc()).limit(500).all()

    report_query = _scope_reports(db.query(Report), current_user)
    total_reports = report_query.count()
    resolved_reports = report_query.filter(
        Report.status.in_([ReportStatusEnum.APPROVED, ReportStatusEnum.CLOSED])
    ).count()
    pending_reports = max(0, total_reports - resolved_reports)

    status_rows = (
        report_query.with_entities(Report.status, func.count(Report.id))
        .group_by(Report.status)
        .all()
    )
    report_type_rows = (
        report_query.with_entities(Report.report_type, func.count(Report.id))
        .group_by(Report.report_type)
        .all()
    )
    leakage_type_rows = (
        report_query.with_entities(Report.leakage_type, func.count(Report.id))
        .group_by(Report.leakage_type)
        .all()
    )

    map_reports = (
        report_query.filter(
            Report.latitude.isnot(None),
            Report.longitude.isnot(None),
            or_(Report.latitude != 0, Report.longitude != 0),
        )
        .order_by(Report.created_at.desc())
        .limit(map_report_limit)
        .all()
    )

    notifications_query = _apply_notification_scope(db.query(Notification), current_user)
    unread_notifications = notifications_query.filter(Notification.read.is_(False)).count()
    latest_notifications = (
        notifications_query.order_by(Notification.created_at.desc()).limit(10).all()
    )

    return {
        "utilities": {
            "total": len(utilities),
            "items": [_build_utility_response(utility, db) for utility in utilities],
        },
        "dmas": {
            "total": len(dmas),
            "items": [transform_dma(dma) for dma in dmas],
        },
        "reports": {
            "total": total_reports,
            "map_total": len(map_reports),
            "map_items": [_build_report_list_item(report) for report in map_reports],
            "status_counts": {
                _report_status_value(status): count for status, count in status_rows
            },
            "report_type_counts": {
                _report_status_value(report_type) or "unknown": count
                for report_type, count in report_type_rows
            },
            "leakage_type_counts": {
                _report_status_value(leakage_type) or "none": count
                for leakage_type, count in leakage_type_rows
            },
        },
        "summary": {
            "total_reports": total_reports,
            "resolved_reports": resolved_reports,
            "pending_reports": pending_reports,
            "efficiency_percent": round((resolved_reports / total_reports) * 100, 1)
            if total_reports
            else 0,
        },
        "notifications": {
            "unread": unread_notifications,
            "items": [_serialize_notification(item) for item in latest_notifications],
        },
    }

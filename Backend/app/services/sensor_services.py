"""
Sensor ingest foundation: shared timestamp parsing, per-category value
extraction helpers, and the generic pending-reading buffer.

Category-specific ingestion lives in:
  - app.services.water_level_services   (existing behaviour, new home)
  - app.services.water_quality_services (Tier A/B/C parameter parsing)

All services operate on the SENSOR PLATFORM database via
app.database.sensor_session.get_sensor_db.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.sensor_platform import (
    SensorDevice,
    SensorPendingReading,
    TankRef,
)

DEFAULT_WARNING_HEIGHT_M = 10.0
DEFAULT_CRITICAL_HEIGHT_M = 0.0

_MAX_PHYSICAL_DEPTH_M = 20.0


# ---------------------------------------------------------------------------
# Timestamp parsing (shared by all categories)
# ---------------------------------------------------------------------------

def _to_naive_utc(value: datetime) -> datetime:
    """
    Normalise a datetime to the app-wide naive-UTC storage convention.

    Aware datetimes are converted to UTC and stripped of tzinfo so the value
    survives round-trips through naive database columns without drift.
    """
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def parse_timestamp(value: Any, reading_timestamp: Any = None) -> Optional[datetime]:
    """
    Parse a sensor timestamp using Waleki's fallback chain.

    Accepts ISO 8601 strings, the ``YYYY-MM-DD_HH-mm-ss`` field format, numeric
    epoch milliseconds, and finally the reading's ``Timestamp`` property.
    All results are normalised to naive UTC (the storage convention).
    """
    if value is None:
        candidates: List[Any] = []
        if reading_timestamp is not None:
            candidates.append(reading_timestamp)
    else:
        candidates = [value]

    for candidate in candidates:
        if candidate is None:
            continue
        if isinstance(candidate, datetime):
            return _to_naive_utc(candidate)

        candidate_text = str(candidate).strip()
        if not candidate_text:
            continue

        try:
            return _to_naive_utc(datetime.fromisoformat(candidate_text.replace("Z", "+00:00")))
        except ValueError:
            pass

        if "_" in candidate_text and "-" in candidate_text:
            parts = candidate_text.split("_")
            if len(parts) == 2:
                try:
                    iso_candidate = f"{parts[0]}T{parts[1].replace('-', ':')}"
                    return _to_naive_utc(datetime.fromisoformat(iso_candidate.replace("Z", "+00:00")))
                except ValueError:
                    pass

        try:
            numeric = int(candidate_text)
        except ValueError:
            continue
        try:
            parsed = datetime.fromtimestamp(numeric / 1000.0, tz=timezone.utc)
            return parsed.replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            continue

    return None


# ---------------------------------------------------------------------------
# Generic extraction helpers (flat fields / properties / raw_data)
# ---------------------------------------------------------------------------

def _try_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_payload_dicts(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return (flat_payload, properties) with guaranteed dict shapes."""
    properties = payload.get("properties")
    if not isinstance(properties, dict):
        properties = {}
    return payload, properties


# ---------------------------------------------------------------------------
# Pending buffer (category-agnostic; parsed at promotion time)
# ---------------------------------------------------------------------------

def _build_dedup_key(device_id: str, occurred_at: datetime) -> str:
    return f"{device_id}:{occurred_at.isoformat()}"


def store_pending_reading(
    db: Session,
    device_id: str,
    payload: Dict[str, Any],
    *,
    recognised: bool,
) -> Dict[str, Any]:
    """
    Buffer a reading from an unregistered device (generic, any category).

    ``recognised`` marks whether the payload contained category-recognisable
    data (used by the router to decide 422 vs buffering).
    """
    if not device_id or not device_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="device_id is required",
        )

    occurred_at = parse_timestamp(payload.get("occurred_at"), payload.get("Timestamp")) or datetime.utcnow()
    dedup_key = _build_dedup_key(device_id.strip(), occurred_at)

    existing = (
        db.query(SensorPendingReading)
        .filter(SensorPendingReading.dedup_key == dedup_key)
        .first()
    )
    if existing is not None:
        return {
            "is_pending": True,
            "reading_id": existing.id,
            "device_id": device_id,
            "occurred_at": existing.occurred_at,
            "dedup_key": dedup_key,
            "is_duplicate": True,
        }

    reading = SensorPendingReading(
        device_id=device_id.strip(),
        payload=_json_dump_payload(payload),
        occurred_at=occurred_at,
        dedup_key=dedup_key,
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)

    return {
        "is_pending": True,
        "reading_id": reading.id,
        "device_id": device_id,
        "occurred_at": occurred_at,
        "dedup_key": dedup_key,
        "is_duplicate": False,
    }


def _json_dump_payload(payload: Dict[str, Any]) -> str:
    import json

    return json.dumps(payload, default=str)


def load_pending_payloads(db: Session, device_id: str) -> List[Dict[str, Any]]:
    """Load buffered raw payloads for a device, oldest first (for promotion)."""
    import json

    rows = (
        db.query(SensorPendingReading)
        .filter(SensorPendingReading.device_id == device_id)
        .order_by(SensorPendingReading.occurred_at.asc())
        .all()
    )
    payloads: List[Dict[str, Any]] = []
    for row in rows:
        try:
            data = json.loads(row.payload)
            if isinstance(data, dict):
                payloads.append(data)
        except (ValueError, TypeError):
            continue
    return payloads


def take_pending_rows(db: Session, device_id: str) -> List[SensorPendingReading]:
    """Fetch and delete pending rows for a device; caller commits once done."""
    rows = (
        db.query(SensorPendingReading)
        .filter(SensorPendingReading.device_id == device_id)
        .all()
    )
    for row in rows:
        db.delete(row)
    return rows


# ---------------------------------------------------------------------------
# Registry lookups (sensor DB)
# ---------------------------------------------------------------------------

def get_sensor_by_device_id(db: Session, device_id: str) -> Optional[SensorDevice]:
    return db.query(SensorDevice).filter(SensorDevice.device_id == device_id).first()


def get_tank_ref(db: Session, tank_id: str) -> Optional[TankRef]:
    return db.get(TankRef, tank_id)

"""
Sensor services: water-level computation, status derivation, timestamp and
depth parsing, and reading ingestion.

The status tiers are ported from Waleki's ``monitor.js`` ``getStatus``:
    not activated                     -> inactive
    water_height <= critical_height   -> critical
    water_height  < warning_height    -> warning
    otherwise                         -> active
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import SensorDevice, SensorReading, SensorStatusEnum, Tank

DEFAULT_WARNING_HEIGHT_M = 10.0
DEFAULT_CRITICAL_HEIGHT_M = 0.0

_RAW_DEPTH_PATTERNS = (
    re.compile(r"Depth\s*[=:]\s*([\d.]+)", re.IGNORECASE),
    re.compile(r"D\s*[=:]\s*([\d.]+)", re.IGNORECASE),
)

DEPTH_PROPERTY_KEYS = ("depth_m", "Depth", "depth", "H2", "h2")


def compute_water_level(h1_m: float, depth_m: float) -> float:
    return max(h1_m - depth_m, 0.0)


def derive_status(
    tank: Optional[Tank],
    sensor: Optional[SensorDevice],
    water_height_m: float,
) -> SensorStatusEnum:
    if sensor is None or not sensor.activated:
        return SensorStatusEnum.INACTIVE

    critical_height = float(sensor.critical_height_m) if sensor.critical_height_m is not None else DEFAULT_CRITICAL_HEIGHT_M
    warning_height = float(sensor.warning_height_m) if sensor.warning_height_m is not None else DEFAULT_WARNING_HEIGHT_M

    if water_height_m <= critical_height:
        return SensorStatusEnum.CRITICAL
    if water_height_m < warning_height:
        return SensorStatusEnum.WARNING
    return SensorStatusEnum.ACTIVE


def parse_timestamp(value: Any, reading_timestamp: Any = None) -> Optional[datetime]:
    """
    Parse a sensor timestamp using Waleki's fallback chain.

    Accepts ISO 8601 strings, the ``YYYY-MM-DD_HH-mm-ss`` field format, numeric
    epoch milliseconds, and finally the reading's ``Timestamp`` property.
    """
    if value is None:
        candidates: list[Any] = []
        if reading_timestamp is not None:
            candidates.append(reading_timestamp)
    else:
        candidates = [value]

    for candidate in candidates:
        if candidate is None:
            continue
        if isinstance(candidate, datetime):
            return candidate

        candidate_text = str(candidate).strip()
        if not candidate_text:
            continue

        try:
            return datetime.fromisoformat(candidate_text.replace("Z", "+00:00"))
        except ValueError:
            pass

        if "_" in candidate_text and "-" in candidate_text:
            parts = candidate_text.split("_")
            if len(parts) == 2:
                try:
                    iso_candidate = f"{parts[0]}T{parts[1].replace('-', ':')}"
                    return datetime.fromisoformat(iso_candidate.replace("Z", "+00:00"))
                except ValueError:
                    pass

        try:
            numeric = int(candidate_text)
        except ValueError:
            continue
        try:
            parsed = datetime.utcfromtimestamp(numeric / 1000.0)
            return parsed
        except (OverflowError, OSError, ValueError):
            continue

    return None


def extract_depth(properties: Optional[Dict[str, Any]], raw_data: Any = None) -> float:
    """
    Extract the sensor depth reading (h2) from explicit fields or a RawData
    string, mirroring Waleki's ``extractDepth``.
    """
    if not isinstance(properties, dict):
        properties = {}

    for key in DEPTH_PROPERTY_KEYS:
        if key in properties and properties[key] is not None:
            try:
                return float(properties[key])
            except (TypeError, ValueError):
                continue

    if isinstance(raw_data, str):
        for pattern in _RAW_DEPTH_PATTERNS:
            match = pattern.search(raw_data)
            if match:
                try:
                    return float(match.group(1))
                except ValueError:
                    continue

    return 0.0


def _snapshot_h1(sensor: SensorDevice, payload_h1: Any) -> float:
    if payload_h1 is not None:
        try:
            return float(payload_h1)
        except (TypeError, ValueError):
            pass
    if sensor.h1_m is not None:
        return float(sensor.h1_m)
    return 0.0


def ingest_reading(
    db: Session,
    device_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Persist a sensor reading, deriving utility/dma/tank scope from the sensor's
    registered tank link. Raises 404 for unknown devices.
    """
    sensor = db.query(SensorDevice).filter(SensorDevice.device_id == device_id).first()
    if sensor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Unregistered device",
        )

    tank = db.query(Tank).filter(Tank.id == sensor.tank_id).first()
    if tank is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sensor tank no longer exists",
        )

    properties = payload.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    depth_m = extract_depth(properties, payload.get("raw_data"))
    if depth_m == 0.0 and sensor.depth_m is not None:
        depth_m = float(sensor.depth_m)

    h1_m = _snapshot_h1(sensor, payload.get("h1_m"))
    water_height_m = compute_water_level(h1_m, depth_m)
    sensor_status = derive_status(tank, sensor, water_height_m)

    occurred_at = parse_timestamp(payload.get("occurred_at"), payload.get("Timestamp")) or datetime.utcnow()

    reading = SensorReading(
        sensor_id=sensor.id,
        tank_id=tank.id,
        utility_id=tank.utility_id,
        dma_id=tank.dma_id,
        h1_m=h1_m,
        depth_m=depth_m,
        water_height_m=water_height_m,
        status=sensor_status,
        raw_data=payload.get("raw_data"),
        occurred_at=occurred_at,
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)

    return {
        "reading_id": reading.id,
        "sensor_id": sensor.id,
        "tank_id": tank.id,
        "utility_id": tank.utility_id,
        "dma_id": tank.dma_id,
        "water_level_m": water_height_m,
        "h1_m": h1_m,
        "depth_m": depth_m,
        "status": sensor_status.value,
        "occurred_at": occurred_at,
    }
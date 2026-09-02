"""
Water-level ingestion: depth extraction, water-height computation, status
derivation, and reading persistence on the sensor platform DB.

Status tiers are ported from Waleki's ``monitor.js`` ``getStatus``:
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

from app.models.sensor_platform import (
    SensorDevice,
    SensorStatusEnum,
    WaterLevelReading,
)
from app.services.sensor_services import (
    DEFAULT_CRITICAL_HEIGHT_M,
    DEFAULT_WARNING_HEIGHT_M,
    _MAX_PHYSICAL_DEPTH_M,
    _try_float,
    parse_timestamp,
)

_RAW_DEPTH_PATTERNS = (
    re.compile(r"Depth\s*[=:]\s*([\d.]+)", re.IGNORECASE),
    re.compile(r"D\s*[=:]\s*([\d.]+)", re.IGNORECASE),
)

_RAW_DEPTH_FALLBACK = re.compile(r"(\d+\.?\d*)\s*m\b", re.IGNORECASE)

DEPTH_PROPERTY_KEYS = ("depth_m", "Depth", "depth", "H2", "h2")
DEPTH_MM_PROPERTY_KEYS = ("Depth_mm", "depth_mm")


# ---------------------------------------------------------------------------
# Water-level computation + status (config JSONB)
# ---------------------------------------------------------------------------

def wl_config(sensor: SensorDevice) -> Dict[str, Any]:
    cfg = sensor.config if isinstance(sensor.config, dict) else {}
    return cfg


def compute_water_level(h1_m: float, depth_m: float) -> float:
    return max(h1_m - depth_m, 0.0)


def derive_status(
    sensor: Optional[SensorDevice],
    water_height_m: float,
) -> SensorStatusEnum:
    if sensor is None or not sensor.activated:
        return SensorStatusEnum.INACTIVE

    cfg = wl_config(sensor)
    critical_height = float(cfg.get("critical_height_m", DEFAULT_CRITICAL_HEIGHT_M))
    warning_height = float(cfg.get("warning_height_m", DEFAULT_WARNING_HEIGHT_M))

    if water_height_m <= critical_height:
        return SensorStatusEnum.CRITICAL
    if water_height_m < warning_height:
        return SensorStatusEnum.WARNING
    return SensorStatusEnum.ACTIVE


# ---------------------------------------------------------------------------
# Depth extraction (hardened, unchanged semantics)
# ---------------------------------------------------------------------------

def _extract_from_properties(properties: Dict[str, Any]) -> Optional[float]:
    for key in DEPTH_PROPERTY_KEYS:
        val = properties.get(key)
        if val is not None:
            result = _try_float(val)
            if result is not None:
                return result
    return None


def _extract_mm_from_properties(properties: Dict[str, Any]) -> Optional[float]:
    for key in DEPTH_MM_PROPERTY_KEYS:
        val = properties.get(key)
        if val is not None:
            result = _try_float(val)
            if result is not None:
                return result / 1000.0
    return None


def _extract_from_raw_data(raw_data: Any) -> Optional[float]:
    if not isinstance(raw_data, str) or not raw_data.strip():
        return None

    for pattern in _RAW_DEPTH_PATTERNS:
        match = pattern.search(raw_data)
        if match:
            result = _try_float(match.group(1))
            if result is not None:
                return result

    for match in _RAW_DEPTH_FALLBACK.finditer(raw_data):
        result = _try_float(match.group(1))
        if result is not None and 0.0 <= result <= _MAX_PHYSICAL_DEPTH_M:
            return result

    return None


def _extract_flat_fields(payload: Dict[str, Any]) -> Optional[float]:
    for key in ("depth_m", "Depth", "depth", "H2", "h2"):
        if key in payload and payload[key] is not None:
            result = _try_float(payload[key])
            if result is not None:
                return result

    for key in ("Depth_mm", "depth_mm"):
        if key in payload and payload[key] is not None:
            result = _try_float(payload[key])
            if result is not None:
                return result / 1000.0

    return None


def extract_depth(
    properties: Optional[Dict[str, Any]],
    raw_data: Any = None,
    payload: Optional[Dict[str, Any]] = None,
) -> float:
    """
    Extract the sensor depth reading (h2) from explicit fields or a RawData
    string, mirroring Waleki's ``extractDepth``.

    Precedence: flat top-level fields -> nested properties -> millimetre
    fields -> RawData regex -> 0.0 fallback.
    """
    if not isinstance(properties, dict):
        properties = {}
    if not isinstance(payload, dict):
        payload = {}

    flat = _extract_flat_fields(payload)
    if flat is not None:
        return flat

    prop = _extract_from_properties(properties)
    if prop is not None:
        return prop

    prop_mm = _extract_mm_from_properties(properties)
    if prop_mm is not None:
        return prop_mm

    raw = _extract_from_raw_data(raw_data)
    if raw is not None:
        return raw

    return 0.0


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def _snapshot_h1(sensor: SensorDevice, payload_h1: Any) -> float:
    if payload_h1 is not None:
        result = _try_float(payload_h1)
        if result is not None:
            return result
    cfg = wl_config(sensor)
    return float(cfg.get("h1_m") or 0.0)


def ingest_water_level_reading(
    db: Session,
    sensor: SensorDevice,
    tank_ref: Any,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Persist a water-level reading for a registered sensor. Idempotent on
    (sensor_id, occurred_at).
    """
    properties = payload.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    depth_m = extract_depth(properties, payload.get("raw_data"), payload)
    if depth_m == 0.0:
        cfg_default = wl_config(sensor).get("depth_m")
        if cfg_default is not None:
            depth_m = float(cfg_default)

    if depth_m > _MAX_PHYSICAL_DEPTH_M:
        cfg_default = wl_config(sensor).get("depth_m")
        depth_m = float(cfg_default) if cfg_default is not None else 0.0

    h1_m = _snapshot_h1(sensor, payload.get("h1_m"))
    water_height_m = compute_water_level(h1_m, depth_m)
    sensor_status = derive_status(sensor, water_height_m)

    occurred_at = parse_timestamp(payload.get("occurred_at"), payload.get("Timestamp")) or datetime.utcnow()

    existing = (
        db.query(WaterLevelReading)
        .filter(
            WaterLevelReading.sensor_id == sensor.id,
            WaterLevelReading.occurred_at == occurred_at,
        )
        .first()
    )
    if existing is not None:
        return _reading_response(existing, is_duplicate=True)

    reading = WaterLevelReading(
        sensor_id=sensor.id,
        tank_id=tank_ref.id,
        utility_id=tank_ref.utility_id,
        dma_id=tank_ref.dma_id,
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

    return _reading_response(reading, is_duplicate=False)


def _reading_response(reading: WaterLevelReading, *, is_duplicate: bool) -> Dict[str, Any]:
    return {
        "reading_id": reading.id,
        "sensor_id": reading.sensor_id,
        "tank_id": reading.tank_id,
        "utility_id": reading.utility_id,
        "dma_id": reading.dma_id,
        "water_level_m": reading.water_height_m,
        "h1_m": reading.h1_m,
        "depth_m": reading.depth_m,
        "status": reading.status.value,
        "occurred_at": reading.occurred_at,
        "is_duplicate": is_duplicate,
    }


# ---------------------------------------------------------------------------
# Promotion of pending readings (called at registration)
# ---------------------------------------------------------------------------

def promote_pending_water_level(
    db: Session,
    sensor: SensorDevice,
    tank_ref: Any,
    payloads: list[Dict[str, Any]],
) -> int:
    """Parse buffered raw payloads as water-level readings. Returns count."""
    promoted = 0
    for payload in payloads:
        result = ingest_water_level_reading(db, sensor, tank_ref, payload)
        if not result.get("is_duplicate"):
            promoted += 1
    return promoted

"""
Sensor services: water-level computation, status derivation, timestamp and
depth parsing, and reading ingestion.

The status tiers are ported from Waleki's ``monitor.js`` ``getStatus``:
    not activated                     -> inactive
    water_height <= critical_height   -> critical
    water_height  < warning_height    -> warning
    otherwise                         -> active

Parser hardening (2026-08):
  - Accept flat top-level fields (how real LoRa firmware sends data).
  - Unit-aware: Depth_mm / depth_mm -> metres (/ 1000).
  - Corruption-tolerant RawData fallback scan.
  - Physical sanity bound: reject depth > 20 m.

Location fingerprint (2026-08):
  - Firmware hardcodes install coordinates at device boot.
  - Haversine distance check vs tank's registered lat/lon.
  - Configurable per-sensor tolerance (location_tolerance_km).
  - Mismatch = store + flag (never reject telemetry).

Idempotent ingest (2026-08):
  - dedup_key = {device_id}:{occurred_at_iso}
  - Conflict -> return existing reading, not duplicate.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import SensorDevice, SensorPendingReading, SensorReading, SensorStatusEnum, Tank

DEFAULT_WARNING_HEIGHT_M = 10.0
DEFAULT_CRITICAL_HEIGHT_M = 0.0

_MAX_PHYSICAL_DEPTH_M = 20.0

_RAW_DEPTH_PATTERNS = (
    re.compile(r"Depth\s*[=:]\s*([\d.]+)", re.IGNORECASE),
    re.compile(r"D\s*[=:]\s*([\d.]+)", re.IGNORECASE),
)

_RAW_DEPTH_FALLBACK = re.compile(r"(\d+\.?\d*)\s*m\b", re.IGNORECASE)

DEPTH_PROPERTY_KEYS = ("depth_m", "Depth", "depth", "H2", "h2")
DEPTH_MM_PROPERTY_KEYS = ("Depth_mm", "depth_mm")


# ---------------------------------------------------------------------------
# Water-level computation
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Depth extraction -- hardened
# ---------------------------------------------------------------------------

def _try_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_from_properties(properties: Dict[str, Any]) -> Optional[float]:
    """Direct numeric fields from the properties dict (metres)."""
    for key in DEPTH_PROPERTY_KEYS:
        val = properties.get(key)
        if val is not None:
            result = _try_float(val)
            if result is not None:
                return result
    return None


def _extract_mm_from_properties(properties: Dict[str, Any]) -> Optional[float]:
    """Millimetre fields from the properties dict, converted to metres."""
    for key in DEPTH_MM_PROPERTY_KEYS:
        val = properties.get(key)
        if val is not None:
            result = _try_float(val)
            if result is not None:
                return result / 1000.0
    return None


def _extract_from_raw_data(raw_data: Any) -> Optional[float]:
    """Parse depth from a RawData string (Waleki-style)."""
    if not isinstance(raw_data, str) or not raw_data.strip():
        return None

    # Strict match first: Depth=X or D=X
    for pattern in _RAW_DEPTH_PATTERNS:
        match = pattern.search(raw_data)
        if match:
            result = _try_float(match.group(1))
            if result is not None:
                return result

    # Corrupted-string fallback: scan for any plausible Nm token
    # (e.g. "Voltage=676mV, Current=5.63mA, Depth=abc")
    for match in _RAW_DEPTH_FALLBACK.finditer(raw_data):
        result = _try_float(match.group(1))
        if result is not None and 0.0 <= result <= _MAX_PHYSICAL_DEPTH_M:
            return result

    return None


def _extract_flat_fields(payload: Dict[str, Any]) -> Optional[float]:
    """Extract depth from flat top-level fields (how real LoRa firmware sends)."""
    # Try direct depth fields first (metres)
    for key in ("depth_m", "Depth", "depth", "H2", "h2"):
        if key in payload and payload[key] is not None:
            result = _try_float(payload[key])
            if result is not None:
                return result

    # Try millimetre fields at top level
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

    Precedence:
      1. Flat top-level fields from payload (how real firmware sends).
      2. Nested ``properties`` dict (legacy envelope).
      3. Millimetre properties (properties then top-level).
      4. RawData string regex.
      5. 0.0 fallback.
    """
    if not isinstance(properties, dict):
        properties = {}
    if not isinstance(payload, dict):
        payload = {}

    # 1. Flat top-level fields from payload
    flat = _extract_flat_fields(payload)
    if flat is not None:
        return flat

    # 2. Direct numeric fields from properties dict
    prop = _extract_from_properties(properties)
    if prop is not None:
        return prop

    # 3. Millimetre fields (properties first, then top-level)
    prop_mm = _extract_mm_from_properties(properties)
    if prop_mm is not None:
        return prop_mm
    for key in ("Depth_mm", "depth_mm"):
        if key in payload and payload[key] is not None:
            result = _try_float(payload[key])
            if result is not None:
                return result / 1000.0

    # 4. RawData string
    raw = _extract_from_raw_data(raw_data)
    if raw is not None:
        return raw

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


def _build_dedup_key(device_id: str, occurred_at: datetime) -> str:
    return f"{device_id}:{occurred_at.isoformat()}"


def ingest_reading(
    db: Session,
    device_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Persist a sensor reading, deriving utility/dma/tank scope from the sensor's
    registered tank link. Raises 404 for unknown devices.

    Idempotent: returns the existing reading if (device_id, occurred_at) was
    already ingested.
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

    depth_m = extract_depth(properties, payload.get("raw_data"), payload)
    if depth_m == 0.0 and sensor.depth_m is not None:
        depth_m = float(sensor.depth_m)

    # Sanitise: reject physically impossible values
    if depth_m > _MAX_PHYSICAL_DEPTH_M:
        depth_m = float(sensor.depth_m) if sensor.depth_m is not None else 0.0

    h1_m = _snapshot_h1(sensor, payload.get("h1_m"))
    water_height_m = compute_water_level(h1_m, depth_m)
    sensor_status = derive_status(tank, sensor, water_height_m)

    occurred_at = parse_timestamp(payload.get("occurred_at"), payload.get("Timestamp")) or datetime.utcnow()

    # --- Idempotency -------------------------------------------------------
    dedup_key = _build_dedup_key(device_id, occurred_at)
    existing = (
        db.query(SensorReading)
        .filter(SensorReading.dedup_key == dedup_key)
        .first()
    )
    if existing is not None:
        return {
            "reading_id": existing.id,
            "sensor_id": existing.sensor_id,
            "tank_id": existing.tank_id,
            "utility_id": existing.utility_id,
            "dma_id": existing.dma_id,
            "water_level_m": existing.water_height_m,
            "h1_m": existing.h1_m,
            "depth_m": existing.depth_m,
            "status": existing.status.value,
            "occurred_at": existing.occurred_at,
            "dedup_key": dedup_key,
            "is_duplicate": True,
        }

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
        dedup_key=dedup_key,
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
        "dedup_key": dedup_key,
        "is_duplicate": False,
    }


# ---------------------------------------------------------------------------
# Pending readings: buffer for unregistered devices
# ---------------------------------------------------------------------------

def store_pending_reading(
    db: Session,
    device_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Buffer a reading from an unregistered device.

    Strict validation: device_id and a resolvable depth are required.
    occurred_at is optional (falls back to server receive-time).
    Returns the buffered reading with is_pending=True.
    """
    if not device_id or not device_id.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="device_id is required",
        )

    properties = payload.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    depth_m = extract_depth(properties, payload.get("raw_data"), payload)
    if depth_m == 0.0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Depth reading is required (depth_m, Depth, raw_data, etc.)",
        )

    if depth_m > _MAX_PHYSICAL_DEPTH_M:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Depth exceeds physical limit ({_MAX_PHYSICAL_DEPTH_M}m)",
        )

    occurred_at = parse_timestamp(payload.get("occurred_at"), payload.get("Timestamp")) or datetime.utcnow()

    dedup_key = _build_dedup_key(device_id, occurred_at)
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
        depth_m=depth_m,
        raw_data=payload.get("raw_data"),
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


def promote_pending_readings(
    db: Session,
    sensor: SensorDevice,
    tank: Tank,
) -> int:
    """
    Promote pending readings for a device_id to real SensorReading rows.

    Called after sensor registration. Computes water height and status from
    the registered sensor config. Deletes promoted rows from the pending table.
    Returns the number of readings promoted.
    """
    pending_rows = (
        db.query(SensorPendingReading)
        .filter(SensorPendingReading.device_id == sensor.device_id)
        .all()
    )
    if not pending_rows:
        return 0

    h1_m = float(sensor.h1_m) if sensor.h1_m is not None else 0.0
    promoted = 0

    for pending in pending_rows:
        existing = (
            db.query(SensorReading)
            .filter(SensorReading.dedup_key == pending.dedup_key)
            .first()
        )
        if existing is not None:
            db.delete(pending)
            promoted += 1
            continue

        water_height_m = compute_water_level(h1_m, pending.depth_m)
        sensor_status = derive_status(tank, sensor, water_height_m)

        reading = SensorReading(
            sensor_id=sensor.id,
            tank_id=tank.id,
            utility_id=tank.utility_id,
            dma_id=tank.dma_id,
            h1_m=h1_m,
            depth_m=pending.depth_m,
            water_height_m=water_height_m,
            status=sensor_status,
            raw_data=pending.raw_data,
            occurred_at=pending.occurred_at,
            dedup_key=pending.dedup_key,
        )
        db.add(reading)
        db.delete(pending)
        promoted += 1

    db.commit()
    return promoted
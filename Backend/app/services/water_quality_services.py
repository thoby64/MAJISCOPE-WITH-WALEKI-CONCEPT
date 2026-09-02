"""
Water-quality ingestion: Tier A/B/C parameter extraction, physical sanity
ranges, worst-of-status derivation, and reading persistence on the sensor
platform DB.

Parameter model (per USGS/EPA guidance — see design doc):

  Tier A (core sonde bundle, always parsed):
    temperature_c (0–50 C), ph (0–14), ec_uscm (specific conductance),
    do_mgl (0.01–20 mg/L) / do_pct_sat, turbidity_ntu

  Tier B/C (optional fitted probes; NULL when absent):
    orp_mv, free_chlorine_mgl, nitrate_mgl, ammonia_mgl, phosphate_mgl,
    chlorophyll_ugl, phycocyanin_ugl

A payload with zero recognized parameters is rejected (422) — unlike water
level, where depth=0 is meaningful, an entirely unrecognized WQ message means
a misconfigured device.

Status derivation: worst-of across present parameters using per-sensor
threshold config (config JSONB). Absent parameter = not evaluated. ORP has no
universal threshold (WHO) — bounds are per-installation config only.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.sensor_platform import (
    SensorDevice,
    SensorStatusEnum,
    WaterQualityReading,
)
from app.services.sensor_services import _try_float, parse_timestamp

# ---------------------------------------------------------------------------
# Parameter registry: canonical field -> (aliases, min, max, unit label)
# ---------------------------------------------------------------------------

WQ_PARAMETERS: Dict[str, Dict[str, Any]] = {
    "temperature_c": {"aliases": ("temperature_c", "Temperature", "temp", "Temp", "WaterTemp", "water_temperature"), "min": -5.0, "max": 50.0},
    "ph": {"aliases": ("ph", "pH", "PH"), "min": 0.0, "max": 14.0},
    "ec_uscm": {"aliases": ("ec_uscm", "EC", "Conductivity", "conductivity", "specific_cond", "SPCond", "ec"), "min": 0.0, "max": 200_000.0},
    "do_mgl": {"aliases": ("do_mgl", "DO", "DissolvedOxygen", "do", "oxygen_mgl"), "min": 0.0, "max": 20.0},
    "do_pct_sat": {"aliases": ("do_pct_sat", "DO_pct", "do_pct", "saturation_pct"), "min": 0.0, "max": 200.0},
    "turbidity_ntu": {"aliases": ("turbidity_ntu", "Turbidity", "Turb", "turbidity", "NTU"), "min": 0.0, "max": 4_000.0},
    "orp_mv": {"aliases": ("orp_mv", "ORP", "Redox", "orp"), "min": -2_000.0, "max": 2_000.0},
    "free_chlorine_mgl": {"aliases": ("free_chlorine_mgl", "FreeCl", "free_cl", "Chlorine", "chlorine_mgl"), "min": 0.0, "max": 20.0},
    "nitrate_mgl": {"aliases": ("nitrate_mgl", "Nitrate", "NO3", "no3"), "min": 0.0, "max": 500.0},
    "ammonia_mgl": {"aliases": ("ammonia_mgl", "Ammonia", "NH3", "nh3", "nh4"), "min": 0.0, "max": 500.0},
    "phosphate_mgl": {"aliases": ("phosphate_mgl", "Phosphate", "PO4", "po4"), "min": 0.0, "max": 500.0},
    "chlorophyll_ugl": {"aliases": ("chlorophyll_ugl", "Chlorophyll", "chla", "chlorophyll_a"), "min": 0.0, "max": 1_000.0},
    "phycocyanin_ugl": {"aliases": ("phycocyanin_ugl", "Phycocyanin", "pc_ugl"), "min": 0.0, "max": 1_000.0},
}

# Keys that are lowercased before alias matching (vendor spellings vary).
_RAW_ALIASES_LOWER = {a.lower(): field for field, spec in WQ_PARAMETERS.items() for a in spec["aliases"]}

# RawData fallback: "pH=7.2, EC=450, Turb=3.1" or "Temp: 21.3"
_RAW_PARAM_PATTERN = re.compile(
    r"([A-Za-z]+[A-Za-z0-9_]*)\s*[=:]\s*(-?\d+(?:\.\d+)?)",
)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def _value_in_range(field: str, value: float) -> bool:
    spec = WQ_PARAMETERS[field]
    return spec["min"] <= value <= spec["max"]


def _match_alias(key: str) -> Optional[str]:
    return _RAW_ALIASES_LOWER.get(key.lower())


def extract_water_quality(
    payload: Dict[str, Any],
    properties: Optional[Dict[str, Any]] = None,
    raw_data: Any = None,
) -> Dict[str, float]:
    """
    Extract recognized water-quality parameters.

    Precedence: flat top-level fields -> nested properties dict -> RawData
    string regex. Values outside the physical sanity range are dropped
    (treated as absent) rather than stored.

    Returns the dict of canonical_field -> value; empty if nothing matched.
    """
    if not isinstance(properties, dict):
        properties = {}
    if not isinstance(payload, dict):
        payload = {}

    extracted: Dict[str, float] = {}

    def _try_store(field: str, value: Any) -> None:
        if field in extracted:
            return
        result = _try_float(value)
        if result is not None and _value_in_range(field, result):
            extracted[field] = result

    # 1. Flat top-level fields + 2. nested properties
    for source in (payload, properties):
        for key, value in source.items():
            if value is None:
                continue
            field = _match_alias(str(key))
            if field is not None:
                _try_store(field, value)

    # 3. RawData string fallback
    if isinstance(raw_data, str) and raw_data.strip():
        for match in _RAW_PARAM_PATTERN.finditer(raw_data):
            token, value_text = match.group(1), match.group(2)
            field = _match_alias(token)
            if field is not None:
                _try_store(field, value_text)

    return extracted


# ---------------------------------------------------------------------------
# Status derivation (worst-of across present parameters)
# ---------------------------------------------------------------------------

def _default_thresholds() -> Dict[str, Dict[str, float]]:
    """
    Conservative default threshold bounds for Tier A parameters.

    Ranges follow WHO/EA operational-monitoring guidance for utility water.
    ORP intentionally has NO default — WHO: no universal ORP threshold exists;
    it must be configured per installation if the probe is fitted.
    """
    return {
        "ph": {"warning_below": 6.5, "warning_above": 8.5, "critical_below": 5.5, "critical_above": 9.5},
        "turbidity_ntu": {"warning_above": 5.0, "critical_above": 10.0},
        "free_chlorine_mgl": {"warning_below": 0.2, "warning_above": 2.0, "critical_below": 0.05, "critical_above": 5.0},
        "temperature_c": {"warning_below": 5.0, "warning_above": 35.0, "critical_below": 0.0, "critical_above": 45.0},
        "do_mgl": {"warning_below": 4.0, "critical_below": 2.0},
        "ec_uscm": {"warning_above": 2_500.0, "critical_above": 5_000.0},
    }


def wq_config(sensor: SensorDevice) -> Dict[str, Any]:
    cfg = sensor.config if isinstance(sensor.config, dict) else {}
    return cfg


def derive_water_quality_status(
    sensor: SensorDevice,
    values: Dict[str, float],
) -> SensorStatusEnum:
    """
    Worst-of status across present parameters using per-sensor thresholds
    (config JSONB 'parameters'), falling back to conservative defaults.
    Absent parameters are not evaluated. Sensors not activated are INACTIVE.
    """
    if not sensor.activated:
        return SensorStatusEnum.INACTIVE
    if not values:
        return SensorStatusEnum.ACTIVE

    cfg = wq_config(sensor).get("parameters") or {}
    defaults = _default_thresholds()

    worst = SensorStatusEnum.ACTIVE
    for field, value in values.items():
        bounds = cfg.get(field) or defaults.get(field)
        if not bounds:
            continue

        critical = False
        warning = False
        if "critical_below" in bounds and value <= bounds["critical_below"]:
            critical = True
        if "critical_above" in bounds and value >= bounds["critical_above"]:
            critical = True
        if "warning_below" in bounds and value <= bounds["warning_below"]:
            warning = True
        if "warning_above" in bounds and value >= bounds["warning_above"]:
            warning = True

        if critical:
            return SensorStatusEnum.CRITICAL
        if warning:
            worst = SensorStatusEnum.WARNING

    return worst


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def ingest_water_quality_reading(
    db: Session,
    sensor: SensorDevice,
    tank_ref: Any,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Persist a water-quality reading for a registered sensor. Idempotent on
    (sensor_id, occurred_at). Raises 422 when no parameters are recognized.
    """
    properties = payload.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    values = extract_water_quality(payload, properties, payload.get("raw_data"))
    if not values:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No recognizable water-quality parameters in payload "
                   "(expected temperature/pH/EC/DO/turbidity/etc.)",
        )

    occurred_at = parse_timestamp(payload.get("occurred_at"), payload.get("Timestamp")) or datetime.utcnow()

    existing = (
        db.query(WaterQualityReading)
        .filter(
            WaterQualityReading.sensor_id == sensor.id,
            WaterQualityReading.occurred_at == occurred_at,
        )
        .first()
    )
    if existing is not None:
        return _wq_response(existing, values=None, is_duplicate=True)

    reading = WaterQualityReading(
        sensor_id=sensor.id,
        tank_id=tank_ref.id,
        utility_id=tank_ref.utility_id,
        dma_id=tank_ref.dma_id,
        status=derive_water_quality_status(sensor, values),
        raw_data=payload.get("raw_data"),
        occurred_at=occurred_at,
        **{field: value for field, value in values.items()},
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)

    return _wq_response(reading, values=values, is_duplicate=False)


def _wq_response(reading: WaterQualityReading, *, values: Optional[Dict[str, float]], is_duplicate: bool) -> Dict[str, Any]:
    param_fields = list(WQ_PARAMETERS.keys())
    present = {}
    for field in param_fields:
        v = getattr(reading, field, None)
        if v is not None:
            present[field] = v
    return {
        "reading_id": reading.id,
        "sensor_id": reading.sensor_id,
        "tank_id": reading.tank_id,
        "utility_id": reading.utility_id,
        "dma_id": reading.dma_id,
        "status": reading.status.value,
        "parameters": present,
        "occurred_at": reading.occurred_at,
        "is_duplicate": is_duplicate,
    }


# ---------------------------------------------------------------------------
# Promotion of pending readings (called at registration)
# ---------------------------------------------------------------------------

def promote_pending_water_quality(
    db: Session,
    sensor: SensorDevice,
    tank_ref: Any,
    payloads: List[Dict[str, Any]],
) -> int:
    """Parse buffered raw payloads as water-quality readings. Returns count."""
    promoted = 0
    for payload in payloads:
        try:
            result = ingest_water_quality_reading(db, sensor, tank_ref, payload)
            if not result.get("is_duplicate"):
                promoted += 1
        except HTTPException:
            # Buffered payload had no recognizable parameters — skip it.
            continue
    return promoted

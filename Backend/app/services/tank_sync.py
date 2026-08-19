"""
Tank reconciliation from uploaded utility infrastructure layers.

Tanks are materialized from ``storage_facilities`` layers on upload. Tanks are
never hard-deleted: features that disappear from a re-upload are soft-marked
``deactivated`` so historical sensor readings and manual DMA assignments remain
intact.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import (
    SensorDevice,
    Tank,
    TankStatusEnum,
    UtilityInfrastructureLayer,
)

TANK_NAME_KEY_CANDIDATES: Tuple[str, ...] = (
    "name",
    "tank_name",
    "tank",
    "id",
    "code",
    "asset_id",
    "tank_id",
)

COORDINATE_KEY_PREFIX = "coord:"


def _normalize_property_key(key: str) -> str:
    return key.strip().lower().replace("-", "_")


def _canonical_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.strip().lower())


def _is_missing_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    return False


def detect_tank_key_field(properties: Dict[str, Any]) -> Optional[str]:
    """
    Pick the first non-empty name-like property matched against candidates.

    Property keys are matched case-insensitively and ignoring separators
    (``TankName`` matches candidate ``tank_name``). Returns the actual property
    key present in the feature, or ``None`` when no candidate is available
    (callers then fall back to the coordinate hash).
    """
    canonical_to_original = {
        _canonical_key(str(key)): key
        for key in properties.keys()
    }
    for candidate in TANK_NAME_KEY_CANDIDATES:
        canonical_candidate = _canonical_key(candidate)
        original_key = canonical_to_original.get(canonical_candidate)
        if original_key is None:
            continue
        value = properties.get(original_key)
        if not _is_missing_value(value):
            return original_key
    return None


def _extract_centroid(geometry: Optional[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    if not isinstance(geometry, dict):
        return None
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Point" and isinstance(coordinates, list) and len(coordinates) >= 2:
        return _to_float_pair(coordinates)
    if geometry_type == "MultiPoint" and isinstance(coordinates, list) and coordinates:
        first = coordinates[0]
        if isinstance(first, list):
            return _to_float_pair(first)
    return None


def _to_float_pair(coordinates: List[Any]) -> Optional[Tuple[float, float]]:
    try:
        longitude = float(coordinates[0])
        latitude = float(coordinates[1])
    except (TypeError, ValueError, IndexError):
        return None
    return latitude, longitude


def coordinate_hash(latitude: float, longitude: float) -> str:
    return f"{COORDINATE_KEY_PREFIX}{latitude:.6f},{longitude:.6f}"


def _sync_summary(
    *,
    created: int,
    updated: int,
    reactivated: int,
    deactivated: int,
    deactivated_with_sensors: int,
    total: int,
) -> Dict[str, Any]:
    return {
        "created": created,
        "updated": updated,
        "reactivated": reactivated,
        "deactivated": deactivated,
        "deactivated_with_sensors": deactivated_with_sensors,
        "total": total,
        "has_warnings": deactivated_with_sensors > 0,
    }


def sync_tanks_from_layer(
    db: Session,
    utility_id: str,
    features: List[Dict[str, Any]],
    layer: UtilityInfrastructureLayer,
) -> Dict[str, Any]:
    """
    Reconcile the ``tank`` table from the features of an uploaded storage
    infrastructure layer.

    Matching is by ``(utility_id, source_key)``. Tanks present before but
    absent from the new layer are soft-deactivated. Tanks that come back in a
    later upload are reactivated.
    """
    existing_tanks = {
        tank.source_key: tank
        for tank in db.query(Tank).filter(Tank.utility_id == utility_id).all()
    }

    seen_source_keys: set[str] = set()
    chosen_key_field: Optional[str] = None
    key_field_counts: Dict[str, int] = {}

    stats = {
        "created": 0,
        "updated": 0,
        "reactivated": 0,
    }

    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            properties = {}

        key_field = detect_tank_key_field(properties)
        key_field_counts[key_field] = key_field_counts.get(key_field, 0) + 1

        geometry = feature.get("geometry")

        name: Optional[str] = None
        source_key: Optional[str] = None
        if key_field is not None:
            raw_value = properties.get(key_field)
            source_key = str(raw_value).strip()
            name = source_key or None
            if not source_key:
                source_key = None

        latitude: Optional[float] = None
        longitude: Optional[float] = None
        centroid = _extract_centroid(geometry)
        if centroid is not None:
            latitude, longitude = centroid

        if source_key is None:
            if latitude is None or longitude is None:
                continue
            source_key = coordinate_hash(latitude, longitude)
            name = name or None

        if not source_key:
            continue

        seen_source_keys.add(source_key)
        existing = existing_tanks.get(source_key)

        if existing is None:
            tank = Tank(
                utility_id=utility_id,
                source_key=source_key,
                name=name,
                latitude=latitude,
                longitude=longitude,
                status=TankStatusEnum.ACTIVE,
            )
            db.add(tank)
            stats["created"] += 1
        else:
            was_deactivated = existing.status == TankStatusEnum.DEACTIVATED
            existing.name = name if name else existing.name
            existing.latitude = latitude if latitude is not None else existing.latitude
            existing.longitude = longitude if longitude is not None else existing.longitude
            if was_deactivated:
                existing.status = TankStatusEnum.ACTIVE
                existing.deactivated_at = None
                stats["reactivated"] += 1
            else:
                stats["updated"] += 1

    if key_field_counts:
        chosen_key_field = max(key_field_counts, key=lambda field: key_field_counts[field])
    if chosen_key_field is not None:
        layer.tank_key_field = chosen_key_field

    deactivated_count = 0
    deactivated_with_sensors = 0
    for tank in existing_tanks.values():
        if tank.source_key in seen_source_keys:
            continue
        if tank.status == TankStatusEnum.DEACTIVATED:
            continue
        tank.status = TankStatusEnum.DEACTIVATED
        tank.deactivated_at = datetime.utcnow()
        deactivated_count += 1
        has_active_sensor = (
            db.query(SensorDevice.id)
            .filter(
                SensorDevice.tank_id == tank.id,
                SensorDevice.activated.is_(True),
            )
            .first()
        )
        if has_active_sensor:
            deactivated_with_sensors += 1

    return _sync_summary(
        created=stats["created"],
        updated=stats["updated"],
        reactivated=stats["reactivated"],
        deactivated=deactivated_count,
        deactivated_with_sensors=deactivated_with_sensors,
        total=len(existing_tanks) + stats["created"],
    )
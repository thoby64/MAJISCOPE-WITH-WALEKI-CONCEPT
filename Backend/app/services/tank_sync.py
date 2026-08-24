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

DEFAULT_TANK_NAME = "TANK"


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


def _is_usable_name(value: Any) -> bool:
    """True when the value is a human-readable tank name.

    Purely numeric values (e.g. ``322``, ``1357``) come from numeric ID
    columns such as ``ObjectID``/``Id`` and are not real names, so callers
    treat them as "no name provided" and fall back to a numbered default.
    """
    if _is_missing_value(value):
        return False
    text = str(value).strip()
    return any(char.isalpha() for char in text)


_NUMERIC_DEFAULT_RE = re.compile(r"^TANK-\d+$")


def _is_numeric_only(value: Any) -> bool:
    """True when the value consists only of digits (e.g. ``322``, ``050``)."""
    if _is_missing_value(value):
        return False
    text = str(value).strip()
    return text.isdigit()


def _resolve_tank_name(raw_value: Any) -> str:
    """Convert a raw name value into a human-readable tank name.

    - Readable names (containing letters) are returned as-is.
    - Purely numeric values become ``TANK-<number>`` (e.g. ``TANK-322``).
    - Missing or non-readable values become the plain default ``TANK``.
    """
    if _is_missing_value(raw_value):
        return DEFAULT_TANK_NAME
    text = str(raw_value).strip()
    if _is_numeric_only(raw_value):
        return f"{DEFAULT_TANK_NAME}-{text}"
    if _is_usable_name(raw_value):
        return text
    return DEFAULT_TANK_NAME


def _name_priority(name: Optional[str]) -> int:
    """Return a priority score for a tank name (higher = more informative).

    3 = real readable name
    2 = numbered default ``TANK-<n>``
    1 = plain default ``TANK``
    0 = unusable / missing / purely numeric
    """
    if not name:
        return 0
    text = str(name).strip()
    if not text:
        return 0
    if _is_usable_name(text):
        return 3
    if _NUMERIC_DEFAULT_RE.match(text):
        return 2
    if text == DEFAULT_TANK_NAME:
        return 1
    return 0


def detect_tank_raw_name(properties: Dict[str, Any]) -> Any:
    """Return the raw value of the first name-like field, even if numeric.

    Unlike ``detect_tank_key_field`` this does not reject numeric values;
    it merely finds the first non-missing candidate field. The caller then
    decides how to interpret the value (via ``_resolve_tank_name``).
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
            return value
    return None


def detect_tank_key_field(properties: Dict[str, Any]) -> Optional[str]:
    """
    Pick the first usable name-like property matched against candidates.

    Property keys are matched case-insensitively and ignoring separators
    (``TankName`` matches candidate ``tank_name``). Only human-readable values
    are accepted: purely numeric values (e.g. ``ObjectID``/``Id`` exports like
    ``322``) are rejected so callers fall back to the coordinate hash and the
    default ``TANK`` name. Returns the actual property key present in the
    feature, or ``None`` when no usable candidate is available.
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
        if _is_usable_name(value):
            return original_key
    return None


def _extract_centroid(geometry: Optional[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    if not isinstance(geometry, dict):
        return None
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Point" and isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        return _to_float_pair(coordinates)
    if geometry_type == "MultiPoint" and isinstance(coordinates, (list, tuple)) and coordinates:
        first = coordinates[0]
        if isinstance(first, (list, tuple)):
            return _to_float_pair(first)
    return None


def _to_float_pair(coordinates) -> Optional[Tuple[float, float]]:
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
    skipped_duplicates: int = 0,
) -> Dict[str, Any]:
    return {
        "created": created,
        "updated": updated,
        "reactivated": reactivated,
        "deactivated": deactivated,
        "deactivated_with_sensors": deactivated_with_sensors,
        "skipped_duplicates": skipped_duplicates,
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

    # Coordinate index for duplicate detection: unnamed features are matched
    # against existing tank locations so re-uploads never create duplicates.
    coords_index: Dict[str, Tank] = {}
    for tank in existing_tanks.values():
        if tank.latitude is not None and tank.longitude is not None:
            coords_index[coordinate_hash(tank.latitude, tank.longitude)] = tank

    seen_source_keys: set[str] = set()
    chosen_key_field: Optional[str] = None
    key_field_counts: Dict[str, int] = {}

    stats = {
        "created": 0,
        "updated": 0,
        "reactivated": 0,
        "skipped_duplicates": 0,
    }

    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            properties = {}

        key_field = detect_tank_key_field(properties)
        key_field_counts[key_field] = key_field_counts.get(key_field, 0) + 1

        # Raw name from the first name-like field (even if numeric) so we can
        # fold numeric identifiers into a "TANK-<n>" default.
        raw_name_value = detect_tank_raw_name(properties)

        geometry = feature.get("geometry")

        latitude: Optional[float] = None
        longitude: Optional[float] = None
        centroid = _extract_centroid(geometry)
        if centroid is not None:
            latitude, longitude = centroid

        name: Optional[str] = None
        source_key: Optional[str] = None
        if key_field is not None:
            raw_value = properties.get(key_field)
            source_key = str(raw_value).strip()
            name = source_key or None
            if not source_key:
                source_key = None

        if source_key is None:
            # Unnamed feature: fall back to the coordinate hash, but first
            # check for an existing tank at the same location so re-uploads
            # (with or without names) never create duplicate tanks.
            if latitude is None or longitude is None:
                continue
            coords_hash = coordinate_hash(latitude, longitude)
            existing_by_coords = coords_index.get(coords_hash)
            if existing_by_coords is not None:
                seen_source_keys.add(existing_by_coords.source_key)
                # Upgrade placeholder names when we can derive a more specific one.
                candidate = _resolve_tank_name(raw_name_value)
                if _name_priority(candidate) > _name_priority(existing_by_coords.name):
                    existing_by_coords.name = candidate
                stats["skipped_duplicates"] += 1
                continue
            source_key = coords_hash

        if not source_key:
            continue

        # Human-readable fallback: never display coordinates as a tank name.
        fallback_name = name or _resolve_tank_name(raw_name_value)

        seen_source_keys.add(source_key)
        existing = existing_tanks.get(source_key)

        if existing is None:
            tank = Tank(
                utility_id=utility_id,
                source_key=source_key,
                name=fallback_name,
                latitude=latitude,
                longitude=longitude,
                status=TankStatusEnum.ACTIVE,
            )
            db.add(tank)
            if latitude is not None and longitude is not None:
                coords_index[coordinate_hash(latitude, longitude)] = tank
            stats["created"] += 1
        else:
            was_deactivated = existing.status == TankStatusEnum.DEACTIVATED
            # Prefer real names; otherwise upgrade placeholders when possible.
            if _is_usable_name(name):
                existing.name = name
            elif _name_priority(existing.name) < 2:
                # Existing name is plain "TANK" or unusable; try to use raw value.
                candidate = _resolve_tank_name(raw_name_value)
                if _name_priority(candidate) > _name_priority(existing.name):
                    existing.name = candidate
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
        skipped_duplicates=stats["skipped_duplicates"],
        total=len(existing_tanks) + stats["created"],
    )
"""
StorageFacility reconciliation from uploaded utility infrastructure layers.

StorageFacilitys are materialized from ``storage_facilities`` layers on upload. StorageFacilitys are
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
    StorageFacility,
    StorageFacilityStatusEnum,
    UtilityInfrastructureLayer,
)

STORAGE_FACILITY_NAME_KEY_CANDIDATES: Tuple[str, ...] = (
    "fid",
    "name",
    "storage_facility_name",
    "storage_facility",
    "id",
    "code",
    "asset_id",
    "storage_facility_id",
    "tank_name",
    "tank",
    "tank_id",
)

COORDINATE_KEY_PREFIX = "coord:"

DEFAULT_STORAGE_FACILITY_NAME = "STORAGE_FACILITY"


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
    """True when the value is a human-readable storage_facility name.

    Purely numeric values (e.g. ``322``, ``1357``) come from numeric ID
    columns such as ``ObjectID``/``Id`` and are not real names, so callers
    treat them as "no name provided" and fall back to a numbered default.
    """
    if _is_missing_value(value):
        return False
    text = str(value).strip()
    return any(char.isalpha() for char in text)


_NUMERIC_DEFAULT_RE = re.compile(r"^STORAGE_FACILITY-\d+$")


def _is_numeric_only(value: Any) -> bool:
    """True when the value consists only of digits (e.g. ``322``, ``050``)."""
    if _is_missing_value(value):
        return False
    text = str(value).strip()
    return text.isdigit()


def _resolve_storage_facility_name(raw_value: Any) -> str:
    """Convert a raw name value into a human-readable storage_facility name.

    - Readable names (containing letters) are returned as-is.
    - Purely numeric values become ``STORAGE_FACILITY-<number>`` (e.g. ``STORAGE_FACILITY-322``).
    - Missing or non-readable values become the plain default ``STORAGE_FACILITY``.
    """
    if _is_missing_value(raw_value):
        return DEFAULT_STORAGE_FACILITY_NAME
    text = str(raw_value).strip()
    if _is_numeric_only(raw_value):
        return f"{DEFAULT_STORAGE_FACILITY_NAME}-{text}"
    if _is_usable_name(raw_value):
        return text
    return DEFAULT_STORAGE_FACILITY_NAME


def _name_priority(name: Optional[str]) -> int:
    """Return a priority score for a storage_facility name (higher = more informative).

    3 = real readable name
    2 = numbered default ``STORAGE_FACILITY-<n>``
    1 = plain default ``STORAGE_FACILITY``
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
    if text == DEFAULT_STORAGE_FACILITY_NAME:
        return 1
    return 0


def detect_storage_facility_raw_name(properties: Dict[str, Any]) -> Any:
    """Return the raw value of the first name-like field, even if numeric.

    Unlike ``detect_storage_facility_key_field`` this does not reject numeric values;
    it merely finds the first non-missing candidate field. The caller then
    decides how to interpret the value (via ``_resolve_storage_facility_name``).
    """
    canonical_to_original = {
        _canonical_key(str(key)): key
        for key in properties.keys()
    }
    for candidate in STORAGE_FACILITY_NAME_KEY_CANDIDATES:
        canonical_candidate = _canonical_key(candidate)
        original_key = canonical_to_original.get(canonical_candidate)
        if original_key is None:
            continue
        value = properties.get(original_key)
        if not _is_missing_value(value):
            return value
    return None


def detect_storage_facility_key_field(properties: Dict[str, Any]) -> Optional[str]:
    """
    Pick the first usable name-like property matched against candidates.

    Property keys are matched case-insensitively and ignoring separators
    (``StorageFacilityName`` matches candidate ``storage_facility_name``). Only human-readable values
    are accepted: purely numeric values (e.g. ``ObjectID``/``Id`` exports like
    ``322``) are rejected so callers fall back to the coordinate hash and the
    default ``STORAGE_FACILITY`` name. Returns the actual property key present in the
    feature, or ``None`` when no usable candidate is available.
    """
    canonical_to_original = {
        _canonical_key(str(key)): key
        for key in properties.keys()
    }

    # Special handling for 'fid' - use it as the primary key if available
    # since it's guaranteed to be unique (feature ID from GPKG)
    fid_key = None
    for candidate in ("fid", "FID", "Fid"):
        canonical_candidate = _canonical_key(candidate)
        original_key = canonical_to_original.get(canonical_candidate)
        if original_key is not None:
            fid_key = original_key
            break

    if fid_key and fid_key in properties:
        fid_value = properties.get(fid_key)
        if fid_key is not None and fid_key != "":
            return fid_key

    for candidate in STORAGE_FACILITY_NAME_KEY_CANDIDATES:
        if candidate == "fid":
            continue  # Already handled above
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


def coordinate_hash(latitude: float, longitude: float, fid: Optional[int] = None) -> str:
    if fid is not None:
        return f"{COORDINATE_KEY_PREFIX}{latitude:.6f},{longitude:.6f},{fid}"
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


def sync_storage_facilities_from_layer(
    db: Session,
    utility_id: str,
    features: List[Dict[str, Any]],
    layer: UtilityInfrastructureLayer,
) -> Dict[str, Any]:
    """
    Reconcile the ``storage_facility`` table from the features of an uploaded storage
    infrastructure layer.

    Matching is by ``(utility_id, source_key)``. StorageFacilitys present before but
    absent from the new layer are soft-deactivated. StorageFacilitys that come back in a
    later upload are reactivated.
    """
    existing_storage_facilities = {
        storage_facility.source_key: storage_facility
        for storage_facility in db.query(StorageFacility).filter(StorageFacility.utility_id == utility_id).all()
    }

    # Coordinate index for duplicate detection: unnamed features are matched
    # against existing storage_facility locations so re-uploads never create duplicates.
    coords_index: Dict[str, StorageFacility] = {}
    for storage_facility in existing_storage_facilities.values():
        if storage_facility.latitude is not None and storage_facility.longitude is not None:
            coords_index[coordinate_hash(storage_facility.latitude, storage_facility.longitude)] = storage_facility

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

        key_field = detect_storage_facility_key_field(properties)
        key_field_counts[key_field] = key_field_counts.get(key_field, 0) + 1

        # Raw name from the first name-like field (even if numeric) so we can
        # fold numeric identifiers into a "STORAGE_FACILITY-<n>" default.
        raw_name_value = detect_storage_facility_raw_name(properties)

        geometry = feature.get("geometry")

        latitude: Optional[float] = None
        longitude: Optional[float] = None
        centroid = _extract_centroid(geometry)
        if centroid is not None:
            latitude, longitude = centroid

        # Extract fid for unique coordinate hashing
        fid = properties.get("fid")
        if isinstance(fid, (int, float)) and not isinstance(fid, bool):
            fid = int(fid)
        else:
            fid = None

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
            # check for an existing storage_facility at the same location so re-uploads
            # (with or without names) never create duplicate storage_facilities.
            if latitude is None or longitude is None:
                continue
            coords_hash = coordinate_hash(latitude, longitude, fid)
            existing_by_coords = coords_index.get(coords_hash)
            if existing_by_coords is not None:
                seen_source_keys.add(existing_by_coords.source_key)
                # Upgrade placeholder names when we can derive a more specific one.
                candidate = _resolve_storage_facility_name(raw_name_value)
                if _name_priority(candidate) > _name_priority(existing_by_coords.name):
                    existing_by_coords.name = candidate
                stats["skipped_duplicates"] += 1
                continue
            # Include fid in source_key when derived from coordinates to ensure uniqueness
            source_key = f"{coords_hash}#{fid}" if fid is not None else coords_hash

        if not source_key:
            continue

        # Human-readable fallback: never display coordinates as a storage_facility name.
        fallback_name = name or _resolve_storage_facility_name(raw_name_value)

        # Check if we've already seen this source_key in the current batch
        # to avoid creating duplicate storage_facilities within the same batch.
        if source_key in seen_source_keys:
            stats["skipped_duplicates"] += 1
            continue

        seen_source_keys.add(source_key)

        # Also check the database directly for any storage_facilities that may have been
        # created in this transaction but not yet in existing_storage_facilities.
        # This handles the case where a previous feature in this batch
        # created a storage_facility with the same source_key that was flushed to the DB.
        # Flush first to ensure any pending changes are visible to the query.
        db.flush()
        existing = existing_storage_facilities.get(source_key)
        if existing is None:
            # Double-check the database directly in case a storage_facility with this
            # source_key was created and flushed earlier in this transaction.
            from app.models import StorageFacility as MainStorageFacility
            existing = db.query(StorageFacility).filter(
                StorageFacility.utility_id == utility_id,
                StorageFacility.source_key == source_key
            ).first()
            if existing:
                existing_storage_facilities[source_key] = existing

        if existing is None:
            storage_facility = StorageFacility(
                utility_id=utility_id,
                source_key=source_key,
                name=fallback_name,
                latitude=latitude,
                longitude=longitude,
                status=StorageFacilityStatusEnum.ACTIVE,
            )
            db.add(storage_facility)
            if latitude is not None and longitude is not None:
                coords_index[coordinate_hash(latitude, longitude)] = storage_facility
            stats["created"] += 1
        else:
            was_deactivated = existing.status == StorageFacilityStatusEnum.DEACTIVATED
            # Prefer real names; otherwise upgrade placeholders when possible.
            if _is_usable_name(name):
                existing.name = name
            elif _name_priority(existing.name) < 2:
                # Existing name is plain "STORAGE_FACILITY" or unusable; try to use raw value.
                candidate = _resolve_storage_facility_name(raw_name_value)
                if _name_priority(candidate) > _name_priority(existing.name):
                    existing.name = candidate
            existing.latitude = latitude if latitude is not None else existing.latitude
            existing.longitude = longitude if longitude is not None else existing.longitude
            if was_deactivated:
                existing.status = StorageFacilityStatusEnum.ACTIVE
                existing.deactivated_at = None
                stats["reactivated"] += 1
            else:
                stats["updated"] += 1

    if key_field_counts:
        chosen_key_field = max(key_field_counts, key=lambda field: key_field_counts[field])
    if chosen_key_field is not None:
        layer.storage_facility_key_field = chosen_key_field

    deactivated_count = 0
    deactivated_with_sensors = 0
    for storage_facility in existing_storage_facilities.values():
        if storage_facility.source_key in seen_source_keys:
            continue
        if storage_facility.status == StorageFacilityStatusEnum.DEACTIVATED:
            continue
        storage_facility.status = StorageFacilityStatusEnum.DEACTIVATED
        storage_facility.deactivated_at = datetime.utcnow()
        deactivated_count += 1
        has_active_sensor = _storage_facility_has_active_sensor(db, storage_facility.id)
        if has_active_sensor:
            deactivated_with_sensors += 1

    # Mirror every touched storage_facility into the sensor platform DB (best effort;
    # failures queue in the outbox and drain later).
    _mirror_synced_storage_facilities(db, existing_storage_facilities.values(), seen_source_keys)

    return _sync_summary(
        created=stats["created"],
        updated=stats["updated"],
        reactivated=stats["reactivated"],
        deactivated=deactivated_count,
        deactivated_with_sensors=deactivated_with_sensors,
        skipped_duplicates=stats["skipped_duplicates"],
        total=len(existing_storage_facilities) + stats["created"],
    )


def _storage_facility_has_active_sensor(db: Session, storage_facility_id: str) -> bool:
    """True when the storage_facility has any activated sensor (sensor platform DB)."""
    try:
        from app.database.sensor_session import SensorSessionLocal
        from app.models.sensor_platform import SensorDevice as PlatformSensorDevice

        with SensorSessionLocal() as sensor_db:
            return (
                sensor_db.query(PlatformSensorDevice.id)
                .filter(
                    PlatformSensorDevice.storage_facility_id == storage_facility_id,
                    PlatformSensorDevice.activated.is_(True),
                )
                .first()
                is not None
            )
    except Exception:
        # Sensor DB unavailable during a main-DB sync: don't block the sync.
        return False


def _mirror_synced_storage_facilities(db: Session, storage_facilities, seen_source_keys) -> None:
    """Best-effort mirror of storage_facilities touched by a storage-layer sync."""
    from app.services.sensor_platform_sync import mirror_storage_facility

    created_or_updated = [t for t in storage_facilities if t.source_key in seen_source_keys]
    # Deactivated storage_facilities are also mirrored (status change matters downstream).
    for storage_facility in list(created_or_updated) + [
        t for t in storage_facilities if t.status == StorageFacilityStatusEnum.DEACTIVATED and t.deactivated_at is not None
    ]:
        try:
            mirror_storage_facility(db, storage_facility)
        except Exception:
            continue
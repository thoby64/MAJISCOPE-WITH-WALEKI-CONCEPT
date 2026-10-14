"""Reconcile water-source entities from uploaded infrastructure GeoPackages."""

from __future__ import annotations

import re
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import UtilityInfrastructureLayer, WaterSource, WaterSourceStatusEnum
from app.services.storage_facility_sync import coordinate_hash, _extract_centroid

_KEY_CANDIDATES = (
    "water_source_id",
    "source_id",
    "borehole_id",
    "well_id",
    "intake_id",
    "asset_id",
    "code",
    "id",
    "fid",
    "water_source_name",
    "source_name",
    "borehole_name",
    "well_name",
    "intake_name",
    "name",
    "water_source",
    "source",
)
_SOURCE_TYPE_CANDIDATES = ("source_type", "water_source_type", "type", "asset_type", "category")
_NAME_FALLBACK = "WATER_SOURCE"
logger = logging.getLogger(__name__)


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def _value(properties: dict[str, Any], candidates: tuple[str, ...]) -> tuple[Optional[str], Any]:
    lookup = {_canonical(str(key)): key for key in properties}
    for candidate in candidates:
        key = lookup.get(_canonical(candidate))
        if key is not None:
            value = properties.get(key)
            if value is not None and str(value).strip():
                return str(key), value
    return None, None


def _has_name(value: Any) -> bool:
    return value is not None and any(char.isalpha() for char in str(value).strip())


def _fallback_name(raw_name: Any) -> str:
    if raw_name is None or not str(raw_name).strip():
        return _NAME_FALLBACK
    value = str(raw_name).strip()
    return value if _has_name(value) else f"{_NAME_FALLBACK}-{value}"


def _source_type(properties: dict[str, Any]) -> Optional[str]:
    _, value = _value(properties, _SOURCE_TYPE_CANDIDATES)
    if value is None:
        return None
    normalized = re.sub(r"[\s-]+", "_", str(value).strip().lower())
    aliases = {
        "bore_hole": "borehole",
        "borehole": "borehole",
        "well": "well",
        "wells": "well",
        "intake": "intake",
        "river_intake": "intake",
        "spring": "spring",
        "dam": "dam",
    }
    return aliases.get(normalized, normalized[:100])


def sync_water_sources_from_layer(
    db: Session,
    utility_id: str,
    features: List[Dict[str, Any]],
    layer: UtilityInfrastructureLayer,
) -> Dict[str, Any]:
    """Upsert source rows using stable feature keys and soft-deactivate removals."""
    existing_by_key = {
        item.source_key: item
        for item in db.query(WaterSource).filter(WaterSource.utility_id == utility_id).all()
    }
    coordinate_index = {
        coordinate_hash(item.latitude, item.longitude): item
        for item in existing_by_key.values()
        if item.latitude is not None and item.longitude is not None
    }
    seen: set[str] = set()
    key_field_counts: dict[str, int] = {}
    counts = {"created": 0, "updated": 0, "reactivated": 0, "skipped_duplicates": 0}

    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        properties = properties if isinstance(properties, dict) else {}
        key_field, key_value = _value(properties, _KEY_CANDIDATES)
        key_field_counts[key_field] = key_field_counts.get(key_field, 0) + 1
        _, raw_name = _value(properties, ("name", "water_source_name", "source_name", "borehole_name", "well_name", "intake_name", "water_source"))
        if raw_name is None:
            raw_name = key_value

        location = _extract_centroid(feature.get("geometry"))
        latitude, longitude = location if location is not None else (None, None)

        source_key = str(key_value).strip() if key_value is not None else ""
        if not source_key:
            if latitude is None or longitude is None:
                continue
            fid = properties.get("fid")
            fid = int(fid) if isinstance(fid, (int, float)) and not isinstance(fid, bool) else None
            coord = coordinate_hash(latitude, longitude)
            matched = coordinate_index.get(coord)
            if matched is not None:
                seen.add(matched.source_key)
                if not matched.name or matched.name == _NAME_FALLBACK:
                    matched.name = _fallback_name(raw_name)
                counts["skipped_duplicates"] += 1
                continue
            source_key = f"{coordinate_hash(latitude, longitude, fid)}#{fid}" if fid is not None else coord

        if source_key in seen:
            counts["skipped_duplicates"] += 1
            continue
        seen.add(source_key)

        source = existing_by_key.get(source_key)
        if source is None:
            source = (
                db.query(WaterSource)
                .filter(WaterSource.utility_id == utility_id, WaterSource.source_key == source_key)
                .first()
            )
        if source is None:
            source = WaterSource(
                utility_id=utility_id,
                source_key=source_key,
                name=_fallback_name(raw_name),
                source_type=_source_type(properties),
                latitude=latitude,
                longitude=longitude,
                status=WaterSourceStatusEnum.ACTIVE,
            )
            db.add(source)
            existing_by_key[source_key] = source
            counts["created"] += 1
        else:
            was_deactivated = source.status == WaterSourceStatusEnum.DEACTIVATED
            if _has_name(raw_name) or not source.name:
                source.name = str(raw_name).strip()
            elif source.name == _NAME_FALLBACK:
                source.name = _fallback_name(raw_name)
            detected_type = _source_type(properties)
            if detected_type:
                source.source_type = detected_type
            if latitude is not None:
                source.latitude = latitude
            if longitude is not None:
                source.longitude = longitude
            if was_deactivated:
                source.status = WaterSourceStatusEnum.ACTIVE
                source.deactivated_at = None
                counts["reactivated"] += 1
            else:
                counts["updated"] += 1

    if key_field_counts:
        layer.water_source_key_field = max(key_field_counts, key=key_field_counts.get)

    deactivated = 0
    deactivated_with_sensors = 0
    for source in existing_by_key.values():
        if source.source_key in seen or source.status == WaterSourceStatusEnum.DEACTIVATED:
            continue
        source.status = WaterSourceStatusEnum.DEACTIVATED
        source.deactivated_at = datetime.utcnow()
        deactivated += 1
        try:
            from app.database.sensor_session import SensorSessionLocal
            from app.models.sensor_platform import WaterSourceSensorDevice

            with SensorSessionLocal() as sensor_db:
                if sensor_db.query(WaterSourceSensorDevice.id).filter(
                    WaterSourceSensorDevice.water_source_id == source.id,
                    WaterSourceSensorDevice.activated.is_(True),
                ).first():
                    deactivated_with_sensors += 1
        except Exception as exc:
            logger.warning("Could not check active water-source sensors for %s: %s", source.id, exc)

    db.flush()
    return {
        **counts,
        "deactivated": deactivated,
        "deactivated_with_sensors": deactivated_with_sensors,
        "total": len(existing_by_key),
        "has_warnings": deactivated_with_sensors > 0,
    }


def mirror_synced_water_sources(db: Session, utility_id: str) -> None:
    """Mirror utility sources after their owning main-database transaction commits."""
    from app.services.sensor_platform_sync import mirror_water_source

    for source in db.query(WaterSource).filter(WaterSource.utility_id == utility_id).all():
        mirror_water_source(db, source)

"""Startup storage_facility backfill from uploaded storage_facilities GeoPackage layers.

StorageFacilitys only (per Phase 3 decision). Idempotent by ``(utility_id, source_key)``
via ``sync_storage_facilities_from_layer``. One corrupt layer is logged and skipped; the
rest of startup proceeds.
"""
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from app.models import UtilityInfrastructureLayer
from app.services.storage_facility_sync import sync_storage_facilities_from_layer
from app.services.water_source_sync import sync_water_sources_from_layer, mirror_synced_water_sources

STORAGE_FACILITIES = "storage_facilities"
WATER_SOURCES = "water_sources"

_COUNT_KEYS = ("created", "updated", "reactivated", "deactivated", "skipped_duplicates")


def run_storage_facility_gpkg_sync_on_startup(
    db: Session,
    loader: Optional[Callable] = None,
) -> Dict[str, Any]:
    """Backfill storage_facilities from stored storage_facilities GPKG layers.

    ``loader(file_name, file_data)`` returns the feature list for a layer; it is
    injectable for tests. Defaults to the GeoPackage feature loader.
    """
    if loader is None:
        from app.api.utilities import load_storage_facilities_features
        loader = load_storage_facilities_features

    layers = (
        db.query(UtilityInfrastructureLayer)
        .filter(UtilityInfrastructureLayer.asset_type == STORAGE_FACILITIES)
        .order_by(UtilityInfrastructureLayer.utility_id, UtilityInfrastructureLayer.file_name)
        .all()
    )

    aggregate: Dict[str, Any] = {
        "layers": len(layers),
        "failed": 0,
    }
    for key in _COUNT_KEYS:
        aggregate[key] = 0

    for layer in layers:
        try:
            features = loader(layer.file_name, layer.file_data)
            summary = sync_storage_facilities_from_layer(db, layer.utility_id, features, layer)
            db.commit()
            for key in _COUNT_KEYS:
                aggregate[key] += summary.get(key, 0)
            print(
                f"   StorageFacility GPKG Startup Sync: utility={layer.utility_id} "
                f"layer={layer.file_name} created={summary.get('created', 0)} "
                f"updated={summary.get('updated', 0)} "
                f"reactivated={summary.get('reactivated', 0)}"
            )
        except Exception as exc:  # noqa: BLE001 - one bad layer must not kill startup
            aggregate["failed"] += 1
            db.rollback()
            print(f"   StorageFacility GPKG Startup Sync failed for layer {layer.file_name}: {exc}")

    if layers:
        print(f"   StorageFacility GPKG Startup Sync total: {aggregate['layers']} layer(s), "
              f"{aggregate['created']} created, {aggregate['updated']} updated, "
              f"{aggregate['skipped_duplicates']} duplicate skips, "
              f"{aggregate['failed']} failed")
    return aggregate


def run_water_source_gpkg_sync_on_startup(
    db: Session,
    loader: Optional[Callable] = None,
) -> Dict[str, Any]:
    """Backfill water-source entities from uploaded water_sources GeoPackages."""
    if loader is None:
        from app.api.utilities import load_water_sources_features
        loader = load_water_sources_features

    layers = (
        db.query(UtilityInfrastructureLayer)
        .filter(UtilityInfrastructureLayer.asset_type == WATER_SOURCES)
        .order_by(UtilityInfrastructureLayer.utility_id, UtilityInfrastructureLayer.file_name)
        .all()
    )
    aggregate: Dict[str, Any] = {"layers": len(layers), "failed": 0}
    for key in _COUNT_KEYS:
        aggregate[key] = 0

    for layer in layers:
        try:
            features = loader(layer.file_name, layer.file_data)
            summary = sync_water_sources_from_layer(db, layer.utility_id, features, layer)
            db.commit()
            mirror_synced_water_sources(db, layer.utility_id)
            for key in _COUNT_KEYS:
                aggregate[key] += summary.get(key, 0)
        except Exception as exc:
            aggregate["failed"] += 1
            db.rollback()
            print(f"Water-source GPKG Startup Sync failed for layer {layer.file_name}: {exc}")

    if layers:
        print(
            f"   Water-source GPKG Startup Sync total: {aggregate['layers']} layer(s), "
            f"{aggregate['created']} created, {aggregate['updated']} updated, "
            f"{aggregate['skipped_duplicates']} duplicate skips, {aggregate['failed']} failed"
        )
    return aggregate

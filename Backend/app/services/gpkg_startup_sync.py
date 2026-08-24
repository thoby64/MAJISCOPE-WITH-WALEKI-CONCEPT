"""Startup tank backfill from uploaded storage_facilities GeoPackage layers.

Tanks only (per Phase 3 decision). Idempotent by ``(utility_id, source_key)``
via ``sync_tanks_from_layer``. One corrupt layer is logged and skipped; the
rest of startup proceeds.
"""
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from app.models import UtilityInfrastructureLayer
from app.services.tank_sync import sync_tanks_from_layer

STORAGE_FACILITIES = "storage_facilities"

_COUNT_KEYS = ("created", "updated", "reactivated", "deactivated", "skipped_duplicates")


def run_tank_gpkg_sync_on_startup(
    db: Session,
    loader: Optional[Callable] = None,
) -> Dict[str, Any]:
    """Backfill tanks from stored storage_facilities GPKG layers.

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
            summary = sync_tanks_from_layer(db, layer.utility_id, features, layer)
            db.commit()
            for key in _COUNT_KEYS:
                aggregate[key] += summary.get(key, 0)
            print(
                f"   Tank GPKG Startup Sync: utility={layer.utility_id} "
                f"layer={layer.file_name} created={summary.get('created', 0)} "
                f"updated={summary.get('updated', 0)} "
                f"reactivated={summary.get('reactivated', 0)}"
            )
        except Exception as exc:  # noqa: BLE001 - one bad layer must not kill startup
            aggregate["failed"] += 1
            db.rollback()
            print(f"   Tank GPKG Startup Sync failed for layer {layer.file_name}: {exc}")

    if layers:
        print(f"   Tank GPKG Startup Sync total: {aggregate['layers']} layer(s), "
              f"{aggregate['created']} created, {aggregate['updated']} updated, "
              f"{aggregate['skipped_duplicates']} duplicate skips, "
              f"{aggregate['failed']} failed")
    return aggregate

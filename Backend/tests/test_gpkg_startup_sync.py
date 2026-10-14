"""GPKG startup storage_facility sync — idempotent backfill from stored storage_facilities layers."""
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import StorageFacility, Utility, UtilityInfrastructureLayer, WaterSource
from app.models.sensor_platform import WaterSourceRef
from app.services.gpkg_startup_sync import (
    run_storage_facility_gpkg_sync_on_startup,
    run_water_source_gpkg_sync_on_startup,
)


def _make_utility(db: Session, name: str = "Co A") -> Utility:
    utility = Utility(name=name, slug=f"cs-{name.lower().replace(' ', '-')}")
    db.add(utility)
    db.commit()
    db.refresh(utility)
    return utility


def _make_layer(db: Session, utility: Utility, file_name: str = "storage_facilities.gpkg") -> UtilityInfrastructureLayer:
    layer = UtilityInfrastructureLayer(
        utility_id=utility.id,
        asset_type="storage_facilities",
        file_data=b"%PDF-fake-bytes",
        file_name=file_name,
        file_size=15,
        feature_count=2,
    )
    db.add(layer)
    db.commit()
    db.refresh(layer)
    return layer


def _fake_loader(*_args, **_kwargs):
    return [
        {"type": "Feature", "properties": {"TankName": "Reservoir One"},
         "geometry": {"type": "Point", "coordinates": [36.7, -3.4]}},
        {"type": "Feature", "properties": {"TankName": "Reservoir Two"},
         "geometry": {"type": "Point", "coordinates": [36.8, -3.5]}},
    ]


class TestGpkgStartupSync:
    def test_creates_missing_storage_facilities_idempotently(self, db: Session):
        utility = _make_utility(db)
        layer = _make_layer(db, utility)

        first = run_storage_facility_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert first["created"] == 2
        assert first["layers"] == 1
        assert first["failed"] == 0
        db.flush()
        assert db.query(StorageFacility).filter(StorageFacility.utility_id == utility.id).count() == 2

        second = run_storage_facility_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert second["created"] == 0
        assert db.query(StorageFacility).filter(StorageFacility.utility_id == utility.id).count() == 2

    def test_skips_non_storage_layers(self, db: Session):
        utility = _make_utility(db)
        layer = _make_layer(db, utility)
        layer.asset_type = "pipes"
        db.add(layer)
        db.commit()

        result = run_storage_facility_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert result["layers"] == 0
        assert result["created"] == 0

    def test_corrupt_layer_does_not_abort(self, db: Session):
        utility = _make_utility(db)
        _make_layer(db, utility, file_name="bad.gpkg")

        def bad_loader(*_args, **_kwargs):
            raise RuntimeError("corrupt gpkg")

        result = run_storage_facility_gpkg_sync_on_startup(db, loader=bad_loader)
        assert result["failed"] == 1
        assert result["created"] == 0

    def test_no_layers_is_noop(self, db: Session):
        result = run_storage_facility_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert result == {
            "layers": 0, "created": 0, "updated": 0,
            "reactivated": 0, "deactivated": 0, "skipped_duplicates": 0,
            "failed": 0,
        }


class TestWaterSourceGpkgStartupSync:
    def test_creates_and_reconciles_sources_idempotently(self, db: Session, sensor_db: Session):
        utility = _make_utility(db)
        layer = UtilityInfrastructureLayer(
            utility_id=utility.id,
            asset_type="water_sources",
            file_data=b"water source layer",
            file_name="water_sources.gpkg",
            file_size=18,
            feature_count=1,
        )
        db.add(layer)
        db.commit()
        db.refresh(layer)
        features = [
            {
                "type": "Feature",
                "properties": {
                    "source_id": "BH-001",
                    "name": "Community borehole",
                    "source_type": "bore hole",
                },
                "geometry": {"type": "Point", "coordinates": [36.7, -3.4]},
            }
        ]

        first = run_water_source_gpkg_sync_on_startup(db, loader=lambda *_args: features)
        db.flush()
        source = db.query(WaterSource).filter_by(utility_id=utility.id).one()
        assert first["created"] == 1
        assert first["failed"] == 0
        assert source.source_key == "BH-001"
        assert source.source_type == "borehole"
        assert sensor_db.get(WaterSourceRef, source.id) is not None

        renamed_features = [
            {
                **features[0],
                "properties": {**features[0]["properties"], "name": "Renamed borehole"},
            }
        ]
        second = run_water_source_gpkg_sync_on_startup(db, loader=lambda *_args: renamed_features)
        assert second["created"] == 0
        assert second["updated"] == 1
        assert db.query(WaterSource).filter_by(utility_id=utility.id).count() == 1
        assert db.query(WaterSource).filter_by(utility_id=utility.id).one().id == source.id
        assert db.query(WaterSource).filter_by(utility_id=utility.id).one().name == "Renamed borehole"

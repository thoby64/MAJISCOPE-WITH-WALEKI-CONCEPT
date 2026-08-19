"""GPKG startup tank sync — idempotent backfill from stored storage_facilities layers."""
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Tank, Utility, UtilityInfrastructureLayer
from app.services.gpkg_startup_sync import run_tank_gpkg_sync_on_startup


def _make_utility(db: Session, name: str = "Co A") -> Utility:
    utility = Utility(name=name, slug=f"cs-{name.lower().replace(' ', '-')}")
    db.add(utility)
    db.commit()
    db.refresh(utility)
    return utility


def _make_layer(db: Session, utility: Utility, file_name: str = "tanks.gpkg") -> UtilityInfrastructureLayer:
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
        {"type": "Feature", "properties": {"TankName": "Tank One"},
         "geometry": {"type": "Point", "coordinates": [36.7, -3.4]}},
        {"type": "Feature", "properties": {"TankName": "Tank Two"},
         "geometry": {"type": "Point", "coordinates": [36.8, -3.5]}},
    ]


class TestGpkgStartupSync:
    def test_creates_missing_tanks_idempotently(self, db: Session):
        utility = _make_utility(db)
        layer = _make_layer(db, utility)

        first = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert first["created"] == 2
        assert first["layers"] == 1
        assert first["failed"] == 0
        db.flush()
        assert db.query(Tank).filter(Tank.utility_id == utility.id).count() == 2

        second = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert second["created"] == 0
        assert db.query(Tank).filter(Tank.utility_id == utility.id).count() == 2

    def test_skips_non_storage_layers(self, db: Session):
        utility = _make_utility(db)
        layer = _make_layer(db, utility)
        layer.asset_type = "pipes"
        db.add(layer)
        db.commit()

        result = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert result["layers"] == 0
        assert result["created"] == 0

    def test_corrupt_layer_does_not_abort(self, db: Session):
        utility = _make_utility(db)
        _make_layer(db, utility, file_name="bad.gpkg")

        def bad_loader(*_args, **_kwargs):
            raise RuntimeError("corrupt gpkg")

        result = run_tank_gpkg_sync_on_startup(db, loader=bad_loader)
        assert result["failed"] == 1
        assert result["created"] == 0

    def test_no_layers_is_noop(self, db: Session):
        result = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert result == {
            "layers": 0, "created": 0, "updated": 0,
            "reactivated": 0, "deactivated": 0, "failed": 0,
        }

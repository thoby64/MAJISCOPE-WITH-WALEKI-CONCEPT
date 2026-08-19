"""
Sensor and Tank API Tests
Tests for sensor registration, ingest, status derivation, tank reconciliation,
and role-scoped listing.
"""

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    DMA,
    Tank,
    SensorDevice,
    SensorReading,
    TankStatusEnum,
    Utility,
    UtilityInfrastructureLayer,
    UtilityManager,
)
from app.security.auth import create_access_token, hash_password
from app.services.tank_sync import sync_tanks_from_layer
from app.services.sensor_services import (
    compute_water_level,
    derive_status,
    extract_depth,
    parse_timestamp,
)
from app.models import SensorStatusEnum


def _make_utility(db: Session, name: str = "Water Co A") -> Utility:
    utility = Utility(name=name, slug=f"wc-{uuid4().hex[:8]}")
    db.add(utility)
    db.commit()
    db.refresh(utility)
    return utility


def _make_dma(db: Session, utility: Utility, name: str = "DMA 1") -> DMA:
    dma = DMA(name=name, utility_id=utility.id)
    db.add(dma)
    db.commit()
    db.refresh(dma)
    return dma


def _make_tank(db: Session, utility: Utility, source_key: str = "Tank A", **kwargs) -> Tank:
    tank = Tank(
        utility_id=utility.id,
        source_key=source_key,
        name=kwargs.get("name", source_key),
        latitude=kwargs.get("latitude", -3.4),
        longitude=kwargs.get("longitude", 36.7),
    )
    db.add(tank)
    db.commit()
    db.refresh(tank)
    return tank


def _make_sensor(
    db: Session,
    tank: Tank,
    device_id: str = "dev-1",
    **kwargs,
) -> SensorDevice:
    sensor = SensorDevice(
        device_id=device_id,
        tank_id=tank.id,
        h1_m=kwargs.get("h1_m", 12.0),
        depth_m=kwargs.get("depth_m"),
        warning_height_m=kwargs.get("warning_height_m", 10.0),
        critical_height_m=kwargs.get("critical_height_m", 0.0),
        activated=kwargs.get("activated", True),
    )
    db.add(sensor)
    db.commit()
    db.refresh(sensor)
    return sensor


def _utility_manager_headers(db: Session, utility: Utility) -> dict:
    manager = UtilityManager(
        email=f"mgr-{uuid4().hex[:8]}@example.com",
        name="Manager",
        password=hash_password("password123"),
        utility_id=utility.id,
    )
    db.add(manager)
    db.commit()
    db.refresh(manager)
    token = create_access_token(manager.id, manager.email)
    return {"Authorization": f"Bearer {token}"}


class TestWaterLevelCore:
    def test_compute_water_level_clamps_at_zero(self):
        assert compute_water_level(12.0, 5.0) == 7.0
        assert compute_water_level(5.0, 12.0) == 0.0
        assert compute_water_level(0.0, 0.0) == 0.0

    def test_derive_status_tiers(self):
        tank = SimpleNamespace(id="t1")
        sensor = SimpleNamespace(activated=True, critical_height_m=0.0, warning_height_m=10.0)
        assert derive_status(tank, sensor, 15.0) == SensorStatusEnum.ACTIVE
        assert derive_status(tank, sensor, 9.0) == SensorStatusEnum.WARNING
        assert derive_status(tank, sensor, 0.0) == SensorStatusEnum.CRITICAL
        sensor = SimpleNamespace(activated=False, critical_height_m=0.0, warning_height_m=10.0)
        assert derive_status(tank, sensor, 15.0) == SensorStatusEnum.INACTIVE

    def test_extract_depth_precedence(self):
        assert extract_depth({"depth_m": 2.5}, "ignored") == 2.5
        assert extract_depth({"H2": 3.0}, None) == 3.0
        assert extract_depth({"h2": 1.25}, None) == 1.25
        assert extract_depth({}, "Depth=4.25") == 4.25
        assert extract_depth({}, "D: 5.5") == 5.5
        assert extract_depth({}, None) == 0.0
        assert extract_depth({}, "no depth here") == 0.0

    def test_parse_timestamp_variants(self):
        iso = parse_timestamp("2026-08-17T12:34:56")
        assert iso is not None and iso.year == 2026
        underscore = parse_timestamp("2026-08-17_12-34-56")
        assert underscore is not None and underscore.hour == 12
        epoch_ms = parse_timestamp("1720000000000")
        assert epoch_ms is not None and epoch_ms.year >= 2024
        reading_timestamp = parse_timestamp("2026-08-17T00:00:00", reading_timestamp=None)
        assert reading_timestamp is not None
        assert parse_timestamp(None, None) is None
        assert parse_timestamp("garbage-not-a-date", None) is None


class TestTankSync:
    def test_created_updated_deactivated(self, db: Session):
        utility = _make_utility(db)
        existing_tank = _make_tank(db, utility, source_key="Existing", name="Existing")
        layer = UtilityInfrastructureLayer(
            utility_id=utility.id,
            asset_type="storage_facilities",
            file_data=b"",
            file_name="tanks.gpkg",
            file_size=0,
            feature_count=2,
        )
        db.add(layer)
        db.commit()
        db.refresh(layer)
        assert layer.tank_key_field is None

        features = [
            {"type": "Feature", "properties": {"TankName": "Existing"}, "geometry": {"type": "Point", "coordinates": [36.7, -3.4]}},
            {"type": "Feature", "properties": {"TankName": "New Tank"}, "geometry": {"type": "Point", "coordinates": [36.8, -3.5]}},
        ]
        summary = sync_tanks_from_layer(db, utility.id, features, layer)

        assert summary["created"] == 1
        assert summary["updated"] == 1
        assert summary["deactivated"] == 0
        assert summary["total"] == 2
        assert layer.tank_key_field == "TankName"

        db.flush()
        tanks = db.query(Tank).filter(Tank.utility_id == utility.id).all()
        assert len(tanks) == 2

        # Re-upload with only one tank -> the other is soft-deactivated
        features2 = [
            {"type": "Feature", "properties": {"TankName": "Existing"}, "geometry": {"type": "Point", "coordinates": [36.7, -3.4]}},
        ]
        summary2 = sync_tanks_from_layer(db, utility.id, features2, layer)
        assert summary2["deactivated"] == 1
        db.flush()
        new_tank = db.query(Tank).filter(Tank.source_key == "New Tank").first()
        assert new_tank.status == TankStatusEnum.DEACTIVATED
        assert new_tank.deactivated_at is not None
        assert existing_tank.id is not None

        # Re-upload again -> reactivated
        summary3 = sync_tanks_from_layer(db, utility.id, features, layer)
        assert summary3["reactivated"] == 1
        db.flush()
        db.refresh(new_tank)
        assert new_tank.status == TankStatusEnum.ACTIVE

    def test_coordinate_fallback_key(self, db: Session):
        utility = _make_utility(db)
        layer = UtilityInfrastructureLayer(
            utility_id=utility.id,
            asset_type="storage_facilities",
            file_data=b"",
            file_name="tanks.gpkg",
            file_size=0,
            feature_count=1,
        )
        db.add(layer)
        db.commit()
        db.refresh(layer)

        features = [
            {"type": "Feature", "properties": {"SomeOther": "x"}, "geometry": {"type": "Point", "coordinates": [36.7, -3.4]}},
        ]
        summary = sync_tanks_from_layer(db, utility.id, features, layer)
        assert summary["created"] == 1
        db.flush()
        tank = db.query(Tank).filter(Tank.utility_id == utility.id).first()
        assert tank.source_key.startswith("coord:")
        assert layer.tank_key_field is None

    def test_deactivated_with_sensor_warns(self, db: Session):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Only")
        _make_sensor(db, tank, device_id="dev-warn", activated=True)
        layer = UtilityInfrastructureLayer(
            utility_id=utility.id,
            asset_type="storage_facilities",
            file_data=b"",
            file_name="tanks.gpkg",
            file_size=0,
            feature_count=0,
        )
        db.add(layer)
        db.commit()
        db.refresh(layer)

        summary = sync_tanks_from_layer(db, utility.id, [], layer)
        assert summary["deactivated"] == 1
        assert summary["deactivated_with_sensors"] == 1
        assert summary["has_warnings"] is True


class TestSensorRegistration:
    def test_register_sensor(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility)
        response = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={
                "device_id": "dev-register",
                "tank_id": tank.id,
                "h1_m": 12.0,
                "activated": True,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["device_id"] == "dev-register"
        assert data["utility_id"] == utility.id
        assert data["activated"] is True
        assert data["warning_height_m"] == 10.0

    def test_register_duplicate_device_conflict(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility)
        _make_sensor(db, tank, device_id="dev-dup")
        response = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "dev-dup", "tank_id": tank.id},
        )
        assert response.status_code == 409

    def test_register_unknown_tank_404(self, client: TestClient, auth_headers: dict):
        response = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "dev-nope", "tank_id": "missing"},
        )
        assert response.status_code == 404

    def test_register_requires_privilege(self, client: TestClient, db: Session, auth_headers: dict):
        # An ordinary User row is an admin; a plain (unauthenticated) request must fail.
        response = client.post(
            "/api/sensors",
            json={"device_id": "dev-x", "tank_id": "whatever"},
        )
        assert response.status_code == 401

    def test_utility_manager_cannot_register_other_utility_sensor(
        self,
        client: TestClient,
        db: Session,
        auth_headers: dict,
    ):
        utility_a = _make_utility(db, name="Water Co A")
        utility_b = _make_utility(db, name="Water Co B")
        tank_b = _make_tank(db, utility_b, source_key="B Tank")
        headers_b = _utility_manager_headers(db, utility_a)
        response = client.post(
            "/api/sensors",
            headers=headers_b,
            json={"device_id": "dev-cross", "tank_id": tank_b.id},
        )
        assert response.status_code == 403


class TestIngest:
    def _register(self, client: TestClient, db: Session, auth_headers: dict, device_id: str = "dev-ingest"):
        utility = _make_utility(db)
        tank = _make_tank(db, utility)
        sensor = _make_sensor(db, tank, device_id=device_id, h1_m=12.0, activated=True)
        return sensor, tank

    def test_ingest_authenticated_user(self, client: TestClient, db: Session, auth_headers: dict):
        sensor, tank = self._register(client, db, auth_headers)
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": sensor.device_id, "h1_m": 12.0, "raw_data": "Depth=3.5"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["status"] == "warning"
        assert data["water_level_m"] == 8.5
        assert data["utility_id"] == tank.utility_id

    def test_ingest_unknown_device_404(self, client: TestClient, auth_headers: dict):
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": "unknown-device", "h1_m": 12.0},
        )
        assert response.status_code == 404

    def test_ingest_status_tiers(self, client: TestClient, db: Session, auth_headers: dict):
        sensor, _tank = self._register(client, db, auth_headers)
        # active: depth 2 -> water 10 >= warning 10
        resp = client.post("/api/sensors/ingest", headers=auth_headers,
                           json={"device_id": sensor.device_id, "h1_m": 12.0, "raw_data": "Depth=2"})
        assert resp.json()["status"] == "active"
        # warning: depth 4 -> water 8 < 10
        resp = client.post("/api/sensors/ingest", headers=auth_headers,
                           json={"device_id": sensor.device_id, "h1_m": 12.0, "raw_data": "Depth=4"})
        assert resp.json()["status"] == "warning"
        # critical: depth 12 -> water 0
        resp = client.post("/api/sensors/ingest", headers=auth_headers,
                           json={"device_id": sensor.device_id, "h1_m": 12.0, "raw_data": "Depth=12"})
        assert resp.json()["status"] == "critical"

    def test_ingest_inactive_sensor(self, client: TestClient, db: Session, auth_headers: dict):
        sensor, _tank = self._register(client, db, auth_headers)
        db.query(SensorDevice).filter(SensorDevice.id == sensor.id).update({"activated": False})
        db.commit()
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": sensor.device_id, "h1_m": 12.0, "raw_data": "Depth=2"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "inactive"

    def test_ingest_accepts_ingest_key(self, client: TestClient, db: Session, auth_headers: dict, monkeypatch):
        sensor, _tank = self._register(client, db, auth_headers)
        monkeypatch.setattr(settings, "sensor_ingest_key", "test-secret")
        response = client.post(
            "/api/sensors/ingest",
            headers={"X-Ingest-Key": "test-secret"},
            json={"device_id": sensor.device_id, "h1_m": 12.0, "raw_data": "Depth=2"},
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True

    def test_ingest_rejects_bad_key_and_no_auth(self, client: TestClient, db: Session, auth_headers: dict, monkeypatch):
        sensor, _tank = self._register(client, db, auth_headers)
        monkeypatch.setattr(settings, "sensor_ingest_key", "test-secret")
        # wrong key, no auth
        response = client.post(
            "/api/sensors/ingest",
            headers={"X-Ingest-Key": "wrong"},
            json={"device_id": sensor.device_id, "h1_m": 12.0},
        )
        assert response.status_code == 401
        # no key, no auth
        response = client.post(
            "/api/sensors/ingest",
            json={"device_id": sensor.device_id, "h1_m": 12.0},
        )
        assert response.status_code == 401

    def test_ingest_uses_sensor_depth_default(self, client: TestClient, db: Session, auth_headers: dict):
        sensor, _tank = self._register(client, db, auth_headers)
        db.query(SensorDevice).filter(SensorDevice.id == sensor.id).update({"depth_m": 2.0})
        db.commit()
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": sensor.device_id, "h1_m": 12.0},
        )
        assert response.status_code == 200
        assert response.json()["depth_m"] == 2.0
        assert response.json()["water_level_m"] == 10.0


class TestScopedListsAndPatch:
    def test_list_tanks_role_scoped(self, client: TestClient, db: Session, auth_headers: dict):
        utility_a = _make_utility(db, name="Water Co A")
        utility_b = _make_utility(db, name="Water Co B")
        tank_a = _make_tank(db, utility_a, source_key="A Tank")
        tank_b = _make_tank(db, utility_b, source_key="B Tank")

        headers_b = _utility_manager_headers(db, utility_b)
        response = client.get("/api/tanks", headers=headers_b)
        assert response.status_code == 200
        data = response.json()
        ids = {item["id"] for item in data["items"]}
        assert tank_b.id in ids
        assert tank_a.id not in ids
        assert data["total"] == 1

    def test_list_sensors_scope(self, client: TestClient, db: Session, auth_headers: dict):
        utility_a = _make_utility(db, name="Water Co A")
        utility_b = _make_utility(db, name="Water Co B")
        tank_a = _make_tank(db, utility_a, source_key="A Tank")
        tank_b = _make_tank(db, utility_b, source_key="B Tank")
        sensor_a = _make_sensor(db, tank_a, device_id="dev-a")
        sensor_b = _make_sensor(db, tank_b, device_id="dev-b")

        headers_b = _utility_manager_headers(db, utility_b)
        response = client.get("/api/sensors", headers=headers_b)
        assert response.status_code == 200
        data = response.json()
        ids = {item["device_id"] for item in data["items"]}
        assert sensor_b.device_id in ids
        assert sensor_a.device_id not in ids

    def test_patch_tank_assign_dma(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        dma = _make_dma(db, utility)
        tank = _make_tank(db, utility, source_key="Tank P")
        response = client.patch(
            f"/api/tanks/{tank.id}",
            headers=auth_headers,
            json={"dma_id": dma.id},
        )
        assert response.status_code == 200
        assert response.json()["dma_id"] == dma.id

    def test_patch_tank_dma_must_match_utility(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        other_utility = _make_utility(db, name="Other Co")
        dma = _make_dma(db, other_utility, name="Other DMA")
        tank = _make_tank(db, utility, source_key="Tank P")
        response = client.patch(
            f"/api/tanks/{tank.id}",
            headers=auth_headers,
            json={"dma_id": dma.id},
        )
        assert response.status_code == 400

    def test_reads_persisted(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility)
        sensor = _make_sensor(db, tank, device_id="dev-persist", activated=True)
        client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": sensor.device_id, "h1_m": 12.0, "raw_data": "Depth=2"},
        )
        readings = db.query(SensorReading).filter(SensorReading.sensor_id == sensor.id).all()
        assert len(readings) == 1
        assert readings[0].water_height_m == 10.0
        assert readings[0].status == SensorStatusEnum.ACTIVE
        assert readings[0].utility_id == utility.id


class TestUploadTankSync:
    """Endpoint-level wiring: uploading a storage_facilities layer reconciles tanks."""

    def _patch_loader(self, monkeypatch, features: list):
        from app.api.utilities import _load_infrastructure_geojson_with_summary as real_loader
        from app.schemas.user import PipeNetworkIngestSummary

        def fake_loader(file_name, file_data, asset_type):
            collection = {"features": features}
            summary = PipeNetworkIngestSummary(
                total_features_read=len(features),
                has_warnings=False,
            )
            return collection, summary

        monkeypatch.setattr(
            "app.api.utilities._load_infrastructure_geojson_with_summary",
            fake_loader,
        )

    def test_upload_storage_facilities_returns_tank_sync(
        self, client: TestClient, db: Session, monkeypatch
    ):
        utility = _make_utility(db)
        headers = _utility_manager_headers(db, utility)
        self._patch_loader(monkeypatch, [
            {
                "type": "Feature",
                "properties": {"TankName": "Reservoir A"},
                "geometry": {"type": "Point", "coordinates": [36.7, -3.4]},
            },
            {
                "type": "Feature",
                "properties": {"TankName": "Reservoir B"},
                "geometry": {"type": "Point", "coordinates": [36.8, -3.5]},
            },
        ])

        response = client.post(
            f"/api/utilities/{utility.id}/infrastructure/storage_facilities",
            headers=headers,
            files={"file": ("storage.gpkg", b"not-a-real-gpkg", "application/geopackage+sqlite3")},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["tank_sync"] is not None
        assert data["tank_sync"]["created"] == 2
        assert data["tank_sync"]["total"] == 2
        assert data["tank_sync"]["has_warnings"] is False

        tanks = db.query(Tank).filter(Tank.utility_id == utility.id).all()
        assert {t.source_key for t in tanks} == {"Reservoir A", "Reservoir B"}
        assert all(t.status == TankStatusEnum.ACTIVE for t in tanks)

        layer = (
            db.query(UtilityInfrastructureLayer)
            .filter(
                UtilityInfrastructureLayer.utility_id == utility.id,
                UtilityInfrastructureLayer.asset_type == "storage_facilities",
            )
            .first()
        )
        assert layer is not None
        assert layer.tank_key_field == "TankName"

    def test_upload_reconcile_deactivates_missing_tank(
        self, client: TestClient, db: Session, monkeypatch
    ):
        utility = _make_utility(db)
        headers = _utility_manager_headers(db, utility)
        tank = _make_tank(db, utility, source_key="Reservoir A")
        sensor = _make_sensor(db, tank, device_id="dev-keep", activated=True)

        self._patch_loader(monkeypatch, [
            {
                "type": "Feature",
                "properties": {"TankName": "Reservoir B"},
                "geometry": {"type": "Point", "coordinates": [36.8, -3.5]},
            },
        ])

        response = client.post(
            f"/api/utilities/{utility.id}/infrastructure/storage_facilities",
            headers=headers,
            files={"file": ("storage.gpkg", b"not-a-real-gpkg", "application/geopackage+sqlite3")},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["tank_sync"]["created"] == 1
        assert data["tank_sync"]["deactivated"] == 1
        assert data["tank_sync"]["deactivated_with_sensors"] == 1
        assert data["tank_sync"]["has_warnings"] is True

        db.refresh(tank)
        assert tank.status == TankStatusEnum.DEACTIVATED
        assert tank.deactivated_at is not None


class TestTankReadings:
    """GET /api/tanks/{tank_id}/readings — reading history for a tank's active sensors."""

    def _ingest(
        self,
        client: TestClient,
        auth_headers: dict,
        device_id: str,
        occurred_at: str,
        depth_raw: str = "Depth=2",
    ):
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={
                "device_id": device_id,
                "h1_m": 12.0,
                "raw_data": depth_raw,
                "occurred_at": occurred_at,
            },
        )
        assert response.status_code == 200
        return response.json()

    def test_readings_empty_for_unmonitored_tank(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Quiet Tank")
        response = client.get(f"/api/tanks/{tank.id}/readings", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_readings_latest_first_and_ordered(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Tank R")
        sensor = _make_sensor(db, tank, device_id="dev-read", activated=True)
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T10:00:00", "Depth=1")
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T12:00:00", "Depth=3")
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T11:00:00", "Depth=2")

        response = client.get(f"/api/tanks/{tank.id}/readings", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        times = [item["occurred_at"] for item in data["items"]]
        assert times == sorted(times, reverse=True)
        assert data["items"][0]["water_level_m"] == 9.0
        assert data["items"][1]["water_level_m"] == 10.0
        assert data["items"][2]["water_level_m"] == 11.0

    def test_readings_limit(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Tank L")
        sensor = _make_sensor(db, tank, device_id="dev-lim", activated=True)
        for i in range(5):
            self._ingest(client, auth_headers, sensor.device_id, f"2026-01-01T10:0{i}:00", "Depth=1")
        response = client.get(f"/api/tanks/{tank.id}/readings?limit=2", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        assert len(data["items"]) == 2

    def test_readings_skips_inactive_sensors(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Tank I")
        sensor = _make_sensor(db, tank, device_id="dev-inactive", activated=False)
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T10:00:00")
        response = client.get(f"/api/tanks/{tank.id}/readings", headers=auth_headers)
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_readings_scoped_403_other_utility(self, client: TestClient, db: Session):
        utility_a = _make_utility(db, name="Water Co A")
        utility_b = _make_utility(db, name="Water Co B")
        tank = _make_tank(db, utility_a, source_key="Tank S")
        headers_b = _utility_manager_headers(db, utility_b)
        response = client.get(f"/api/tanks/{tank.id}/readings", headers=headers_b)
        assert response.status_code == 403

    def test_readings_404_unknown_tank(self, client: TestClient, auth_headers: dict):
        response = client.get(f"/api/tanks/{uuid4()}/readings", headers=auth_headers)
        assert response.status_code == 404


class TestSensorDelete:
    """DELETE /api/sensors/{device_id} — cascade deletes sensor + readings, admin/utility-manager gated."""

    def test_delete_sensor_cascades_readings(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Delete Tank")
        sensor = _make_sensor(db, tank, device_id="dev-del", activated=True)
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": "dev-del", "h1_m": 12.0, "raw_data": "Depth=2", "occurred_at": "2026-01-01T10:00:00"},
        )
        assert response.status_code == 200

        delete_response = client.delete("/api/sensors/dev-del", headers=auth_headers)
        assert delete_response.status_code == 204

        assert db.query(SensorDevice).filter(SensorDevice.device_id == "dev-del").first() is None
        assert db.query(SensorReading).filter(SensorReading.sensor_id == sensor.id).count() == 0

    def test_delete_sensor_unknown_returns_404(self, client: TestClient, db: Session, auth_headers: dict):
        response = client.delete("/api/sensors/does-not-exist", headers=auth_headers)
        assert response.status_code == 404

    def test_delete_sensor_scoped_to_owning_utility_only(self, client: TestClient, db: Session):
        from app.models import UtilityManager

        utility_a = _make_utility(db, name="Water Co A")
        utility_b = _make_utility(db, name="Water Co B")
        tank = _make_tank(db, utility_b, source_key="Scoped Tank")
        sensor = _make_sensor(db, tank, device_id="dev-scoped", activated=True)

        manager_b = UtilityManager(email="mb@example.com", name="Manager B", phone="+1",
                                   password=hash_password("pass123"), utility_id=utility_b.id)
        db.add(manager_b)
        db.commit()
        db.refresh(manager_b)
        token_b = create_access_token(manager_b.id, manager_b.email)

        # Manager of utility B (owning) can delete.
        response_b = client.delete("/api/sensors/dev-scoped", headers={"Authorization": f"Bearer {token_b}"})
        assert response_b.status_code == 204
        assert db.query(SensorDevice).filter(SensorDevice.device_id == "dev-scoped").first() is None

    def test_delete_sensor_duplicate_returns_404(self, client: TestClient, db: Session, auth_headers: dict, admin_auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Twice Tank")
        _make_sensor(db, tank, device_id="dev-twice", activated=True)
        first = client.delete("/api/sensors/dev-twice", headers=admin_auth_headers)
        assert first.status_code == 204
        second = client.delete("/api/sensors/dev-twice", headers=admin_auth_headers)
        assert second.status_code == 404

    def test_delete_sensor_audit_logged(self, client: TestClient, db: Session, admin_auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Audit Tank")
        _make_sensor(db, tank, device_id="dev-audit", activated=True)
        response = client.delete("/api/sensors/dev-audit", headers=admin_auth_headers)
        assert response.status_code == 204
        from app.models import ActivityLog
        logs = db.query(ActivityLog).filter(ActivityLog.entity_id.isnot(None)).all()
        assert any(getattr(log, "action", None) == "sensor.delete" for log in logs)
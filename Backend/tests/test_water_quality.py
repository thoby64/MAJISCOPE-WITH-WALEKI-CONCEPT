"""
Water-quality sensor tests: parameter extraction, sanity ranges, status
derivation, ingest + registration category dispatch, and the one-active-
sensor-per-category-per-tank restriction.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Utility, UtilityManager, DMA
from app.models.sensor_platform import (
    SensorCategoryEnum,
    SensorDevice,
    SensorStatusEnum,
    WaterQualityReading,
)
from app.security.auth import create_access_token, hash_password
from app.services.water_quality_services import (
    WQ_PARAMETERS,
    derive_water_quality_status,
    extract_water_quality,
)
from app.services.sensor_services import parse_timestamp

from tests.test_sensors import (
    _make_dma,
    _make_tank,
    _make_utility,
    _utility_manager_headers,
)


def _make_wq_sensor(sensor_db: Session, tank, device_id: str = "wq-1", **kwargs):
    sensor = SensorDevice(
        device_id=device_id,
        category=SensorCategoryEnum.WATER_QUALITY,
        tank_id=tank.id,
        activated=kwargs.get("activated", True),
        config=kwargs.get("config", {}),
    )
    sensor_db.add(sensor)
    sensor_db.commit()
    sensor_db.refresh(sensor)
    return sensor


class TestWqExtraction:
    def test_flat_fields(self):
        values = extract_water_quality(
            {"temperature_c": 21.3, "ph": 7.2, "ec_uscm": 450.0, "turbidity_ntu": 3.1, "do_mgl": 6.4}
        )
        assert values == {
            "temperature_c": 21.3,
            "ph": 7.2,
            "ec_uscm": 450.0,
            "turbidity_ntu": 3.1,
            "do_mgl": 6.4,
        }

    def test_vendor_aliases(self):
        values = extract_water_quality(
            {"Temperature": 20.0, "pH": 6.9, "Conductivity": 512.5, "Turbidity": 4.2, "DissolvedOxygen": 5.5}
        )
        assert values["temperature_c"] == 20.0
        assert values["ph"] == 6.9
        assert values["ec_uscm"] == 512.5
        assert values["turbidity_ntu"] == 4.2
        assert values["do_mgl"] == 5.5

    def test_properties_envelope(self):
        values = extract_water_quality(
            {}, {"temp": 19.5, "ph": 8.0, "ORP": 220.0}
        )
        assert values["temperature_c"] == 19.5
        assert values["ph"] == 8.0
        assert values["orp_mv"] == 220.0

    def test_raw_data_fallback(self):
        values = extract_water_quality({}, None, "pH=7.4, EC=380, Turb=2.2, Temp=22.1")
        assert values["ph"] == 7.4
        assert values["ec_uscm"] == 380.0
        assert values["turbidity_ntu"] == 2.2
        assert values["temperature_c"] == 22.1

    def test_sanity_ranges_drop_impossible_values(self):
        values = extract_water_quality({"ph": 23.0, "temperature_c": 21.0})
        assert "ph" not in values  # pH 23 impossible -> dropped
        assert values["temperature_c"] == 21.0

    def test_nothing_recognized_returns_empty(self):
        assert extract_water_quality({"device_id": "x", "battery": 3.7}) == {}

    def test_do_pct_satellite_column(self):
        values = extract_water_quality({"do_pct_sat": 95.0, "do_mgl": 8.2})
        assert values["do_pct_sat"] == 95.0
        assert values["do_mgl"] == 8.2

    def test_tierbc_optional_params(self):
        values = extract_water_quality(
            {"free_chlorine_mgl": 0.8, "nitrate_mgl": 12.0, "ammonia_mgl": 0.2,
             "phosphate_mgl": 0.5, "chlorophyll_ugl": 3.2, "phycocyanin_ugl": 1.1}
        )
        assert values["free_chlorine_mgl"] == 0.8
        assert values["nitrate_mgl"] == 12.0
        assert values["ammonia_mgl"] == 0.2
        assert values["phosphate_mgl"] == 0.5
        assert values["chlorophyll_ugl"] == 3.2
        assert values["phycocyanin_ugl"] == 1.1

    def test_all_parameters_have_sane_bounds(self):
        for field, spec in WQ_PARAMETERS.items():
            assert spec["min"] < spec["max"], field


class TestWqStatus:
    def _sensor(self, config=None, activated=True):
        return SimpleNamespace(activated=activated, config=config or {})

    def test_ok_readings_are_active(self):
        s = self._sensor()
        assert derive_water_quality_status(
            s, {"ph": 7.2, "turbidity_ntu": 1.0, "temperature_c": 21.0}
        ) == SensorStatusEnum.ACTIVE

    def test_warning_threshold(self):
        s = self._sensor()
        assert derive_water_quality_status(s, {"turbidity_ntu": 7.0}) == SensorStatusEnum.WARNING
        assert derive_water_quality_status(s, {"ph": 6.2}) == SensorStatusEnum.WARNING

    def test_critical_threshold(self):
        s = self._sensor()
        assert derive_water_quality_status(s, {"ph": 5.0}) == SensorStatusEnum.CRITICAL
        assert derive_water_quality_status(s, {"turbidity_ntu": 15.0}) == SensorStatusEnum.CRITICAL

    def test_worst_of_across_parameters(self):
        s = self._sensor()
        status = derive_water_quality_status(s, {"ph": 7.0, "turbidity_ntu": 12.0})
        assert status == SensorStatusEnum.CRITICAL

    def test_absent_parameter_not_evaluated(self):
        s = self._sensor()
        # No turbidity fitted; only pH present and fine.
        assert derive_water_quality_status(s, {"ph": 7.0}) == SensorStatusEnum.ACTIVE

    def test_custom_thresholds_override_defaults(self):
        s = self._sensor({"parameters": {"ph": {"warning_below": 7.5}}})
        assert derive_water_quality_status(s, {"ph": 7.2}) == SensorStatusEnum.WARNING

    def test_inactive_sensor_is_inactive(self):
        s = self._sensor(activated=False)
        assert derive_water_quality_status(
            s, {"ph": 2.0, "turbidity_ntu": 100.0}
        ) == SensorStatusEnum.INACTIVE

    def test_orp_has_no_default_threshold(self):
        # WHO: no universal ORP threshold — never alarms by default.
        s = self._sensor()
        assert derive_water_quality_status(s, {"orp_mv": 150.0}) == SensorStatusEnum.ACTIVE


class TestWqIngest:
    def test_ingest_water_quality_registered_device(self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)
        _make_wq_sensor(sensor_db, tank, device_id="AU_NAM_WQ_0001")

        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={
                "device_id": "AU_NAM_WQ_0001",
                "temperature_c": 21.4,
                "ph": 7.1,
                "ec_uscm": 460.0,
                "do_mgl": 6.2,
                "turbidity_ntu": 2.8,
                "occurred_at": "2026-03-01T09:00:00Z",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["category"] == "water_quality"
        assert data["status"] == "active"
        assert data["parameters"]["ph"] == 7.1
        assert data["parameters"]["turbidity_ntu"] == 2.8
        assert data["occurred_at"].endswith("Z")

    def test_ingest_wq_unknown_device_pending_then_promotion(
        self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict
    ):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)

        buffered = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": "AU_NAM_WQ_0002", "ph": 6.8, "turbidity_ntu": 9.0,
                  "occurred_at": "2026-03-02T08:30:00Z"},
        )
        assert buffered.status_code == 200
        assert buffered.json()["is_pending"] is True

        registered = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={
                "device_id": "AU_NAM_WQ_0002",
                "tank_id": tank.id,
                "category": "water_quality",
                "activated": True,
            },
        )
        assert registered.status_code == 201
        assert registered.json()["promoted_readings"] == 1

        reading = (
            sensor_db.query(WaterQualityReading)
            .filter(WaterQualityReading.sensor_id == registered.json()["id"])
            .first()
        )
        assert reading is not None
        assert reading.ph == 6.8
        assert reading.status == SensorStatusEnum.WARNING  # turbidity 9 -> warning

    def test_ingest_wq_unrecognized_payload_422(self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict):
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": "wq-nothing", "occurred_at": "2026-03-01T10:00:00Z"},
        )
        assert response.status_code == 422

    def test_ingest_wq_idempotent(self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)
        _make_wq_sensor(sensor_db, tank, device_id="wq-dedup")
        payload = {"device_id": "wq-dedup", "ph": 7.0, "occurred_at": "2026-03-01T11:00:00Z"}

        first = client.post("/api/sensors/ingest", headers=auth_headers, json=payload).json()
        second = client.post("/api/sensors/ingest", headers=auth_headers, json=payload).json()
        assert first["is_duplicate"] is False
        assert second["is_duplicate"] is True
        assert first["reading_id"] == second["reading_id"]


class TestCategoryRestriction:
    def test_two_active_same_category_rejected(
        self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict
    ):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)
        _make_sensor_response = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0001", "tank_id": tank.id,
                  "category": "water_level", "h1_m": 10.0, "activated": True},
        )
        assert _make_sensor_response.status_code == 201

        dup = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0002", "tank_id": tank.id,
                  "category": "water_level", "h1_m": 9.0, "activated": True},
        )
        assert dup.status_code == 409
        assert "already has an active water_level sensor" in dup.json()["detail"]

    def test_different_categories_allowed_on_same_tank(
        self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict
    ):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)

        wl = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0003", "tank_id": tank.id,
                  "category": "water_level", "h1_m": 10.0, "activated": True},
        )
        assert wl.status_code == 201

        wq = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0004", "tank_id": tank.id,
                  "category": "water_quality", "activated": True},
        )
        assert wq.status_code == 201

    def test_activation_clash_via_patch_rejected(
        self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict
    ):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)
        first = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0005", "tank_id": tank.id,
                  "category": "water_level", "h1_m": 10.0, "activated": True},
        )
        assert first.status_code == 201

        second = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0006", "tank_id": tank.id,
                  "category": "water_level", "h1_m": 8.0, "activated": False},
        )
        assert second.status_code == 201

        clash = client.patch(
            "/api/sensors/AU_NAM_0006",
            headers=auth_headers,
            json={"activated": True},
        )
        assert clash.status_code == 409


class TestWqConfigThresholds:
    def test_register_with_custom_thresholds(self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)

        response = client.post(
            "/api/sensors",
            headers=auth_headers,
            json={
                "device_id": "AU_NAM_WQ_0010",
                "tank_id": tank.id,
                "category": "water_quality",
                "activated": True,
                "parameter_thresholds": {
                    "ph": {"warning_below": 7.4, "critical_below": 6.8},
                },
            },
        )
        assert response.status_code == 201
        config = response.json()["config"]
        assert config["parameters"]["ph"]["warning_below"] == 7.4
        assert config["parameters"]["ph"]["critical_below"] == 6.8

    def test_custom_threshold_drives_status(
        self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict
    ):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)
        client.post(
            "/api/sensors",
            headers=auth_headers,
            json={
                "device_id": "AU_NAM_WQ_0011",
                "tank_id": tank.id,
                "category": "water_quality",
                "activated": True,
                "parameter_thresholds": {"ph": {"warning_below": 7.5}},
            },
        )
        reading = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": "AU_NAM_WQ_0011", "ph": 7.2,
                  "occurred_at": "2026-03-03T09:00:00Z"},
        )
        assert reading.status_code == 200
        assert reading.json()["status"] == "warning"


class TestWqReadingsHistory:
    def test_history_category_filter(self, client: TestClient, db: Session, sensor_db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, sensor_db)
        client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0007", "tank_id": tank.id,
                  "category": "water_level", "h1_m": 10.0, "activated": True},
        )
        client.post(
            "/api/sensors",
            headers=auth_headers,
            json={"device_id": "AU_NAM_0008", "tank_id": tank.id,
                  "category": "water_quality", "activated": True},
        )
        client.post("/api/sensors/ingest", headers=auth_headers,
                    json={"device_id": "AU_NAM_0007", "depth_m": 2.0, "occurred_at": "2026-03-04T08:00:00Z"})
        client.post("/api/sensors/ingest", headers=auth_headers,
                    json={"device_id": "AU_NAM_0008", "ph": 7.0, "occurred_at": "2026-03-04T08:05:00Z"})

        wl_history = client.get(f"/api/tanks/{tank.id}/readings", headers=auth_headers)
        assert wl_history.status_code == 200
        assert all(item["category"] == "water_level" for item in wl_history.json()["items"])

        wq_history = client.get(
            f"/api/tanks/{tank.id}/readings?category=water_quality",
            headers=auth_headers,
        )
        assert wq_history.status_code == 200
        items = wq_history.json()["items"]
        assert len(items) == 1
        assert items[0]["category"] == "water_quality"
        assert items[0]["parameters"]["ph"] == 7.0

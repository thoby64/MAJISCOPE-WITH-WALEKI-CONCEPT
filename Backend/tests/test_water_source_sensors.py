from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Utility, WaterSource, WaterSourceStatusEnum
from app.models.sensor_platform import (
    SensorDevice,
    WaterLevelReading,
    WaterSourceSensorDevice,
    WaterSourceWaterLevelReading,
    WaterSourceWaterQualityReading,
)


def _make_utility(db: Session) -> Utility:
    utility = Utility(name="Source Sensor Utility", slug=f"source-{uuid4().hex[:8]}")
    db.add(utility)
    db.commit()
    db.refresh(utility)
    return utility


def _make_water_source(db: Session, utility: Utility) -> WaterSource:
    source = WaterSource(
        utility_id=utility.id,
        source_key=f"borehole-{uuid4().hex[:8]}",
        name="Community borehole",
        source_type="borehole",
        latitude=-3.4,
        longitude=36.7,
        status=WaterSourceStatusEnum.ACTIVE,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def test_water_source_sensor_registration_and_ingest_use_separate_tables(
    client: TestClient,
    db: Session,
    sensor_db: Session,
    auth_headers: dict,
):
    utility = _make_utility(db)
    source = _make_water_source(db, utility)

    registered = client.post(
        "/api/water-source-sensors",
        headers=auth_headers,
        json={
            "device_id": "source-level-01",
            "water_source_id": source.id,
            "category": "water_level",
            "h1_m": 12.0,
            "activated": True,
        },
    )

    assert registered.status_code == 201, registered.text
    assert registered.json()["water_source_id"] == source.id
    assert sensor_db.query(WaterSourceSensorDevice).filter_by(device_id="source-level-01").count() == 1
    assert sensor_db.query(SensorDevice).filter_by(device_id="source-level-01").count() == 0

    ingested = client.post(
        "/api/water-source-sensors/ingest",
        headers=auth_headers,
        json={
            "device_id": "source-level-01",
            "h1_m": 12.0,
            "depth_m": 3.5,
            "occurred_at": "2026-01-01T10:00:00",
        },
    )

    assert ingested.status_code == 200, ingested.text
    assert ingested.json()["water_source_id"] == source.id
    assert ingested.json()["water_level_m"] == 8.5
    source_sensor = sensor_db.query(WaterSourceSensorDevice).filter_by(device_id="source-level-01").one()
    assert sensor_db.query(WaterSourceWaterLevelReading).filter_by(sensor_id=source_sensor.id).count() == 1
    assert sensor_db.query(WaterLevelReading).count() == 0

    sensor_list = client.get("/api/water-source-sensors", headers=auth_headers)
    assert sensor_list.status_code == 200
    assert [item["device_id"] for item in sensor_list.json()["items"]] == ["source-level-01"]
    history = client.get(
        f"/api/water-sources/{source.id}/readings?category=water_level",
        headers=auth_headers,
    )
    assert history.status_code == 200, history.text
    assert history.json()["total"] == 1
    assert history.json()["items"][0]["water_source_id"] == source.id


def test_sensor_ingest_rejects_wrong_asset_endpoint(
    client: TestClient,
    db: Session,
    sensor_db: Session,
    auth_headers: dict,
):
    utility = _make_utility(db)
    source = _make_water_source(db, utility)
    registered = client.post(
        "/api/water-source-sensors",
        headers=auth_headers,
        json={
            "device_id": "source-level-wrong-route",
            "water_source_id": source.id,
            "category": "water_level",
            "h1_m": 12.0,
            "activated": True,
        },
    )
    assert registered.status_code == 201, registered.text

    response = client.post(
        "/api/storage-facility-sensors/ingest",
        headers=auth_headers,
        json={
            "device_id": "source-level-wrong-route",
            "h1_m": 12.0,
            "depth_m": 3.5,
        },
    )

    assert response.status_code == 409
    assert "water-source" in response.json()["detail"].lower()


def test_water_quality_source_ingest_returns_quality_response_and_persists_separately(
    client: TestClient,
    db: Session,
    sensor_db: Session,
    auth_headers: dict,
):
    utility = _make_utility(db)
    source = _make_water_source(db, utility)
    registered = client.post(
        "/api/water-source-sensors",
        headers=auth_headers,
        json={
            "device_id": "source-quality-01",
            "water_source_id": source.id,
            "category": "water_quality",
            "activated": True,
        },
    )
    assert registered.status_code == 201, registered.text

    response = client.post(
        "/api/water-source-sensors/ingest",
        headers=auth_headers,
        json={
            "device_id": "source-quality-01",
            "ph": 7.2,
            "turbidity_ntu": 2.5,
            "occurred_at": "2026-01-01T10:00:00",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["category"] == "water_quality"
    assert response.json()["parameters"]["ph"] == 7.2
    quality_sensor = sensor_db.query(WaterSourceSensorDevice).filter_by(device_id="source-quality-01").one()
    assert sensor_db.query(WaterSourceWaterQualityReading).filter_by(sensor_id=quality_sensor.id).count() == 1
    assert sensor_db.query(WaterSourceWaterLevelReading).count() == 0

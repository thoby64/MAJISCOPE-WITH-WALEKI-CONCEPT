from datetime import datetime, timezone
import json

import pytest
from sqlalchemy import Boolean, Column, DateTime, Float, MetaData, String, Table, Text, create_engine, insert

from app.models import Base
from app.models.sensor_platform import (
    SensorBase,
    SensorCategoryEnum,
    SensorDevice,
    SensorPendingReading,
    SensorStatusEnum,
    TankRef,
    WaterQualityReading,
)
from migrate_sqlite_to_postgres import (
    TABLE_ORDER,
    _copy_table,
    _inspect_schema,
    _table_stats,
)
from scripts.migrate_sensor_data import _mapped_rows, _validate_mappings
from scripts.verify_schema import compare_database
from scripts.stamp_baseline import ensure_unstamped


def _reflect(engine):
    metadata = MetaData()
    metadata.reflect(bind=engine)
    return metadata


def test_main_preflight_covers_current_tables_and_binary_bytes():
    source = create_engine("sqlite:///:memory:")
    target = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(source)
    Base.metadata.create_all(target)

    source_meta = _reflect(source)
    target_meta = _reflect(target)
    assert _inspect_schema(source_meta, target_meta) == []
    assert set(TABLE_ORDER) == set(Base.metadata.tables)

    image_table = source_meta.tables["image_upload"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with source.begin() as connection:
        connection.execute(
            insert(image_table).values(
                id="image-1",
                file_data=b"image-bytes",
                file_name="test.jpg",
                file_type="image/jpeg",
                file_size=11,
                image_type="REPORT",
                mime_type="image/jpeg",
                created_at=now,
            )
        )

    with source.connect() as source_connection, target.begin() as target_connection:
        _copy_table(
            source_connection,
            target_connection,
            image_table,
            target_meta.tables["image_upload"],
            batch_size=1,
        )

    assert _table_stats(source, source_meta)["image_upload"] == {"rows": 1, "binary_bytes": 11}
    assert _table_stats(target, target_meta)["image_upload"] == {"rows": 1, "binary_bytes": 11}
    source.dispose()
    target.dispose()


def test_sensor_mapper_preserves_quality_and_pending_payloads():
    source_engine = create_engine("sqlite:///:memory:")
    SensorBase.metadata.create_all(source_engine)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with source_engine.begin() as connection:
        connection.execute(insert(TankRef.__table__).values(
            id="tank-1",
            utility_id="utility-1",
            dma_id="dma-1",
            source_key="source-1",
            status="ACTIVE",
            created_at=now,
            updated_at=now,
        ))
        connection.execute(insert(SensorDevice.__table__).values(
            id="sensor-1",
            device_id="device-1",
            category=SensorCategoryEnum.WATER_QUALITY,
            tank_id="tank-1",
            activated=True,
            config={"parameters": {"ph": {"min_ok": 6.5, "max_ok": 8.5}}},
            created_at=now,
            updated_at=now,
        ))
        connection.execute(insert(WaterQualityReading.__table__).values(
            id="quality-1",
            sensor_id="sensor-1",
            tank_id="tank-1",
            utility_id="utility-1",
            dma_id="dma-1",
            status=SensorStatusEnum.ACTIVE,
            ph=7.2,
            occurred_at=now,
            created_at=now,
        ))
        connection.execute(insert(SensorPendingReading.__table__).values(
            id="pending-1",
            device_id="unregistered-1",
            payload=json.dumps({"ph": 7.1}),
            occurred_at=now,
            dedup_key=f"unregistered-1:{now.isoformat()}",
            created_at=now,
        ))

    source_meta = _reflect(source_engine)
    with source_engine.connect() as connection:
        mapped_counts = _validate_mappings(connection, source_meta)
        rows = list(_mapped_rows(connection, source_meta))
    quality = next(row for name, row in rows if name == "water_quality_reading")
    pending = next(row for name, row in rows if name == "sensor_pending_reading")

    assert mapped_counts["water_quality_reading"] == 1
    assert quality["id"] == "quality-1"
    assert quality["ph"] == 7.2
    assert quality["status"] == SensorStatusEnum.ACTIVE
    assert json.loads(pending["payload"]) == {"ph": 7.1}
    source_engine.dispose()


def test_schema_verifier_detects_drift_and_accepts_current_metadata():
    engine = create_engine("sqlite:///:memory:")
    assert compare_database(engine, Base.metadata)

    Base.metadata.create_all(engine)
    assert compare_database(engine, Base.metadata) == []
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version_main (version_num VARCHAR(32) NOT NULL)"
        )
        connection.exec_driver_sql(
            "INSERT INTO alembic_version_main (version_num) VALUES ('0001_main_baseline')"
        )
    assert compare_database(
        engine,
        Base.metadata,
        version_table="alembic_version_main",
    ) == []
    engine.dispose()


def test_sensor_schema_verifier_accepts_current_metadata_and_version_table():
    engine = create_engine("sqlite:///:memory:")
    assert compare_database(
        engine,
        SensorBase.metadata,
        version_table="alembic_version_sensor",
    )

    SensorBase.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version_sensor (version_num VARCHAR(32) NOT NULL)"
        )
        connection.exec_driver_sql(
            "INSERT INTO alembic_version_sensor (version_num) VALUES ('0001_sensor_baseline')"
        )
    assert compare_database(
        engine,
        SensorBase.metadata,
        version_table="alembic_version_sensor",
    ) == []
    engine.dispose()


def test_baseline_stamp_refuses_an_existing_version_table():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE alembic_version_main (version_num VARCHAR(32) NOT NULL)")
    with pytest.raises(RuntimeError, match="refusing to overwrite"):
        ensure_unstamped(engine, "alembic_version_main")
    engine.dispose()


def test_sensor_mapper_converts_legacy_water_level_and_pending_tables():
    engine = create_engine("sqlite:///:memory:")
    legacy = MetaData()
    Table(
        "tank", legacy,
        Column("id", String(36), primary_key=True),
        Column("utility_id", String(36), nullable=False),
        Column("dma_id", String(36)),
        Column("source_key", String(500), nullable=False),
        Column("name", String(255)),
        Column("latitude", Float),
        Column("longitude", Float),
        Column("status", String(20)),
        Column("created_at", DateTime),
        Column("updated_at", DateTime),
        Column("deactivated_at", DateTime),
    )
    Table(
        "sensor_device", legacy,
        Column("id", String(36), primary_key=True),
        Column("device_id", String(100), nullable=False),
        Column("tank_id", String(36), nullable=False),
        Column("h1_m", Float),
        Column("depth_m", Float),
        Column("warning_height_m", Float),
        Column("critical_height_m", Float),
        Column("activated", Boolean),
        Column("created_at", DateTime),
        Column("updated_at", DateTime),
    )
    Table(
        "sensor_reading", legacy,
        Column("id", String(36), primary_key=True),
        Column("sensor_id", String(36), nullable=False),
        Column("tank_id", String(36), nullable=False),
        Column("utility_id", String(36), nullable=False),
        Column("dma_id", String(36)),
        Column("h1_m", Float),
        Column("depth_m", Float),
        Column("water_height_m", Float),
        Column("status", String(20)),
        Column("raw_data", Text),
        Column("occurred_at", DateTime, nullable=False),
        Column("created_at", DateTime),
    )
    Table(
        "sensor_pending_reading", legacy,
        Column("id", String(36), primary_key=True),
        Column("device_id", String(100), nullable=False),
        Column("depth_m", Float),
        Column("raw_data", Text),
        Column("occurred_at", DateTime, nullable=False),
        Column("dedup_key", String(300)),
        Column("created_at", DateTime),
    )
    legacy.create_all(engine)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with engine.begin() as connection:
        connection.execute(legacy.tables["tank"].insert().values(
            id="tank-legacy", utility_id="utility-1", source_key="tank-source",
            status="ACTIVE", created_at=now, updated_at=now,
        ))
        connection.execute(legacy.tables["sensor_device"].insert().values(
            id="sensor-legacy", device_id="device-legacy", tank_id="tank-legacy",
            h1_m=12.0, depth_m=2.0, activated=True, created_at=now, updated_at=now,
        ))
        connection.execute(legacy.tables["sensor_reading"].insert().values(
            id="reading-legacy", sensor_id="sensor-legacy", tank_id="tank-legacy",
            utility_id="utility-1", h1_m=12.0, depth_m=2.0, water_height_m=10.0,
            status="ACTIVE", occurred_at=now, created_at=now,
        ))
        connection.execute(legacy.tables["sensor_pending_reading"].insert().values(
            id="pending-legacy", device_id="unregistered", depth_m=1.5,
            raw_data="Depth: 1.5", occurred_at=now, dedup_key="legacy-key", created_at=now,
        ))

    source_meta = _reflect(engine)
    with engine.connect() as connection:
        counts = _validate_mappings(connection, source_meta)
        rows = list(_mapped_rows(connection, source_meta))
    sensor = next(row for name, row in rows if name == "sensor_device")
    reading = next(row for name, row in rows if name == "water_level_reading")
    pending = next(row for name, row in rows if name == "sensor_pending_reading")

    assert counts["sensor_device"] == counts["water_level_reading"] == 1
    assert sensor["category"] == SensorCategoryEnum.WATER_LEVEL
    assert sensor["config"]["h1_m"] == 12.0
    assert reading["status"] == SensorStatusEnum.ACTIVE
    assert json.loads(pending["payload"]) == {
        "device_id": "unregistered", "depth_m": 1.5, "raw_data": "Depth: 1.5"
    }
    engine.dispose()
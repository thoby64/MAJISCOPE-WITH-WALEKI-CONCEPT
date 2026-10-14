import pytest
from sqlalchemy import create_engine, inspect, text

from app.services.storage_facility_migrations import (
    downgrade_storage_facility_schema_on_connection,
    migrate_storage_facility_schema,
)


def test_main_schema_rename_preserves_values_and_is_idempotent():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE tank (
                id VARCHAR(36) PRIMARY KEY,
                utility_id VARCHAR(36) NOT NULL,
                dma_id VARCHAR(36),
                source_key VARCHAR(500) NOT NULL,
                name VARCHAR(255),
                status VARCHAR(20) NOT NULL,
                CONSTRAINT uq_tank_utility_source_key UNIQUE (utility_id, source_key)
            )
            """
        )
        connection.exec_driver_sql(
            "CREATE INDEX ix_tank_utility_id ON tank (utility_id)"
        )
        connection.exec_driver_sql(
            "CREATE TABLE utility_infrastructure_layer "
            "(id VARCHAR(36) PRIMARY KEY, tank_key_field VARCHAR(100))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE sensor_mirror_outbox "
            "(id VARCHAR(36) PRIMARY KEY, op VARCHAR(30) NOT NULL, tank_id VARCHAR(36))"
        )
        connection.execute(
            text("INSERT INTO tank VALUES ('facility-1', 'utility-1', 'dma-1', 'key-1', 'Reservoir', 'active')")
        )
        connection.execute(
            text("INSERT INTO utility_infrastructure_layer VALUES ('layer-1', 'TankName')")
        )
        connection.execute(
            text("INSERT INTO sensor_mirror_outbox VALUES ('outbox-1', 'upsert_tank', 'facility-1')")
        )

    migrate_storage_facility_schema(engine)
    migrate_storage_facility_schema(engine)

    inspector = inspect(engine)
    assert "tank" not in inspector.get_table_names()
    assert "storage_facilities" in inspector.get_table_names()
    assert {column["name"] for column in inspector.get_columns("utility_infrastructure_layer")} == {
        "id", "storage_facility_key_field"
    }
    assert {column["name"] for column in inspector.get_columns("sensor_mirror_outbox")} == {
        "id", "op", "storage_facility_id"
    }
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT id, utility_id, dma_id, source_key, name, status FROM storage_facilities")
        ).one() == ("facility-1", "utility-1", "dma-1", "key-1", "Reservoir", "active")
        assert connection.execute(
            text("SELECT storage_facility_key_field FROM utility_infrastructure_layer")
        ).scalar_one() == "TankName"
        assert connection.execute(
            text("SELECT op, storage_facility_id FROM sensor_mirror_outbox")
        ).one() == ("upsert_tank", "facility-1")
    assert {index["name"] for index in inspector.get_indexes("storage_facilities")} == {
        "ix_storage_facilities_utility_id"
    }
    assert {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("storage_facilities")
    } == {"uq_storage_facilities_utility_source_key"}
    with engine.begin() as connection:
        downgrade_storage_facility_schema_on_connection(connection)
    downgraded = inspect(engine)
    assert "tank" in downgraded.get_table_names()
    assert {index["name"] for index in downgraded.get_indexes("tank")} == {
        "ix_tank_utility_id"
    }
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id, source_key FROM tank")).one() == (
            "facility-1", "key-1"
        )
    assert {
            constraint["name"]
            for constraint in downgraded.get_unique_constraints("tank")
    } == {"uq_tank_utility_source_key"}


def test_sensor_schema_rename_preserves_relationship_values_and_is_idempotent():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE tank (
                id VARCHAR(36) PRIMARY KEY,
                utility_id VARCHAR(36) NOT NULL,
                source_key VARCHAR(500) NOT NULL,
                CONSTRAINT uq_tank_ref_utility_source_key UNIQUE (utility_id, source_key)
            )
            """
        )
        connection.exec_driver_sql(
            "CREATE TABLE sensor_device "
            "(id VARCHAR(36) PRIMARY KEY, tank_id VARCHAR(36) NOT NULL, category VARCHAR(30), activated BOOLEAN)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX ix_sensor_device_tank_id ON sensor_device (tank_id)"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX uq_sensor_device_tank_category_active "
            "ON sensor_device (tank_id, category) WHERE activated IS 1"
        )
        connection.exec_driver_sql(
            "CREATE TABLE water_level_reading (id VARCHAR(36) PRIMARY KEY, tank_id VARCHAR(36) NOT NULL)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX ix_water_level_reading_tank_id ON water_level_reading (tank_id)"
        )
        connection.exec_driver_sql(
            "CREATE TABLE water_quality_reading (id VARCHAR(36) PRIMARY KEY, tank_id VARCHAR(36) NOT NULL)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX ix_water_quality_reading_tank_id ON water_quality_reading (tank_id)"
        )
        connection.execute(
            text("INSERT INTO tank VALUES ('facility-1', 'utility-1', 'source-1')")
        )
        for table_name in ("sensor_device", "water_level_reading", "water_quality_reading"):
            connection.execute(
                text(
                    f"INSERT INTO {table_name} (id, tank_id) "
                    "VALUES ('row-1', 'facility-1')"
                )
            )

    migrate_storage_facility_schema(engine, sensor_platform=True)
    migrate_storage_facility_schema(engine, sensor_platform=True)

    inspector = inspect(engine)
    assert "tank" not in inspector.get_table_names()
    assert "storage_facilities" in inspector.get_table_names()
    for table_name, new_index in (
        ("sensor_device", "ix_sensor_device_storage_facility_id"),
        ("water_level_reading", "ix_water_level_reading_storage_facility_id"),
        ("water_quality_reading", "ix_water_quality_reading_storage_facility_id"),
    ):
        assert "storage_facility_id" in {
            column["name"] for column in inspector.get_columns(table_name)
        }
        expected_indexes = {new_index}
        if table_name == "sensor_device":
            expected_indexes.add("uq_sensor_device_storage_facility_category_active")
        assert {index["name"] for index in inspector.get_indexes(table_name)} == expected_indexes
        with engine.connect() as connection:
            assert connection.execute(
                text(f"SELECT storage_facility_id FROM {table_name}")
            ).scalar_one() == "facility-1"


def test_conflicting_old_and_new_tables_fail_without_guessing():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE tank (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE storage_facilities (id VARCHAR(36) PRIMARY KEY)"
        )

    with pytest.raises(RuntimeError, match="Both source 'tank' and destination"):
        migrate_storage_facility_schema(engine)

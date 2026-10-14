"""Idempotent, data-preserving schema renames for storage facilities."""

from __future__ import annotations

from sqlalchemy import MetaData, Table, inspect, text
from sqlalchemy.engine import Connection, Engine


def migrate_storage_facility_schema(engine: Engine, *, sensor_platform: bool = False) -> None:
    """Rename legacy storage-facility tables and columns without changing row values."""
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(731942017)"))
        migrate_storage_facility_schema_on_connection(
            connection,
            sensor_platform=sensor_platform,
        )


def downgrade_storage_facility_schema_on_connection(
    connection: Connection,
    *,
    sensor_platform: bool = False,
) -> None:
    """Reverse the schema rename without modifying row values."""
    _rename_storage_facility_schema(
        connection,
        sensor_platform=sensor_platform,
        reverse=True,
    )


def migrate_storage_facility_schema_on_connection(
    connection: Connection,
    *,
    sensor_platform: bool = False,
) -> None:
    """Apply the schema rename inside the caller's transaction."""
    _rename_storage_facility_schema(
        connection,
        sensor_platform=sensor_platform,
        reverse=False,
    )


def _rename_storage_facility_schema(
    connection: Connection,
    *,
    sensor_platform: bool,
    reverse: bool,
) -> None:
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    old_table, new_table = (
        ("storage_facilities", "tank") if reverse else ("tank", "storage_facilities")
    )

    if old_table in tables and new_table in tables:
        raise RuntimeError(
            f"Both source '{old_table}' and destination '{new_table}' tables exist; "
            "refusing to guess which data is authoritative."
        )
    if old_table in tables:
        connection.exec_driver_sql(f'ALTER TABLE "{old_table}" RENAME TO "{new_table}"')
        tables.remove(old_table)
        tables.add(new_table)

    if sensor_platform:
        columns_by_table = {
            "sensor_device": (("tank_id", "storage_facility_id"),),
            "water_level_reading": (("tank_id", "storage_facility_id"),),
            "water_quality_reading": (("tank_id", "storage_facility_id"),),
        }
    else:
        columns_by_table = {
            "utility_infrastructure_layer": (("tank_key_field", "storage_facility_key_field"),),
            "sensor_mirror_outbox": (("tank_id", "storage_facility_id"),),
        }

    for table_name, column_pairs in columns_by_table.items():
        if table_name not in tables:
            continue
        columns = {column["name"] for column in inspect(connection).get_columns(table_name)}
        for legacy_column, renamed_column in column_pairs:
            old_column, target_column = (
                (renamed_column, legacy_column)
                if reverse
                else (legacy_column, renamed_column)
            )
            if old_column in columns and target_column in columns:
                raise RuntimeError(
                    f"Both source '{old_column}' and destination '{target_column}' columns "
                    f"exist in '{table_name}'; refusing to guess which data is authoritative."
                )
            if old_column in columns:
                connection.exec_driver_sql(
                    f'ALTER TABLE "{table_name}" RENAME COLUMN "{old_column}" TO "{target_column}"'
                )
                columns.remove(old_column)
                columns.add(target_column)

    unique_constraint_renames = {
        "uq_tank_utility_source_key": "uq_storage_facilities_utility_source_key",
        "uq_tank_ref_utility_source_key": "uq_storage_facilities_ref_utility_source_key",
    }
    if reverse:
        unique_constraint_renames = {
            new_name: old_name
            for old_name, new_name in unique_constraint_renames.items()
        }
    if new_table in tables:
        _rename_unique_constraints(connection, new_table, unique_constraint_renames)

    index_renames = {
        "ix_tank_utility_id": "ix_storage_facilities_utility_id",
        "ix_tank_dma_id": "ix_storage_facilities_dma_id",
        "ix_tank_source_key": "ix_storage_facilities_source_key",
        "ix_tank_status": "ix_storage_facilities_status",
        "ix_sensor_device_tank_id": "ix_sensor_device_storage_facility_id",
        "ix_water_level_reading_tank_id": "ix_water_level_reading_storage_facility_id",
        "ix_water_quality_reading_tank_id": "ix_water_quality_reading_storage_facility_id",
        "uq_sensor_device_tank_category_active": "uq_sensor_device_storage_facility_category_active",
    }
    if reverse:
        index_renames = {
            new_name: old_name for old_name, new_name in index_renames.items()
        }
    for table_name in tables:
        for index in inspect(connection).get_indexes(table_name):
            old_name = index.get("name")
            new_name = index_renames.get(old_name)
            if new_name:
                _rename_index(connection, table_name, old_name, new_name)

    if connection.dialect.name == "postgresql":
        enum_names = {item["name"] for item in inspect(connection).get_enums()}
        source_enum, target_enum = (
            ("storagefacilitystatusenum", "tankstatusenum")
            if reverse
            else ("tankstatusenum", "storagefacilitystatusenum")
        )
        if source_enum in enum_names and target_enum in enum_names:
            raise RuntimeError(
                "Both source and destination storage-facility status enum types exist."
            )
        if source_enum in enum_names:
            connection.exec_driver_sql(
                f'ALTER TYPE "{source_enum}" RENAME TO "{target_enum}"'
            )


def _rename_unique_constraints(
    connection: Connection,
    table_name: str,
    renames: dict[str, str],
) -> None:
    constraints = inspect(connection).get_unique_constraints(table_name)
    for constraint in constraints:
        old_name = constraint.get("name")
        new_name = renames.get(old_name)
        if not new_name:
            continue
        if connection.dialect.name == "postgresql":
            connection.exec_driver_sql(
                f'ALTER TABLE "{table_name}" RENAME CONSTRAINT "{old_name}" TO "{new_name}"'
            )
            continue

        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        operations = Operations(MigrationContext.configure(connection))
        with operations.batch_alter_table(table_name, recreate="always") as batch:
            batch.drop_constraint(old_name, type_="unique")
            batch.create_unique_constraint(new_name, constraint["column_names"])


def _rename_index(
    connection: Connection,
    table_name: str,
    old_name: str,
    new_name: str,
) -> None:
    indexes = {
        index.get("name"): index
        for index in inspect(connection).get_indexes(table_name)
    }
    if new_name in indexes and old_name in indexes:
        raise RuntimeError(
            f"Both legacy index '{old_name}' and target '{new_name}' exist on '{table_name}'."
        )
    if old_name not in indexes:
        return
    if new_name in indexes:
        return

    if connection.dialect.name == "postgresql":
        connection.exec_driver_sql(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"')
        return

    row = connection.execute(
        text("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = :name"),
        {"name": old_name},
    ).first()
    if row is None or not row[0]:
        return
    create_sql = row[0].replace(old_name, new_name, 1)
    connection.exec_driver_sql(f'DROP INDEX "{old_name}"')
    connection.exec_driver_sql(create_sql)

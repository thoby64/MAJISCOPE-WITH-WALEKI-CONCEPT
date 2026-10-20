from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect


def test_storage_facility_key_field_migration_is_idempotent(monkeypatch):
    migration = import_module(
        "migrations.main.versions.0006_storage_facility_key_field"
    )
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE utility_infrastructure_layer (id VARCHAR(36) PRIMARY KEY)"
        )
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()
        migration.upgrade()

        column = next(
            column
            for column in inspect(connection).get_columns(
                "utility_infrastructure_layer"
            )
            if column["name"] == "storage_facility_key_field"
        )
        assert column["nullable"] is True
        assert column["type"].length == 100

        migration.downgrade()

    assert "storage_facility_key_field" not in {
        column["name"]
        for column in inspect(engine).get_columns("utility_infrastructure_layer")
    }
    engine.dispose()

"""Synchronous, additive schema creation for both application databases."""

from sqlalchemy import MetaData, text
from sqlalchemy.engine import Engine

from app.models import Base
from app.models.sensor_platform import SensorBase


def sync_startup_database_schemas(main_engine: Engine, sensor_engine: Engine) -> None:
    """Create missing ORM tables in both databases before the app accepts requests."""
    _create_missing_tables(main_engine, Base.metadata, 731942021)
    _create_missing_tables(sensor_engine, SensorBase.metadata, 731942022)


def _create_missing_tables(
    engine: Engine,
    metadata: MetaData,
    advisory_lock_id: int,
) -> None:
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(
                text("SELECT pg_advisory_xact_lock(:lock_id)"),
                {"lock_id": advisory_lock_id},
            )
            metadata.create_all(bind=connection)
        return

    metadata.create_all(bind=engine)

#!/usr/bin/env python3
"""Compare one configured database's live schema with its current SQLAlchemy models."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.database.session import _normalize_database_url
from app.database.sensor_session import _normalize_database_url as _normalize_sensor_database_url
from app.models import Base
from app.models.sensor_platform import SensorBase


def compare_database(engine, metadata, *, version_table: str = "alembic_version") -> list[object]:
    with engine.connect() as connection:
        migration_context = MigrationContext.configure(
            connection,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "version_table": version_table,
            },
        )
        return compare_metadata(migration_context, metadata)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", choices=("main", "sensor"))
    args = parser.parse_args()

    if args.database == "main":
        url = _normalize_database_url(settings.database_url)
        metadata = Base.metadata
        version_table = "alembic_version_main"
    else:
        url = _normalize_sensor_database_url(settings.sensor_database_url)
        metadata = SensorBase.metadata
        version_table = "alembic_version_sensor"

    engine = create_engine(url, pool_pre_ping=True)
    try:
        differences = compare_database(engine, metadata, version_table=version_table)
    finally:
        engine.dispose()

    if differences:
        print(f"Schema drift found in {args.database} database:")
        for difference in differences:
            print(f"  {difference!r}")
        return 1

    print(f"{args.database.capitalize()} database matches current model metadata.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
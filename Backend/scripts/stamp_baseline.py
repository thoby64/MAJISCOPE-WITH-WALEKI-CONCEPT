#!/usr/bin/env python3
"""Verify an existing schema and stamp its initial Alembic baseline once."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.database.session import _normalize_database_url
from app.database.sensor_session import _normalize_database_url as _normalize_sensor_database_url
from app.models import Base
from app.models.sensor_platform import SensorBase
from scripts.verify_schema import compare_database


def ensure_unstamped(engine, version_table: str) -> None:
    if version_table in inspect(engine).get_table_names():
        raise RuntimeError(
            f"{version_table} already exists; refusing to overwrite an existing Alembic version marker"
        )


def stamp(database: str) -> None:
    if database == "main":
        url = _normalize_database_url(settings.database_url)
        metadata = Base.metadata
        version_table = "alembic_version_main"
        revision = "0001_main_baseline"
        ini_path = Path(__file__).resolve().parents[1] / "alembic.ini"
    else:
        url = _normalize_sensor_database_url(settings.sensor_database_url)
        metadata = SensorBase.metadata
        version_table = "alembic_version_sensor"
        revision = "0001_sensor_baseline"
        ini_path = Path(__file__).resolve().parents[1] / "alembic.sensor.ini"

    engine = create_engine(url, pool_pre_ping=True)
    try:
        ensure_unstamped(engine, version_table)
        differences = compare_database(engine, metadata, version_table=version_table)
        if differences:
            rendered = "\n- ".join(repr(item) for item in differences)
            raise RuntimeError(f"Schema differs from current {database} models:\n- {rendered}")
    finally:
        engine.dispose()

    config = Config(str(ini_path))
    command.stamp(config, revision)
    print(f"Stamped {database} database at {revision}.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", choices=("main", "sensor"))
    args = parser.parse_args()
    stamp(args.database)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
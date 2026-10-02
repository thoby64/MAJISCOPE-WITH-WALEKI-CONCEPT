#!/usr/bin/env python3
"""Preflight or migrate legacy/main-database sensor data into the sensor store.

The default action is read-only. It supports legacy ``sensor_reading`` rows,
current typed reading tables (including water quality), legacy/current device
registries, and legacy/current pending payloads. The target schema must already
be created and migrated.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import MetaData, case, create_engine, func, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.engine import Engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.session import _normalize_database_url
from app.models.sensor_platform import (
    SensorBase,
    SensorCategoryEnum,
    SensorDevice,
    SensorPendingReading,
    SensorStatusEnum,
    TankRef,
    TankStatusEnum,
    WaterLevelReading,
    WaterQualityReading,
)


TARGET_TABLES = {
    "tank": TankRef,
    "sensor_device": SensorDevice,
    "water_level_reading": WaterLevelReading,
    "water_quality_reading": WaterQualityReading,
    "sensor_pending_reading": SensorPendingReading,
}
REQUIRED_SOURCE_TABLES = {"tank"}
SENSOR_STATUS_COLUMNS = {"status"}


def _engine(url: str) -> Engine:
    engine = create_engine(_normalize_database_url(url), pool_pre_ping=True)
    return engine


def _reflect(engine: Engine) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=engine)
    return metadata


def _schema_problems(source: MetaData, target: MetaData) -> list[str]:
    problems = []
    missing_source = REQUIRED_SOURCE_TABLES - set(source.tables)
    if missing_source:
        problems.append(f"source is missing required tables: {', '.join(sorted(missing_source))}")

    for table_name, model in TARGET_TABLES.items():
        reflected = target.tables.get(table_name)
        if reflected is None:
            problems.append(f"target is missing required sensor table: {table_name}")
            continue
        reflected_columns = set(reflected.columns.keys())
        model_columns = set(model.__table__.columns.keys())
        if reflected_columns != model_columns:
            problems.append(
                f"target {table_name} column mismatch: "
                f"database-only={sorted(reflected_columns - model_columns)}, "
                f"model-only={sorted(model_columns - reflected_columns)}"
            )
    return problems


def _count(connection, metadata: MetaData, table_name: str) -> int:
    if table_name not in metadata.tables:
        return 0
    return int(connection.execute(
        select(func.count()).select_from(metadata.tables[table_name])
    ).scalar_one())


def _rows(connection, metadata: MetaData, table_name: str) -> Iterator[dict[str, Any]]:
    if table_name not in metadata.tables:
        return
    table = metadata.tables[table_name]
    result = connection.execution_options(stream_results=True).execute(select(table))
    while batch := result.mappings().fetchmany(1000):
        for row in batch:
            yield dict(row)


def _utc_naive(value: Any) -> Any:
    if value is not None and getattr(value, "tzinfo", None) is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _enum(enum_class, value: Any):
    if isinstance(value, enum_class):
        return value
    raw = value.value if hasattr(value, "value") else str(value)
    try:
        return enum_class(raw.lower())
    except ValueError:
        try:
            return enum_class[raw.upper()]
        except KeyError as exc:
            raise ValueError(f"Unsupported {enum_class.__name__} value: {raw!r}") from exc


def _sensor_config(row: dict[str, Any]) -> tuple[SensorCategoryEnum, dict[str, Any] | None]:
    raw_category = row.get("category")
    category = _enum(SensorCategoryEnum, raw_category) if raw_category else SensorCategoryEnum.WATER_LEVEL
    config = row.get("config")
    if isinstance(config, str):
        config = json.loads(config) if config.strip() else None
    if config is not None and not isinstance(config, dict):
        raise ValueError(f"Sensor {row.get('device_id')!r} config must be a JSON object")
    if config is None and category == SensorCategoryEnum.WATER_LEVEL:
        config = {
            key: row[key]
            for key in ("h1_m", "depth_m", "warning_height_m", "critical_height_m")
            if row.get(key) is not None
        }
        config.setdefault("warning_height_m", 10.0)
        config.setdefault("critical_height_m", 0.0)
    return category, config


def _mapped_rows(source_connection, source: MetaData) -> Iterator[tuple[str, dict[str, Any]]]:
    for row in _rows_for(source_connection, "tank", source):
        yield "tank", {
            key: _enum(TankStatusEnum, row.get("status") or "active") if key == "status" else _utc_naive(row.get(key))
            for key in ("id", "utility_id", "dma_id", "source_key", "name", "latitude", "longitude", "status", "created_at", "updated_at", "deactivated_at")
            if key in row
        }

    for row in _rows_for(source_connection, "sensor_device", source):
        category, config = _sensor_config(row)
        yield "sensor_device", {
            "id": row["id"],
            "device_id": row["device_id"],
            "category": category,
            "tank_id": row["tank_id"],
            "activated": bool(row.get("activated", False)),
            "config": config,
            "created_at": _utc_naive(row.get("created_at")),
            "updated_at": _utc_naive(row.get("updated_at")),
        }

    level_sources = [name for name in ("sensor_reading", "water_level_reading") if name in source.tables]
    if len(level_sources) > 1:
        raise ValueError("source contains both sensor_reading and water_level_reading; reconcile them before migration")
    for table_name in level_sources:
        for row in _rows_for(source_connection, table_name, source):
            mapped = {}
            for key in ("id", "sensor_id", "tank_id", "utility_id", "dma_id", "h1_m", "depth_m", "water_height_m", "raw_data", "occurred_at", "created_at"):
                if key in row:
                    mapped[key] = _utc_naive(row[key])
            status_value = row.get("status")
            if status_value is not None:
                mapped["status"] = _enum(SensorStatusEnum, status_value)
            if "h1_m" not in mapped or mapped["h1_m"] is None:
                mapped["h1_m"] = 0.0
            if "depth_m" not in mapped or mapped["depth_m"] is None:
                mapped["depth_m"] = 0.0
            if "water_height_m" not in mapped or mapped["water_height_m"] is None:
                mapped["water_height_m"] = 0.0
            yield "water_level_reading", mapped

    for row in _rows_for(source_connection, "water_quality_reading", source):
        mapped = {
            key: _utc_naive(value)
            for key, value in row.items()
            if key in WaterQualityReading.__table__.columns
        }
        if mapped.get("status") is not None:
            mapped["status"] = _enum(SensorStatusEnum, mapped["status"])
        yield "water_quality_reading", mapped

    for row in _rows_for(source_connection, "sensor_pending_reading", source):
        payload = row.get("payload")
        if isinstance(payload, str):
            payload = json.loads(payload)
        if payload is None:
            payload = {
                "device_id": row.get("device_id"),
                "depth_m": row.get("depth_m"),
                "raw_data": row.get("raw_data"),
            }
        if not isinstance(payload, dict):
            raise ValueError(f"Pending reading {row.get('id')!r} payload must be a JSON object")
        occurred_at = _utc_naive(row.get("occurred_at")) or datetime.utcnow()
        dedup_key = row.get("dedup_key") or f"{row.get('device_id')}:{occurred_at.isoformat()}"
        yield "sensor_pending_reading", {
            "id": row["id"],
            "device_id": row["device_id"],
            "payload": json.dumps(payload, default=str),
            "occurred_at": occurred_at,
            "dedup_key": dedup_key,
            "created_at": _utc_naive(row.get("created_at")),
        }


def _rows_for(connection, table_name: str, source: MetaData) -> Iterator[dict[str, Any]]:
    if table_name not in source.tables:
        return iter(())
    yield from _rows(connection, source, table_name)


def _validate_mappings(source_connection, source: MetaData) -> dict[str, int]:
    counts = {name: 0 for name in TARGET_TABLES}
    required = {
        "tank": {"id", "utility_id", "source_key"},
        "sensor_device": {"id", "device_id", "tank_id"},
        "sensor_reading": {"id", "sensor_id", "tank_id", "utility_id", "occurred_at"},
        "water_level_reading": {"id", "sensor_id", "tank_id", "utility_id", "occurred_at"},
        "water_quality_reading": {"id", "sensor_id", "tank_id", "utility_id", "status", "occurred_at"},
        "sensor_pending_reading": {"id", "device_id", "occurred_at"},
    }
    for table_name, required_columns in required.items():
        if table_name in source.tables:
            missing = required_columns - set(source.tables[table_name].columns.keys())
            if missing:
                raise ValueError(f"source {table_name} is missing required columns: {', '.join(sorted(missing))}")

    for target_name, row in _mapped_rows(source_connection, source):
        table = TARGET_TABLES[target_name].__table__
        invalid = {
            column.name for column in table.columns
            if not column.nullable and column.default is None and column.server_default is None
            and (column.name not in row or row[column.name] is None)
        }
        if invalid:
            raise ValueError(f"mapped {target_name} row is missing required fields: {', '.join(sorted(invalid))}")
        for column in table.columns:
            if row.get(column.name) is None and column.default is not None:
                row.pop(column.name, None)
        for column_name, value in row.items():
            if column_name in SENSOR_STATUS_COLUMNS and target_name in {"water_level_reading", "water_quality_reading"} and value is not None:
                _enum(SensorStatusEnum, value)
        counts[target_name] += 1
    return counts


def _copy(
    source_connection,
    source: MetaData,
    target_engine: Engine,
    batch_size: int,
    expected_counts: dict[str, int],
) -> dict[str, int]:
    inserted = {name: 0 for name in TARGET_TABLES}
    pending: dict[str, list[dict[str, Any]]] = {name: [] for name in TARGET_TABLES}
    with target_engine.begin() as target_connection:
        target_connection.exec_driver_sql("SET LOCAL lock_timeout = '5s'")
        preparer = target_engine.dialect.identifier_preparer
        for table_name in TARGET_TABLES:
            target_connection.exec_driver_sql(
                f"LOCK TABLE {preparer.quote(table_name)} IN ACCESS EXCLUSIVE MODE"
            )
        if any(
            target_connection.execute(
                select(func.count()).select_from(TARGET_TABLES[table_name].__table__)
            ).scalar_one()
            for table_name in TARGET_TABLES
        ):
            raise RuntimeError("Sensor target is not empty at apply time; no rows were written")

        for target_name, row in _mapped_rows(source_connection, source):
            pending[target_name].append(row)
            if len(pending[target_name]) >= batch_size:
                inserted[target_name] += _insert_batch(target_connection, target_name, pending[target_name])
                pending[target_name].clear()
        for target_name, rows in pending.items():
            if rows:
                inserted[target_name] += _insert_batch(target_connection, target_name, rows)
                rows.clear()

        sensor_table = SensorDevice.__table__
        tank_table = TankRef.__table__
        counts = select(
            sensor_table.c.tank_id,
            func.count().label("sensor_count"),
            func.sum(case((sensor_table.c.activated.is_(True), 1), else_=0)).label("active_sensor_count"),
        ).group_by(sensor_table.c.tank_id)
        for tank_id, total, active in target_connection.execute(counts):
            target_connection.execute(
                update(tank_table)
                .where(tank_table.c.id == tank_id)
                .values(sensor_count=total, active_sensor_count=active)
            )
        count_mismatches = [
            name for name in TARGET_TABLES if inserted[name] != expected_counts[name]
        ]
        if count_mismatches:
            raise RuntimeError(
                "Sensor rows were skipped or duplicated during insert: "
                + ", ".join(
                    f"{name} expected {expected_counts[name]}, inserted {inserted[name]}"
                    for name in count_mismatches
                )
            )
        target_mismatches = []
        for name, model in TARGET_TABLES.items():
            actual = target_connection.execute(
                select(func.count()).select_from(model.__table__)
            ).scalar_one()
            if actual != expected_counts[name]:
                target_mismatches.append(f"{name} expected {expected_counts[name]}, found {actual}")
        if target_mismatches:
            raise RuntimeError("Sensor target row-count verification failed: " + "; ".join(target_mismatches))
    return inserted


def _insert_batch(connection, table_name: str, rows: list[dict[str, Any]]) -> int:
    table = TARGET_TABLES[table_name].__table__
    groups: dict[frozenset[str], list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(frozenset(row), []).append(row)
    inserted = 0
    for group in groups.values():
        statement = postgres_insert(table).values(group).on_conflict_do_nothing(index_elements=[table.c.id])
        result = connection.execute(statement)
        inserted += max(result.rowcount or 0, 0)
    return inserted


def _target_counts(engine: Engine) -> dict[str, int]:
    return {name: _count(engine, SensorBase.metadata, name) for name in TARGET_TABLES}


def migrate(source_url: str, target_url: str, *, apply: bool, batch_size: int) -> None:
    source_engine = _engine(source_url)
    target_engine = _engine(target_url)
    if source_engine.url == target_engine.url:
        raise ValueError("source and target must be different databases")
    if not target_engine.dialect.name.startswith("postgresql"):
        raise ValueError("sensor migration target must be PostgreSQL")
    try:
        source = _reflect(source_engine)
        target = _reflect(target_engine)
        problems = _schema_problems(source, target)
        if problems:
            raise RuntimeError("Sensor migration preflight failed:\n- " + "\n- ".join(problems))

        source_connection = source_engine.connect()
        if source_engine.dialect.name.startswith("postgresql"):
            source_connection = source_connection.execution_options(isolation_level="REPEATABLE READ")
        with source_connection:
            with source_connection.begin():
                planned = _validate_mappings(source_connection, source)
                source_counts = {
                    name: sum(_count(source_connection, source, item) for item in source_names)
                    for name, source_names in {
                        "water_level_reading": ("sensor_reading", "water_level_reading"),
                        "water_quality_reading": ("water_quality_reading",),
                        "sensor_pending_reading": ("sensor_pending_reading",),
                        "sensor_device": ("sensor_device",),
                        "tank": ("tank",),
                    }.items()
                }
                initial_target = _target_counts(target_engine)
                print("Sensor migration preflight (source rows -> current target rows):")
                for name in TARGET_TABLES:
                    print(f"  {name}: {source_counts[name]} source rows; {initial_target[name]} target rows; {planned[name]} mapped rows")

                if not apply:
                    print("\nREAD-ONLY PREFLIGHT ONLY. No data was written. Review the report, then rerun with --apply.")
                    return
                if any(initial_target.values()):
                    raise RuntimeError("Target sensor tables are not empty. Use a new/empty target for an atomic migration.")

                _copy(source_connection, source, target_engine, batch_size, planned)
                print("\nCopy completed; inserted rows were committed and target counts verified.")
                print("Source databases and legacy tables were not modified or dropped.")
    finally:
        source_engine.dispose()
        target_engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", required=True, help="Source main/legacy database URL.")
    parser.add_argument("--target-url", required=True, help="Target PostgreSQL sensor database URL.")
    parser.add_argument("--apply", action="store_true", help="Write data; default is a read-only preflight.")
    parser.add_argument("--batch-size", type=int, default=1000, help="Rows per insert batch (default: 1000).")
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    migrate(args.source_url, args.target_url, apply=args.apply, batch_size=args.batch_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
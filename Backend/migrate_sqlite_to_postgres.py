#!/usr/bin/env python
"""Preflight or explicitly migrate a complete current SQLite main schema to PostgreSQL.

The default action is read-only. Prepare and review the PostgreSQL schema first;
this tool never creates or alters target tables. Historical schemas with drift
need an explicit, reviewed migration rather than implicit column guessing.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from sqlalchemy import MetaData, create_engine, delete, func, insert, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.sql.sqltypes import Enum as SQLAlchemyEnum, JSON as SQLAlchemyJSON

from app.database.session import _normalize_database_url
from app.models import Base


# Parent records precede children. team.leader_id is cleared on insert and
# restored after engineers exist to break the team/engineer FK cycle.
TABLE_ORDER = [
    "user",
    "utility",
    "utility_manager",
    "utility_service_area",
    "utility_infrastructure_layer",
    "dma",
    "dma_manager",
    "team",
    "engineer",
    "report",
    "image_upload",
    "activity_log",
    "notification",
    "push_device_token",
    "tank",
    "sensor_mirror_outbox",
    "hydraulic_model_launch_session",
    "hydraulic_simulation_snapshot",
]
IGNORED_MIGRATION_TABLES = {
    "alembic_version",
    "alembic_version_main",
    "alembic_version_sensor",
}
BINARY_TABLES = {"image_upload": "file_data", "utility_infrastructure_layer": "file_data"}
JSON_COLUMN_NAMES = {
    "photos", "data", "before_data", "after_data", "metadata_json",
    "readiness_json", "missing_required_json", "optional_status_json",
    "input_parameters_json", "summary_json", "nrw_json", "leakage_json",
    "alerts_json", "nodes_geojson", "pipes_geojson", "hotspots_geojson", "config",
}


def _create_sqlite_engine(source: Path) -> Engine:
    return create_engine(f"sqlite:///{source}")


def _create_postgres_engine(target_url: str) -> Engine:
    engine = create_engine(_normalize_database_url(target_url), pool_pre_ping=True)
    if not engine.dialect.name.startswith("postgresql"):
        engine.dispose()
        raise ValueError("Target URL must connect to PostgreSQL")
    return engine


def _reflect(engine: Engine) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=engine)
    return metadata


def _inspect_schema(source_meta: MetaData, target_meta: MetaData) -> list[str]:
    problems: list[str] = []
    for database_name, metadata in (("source", source_meta), ("target", target_meta)):
        missing = [name for name in TABLE_ORDER if name not in metadata.tables]
        if missing:
            problems.append(f"{database_name} is missing current tables: {', '.join(missing)}")

    for table_name in TABLE_ORDER:
        if table_name not in source_meta.tables or table_name not in target_meta.tables:
            continue
        source_columns = set(source_meta.tables[table_name].columns.keys())
        target_columns = set(target_meta.tables[table_name].columns.keys())
        if source_columns != target_columns:
            problems.append(
                f"{table_name} column mismatch: source-only={sorted(source_columns - target_columns)}, "
                f"target-only={sorted(target_columns - source_columns)}"
            )

    source_extras = set(source_meta.tables) - set(TABLE_ORDER) - IGNORED_MIGRATION_TABLES
    target_extras = set(target_meta.tables) - set(TABLE_ORDER) - IGNORED_MIGRATION_TABLES
    if source_extras:
        problems.append(f"source has unmapped tables: {', '.join(sorted(source_extras))}")
    if target_extras:
        problems.append(f"target has tables outside the current main schema: {', '.join(sorted(target_extras))}")
    return problems


def _table_stats_from_connection(connection, metadata: MetaData) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = {}
    for table_name in TABLE_ORDER:
        if table_name not in metadata.tables:
            continue
        table = metadata.tables[table_name]
        row_count = connection.execute(select(func.count()).select_from(table)).scalar_one()
        binary_bytes = 0
        if table_name in BINARY_TABLES:
            column_name = BINARY_TABLES[table_name]
            if column_name in table.c:
                binary_bytes = connection.execute(
                    select(func.coalesce(func.sum(func.length(table.c[column_name])), 0))
                ).scalar_one()
        stats[table_name] = {"rows": int(row_count), "binary_bytes": int(binary_bytes)}
    return stats


def _table_stats(engine: Engine, metadata: MetaData) -> dict[str, dict[str, int]]:
    with engine.connect() as connection:
        return _table_stats_from_connection(connection, metadata)


def _validate_values(connection, source_meta: MetaData) -> list[str]:
    problems: list[str] = []
    for table_name in TABLE_ORDER:
        if table_name not in source_meta.tables or table_name not in Base.metadata.tables:
            continue
        source_table = source_meta.tables[table_name]
        model_table = Base.metadata.tables[table_name]
        result = connection.execution_options(stream_results=True).execute(select(source_table))
        while batch := result.fetchmany(500):
            for row in batch:
                for column_name in source_table.columns.keys():
                    value = row[column_name]
                    if value is None:
                        continue
                    model_type = model_table.c[column_name].type
                    if isinstance(model_type, SQLAlchemyEnum):
                        enum_value = value.value if hasattr(value, "value") else str(value)
                        if enum_value not in model_type.enums:
                            problems.append(
                                f"{table_name}.{column_name} has unsupported enum value {enum_value!r}"
                            )
                    if column_name in JSON_COLUMN_NAMES or isinstance(model_type, SQLAlchemyJSON):
                        if isinstance(value, str):
                            try:
                                json.loads(value)
                            except (TypeError, ValueError):
                                problems.append(f"{table_name}.{column_name} contains invalid JSON")
    return problems


def _copy_table(source_connection, target_connection, source_table, target_table, *, batch_size: int) -> int:
    result = source_connection.execution_options(stream_results=True).execute(select(source_table))
    inserted = 0
    while batch := result.mappings().fetchmany(batch_size):
        rows = [dict(row) for row in batch]
        if target_table.name == "team":
            for row in rows:
                row["leader_id"] = None
        target_connection.execute(insert(target_table), rows)
        inserted += len(rows)
    return inserted


def _migrate(source: Path, target_url: str, *, apply: bool, replace: bool, batch_size: int) -> None:
    source_engine = _create_sqlite_engine(source)
    target_engine = _create_postgres_engine(target_url)
    try:
        source_meta = _reflect(source_engine)
        target_meta = _reflect(target_engine)
        problems = _inspect_schema(source_meta, target_meta)
        if problems:
            raise RuntimeError("Migration preflight failed:\n- " + "\n- ".join(problems))

        target_stats = _table_stats(target_engine, target_meta)
        target_rows = sum(item["rows"] for item in target_stats.values())
        if target_rows and not replace:
            raise RuntimeError("Target is not empty. Review it, then pass --replace only if replacing is intentional.")
        target_tables = target_meta.tables
        with source_engine.connect() as source_connection:
            with source_connection.begin():
                value_problems = _validate_values(source_connection, source_meta)
                if value_problems:
                    raise RuntimeError(
                        "Source value validation failed:\n- " + "\n- ".join(sorted(set(value_problems)))
                    )
                source_stats = _table_stats_from_connection(source_connection, source_meta)
                print("Preflight table totals (source -> target):")
                for table_name in TABLE_ORDER:
                    src = source_stats[table_name]
                    dst = target_stats[table_name]
                    print(
                        f"  {table_name}: {src['rows']} rows / {src['binary_bytes']} binary bytes -> "
                        f"{dst['rows']} rows / {dst['binary_bytes']} binary bytes"
                    )

                if not apply:
                    print("\nREAD-ONLY PREFLIGHT ONLY. No data was written. Review the inventory, then rerun with --apply.")
                    return

                with target_engine.begin() as target_connection:
                    target_connection.exec_driver_sql("SET LOCAL lock_timeout = '5s'")
                    preparer = target_engine.dialect.identifier_preparer
                    for table_name in TABLE_ORDER:
                        target_connection.exec_driver_sql(
                            f"LOCK TABLE {preparer.quote(table_name)} IN ACCESS EXCLUSIVE MODE"
                        )
                    current_target_stats = _table_stats_from_connection(target_connection, target_meta)
                    if sum(item["rows"] for item in current_target_stats.values()) and not replace:
                        raise RuntimeError(
                            "Target is not empty at apply time. Rerun preflight or use a new isolated target."
                        )
                    if replace:
                        target_connection.execute(update(target_tables["team"]).values(leader_id=None))
                        for table_name in reversed(TABLE_ORDER):
                            target_connection.execute(delete(target_tables[table_name]))

                    print("\nCopying source rows in batches...")
                    for table_name in TABLE_ORDER:
                        copied = _copy_table(
                            source_connection,
                            target_connection,
                            source_meta.tables[table_name],
                            target_tables[table_name],
                            batch_size=batch_size,
                        )
                        print(f"  {table_name}: {copied} rows")

                    team_table = target_tables["team"]
                    source_team = source_meta.tables["team"]
                    leaders = source_connection.execute(
                        select(source_team.c.id, source_team.c.leader_id).where(source_team.c.leader_id.is_not(None))
                    ).all()
                    for team_id, leader_id in leaders:
                        target_connection.execute(
                            update(team_table).where(team_table.c.id == team_id).values(leader_id=leader_id)
                        )

                    migrated_stats = _table_stats_from_connection(target_connection, target_meta)
                    mismatches = [name for name in TABLE_ORDER if source_stats[name] != migrated_stats[name]]
                    if mismatches:
                        raise RuntimeError(f"Post-copy verification mismatch in tables: {', '.join(mismatches)}")

                print("\nCopy completed; source/target row counts and binary payload totals match.")
    finally:
        source_engine.dispose()
        target_engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Preflight or migrate the current Majiscope main database.")
    parser.add_argument("--source", required=True, help="Path to a SQLite database with the complete current main schema.")
    parser.add_argument("--target", required=True, help="PostgreSQL SQLAlchemy URL with the current schema already migrated.")
    parser.add_argument("--apply", action="store_true", help="Write data. Without this option the command is read-only.")
    parser.add_argument("--replace", action="store_true", help="Delete target rows before copying; requires --apply and is destructive.")
    parser.add_argument("--batch-size", type=int, default=5000, help="Rows per insert batch (default: 5000).")
    args = parser.parse_args()

    if args.replace and not args.apply:
        parser.error("--replace requires --apply")
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    source = Path(args.source).resolve()
    if not source.exists():
        raise FileNotFoundError(f"SQLite source database not found: {source}")

    _migrate(source, args.target, apply=args.apply, replace=args.replace, batch_size=args.batch_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

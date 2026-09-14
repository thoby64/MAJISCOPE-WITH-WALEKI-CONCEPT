"""
Runtime database migrations for local/dev deployments.

This project does not currently use a full Alembic workflow in active
development, so startup migrations keep the local SQLite/Postgres database in
sync with the live backend models.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError

from app.services.slugs import slugify


def _run_postgres_ddl_without_timeout(
    connection,
    statement: str,
    *,
    required: bool = False,
) -> bool:
    connection.exec_driver_sql("SET LOCAL statement_timeout = '30s'")
    connection.exec_driver_sql("SET LOCAL lock_timeout = '5s'")
    try:
        connection.exec_driver_sql(statement)
    except OperationalError as exc:
        if _is_lock_or_statement_timeout(exc):
            compact_statement = " ".join(statement.split())
            if required:
                print(
                    "[startup-migrations] Required PostgreSQL DDL could not get a "
                    f"database lock in time: {compact_statement}"
                )
                raise
            print(
                "[startup-migrations] Skipping PostgreSQL DDL because the database "
                f"did not grant the lock quickly enough: {compact_statement}"
            )
            return False
        raise
    return True


def _is_lock_or_statement_timeout(exc: OperationalError) -> bool:
    message = str(exc).lower()
    return (
        "statement timeout" in message
        or "lock timeout" in message
        or "querycanceled" in message
        or "canceling statement" in message
    )


def run_safe_startup_migrations(engine: Engine) -> None:
    """
    Idempotent ADD COLUMN / index migrations safe to run on every deploy,
    including production. These use IF NOT EXISTS style DDL and avoid
    long-running table rewrites.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    if not existing_tables:
        return

    _migrate_account_invitation_columns(engine)
    _migrate_account_password_reset_columns(engine)
    _migrate_notification_columns(engine)
    _migrate_activity_log_constraints(engine)
    _migrate_report_workflow_columns(engine)
    _migrate_report_classification_columns(engine)
    _migrate_utility_contact_columns(engine)
    _migrate_human_readable_slugs(engine)
    _migrate_utility_service_area_table(engine)
    _migrate_dma_boundary_columns(engine)
    _migrate_utility_infrastructure_layer_table(engine)
    _migrate_sensor_tables(engine)
    _migrate_tank_key_field(engine)
    _migrate_hydraulic_model_tables(engine)
    _migrate_hydraulic_snapshot_report_columns(engine)
    _drop_legacy_utility_pipe_network_table(engine)


def run_heavy_startup_migrations(engine: Engine) -> None:
    """
    Migrations that may lock large tables or rewrite schema. Only run when
    RUN_STARTUP_MIGRATIONS=true (typically local/dev).
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    if not existing_tables:
        return

    dialect = engine.dialect.name

    if _needs_branchless_migration(inspector):
        if dialect == "sqlite":
            _backup_sqlite_database(engine)
            _migrate_sqlite_branchless_schema(engine)
        elif dialect.startswith("postgresql"):
            _migrate_postgres_branchless_schema(engine, inspector)

    _migrate_geographic_assignment_columns(engine)


def run_startup_migrations(engine: Engine) -> None:
    """Run all startup migrations (safe + heavy). Used in local/dev."""
    run_safe_startup_migrations(engine)
    run_heavy_startup_migrations(engine)


def _migrate_dma_boundary_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "dma" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("dma")}
    if "boundary_geojson" in columns:
        return

    with engine.begin() as connection:
        if engine.dialect.name.startswith("postgresql"):
            if not _run_postgres_ddl_without_timeout(
                connection,
                'ALTER TABLE dma ADD COLUMN IF NOT EXISTS boundary_geojson TEXT',
            ):
                return
        else:
            connection.exec_driver_sql("ALTER TABLE dma ADD COLUMN boundary_geojson TEXT")


def _migrate_utility_infrastructure_layer_table(engine: Engine) -> None:
    inspector = inspect(engine)
    if "utility" not in inspector.get_table_names():
        return
    if "utility_infrastructure_layer" in inspector.get_table_names():
        return

    with engine.begin() as connection:
        if engine.dialect.name.startswith("postgresql"):
            created_table = _run_postgres_ddl_without_timeout(
                connection,
                '''
                CREATE TABLE IF NOT EXISTS utility_infrastructure_layer (
                    id VARCHAR(36) PRIMARY KEY,
                    utility_id VARCHAR(36) NOT NULL REFERENCES utility(id) ON DELETE CASCADE,
                    asset_type VARCHAR(50) NOT NULL,
                    uploaded_by_manager_id VARCHAR(36) REFERENCES utility_manager(id) ON DELETE SET NULL,
                    file_data BYTEA NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
                    file_size INTEGER NOT NULL,
                    feature_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL,
                    CONSTRAINT uq_utility_infrastructure_asset UNIQUE (utility_id, asset_type)
                )
                '''
            )
            if not created_table:
                return
            for statement in [
                "CREATE INDEX IF NOT EXISTS ix_utility_infrastructure_layer_utility_id ON utility_infrastructure_layer (utility_id)",
                "CREATE INDEX IF NOT EXISTS ix_utility_infrastructure_layer_asset_type ON utility_infrastructure_layer (asset_type)",
                "CREATE INDEX IF NOT EXISTS ix_utility_infrastructure_layer_uploaded_by_manager_id ON utility_infrastructure_layer (uploaded_by_manager_id)",
            ]:
                if not _run_postgres_ddl_without_timeout(connection, statement):
                    return
        else:
            connection.exec_driver_sql(
                '''
                CREATE TABLE IF NOT EXISTS utility_infrastructure_layer (
                    id VARCHAR(36) PRIMARY KEY,
                    utility_id VARCHAR(36) NOT NULL,
                    asset_type VARCHAR(50) NOT NULL,
                    uploaded_by_manager_id VARCHAR(36),
                    file_data BLOB NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
                    file_size INTEGER NOT NULL,
                    feature_count INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    CONSTRAINT uq_utility_infrastructure_asset UNIQUE (utility_id, asset_type),
                    FOREIGN KEY(utility_id) REFERENCES utility(id) ON DELETE CASCADE,
                    FOREIGN KEY(uploaded_by_manager_id) REFERENCES utility_manager(id) ON DELETE SET NULL
                )
                '''
            )
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_infrastructure_layer_utility_id ON utility_infrastructure_layer (utility_id)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_infrastructure_layer_asset_type ON utility_infrastructure_layer (asset_type)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_infrastructure_layer_uploaded_by_manager_id ON utility_infrastructure_layer (uploaded_by_manager_id)")


def _migrate_tank_key_field(engine: Engine) -> None:
    inspector = inspect(engine)
    if "utility_infrastructure_layer" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("utility_infrastructure_layer")}
    if "tank_key_field" in columns:
        return

    with engine.begin() as connection:
        if engine.dialect.name.startswith("postgresql"):
            if not _run_postgres_ddl_without_timeout(
                connection,
                'ALTER TABLE utility_infrastructure_layer ADD COLUMN IF NOT EXISTS tank_key_field VARCHAR(100)',
            ):
                return
        else:
            connection.exec_driver_sql("ALTER TABLE utility_infrastructure_layer ADD COLUMN tank_key_field VARCHAR(100)")


def _migrate_sensor_tables(engine: Engine) -> None:
    """
    Ensure the tank table exists (main DB source of truth), and DROP the
    legacy sensor tables that moved to the sensor platform database.

    Legacy tables (sensor_device, sensor_reading, sensor_pending_reading) were
    migrated to the sensor platform DB via scripts/migrate_sensor_data.py;
    they are removed here so the main DB no longer carries stale copies.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    if "utility" not in existing_tables or "dma" not in existing_tables:
        return

    if "tank" not in existing_tables:
        if engine.dialect.name.startswith("postgresql"):
            ddl_statements = [
                """
                CREATE TABLE IF NOT EXISTS tank (
                    id VARCHAR(36) PRIMARY KEY,
                    utility_id VARCHAR(36) NOT NULL REFERENCES utility(id) ON DELETE CASCADE,
                    dma_id VARCHAR(36) REFERENCES dma(id) ON DELETE SET NULL,
                    source_key VARCHAR(500) NOT NULL,
                    name VARCHAR(255),
                    latitude FLOAT,
                    longitude FLOAT,
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL,
                    deactivated_at TIMESTAMP,
                    CONSTRAINT uq_tank_utility_source_key UNIQUE (utility_id, source_key)
                )
                """,
                "CREATE INDEX IF NOT EXISTS ix_tank_utility_id ON tank (utility_id)",
                "CREATE INDEX IF NOT EXISTS ix_tank_dma_id ON tank (dma_id)",
                "CREATE INDEX IF NOT EXISTS ix_tank_status ON tank (status)",
            ]
        else:
            ddl_statements = [
                """
                CREATE TABLE IF NOT EXISTS tank (
                    id VARCHAR(36) PRIMARY KEY,
                    utility_id VARCHAR(36) NOT NULL,
                    dma_id VARCHAR(36),
                    source_key VARCHAR(500) NOT NULL,
                    name VARCHAR(255),
                    latitude FLOAT,
                    longitude FLOAT,
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    deactivated_at DATETIME,
                    CONSTRAINT uq_tank_utility_source_key UNIQUE (utility_id, source_key),
                    FOREIGN KEY(utility_id) REFERENCES utility(id) ON DELETE CASCADE,
                    FOREIGN KEY(dma_id) REFERENCES dma(id) ON DELETE SET NULL
                )
                """,
                "CREATE INDEX IF NOT EXISTS ix_tank_utility_id ON tank (utility_id)",
                "CREATE INDEX IF NOT EXISTS ix_tank_dma_id ON tank (dma_id)",
                "CREATE INDEX IF NOT EXISTS ix_tank_status ON tank (status)",
            ]
        with engine.begin() as connection:
            for statement in ddl_statements:
                if engine.dialect.name.startswith("postgresql"):
                    if not _run_postgres_ddl_without_timeout(connection, statement, required=False):
                        return
                else:
                    connection.exec_driver_sql(statement)

    # Drop legacy sensor tables (data lives in the sensor platform DB now).
    for legacy_table in (
        "sensor_pending_reading",
        "sensor_reading",
        "sensor_device",
    ):
        if legacy_table in existing_tables:
            with engine.begin() as connection:
                try:
                    connection.exec_driver_sql(f"DROP TABLE IF EXISTS {legacy_table} CASCADE")
                except Exception as exc:  # non-fatal: best effort cleanup
                    print(f"   Legacy table drop skipped for {legacy_table}: {exc}")

    # Ensure water_quality_reading has the pressure column (added in v2.1)
    if "water_quality_reading" in existing_tables:
        with engine.begin() as connection:
            try:
                connection.exec_driver_sql(
                    "ALTER TABLE water_quality_reading ADD COLUMN IF NOT EXISTS pressure FLOAT;"
                )
            except Exception as exc:
                print(f"   Pressure column add skipped: {exc}")


def _drop_legacy_utility_pipe_network_table(engine: Engine) -> None:
    inspector = inspect(engine)
    if "utility_pipe_network" not in inspector.get_table_names():
        return

    with engine.begin() as connection:
        if engine.dialect.name.startswith("postgresql"):
            if not _run_postgres_ddl_without_timeout(
                connection,
                'DROP TABLE IF EXISTS utility_pipe_network CASCADE',
            ):
                return
        else:
            connection.exec_driver_sql("DROP TABLE IF EXISTS utility_pipe_network")


def _migrate_report_classification_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "report" not in inspector.get_table_names():
        return

    column_details = {column["name"]: column for column in inspector.get_columns("report")}
    columns = set(column_details)
    is_postgres = engine.dialect.name.startswith("postgresql")
    quoted_table_name = '"report"' if is_postgres else "report"

    if "report_type" not in columns:
        with engine.begin() as connection:
            statement = (
                f"ALTER TABLE {quoted_table_name} ADD COLUMN IF NOT EXISTS report_type VARCHAR(32) NOT NULL DEFAULT 'leakage'"
                if is_postgres
                else f"ALTER TABLE {quoted_table_name} ADD COLUMN report_type VARCHAR(32) NOT NULL DEFAULT 'leakage'"
            )
            if is_postgres:
                if not _run_postgres_ddl_without_timeout(connection, statement):
                    return
            else:
                connection.exec_driver_sql(statement)

    if "leakage_type" not in columns:
        with engine.begin() as connection:
            if is_postgres:
                if not _run_postgres_ddl_without_timeout(
                    connection,
                    f"ALTER TABLE {quoted_table_name} ADD COLUMN IF NOT EXISTS leakage_type VARCHAR(50) DEFAULT 'unknown'",
                ):
                    return
            else:
                connection.exec_driver_sql(f"ALTER TABLE {quoted_table_name} ADD COLUMN leakage_type VARCHAR(50) DEFAULT 'unknown'")

    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"UPDATE {quoted_table_name} SET report_type = 'leakage' WHERE report_type IS NULL OR report_type NOT IN ('leakage', 'non_leakage')"
        )
        connection.exec_driver_sql(
            f"UPDATE {quoted_table_name} SET leakage_type = NULL WHERE report_type = 'non_leakage'"
        )
        connection.exec_driver_sql(
            f"UPDATE {quoted_table_name} SET leakage_type = 'unknown' WHERE report_type = 'leakage' AND leakage_type IS NULL"
        )

        if is_postgres:
            statements = [
                f"ALTER TABLE {quoted_table_name} ALTER COLUMN leakage_type DROP NOT NULL",
                f"CREATE INDEX IF NOT EXISTS ix_report_type ON {quoted_table_name} (report_type)",
                f"CREATE INDEX IF NOT EXISTS ix_report_leakage_type ON {quoted_table_name} (leakage_type)",
                f"ALTER TABLE {quoted_table_name} DROP CONSTRAINT IF EXISTS ck_report_type_leakage_type",
                (
                    f"ALTER TABLE {quoted_table_name} ADD CONSTRAINT ck_report_type_leakage_type CHECK ("
                    "report_type IN ('leakage', 'non_leakage') AND "
                    "((report_type = 'leakage' AND leakage_type IS NOT NULL) OR "
                    "(report_type = 'non_leakage' AND leakage_type IS NULL)))"
                ),
            ]
            for statement in statements:
                if not _run_postgres_ddl_without_timeout(connection, statement):
                    return
        else:
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_report_type ON report (report_type)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_report_leakage_type ON report (leakage_type)")


def _needs_branchless_migration(inspector) -> bool:
    if "branch" in inspector.get_table_names():
        return True

    for table_name in ("team", "engineer", "report"):
        if table_name not in inspector.get_table_names():
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "branch_id" in columns:
            return True

    return False


def _backup_sqlite_database(engine: Engine) -> None:
    db_path = engine.url.database
    if not db_path:
        return

    sqlite_path = Path(db_path)
    if not sqlite_path.is_absolute():
        sqlite_path = Path.cwd() / sqlite_path

    if not sqlite_path.exists():
        return

    backup_path = sqlite_path.with_suffix(f".pre-branch-removal-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.bak")
    shutil.copy2(sqlite_path, backup_path)


def _migrate_sqlite_branchless_schema(engine: Engine) -> None:
    statements = [
        "PRAGMA foreign_keys=OFF",
        """
        CREATE TABLE IF NOT EXISTS team_new (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            dma_id VARCHAR(36) NOT NULL,
            leader_id VARCHAR(36),
            status VARCHAR(8),
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            CONSTRAINT uq_team_name_dma UNIQUE (name, dma_id),
            FOREIGN KEY(dma_id) REFERENCES dma(id) ON DELETE CASCADE,
            FOREIGN KEY(leader_id) REFERENCES engineer(id)
        )
        """,
        """
        INSERT INTO team_new (id, name, description, dma_id, leader_id, status, created_at, updated_at)
        SELECT id, name, description, dma_id, leader_id, status, created_at, updated_at
        FROM team
        """,
        "DROP TABLE IF EXISTS team",
        "ALTER TABLE team_new RENAME TO team",
        "CREATE INDEX IF NOT EXISTS ix_team_dma_id ON team (dma_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_team_leader_id ON team (leader_id)",
        """
        CREATE TABLE IF NOT EXISTS engineer_new (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            phone VARCHAR(20),
            dma_id VARCHAR(36) NOT NULL,
            team_id VARCHAR(36),
            status VARCHAR(8),
            role VARCHAR(50),
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            FOREIGN KEY(dma_id) REFERENCES dma(id) ON DELETE CASCADE,
            FOREIGN KEY(team_id) REFERENCES team(id)
        )
        """,
        """
        INSERT INTO engineer_new (id, name, email, password, phone, dma_id, team_id, status, role, created_at, updated_at)
        SELECT id, name, email, password, phone, dma_id, team_id, status, role, created_at, updated_at
        FROM engineer
        """,
        "DROP TABLE IF EXISTS engineer",
        "ALTER TABLE engineer_new RENAME TO engineer",
        "CREATE INDEX IF NOT EXISTS ix_engineer_dma_id ON engineer (dma_id)",
        "CREATE INDEX IF NOT EXISTS ix_engineer_team_id ON engineer (team_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_engineer_email ON engineer (email)",
        """
        CREATE TABLE IF NOT EXISTS report_new (
            id VARCHAR(36) PRIMARY KEY,
            tracking_id VARCHAR(50) NOT NULL UNIQUE,
            description TEXT NOT NULL,
            latitude FLOAT NOT NULL,
            longitude FLOAT NOT NULL,
            address VARCHAR(255),
            region_name VARCHAR(100),
            district_name VARCHAR(100),
            photos JSON,
            priority VARCHAR(8),
            report_type VARCHAR(32) NOT NULL DEFAULT 'leakage',
            leakage_type VARCHAR(50) DEFAULT 'unknown',
            status VARCHAR(16),
            utility_id VARCHAR(36),
            dma_id VARCHAR(36),
            team_id VARCHAR(36),
            assigned_engineer_id VARCHAR(36),
            reporter_name VARCHAR(255) NOT NULL,
            reporter_phone VARCHAR(20) NOT NULL,
            notes TEXT,
            sla_deadline DATETIME NOT NULL,
            resolved_at DATETIME,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            FOREIGN KEY(utility_id) REFERENCES utility(id),
            FOREIGN KEY(dma_id) REFERENCES dma(id) ON DELETE CASCADE,
            FOREIGN KEY(team_id) REFERENCES team(id),
            FOREIGN KEY(assigned_engineer_id) REFERENCES engineer(id)
        )
        """,
        """
        INSERT INTO report_new (
            id, tracking_id, description, latitude, longitude, address, region_name, district_name, photos, priority, report_type, leakage_type, status,
            utility_id, dma_id, team_id, assigned_engineer_id, reporter_name, reporter_phone,
            notes, sla_deadline, resolved_at, created_at, updated_at
        )
        SELECT
            id, tracking_id, description, latitude, longitude, address, NULL as region_name, NULL as district_name, photos, priority, 'leakage' as report_type, 'unknown' as leakage_type, status,
            utility_id, dma_id, team_id, assigned_engineer_id, reporter_name, reporter_phone,
            notes, sla_deadline, resolved_at, created_at, updated_at
        FROM report
        """,
        "DROP TABLE IF EXISTS report",
        "ALTER TABLE report_new RENAME TO report",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_report_tracking_id ON report (tracking_id)",
        "CREATE INDEX IF NOT EXISTS ix_report_status ON report (status)",
        "CREATE INDEX IF NOT EXISTS ix_report_type ON report (report_type)",
        "CREATE INDEX IF NOT EXISTS ix_report_leakage_type ON report (leakage_type)",
        "CREATE INDEX IF NOT EXISTS ix_report_utility_id ON report (utility_id)",
        "CREATE INDEX IF NOT EXISTS ix_report_dma_id ON report (dma_id)",
        "CREATE INDEX IF NOT EXISTS ix_report_created_at ON report (created_at)",
        "DROP TABLE IF EXISTS branch",
        "PRAGMA foreign_keys=ON",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)


def _migrate_postgres_branchless_schema(engine: Engine, inspector) -> None:
    with engine.begin() as connection:
        team_unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("team")}
        if "uq_team_name_branch" in team_unique_constraints:
            connection.execute(text('ALTER TABLE "team" DROP CONSTRAINT IF EXISTS uq_team_name_branch'))

        connection.execute(text('ALTER TABLE "team" DROP COLUMN IF EXISTS branch_id CASCADE'))
        connection.execute(text('ALTER TABLE "engineer" DROP COLUMN IF EXISTS branch_id CASCADE'))
        connection.execute(text('ALTER TABLE "report" DROP COLUMN IF EXISTS branch_id CASCADE'))

        updated_inspector = inspect(connection)
        current_team_uniques = {constraint["name"] for constraint in updated_inspector.get_unique_constraints("team")}
        if "uq_team_name_dma" not in current_team_uniques:
            connection.execute(text('ALTER TABLE "team" ADD CONSTRAINT uq_team_name_dma UNIQUE (name, dma_id)'))

        connection.execute(text('DROP TABLE IF EXISTS "branch" CASCADE'))


def _migrate_notification_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "notification" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("notification")}

    statements = []
    if "data" not in columns:
        statements.append('ALTER TABLE notification ADD COLUMN data JSON')
    if "updated_at" not in columns:
        if engine.dialect.name == "sqlite":
            statements.append('ALTER TABLE notification ADD COLUMN updated_at DATETIME')
            statements.append('UPDATE notification SET updated_at = created_at WHERE updated_at IS NULL')
        else:
            statements.append('ALTER TABLE notification ADD COLUMN updated_at TIMESTAMP')
            statements.append('UPDATE notification SET updated_at = created_at WHERE updated_at IS NULL')

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)


def _migrate_account_invitation_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    for table_name, placeholder_names in (
        ("user", ("Pending Setup", "Invited User")),
        ("engineer", ("Pending Setup", "Invited User")),
        ("utility_manager", ("Pending Setup", "Invited User")),
        ("dma_manager", ("Pending Setup", "Invited User")),
    ):
        if table_name not in inspector.get_table_names():
            continue

        columns = {column["name"] for column in inspector.get_columns(table_name)}
        statements = []
        quoted_table_name = f'"{table_name}"' if engine.dialect.name.startswith("postgresql") else table_name
        if "invite_token_hash" not in columns:
            statements.append(f'ALTER TABLE {quoted_table_name} ADD COLUMN invite_token_hash VARCHAR(255)')
        if "invite_sent_at" not in columns:
            statements.append(f'ALTER TABLE {quoted_table_name} ADD COLUMN invite_sent_at {"DATETIME" if engine.dialect.name == "sqlite" else "TIMESTAMP"}')
        if "invite_expires_at" not in columns:
            statements.append(f'ALTER TABLE {quoted_table_name} ADD COLUMN invite_expires_at {"DATETIME" if engine.dialect.name == "sqlite" else "TIMESTAMP"}')
        if "setup_completed_at" not in columns:
            statements.append(f'ALTER TABLE {quoted_table_name} ADD COLUMN setup_completed_at {"DATETIME" if engine.dialect.name == "sqlite" else "TIMESTAMP"}')

        with engine.begin() as connection:
            for statement in statements:
                connection.exec_driver_sql(statement)

            if engine.dialect.name == "sqlite":
                connection.exec_driver_sql(
                    f"CREATE INDEX IF NOT EXISTS ix_{table_name}_invite_token_hash ON {table_name} (invite_token_hash)"
                )
            else:
                connection.exec_driver_sql(
                    f'CREATE INDEX IF NOT EXISTS ix_{table_name}_invite_token_hash ON "{table_name}" (invite_token_hash)'
                )

            placeholders = "', '".join(placeholder_names)
            connection.exec_driver_sql(
                f"""
                UPDATE {quoted_table_name}
                SET setup_completed_at = created_at
                WHERE setup_completed_at IS NULL
                  AND COALESCE(name, '') NOT IN ('{placeholders}')
                """
            )


def _migrate_account_password_reset_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    for table_name in ("user", "engineer", "utility_manager", "dma_manager"):
        if table_name not in inspector.get_table_names():
            continue

        columns = {column["name"] for column in inspector.get_columns(table_name)}
        statements = []
        quoted_table_name = f'"{table_name}"' if engine.dialect.name.startswith("postgresql") else table_name
        timestamp_type = "DATETIME" if engine.dialect.name == "sqlite" else "TIMESTAMP"
        if "password_reset_token_hash" not in columns:
            statements.append(f'ALTER TABLE {quoted_table_name} ADD COLUMN password_reset_token_hash VARCHAR(255)')
        if "password_reset_sent_at" not in columns:
            statements.append(f'ALTER TABLE {quoted_table_name} ADD COLUMN password_reset_sent_at {timestamp_type}')
        if "password_reset_expires_at" not in columns:
            statements.append(f'ALTER TABLE {quoted_table_name} ADD COLUMN password_reset_expires_at {timestamp_type}')

        with engine.begin() as connection:
            for statement in statements:
                connection.exec_driver_sql(statement)

            if engine.dialect.name == "sqlite":
                connection.exec_driver_sql(
                    f"CREATE INDEX IF NOT EXISTS ix_{table_name}_password_reset_token_hash ON {table_name} (password_reset_token_hash)"
                )
            else:
                connection.exec_driver_sql(
                    f'CREATE INDEX IF NOT EXISTS ix_{table_name}_password_reset_token_hash ON "{table_name}" (password_reset_token_hash)'
                )


def _migrate_activity_log_constraints(engine: Engine) -> None:
    inspector = inspect(engine)
    if "activity_log" not in inspector.get_table_names():
        return

    if engine.dialect.name == "sqlite":
        with engine.begin() as connection:
            row = connection.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_log'"
            ).fetchone()
            create_sql = row[0] if row else ""
            if "uq_log_entity" in create_sql or "UNIQUE (entity, entity_id)" in create_sql:
                statements = [
                    "PRAGMA foreign_keys=OFF",
                    """
                    CREATE TABLE IF NOT EXISTS activity_log_new (
                        id VARCHAR(36) PRIMARY KEY,
                        action VARCHAR(100) NOT NULL,
                        user_id VARCHAR(36),
                        utility_mgr_id VARCHAR(36),
                        dma_mgr_id VARCHAR(36),
                        engineer_id VARCHAR(36),
                        user_name VARCHAR(255) NOT NULL,
                        user_role VARCHAR(50) NOT NULL,
                        entity VARCHAR(100) NOT NULL,
                        entity_id VARCHAR(36) NOT NULL,
                        details TEXT,
                        utility_id VARCHAR(36),
                        dma_id VARCHAR(36),
                        timestamp DATETIME NOT NULL,
                        FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE SET NULL,
                        FOREIGN KEY(utility_mgr_id) REFERENCES utility_manager(id) ON DELETE SET NULL,
                        FOREIGN KEY(dma_mgr_id) REFERENCES dma_manager(id) ON DELETE SET NULL,
                        FOREIGN KEY(engineer_id) REFERENCES engineer(id) ON DELETE SET NULL,
                        FOREIGN KEY(utility_id) REFERENCES utility(id) ON DELETE SET NULL,
                        FOREIGN KEY(dma_id) REFERENCES dma(id) ON DELETE SET NULL
                    )
                    """,
                    """
                    INSERT INTO activity_log_new (
                        id, action, user_id, utility_mgr_id, dma_mgr_id, engineer_id, user_name, user_role,
                        entity, entity_id, details, utility_id, dma_id, timestamp
                    )
                    SELECT
                        id, action, user_id, utility_mgr_id, dma_mgr_id, engineer_id, user_name, user_role,
                        entity, entity_id, details, utility_id, dma_id, timestamp
                    FROM activity_log
                    """,
                    "DROP TABLE IF EXISTS activity_log",
                    "ALTER TABLE activity_log_new RENAME TO activity_log",
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_user_id ON activity_log (user_id)",
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_utility_mgr_id ON activity_log (utility_mgr_id)",
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_dma_mgr_id ON activity_log (dma_mgr_id)",
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_engineer_id ON activity_log (engineer_id)",
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_utility_id ON activity_log (utility_id)",
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_dma_id ON activity_log (dma_id)",
                    "CREATE INDEX IF NOT EXISTS ix_activity_log_timestamp ON activity_log (timestamp)",
                    "PRAGMA foreign_keys=ON",
                ]
                for statement in statements:
                    connection.exec_driver_sql(statement)

        inspector = inspect(engine)

    if engine.dialect.name.startswith("postgresql"):
        with engine.begin() as connection:
            connection.execute(text('ALTER TABLE "activity_log" DROP CONSTRAINT IF EXISTS uq_log_entity'))

    columns = {column["name"] for column in inspector.get_columns("activity_log")}
    is_postgres = engine.dialect.name.startswith("postgresql")
    json_type = "JSONB" if is_postgres else "JSON"
    text_type = "TEXT"
    column_definitions = {
        "event_type": "VARCHAR(100)",
        "status": "VARCHAR(32)",
        "target_name": "VARCHAR(255)",
        "ip_address": "VARCHAR(64)",
        "user_agent": text_type,
        "request_method": "VARCHAR(16)",
        "request_path": "VARCHAR(500)",
        "before_data": json_type,
        "after_data": json_type,
        "metadata_json": json_type,
        "error_message": text_type,
    }

    for column_name, column_type in column_definitions.items():
        if column_name in columns:
            continue
        statement = (
            f'ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS {column_name} {column_type}'
            if is_postgres
            else f"ALTER TABLE activity_log ADD COLUMN {column_name} {column_type}"
        )
        with engine.begin() as connection:
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, statement)
            else:
                connection.exec_driver_sql(statement)

    index_columns = [
        "event_type",
        "status",
        "entity",
        "entity_id",
        "user_role",
        "utility_id",
        "dma_id",
        "timestamp",
    ]
    for column_name in index_columns:
        index_name = f"ix_activity_log_{column_name}"
        statement = (
            f'CREATE INDEX IF NOT EXISTS {index_name} ON "activity_log" ({column_name})'
            if is_postgres
            else f"CREATE INDEX IF NOT EXISTS {index_name} ON activity_log ({column_name})"
        )
        with engine.begin() as connection:
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, statement)
            else:
                connection.exec_driver_sql(statement)


def _migrate_report_workflow_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "report" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("report")}
    quoted_table_name = '"report"' if engine.dialect.name.startswith("postgresql") else "report"
    statements: list[str] = []

    if "engineer_submission_notes" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} ADD COLUMN engineer_submission_notes TEXT")
    if "team_leader_review_notes" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} ADD COLUMN team_leader_review_notes TEXT")
    if "dma_review_notes" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} ADD COLUMN dma_review_notes TEXT")
    if "public_history_key" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} ADD COLUMN public_history_key VARCHAR(64)")
    if "region_name" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} ADD COLUMN region_name VARCHAR(100)")
    if "district_name" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} ADD COLUMN district_name VARCHAR(100)")

    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)

        index_statement = (
            "CREATE INDEX IF NOT EXISTS ix_report_public_history_key ON report (public_history_key)"
            if engine.dialect.name == "sqlite"
            else 'CREATE INDEX IF NOT EXISTS ix_report_public_history_key ON "report" (public_history_key)'
        )
        connection.exec_driver_sql(index_statement)
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_report_region_name ON report (region_name)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_report_district_name ON report (district_name)")
        else:
            connection.exec_driver_sql('CREATE INDEX IF NOT EXISTS ix_report_region_name ON "report" (region_name)')
            connection.exec_driver_sql('CREATE INDEX IF NOT EXISTS ix_report_district_name ON "report" (district_name)')


def _migrate_utility_contact_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "utility" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("utility")}
    is_postgres = engine.dialect.name.startswith("postgresql")
    quoted_table_name = '"utility"' if is_postgres else "utility"
    add_column_clause = "ADD COLUMN IF NOT EXISTS" if is_postgres else "ADD COLUMN"
    statements: list[str] = []

    if "contact_phone" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} contact_phone VARCHAR(20)")
    if "contact_email" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} contact_email VARCHAR(255)")
    if "contact_address" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} contact_address VARCHAR(255)")
    if "center_latitude" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} center_latitude FLOAT")
    if "center_longitude" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} center_longitude FLOAT")
    if "boundary_geojson" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} boundary_geojson TEXT")
    if "boundary_source_type" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} boundary_source_type VARCHAR(32)")
    if "boundary_status" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} boundary_status VARCHAR(32)")
    if "region_name" not in columns:
        statements.append(f"ALTER TABLE {quoted_table_name} {add_column_clause} region_name VARCHAR(100)")

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            if is_postgres:
                if not _run_postgres_ddl_without_timeout(
                    connection,
                    statement,
                ):
                    return
            else:
                connection.exec_driver_sql(statement)


def _migrate_utility_service_area_table(engine: Engine) -> None:
    inspector = inspect(engine)
    if "utility" not in inspector.get_table_names():
        return

    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql(
                """
                CREATE TABLE IF NOT EXISTS utility_service_area (
                    id VARCHAR(36) PRIMARY KEY,
                    utility_id VARCHAR(36) NOT NULL,
                    category VARCHAR(32) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    region_name VARCHAR(100),
                    admin_area_id VARCHAR(100),
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    CONSTRAINT uq_utility_service_area_named UNIQUE (utility_id, category, name, region_name),
                    FOREIGN KEY(utility_id) REFERENCES utility(id) ON DELETE CASCADE
                )
                """
            )
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_service_area_utility_id ON utility_service_area (utility_id)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_service_area_category ON utility_service_area (category)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_service_area_name ON utility_service_area (name)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_service_area_region_name ON utility_service_area (region_name)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_utility_service_area_admin_area_id ON utility_service_area (admin_area_id)")
            return

        if engine.dialect.name.startswith("postgresql"):
            ddl_statements = [
                """
                CREATE TABLE IF NOT EXISTS utility_service_area (
                    id VARCHAR(36) PRIMARY KEY,
                    utility_id VARCHAR(36) NOT NULL REFERENCES utility(id) ON DELETE CASCADE,
                    category VARCHAR(32) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    region_name VARCHAR(100),
                    admin_area_id VARCHAR(100),
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL,
                    CONSTRAINT uq_utility_service_area_named UNIQUE (utility_id, category, name, region_name)
                )
                """,
                "CREATE INDEX IF NOT EXISTS ix_utility_service_area_utility_id ON utility_service_area (utility_id)",
                "CREATE INDEX IF NOT EXISTS ix_utility_service_area_category ON utility_service_area (category)",
                "CREATE INDEX IF NOT EXISTS ix_utility_service_area_name ON utility_service_area (name)",
                "CREATE INDEX IF NOT EXISTS ix_utility_service_area_region_name ON utility_service_area (region_name)",
                "CREATE INDEX IF NOT EXISTS ix_utility_service_area_admin_area_id ON utility_service_area (admin_area_id)",
            ]
            for statement in ddl_statements:
                if not _run_postgres_ddl_without_timeout(
                    connection,
                    statement,
                ):
                    return


def _unique_slug(base_slug: str, used_slugs: set[str]) -> str:
    candidate = base_slug
    suffix = 2
    while candidate in used_slugs:
        candidate = f"{base_slug}-{suffix}"
        suffix += 1
    used_slugs.add(candidate)
    return candidate


def _migrate_human_readable_slugs(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    is_postgres = engine.dialect.name.startswith("postgresql")

    if "utility" in existing_tables:
        utility_columns = {column["name"] for column in inspector.get_columns("utility")}
        if "slug" not in utility_columns:
            with engine.begin() as connection:
                statement = (
                    'ALTER TABLE "utility" ADD COLUMN IF NOT EXISTS slug VARCHAR(255)'
                    if is_postgres
                    else "ALTER TABLE utility ADD COLUMN slug VARCHAR(255)"
                )
                if is_postgres:
                    if not _run_postgres_ddl_without_timeout(connection, statement):
                        return
                else:
                    connection.exec_driver_sql(statement)

        with engine.begin() as connection:
            rows = connection.execute(text("SELECT id, name, slug FROM utility ORDER BY created_at, id")).mappings().all()
            used_slugs = {str(row["slug"]) for row in rows if row["slug"]}
            for row in rows:
                if row["slug"]:
                    continue
                slug = _unique_slug(slugify(str(row["name"]), fallback="utility"), used_slugs)
                connection.execute(
                    text("UPDATE utility SET slug = :slug WHERE id = :utility_id"),
                    {"slug": slug, "utility_id": row["id"]},
                )

        with engine.begin() as connection:
            statement = (
                'CREATE UNIQUE INDEX IF NOT EXISTS ix_utility_slug_unique ON "utility" (slug)'
                if is_postgres
                else "CREATE UNIQUE INDEX IF NOT EXISTS ix_utility_slug_unique ON utility (slug)"
            )
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, statement)
            else:
                connection.exec_driver_sql(statement)

    if "dma" in existing_tables:
        dma_columns = {column["name"] for column in inspector.get_columns("dma")}
        if "slug" not in dma_columns:
            with engine.begin() as connection:
                statement = (
                    "ALTER TABLE dma ADD COLUMN IF NOT EXISTS slug VARCHAR(255)"
                    if is_postgres
                    else "ALTER TABLE dma ADD COLUMN slug VARCHAR(255)"
                )
                if is_postgres:
                    if not _run_postgres_ddl_without_timeout(connection, statement):
                        return
                else:
                    connection.exec_driver_sql(statement)

        with engine.begin() as connection:
            rows = connection.execute(text("SELECT id, utility_id, name, slug FROM dma ORDER BY utility_id, created_at, id")).mappings().all()
            used_slugs = {str(row["slug"]) for row in rows if row["slug"]}
            for row in rows:
                if row["slug"]:
                    continue
                slug = _unique_slug(slugify(str(row["name"]), fallback="dma"), used_slugs)
                connection.execute(
                    text("UPDATE dma SET slug = :slug WHERE id = :dma_id"),
                    {"slug": slug, "dma_id": row["id"]},
                )

        with engine.begin() as connection:
            statement = (
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_dma_slug_unique ON dma (slug)"
            )
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, statement)
            else:
                connection.exec_driver_sql(statement)

    if "team" in existing_tables:
        team_columns = {column["name"] for column in inspector.get_columns("team")}
        if "slug" not in team_columns:
            with engine.begin() as connection:
                statement = (
                    "ALTER TABLE team ADD COLUMN IF NOT EXISTS slug VARCHAR(255)"
                    if is_postgres
                    else "ALTER TABLE team ADD COLUMN slug VARCHAR(255)"
                )
                if is_postgres:
                    if not _run_postgres_ddl_without_timeout(connection, statement):
                        return
                else:
                    connection.exec_driver_sql(statement)

        with engine.begin() as connection:
            rows = connection.execute(text("SELECT id, name, slug FROM team ORDER BY dma_id, created_at, id")).mappings().all()
            used_slugs = {str(row["slug"]) for row in rows if row["slug"]}
            for row in rows:
                if row["slug"]:
                    continue
                slug = _unique_slug(slugify(str(row["name"]), fallback="team"), used_slugs)
                connection.execute(
                    text("UPDATE team SET slug = :slug WHERE id = :team_id"),
                    {"slug": slug, "team_id": row["id"]},
                )

        with engine.begin() as connection:
            statement = "CREATE UNIQUE INDEX IF NOT EXISTS ix_team_slug_unique ON team (slug)"
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, statement)
            else:
                connection.exec_driver_sql(statement)


def _migrate_geographic_assignment_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "report" not in inspector.get_table_names():
        return

    columns = {
        column["name"]: column
        for column in inspector.get_columns("report")
    }

    if engine.dialect.name == "sqlite":
        _migrate_sqlite_nullable_report_assignment(engine)
        return

    if engine.dialect.name.startswith("postgresql"):
        statements: list[str] = []
        if columns.get("utility_id", {}).get("nullable") is False:
            statements.append('ALTER TABLE "report" ALTER COLUMN utility_id DROP NOT NULL')
        if columns.get("dma_id", {}).get("nullable") is False:
            statements.append('ALTER TABLE "report" ALTER COLUMN dma_id DROP NOT NULL')

        if not statements:
            return

        try:
            with engine.begin() as connection:
                if engine.dialect.name.startswith("postgresql"):
                    connection.exec_driver_sql("SET LOCAL statement_timeout = 0")
                for statement in statements:
                    connection.execute(text(statement))
        except OperationalError as exc:
            if _is_lock_or_statement_timeout(exc):
                print(
                    "[startup-migrations] Skipping nullable geographic assignment migration for now "
                    "because the report table is locked or timed out. "
                    "Run the ALTER TABLE manually during a quiet window if needed."
                )
                return
            raise


def _migrate_hydraulic_model_tables(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    is_postgres = engine.dialect.name.startswith("postgresql")

    if "utility" not in existing_tables or "dma" not in existing_tables:
        return

    if "hydraulic_model_launch_session" not in existing_tables:
        if is_postgres:
            create_launch_session = """
            CREATE TABLE IF NOT EXISTS hydraulic_model_launch_session (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) REFERENCES "user"(id) ON DELETE SET NULL,
                utility_mgr_id VARCHAR(36) REFERENCES utility_manager(id) ON DELETE SET NULL,
                dma_mgr_id VARCHAR(36) REFERENCES dma_manager(id) ON DELETE SET NULL,
                engineer_id VARCHAR(36) REFERENCES engineer(id) ON DELETE SET NULL,
                user_name VARCHAR(255) NOT NULL,
                user_role VARCHAR(50) NOT NULL,
                utility_id VARCHAR(36) NOT NULL REFERENCES utility(id) ON DELETE CASCADE,
                dma_id VARCHAR(36) NOT NULL REFERENCES dma(id) ON DELETE CASCADE,
                hydraulic_filename VARCHAR(255),
                hydraulic_file_ref VARCHAR(500),
                launch_token_hash VARCHAR(128) UNIQUE,
                status VARCHAR(32) NOT NULL DEFAULT 'preparing',
                readiness_json JSON,
                missing_required_json JSON,
                optional_status_json JSON,
                error_message TEXT,
                expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                launched_at TIMESTAMP WITHOUT TIME ZONE,
                completed_at TIMESTAMP WITHOUT TIME ZONE,
                cleaned_at TIMESTAMP WITHOUT TIME ZONE,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        else:
            create_launch_session = """
            CREATE TABLE IF NOT EXISTS hydraulic_model_launch_session (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36),
                utility_mgr_id VARCHAR(36),
                dma_mgr_id VARCHAR(36),
                engineer_id VARCHAR(36),
                user_name VARCHAR(255) NOT NULL,
                user_role VARCHAR(50) NOT NULL,
                utility_id VARCHAR(36) NOT NULL,
                dma_id VARCHAR(36) NOT NULL,
                hydraulic_filename VARCHAR(255),
                hydraulic_file_ref VARCHAR(500),
                launch_token_hash VARCHAR(128) UNIQUE,
                status VARCHAR(32) NOT NULL DEFAULT 'preparing',
                readiness_json JSON,
                missing_required_json JSON,
                optional_status_json JSON,
                error_message TEXT,
                expires_at DATETIME NOT NULL,
                launched_at DATETIME,
                completed_at DATETIME,
                cleaned_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        with engine.begin() as connection:
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, create_launch_session, required=False)
            else:
                connection.exec_driver_sql(create_launch_session)

    if "hydraulic_simulation_snapshot" not in existing_tables:
        if is_postgres:
            create_snapshot = """
            CREATE TABLE IF NOT EXISTS hydraulic_simulation_snapshot (
                id VARCHAR(36) PRIMARY KEY,
                launch_session_id VARCHAR(36) REFERENCES hydraulic_model_launch_session(id) ON DELETE SET NULL,
                utility_id VARCHAR(36) NOT NULL REFERENCES utility(id) ON DELETE CASCADE,
                dma_id VARCHAR(36) NOT NULL REFERENCES dma(id) ON DELETE CASCADE,
                hydraulic_scenario_id VARCHAR(100),
                scenario_name VARCHAR(255),
                scenario_status VARCHAR(32),
                input_parameters_json JSON,
                summary_json JSON,
                nrw_json JSON,
                leakage_json JSON,
                alerts_json JSON,
                nodes_geojson JSON,
                pipes_geojson JSON,
                hotspots_geojson JSON,
                created_by_user_id VARCHAR(36),
                created_by_role VARCHAR(50),
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        else:
            create_snapshot = """
            CREATE TABLE IF NOT EXISTS hydraulic_simulation_snapshot (
                id VARCHAR(36) PRIMARY KEY,
                launch_session_id VARCHAR(36),
                utility_id VARCHAR(36) NOT NULL,
                dma_id VARCHAR(36) NOT NULL,
                hydraulic_scenario_id VARCHAR(100),
                scenario_name VARCHAR(255),
                scenario_status VARCHAR(32),
                input_parameters_json JSON,
                summary_json JSON,
                nrw_json JSON,
                leakage_json JSON,
                alerts_json JSON,
                nodes_geojson JSON,
                pipes_geojson JSON,
                hotspots_geojson JSON,
                created_by_user_id VARCHAR(36),
                created_by_role VARCHAR(50),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        with engine.begin() as connection:
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, create_snapshot, required=False)
            else:
                connection.exec_driver_sql(create_snapshot)

    index_statements = [
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_launch_user_role ON hydraulic_model_launch_session (user_role)",
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_launch_utility_id ON hydraulic_model_launch_session (utility_id)",
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_launch_dma_id ON hydraulic_model_launch_session (dma_id)",
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_launch_status ON hydraulic_model_launch_session (status)",
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_launch_expires_at ON hydraulic_model_launch_session (expires_at)",
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_snapshot_utility_id ON hydraulic_simulation_snapshot (utility_id)",
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_snapshot_dma_id ON hydraulic_simulation_snapshot (dma_id)",
        "CREATE INDEX IF NOT EXISTS ix_hydraulic_snapshot_created_at ON hydraulic_simulation_snapshot (created_at)",
    ]
    with engine.begin() as connection:
        for statement in index_statements:
            if is_postgres:
                _run_postgres_ddl_without_timeout(connection, statement, required=False)
            else:
                connection.exec_driver_sql(statement)


def _migrate_hydraulic_snapshot_report_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    if "hydraulic_simulation_snapshot" not in inspector.get_table_names():
        return

    column_metadata = {column["name"]: column for column in inspector.get_columns("hydraulic_simulation_snapshot")}
    existing = set(column_metadata)
    foreign_keys = inspector.get_foreign_keys("hydraulic_simulation_snapshot")
    definitions = {
        "report_reference": "VARCHAR(40)",
        "utility_name": "VARCHAR(255)",
        "dma_name": "VARCHAR(255)",
        "created_by_name": "VARCHAR(255)",
        "created_by_email": "VARCHAR(255)",
        "completed_at": "TIMESTAMP",
        "execution_duration_seconds": "FLOAT",
        "snapshot_version": "INTEGER DEFAULT 1 NOT NULL",
        "result_quality": "VARCHAR(32)",
        "error_message": "TEXT",
    }
    with engine.begin() as connection:
        for column, definition in definitions.items():
            if column in existing:
                continue
            statement = f'ALTER TABLE hydraulic_simulation_snapshot ADD COLUMN {column} {definition}'
            if engine.dialect.name.startswith("postgresql"):
                _run_postgres_ddl_without_timeout(connection, statement, required=False)
            else:
                connection.exec_driver_sql(statement)

        if engine.dialect.name.startswith("postgresql"):
            for column in ("utility_id", "dma_id"):
                if column_metadata.get(column, {}).get("nullable") is False:
                    _run_postgres_ddl_without_timeout(
                        connection,
                        f"ALTER TABLE hydraulic_simulation_snapshot ALTER COLUMN {column} DROP NOT NULL",
                        required=False,
                    )
            for column, target in (("utility_id", "utility"), ("dma_id", "dma")):
                foreign_key = next((item for item in foreign_keys if item.get("constrained_columns") == [column]), None)
                ondelete = str((foreign_key or {}).get("options", {}).get("ondelete", "")).upper()
                if foreign_key and ondelete != "SET NULL" and foreign_key.get("name"):
                    constraint_name = str(foreign_key["name"]).replace('"', '""')
                    _run_postgres_ddl_without_timeout(
                        connection,
                        f'ALTER TABLE hydraulic_simulation_snapshot DROP CONSTRAINT "{constraint_name}", '
                        f'ADD CONSTRAINT "{constraint_name}" FOREIGN KEY ({column}) REFERENCES {target}(id) ON DELETE SET NULL',
                        required=False,
                    )

        connection.exec_driver_sql(
            "UPDATE hydraulic_simulation_snapshot SET snapshot_version = 1 WHERE snapshot_version IS NULL"
        )
        if engine.dialect.name.startswith("postgresql"):
            connection.exec_driver_sql(
                """
                UPDATE hydraulic_simulation_snapshot snapshot
                SET utility_name = COALESCE(snapshot.utility_name, utility.name),
                    dma_name = COALESCE(snapshot.dma_name, dma.name),
                    completed_at = COALESCE(snapshot.completed_at, snapshot.created_at),
                    report_reference = COALESCE(snapshot.report_reference, 'HYD-' || UPPER(LEFT(REPLACE(snapshot.id, '-', ''), 12)))
                FROM utility, dma
                WHERE snapshot.utility_id = utility.id AND snapshot.dma_id = dma.id
                """
            )
        else:
            connection.exec_driver_sql(
                """
                UPDATE hydraulic_simulation_snapshot
                SET utility_name = COALESCE(utility_name, (SELECT name FROM utility WHERE id = utility_id)),
                    dma_name = COALESCE(dma_name, (SELECT name FROM dma WHERE id = dma_id)),
                    completed_at = COALESCE(completed_at, created_at),
                    report_reference = COALESCE(report_reference, 'HYD-' || UPPER(SUBSTR(REPLACE(id, '-', ''), 1, 12)))
                """
            )

        indexes = [
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_hydraulic_snapshot_reference ON hydraulic_simulation_snapshot (report_reference)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_hydraulic_snapshot_run ON hydraulic_simulation_snapshot (launch_session_id, hydraulic_scenario_id)",
            "CREATE INDEX IF NOT EXISTS ix_hydraulic_snapshot_status ON hydraulic_simulation_snapshot (scenario_status)",
            "CREATE INDEX IF NOT EXISTS ix_hydraulic_snapshot_completed_at ON hydraulic_simulation_snapshot (completed_at)",
        ]
        for statement in indexes:
            if engine.dialect.name.startswith("postgresql"):
                _run_postgres_ddl_without_timeout(connection, statement, required=False)
            else:
                connection.exec_driver_sql(statement)


def _migrate_sqlite_nullable_report_assignment(engine: Engine) -> None:
    with engine.begin() as connection:
        row = connection.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='report'"
        ).fetchone()
        create_sql = row[0] if row else ""
        if "utility_id VARCHAR(36) NOT NULL" not in create_sql and "dma_id VARCHAR(36) NOT NULL" not in create_sql:
            return

        statements = [
            "PRAGMA foreign_keys=OFF",
            """
            CREATE TABLE IF NOT EXISTS report_new (
                id VARCHAR(36) PRIMARY KEY,
                tracking_id VARCHAR(50) NOT NULL UNIQUE,
                description TEXT NOT NULL,
                latitude FLOAT NOT NULL,
                longitude FLOAT NOT NULL,
                address VARCHAR(255),
                region_name VARCHAR(100),
                district_name VARCHAR(100),
                photos JSON,
                priority VARCHAR(8),
                report_type VARCHAR(32) NOT NULL DEFAULT 'leakage',
                leakage_type VARCHAR(50) DEFAULT 'unknown',
                status VARCHAR(16),
                utility_id VARCHAR(36),
                dma_id VARCHAR(36),
                team_id VARCHAR(36),
                assigned_engineer_id VARCHAR(36),
                reporter_name VARCHAR(255) NOT NULL,
                reporter_phone VARCHAR(20) NOT NULL,
                notes TEXT,
                engineer_submission_notes TEXT,
                team_leader_review_notes TEXT,
                dma_review_notes TEXT,
                public_history_key VARCHAR(64),
                sla_deadline DATETIME NOT NULL,
                resolved_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                FOREIGN KEY(utility_id) REFERENCES utility(id),
                FOREIGN KEY(dma_id) REFERENCES dma(id) ON DELETE CASCADE,
                FOREIGN KEY(team_id) REFERENCES team(id),
                FOREIGN KEY(assigned_engineer_id) REFERENCES engineer(id)
            )
            """,
            """
            INSERT INTO report_new (
                id, tracking_id, description, latitude, longitude, address, region_name, district_name, photos, priority, report_type, leakage_type, status,
                utility_id, dma_id, team_id, assigned_engineer_id, reporter_name, reporter_phone,
                notes, engineer_submission_notes, team_leader_review_notes, dma_review_notes, public_history_key,
                sla_deadline, resolved_at, created_at, updated_at
            )
            SELECT
                id, tracking_id, description, latitude, longitude, address, region_name, district_name, photos, priority, report_type, leakage_type, status,
                utility_id, dma_id, team_id, assigned_engineer_id, reporter_name, reporter_phone,
                notes,
                engineer_submission_notes,
                team_leader_review_notes,
                dma_review_notes,
                public_history_key,
                sla_deadline, resolved_at, created_at, updated_at
            FROM report
            """,
            "DROP TABLE IF EXISTS report",
            "ALTER TABLE report_new RENAME TO report",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_report_tracking_id ON report (tracking_id)",
            "CREATE INDEX IF NOT EXISTS ix_report_status ON report (status)",
            "CREATE INDEX IF NOT EXISTS ix_report_type ON report (report_type)",
            "CREATE INDEX IF NOT EXISTS ix_report_leakage_type ON report (leakage_type)",
            "CREATE INDEX IF NOT EXISTS ix_report_utility_id ON report (utility_id)",
            "CREATE INDEX IF NOT EXISTS ix_report_dma_id ON report (dma_id)",
            "CREATE INDEX IF NOT EXISTS ix_report_created_at ON report (created_at)",
            "CREATE INDEX IF NOT EXISTS ix_report_public_history_key ON report (public_history_key)",
            "CREATE INDEX IF NOT EXISTS ix_report_region_name ON report (region_name)",
            "CREATE INDEX IF NOT EXISTS ix_report_district_name ON report (district_name)",
            "PRAGMA foreign_keys=ON",
        ]
        for statement in statements:
            connection.exec_driver_sql(statement)

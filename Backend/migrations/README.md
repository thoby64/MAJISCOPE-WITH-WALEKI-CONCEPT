# Database Migration Procedure

The main and sensor databases have independent Alembic configurations and version tables. Run commands from `Backend/` with `DATABASE_URL` and `SENSOR_DATABASE_URL` set for the intended environment. Never run a production migration from every API replica; use one controlled deployment job.

## Fresh databases

For a new database pair, create the current schemas and record their baselines:

```sh
make db-init
make db-main-stamp
make db-sensor-stamp
```

`db-init` creates tables from current SQLAlchemy metadata. Each stamp target first runs the read-only schema verifier and refuses to stamp if the live database differs from its models.

## Existing databases

Take and verify restorable backups of both databases. Point the environment URLs at the intended databases, then compare each live schema:

```sh
make db-main-check
make db-sensor-check
```

The verifier compares reflected tables, columns, types, defaults, indexes, and constraints to current SQLAlchemy metadata. A clean result verifies structure only; it does not prove row-level correctness or backup integrity. Resolve all reported differences first.

After a clean check, stamp each existing schema exactly once:

```sh
make db-main-stamp
make db-sensor-stamp
```

The baseline revisions intentionally contain no DDL. Stamping records that a manually verified schema is the starting point; it does not create, alter, or repair tables. If either existing database differs, do not stamp it. Bring it to the current schema with a separately reviewed migration first.

## Schema changes

1. Change the model and add focused tests.
2. On a disposable database already at the current revision, create a candidate revision:

   ```sh
   make db-revision-main message="describe main change"
   make db-revision-sensor message="describe sensor change"
   ```

3. Inspect/edit the generated revision. Autogeneration is only a proposal. Review data backfills, nullability, enum changes, indexes/locks, large-table behavior, and downgrade behavior.
4. Test upgrade and application behavior on a staging copy. Confirm both schemas:

   ```sh
   make db-main-check
   make db-sensor-check
   ```

5. Run the required upgrade once from the release/deployment job:

   ```sh
   make db-main-upgrade
   make db-sensor-upgrade
   ```

Run both when a release changes both stores. Keep API replicas on a version compatible with the schema until rollout completes. `make migrate` upgrades both histories in sequence and is intended only for one controlled job.

## Data transfer and recovery

- The SQLite-to-PostgreSQL utility and sensor transfer tool default to read-only preflight. Review their inventories and resolve every warning before passing `--apply`.
- Current main schema must already exist on the PostgreSQL target. The main importer requires matching current tables/columns. `--replace` is destructive and requires `--apply`.
- Sensor transfer requires the current sensor target schema and an empty target. It copies mapped rows in one transaction and leaves the source untouched.
- Quiesce writes to the source for the apply/cutover window. Sensor transfer reads one repeatable-read snapshot, but writes committed after that snapshot are not included. Keep ingest and tank mutations paused until the new database is authoritative, or implement a separately tested change-capture/delta phase.
- Apply locks target tables and fails after a short lock wait if another transaction blocks the migration. Keep application writers off the target until verification finishes.
- Neither tool can infer arbitrary legacy columns. Add and test a specific mapping when preflight reports an unsupported schema; do not remove the guard or silently discard a column.
- Back up both databases and practice restore before production. Keep source rows untouched until counts, binary byte totals, enum/JSON validation, API behavior, and business acceptance are confirmed. Both transfers verify their row totals before committing their target transaction; main transfer also verifies aggregate binary payload bytes.
- Prefer additive revisions followed by later cleanup releases. A downgrade does not recover deleted data. Use isolated URLs for staging and ensure no migration job can accidentally inherit production URLs.

Example commands (the first invocation of each tool is read-only):

```sh
python migrate_sqlite_to_postgres.py --source ./majiscope.db --target "$DATABASE_URL"
python migrate_sqlite_to_postgres.py --source ./majiscope.db --target "$DATABASE_URL" --apply

python scripts/migrate_sensor_data.py --source-url "$DATABASE_URL" --target-url "$SENSOR_DATABASE_URL"
python scripts/migrate_sensor_data.py --source-url "$DATABASE_URL" --target-url "$SENSOR_DATABASE_URL" --apply
```

For a non-empty main PostgreSQL target, `--replace` is additionally required and clears target rows transactionally. Sensor transfer intentionally has no replace mode: choose a new empty target and preserve the old one for rollback. Do not run both transfer tools against the same source/target pair unless each tool's source tables are actually present and independently reviewed.
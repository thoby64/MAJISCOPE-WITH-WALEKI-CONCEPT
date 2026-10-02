# Majiscope Backend Database Reference

## Purpose and confidence

This document describes the database design implemented by the backend code in this repository, the checked-in local SQLite snapshot, and the implications for a production deployment that may grow substantially. The current SQLAlchemy models and database services are the source for the intended live design. The local `majiscope.db` is an older, small SQLite example and is not a complete or reliable representation of a current production schema.

The code establishes table ownership and column-level behavior, but it does **not** establish production row counts, image sizes, sensor reporting intervals, availability targets, retention policy, or provider-specific storage limits. Capacity examples below are therefore planning calculations, not a quote or a guarantee. Measure representative production data and load before committing to a service size.

## Executive summary

- The backend uses SQLAlchemy with PostgreSQL as the intended production relational database. SQLite is supported for local development and tests.
- There are two separately configured database engines: the **main application database** (`DATABASE_URL`) and the **sensor platform database** (`SENSOR_DATABASE_URL`). They may be separate databases on one PostgreSQL cluster initially, but they are not one transactional database. They may later be placed on separate clusters to isolate sensor write load.
- Main-database data is mostly operational and transactional: accounts, utility geography and assets, leak reports, audit records, notifications, image uploads, and hydraulic-model state/results.
- Sensor-database data includes sensor inventory, tank references, high-volume water-level and water-quality readings, and a temporary buffer for unregistered devices. Sensor readings are append-heavy and are likely to dominate future growth if devices report frequently.
- Uploaded images and GeoPackage infrastructure files are currently stored as binary values in PostgreSQL (`LargeBinary`, PostgreSQL `BYTEA`). Hydraulic simulation geometry/results may also be large JSON values. These are material storage and backup considerations.
- The repository now contains independent Alembic histories for the main and sensor databases. Each begins with a no-DDL baseline that must only be stamped after the read-only schema verifier succeeds. `create_all` creates missing tables but does not upgrade existing tables. Production startup disables schema DDL; schema changes require reviewed migrations.
- Do not use the current SQLite file size as a sizing estimate. It is 2.4 MiB, has only a handful of seed rows, and contains none of the newer sensor/tank/hydraulic structures in the current models.

## Database topology and configuration

### Main application database

Configured by `DATABASE_URL`; the default in `app/config.py` is PostgreSQL (`postgresql+psycopg://.../majiscope`). The main SQLAlchemy metadata is `app.models.base.Base`. This database owns accounts, utilities, DMAs, teams, engineers, reports, uploads, GIS assets, and other operational records. It is also the source of truth for tank identity and lifecycle.

### Sensor platform database

Configured by `SENSOR_DATABASE_URL`; its default is PostgreSQL (`postgresql+psycopg://.../sensor_platform`). It has its own SQLAlchemy engine, session factory, and independent `SensorBase` metadata. Its tables are deliberately excluded from the main `Base.metadata` so that initializing one store cannot accidentally create the other's tables.

The sensor database owns a **mirror** of main-database tanks (`tank`) for scoped sensor reads, one unified sensor registry (`sensor_device`), two typed reading tables, and the unregistered-device buffer. The main database owns actual tank creation and updates. Tank mirror writes are attempted after a main-database commit; failures are queued in `sensor_mirror_outbox` in the main database and later retried/reconciled. The mirror is eventually consistent, not a cross-database transaction.

No cross-database joins or atomic transactions are available in the current code. The API opens separate sessions and coordinates the databases in application code. A successful write to one store does not prove a corresponding write to the other store succeeded.

### URL and runtime behavior

- Both URL handlers normalize common `postgres://` and `postgresql://` provider URLs to the psycopg v3 SQLAlchemy driver. SQLite connections set `check_same_thread=False`.
- Both engines use `pool_pre_ping=True` and recycle connections after 300 seconds. Pool size and overflow are otherwise left at SQLAlchemy defaults; each application worker creates its own pools for both databases. Budget database connections across all workers, background tasks, migration jobs, and any connection pooler.
- Production settings ignore `.env` and must come from the deployment environment. **Set both `DATABASE_URL` and `SENSOR_DATABASE_URL` explicitly.** Both `.env.example` and `.env.render.example` now provide a value for each store.
- Production mode forces `RUN_STARTUP_MIGRATIONS` and `RUN_STARTUP_SCHEMA_SYNC` off in settings. The application does not run hand-written schema migrations or `create_all` for either database in production. Tank outbox draining/reconciliation remains runtime behavior and assumes the schema has already been migrated.

## Main application database schema

IDs are generally UUID strings (`VARCHAR(36)`), not native PostgreSQL UUID columns. Most timestamps are SQLAlchemy `DateTime` values populated as naive UTC by `datetime.utcnow`; API serialization adds a UTC `Z` suffix. Treat stored naive timestamps as UTC and normalize timestamps consistently in imports and external queries.

The following describes the current ORM models. Foreign-key behavior below is included where explicitly defined. ORM relationships are not necessarily database constraints, and no PostGIS geometry type is used.

### Identity and organization

#### `user`

Administrative/default user accounts.

- `id`: UUID string primary key.
- `email`: required, unique, indexed login address; `password`: required password hash (bcrypt is configured by the security settings; never store plaintext).
- `name`: required; `phone`, `avatar`: optional contact/profile fields; `status`: active/inactive enum.
- Invitation lifecycle: `invite_token_hash`, `invite_sent_at`, `invite_expires_at`, `setup_completed_at`.
- Password reset lifecycle: `password_reset_token_hash`, `password_reset_sent_at`, `password_reset_expires_at`.
- `created_at`, `updated_at`: required audit timestamps.
- Related activity logs and notifications are represented through foreign keys in their own tables.

#### `utility`

Water utility tenant and root of the live organizational hierarchy.

- `id`: UUID string primary key; `name`: required unique name and index; optional unique `slug`; optional indexed `region_name`.
- `description`, `contact_phone`, `contact_email`, `contact_address`: optional descriptive/contact data.
- `center_latitude`, `center_longitude`: optional center point as floating-point coordinates.
- `boundary_geojson`: optional GeoJSON text; `boundary_source_type`, `boundary_status`: optional boundary metadata.
- `status`: active/inactive; `created_at`, `updated_at`.
- One optional utility manager; child DMAs; reports; audit records; infrastructure layers; and named service areas.

#### `utility_service_area`

Named administrative or service areas associated with a utility.

- `id`: UUID string primary key; `utility_id`: required indexed FK to `utility`, delete cascades.
- `category`: required indexed enum (`region`, `district`, `city`, `town`, `ward`, `village`, `custom_area`, `infrastructure_corridor`).
- `name`: required indexed name; optional indexed `region_name` and `admin_area_id`.
- `created_at`, `updated_at`.
- Unique key on `(utility_id, category, name, region_name)`. Database null-uniqueness semantics should be considered if exact duplicate names with a null region must be prohibited across all rows.

#### `utility_manager`

Utility-level account.

- `id`: UUID string primary key; `email`: required unique/indexed; `password`: required hash; `name`: required; optional `phone`, `avatar`; `status`: active/inactive.
- `utility_id`: optional unique/indexed FK to `utility`, `ON DELETE SET NULL`, so at most one manager is assigned to a utility.
- Invitation, password-reset, setup-completion, `created_at`, and `updated_at` fields follow the account lifecycle described for `user`.
- Related notifications, audit records, and uploaded infrastructure layers.

#### `utility_infrastructure_layer`

One uploaded GIS/infrastructure asset per utility and asset type.

- `id`: UUID string primary key; `utility_id`: required indexed FK to `utility`, `ON DELETE CASCADE`.
- `asset_type`: required indexed type/name; `uploaded_by_manager_id`: optional indexed FK to `utility_manager`, `ON DELETE SET NULL`.
- `file_data`: required binary GeoPackage or other asset content; `file_name`, `mime_type`, `file_size`, `feature_count`: required file metadata.
- `tank_key_field`: optional source field used to identify tanks; `created_at`, `updated_at`.
- Unique key `(utility_id, asset_type)` means replacement/update is the natural lifecycle for a given asset slot rather than unlimited version rows. The database model stores the binary file inline, not in object storage.

#### `dma`

District Meter Area within a utility.

- `id`: UUID string primary key; `name`: required; optional unique `slug`; optional `description`.
- `utility_id`: required indexed FK to `utility`, `ON DELETE CASCADE`.
- `center_latitude`, `center_longitude`: optional float coordinates; `boundary_geojson`: optional GeoJSON text; `status`: active/inactive.
- `created_at`, `updated_at`.
- Unique `(name, utility_id)` and `(utility_id, slug)`; manager, team, engineer, report, and audit relationships.

#### `dma_manager`

DMA-level account.

- `id`: UUID string primary key; unique/indexed `email`; required password hash and name; optional phone/avatar; active/inactive status.
- Required indexed `utility_id` FK to `utility`, `ON DELETE CASCADE`; optional unique/indexed `dma_id` FK to `dma`.
- Invitation, password-reset, setup-completion, and created/updated timestamps.
- Related notifications and activity records. The schema has separate utility and DMA references; application validation must keep these references consistent.

#### `team`

Operational team within a DMA.

- `id`: UUID string primary key; required `name`; optional unique `slug` and `description`.
- Required indexed `dma_id` FK to `dma`, `ON DELETE CASCADE`.
- Optional unique `leader_id` FK to `engineer`; `status`; `created_at`, `updated_at`.
- Unique `(name, dma_id)`; engineers and reports may reference the team.
- `team.leader_id` and `engineer.team_id` form a circular relationship. The SQLite-to-PostgreSQL migration script explicitly clears/restores team leaders to get around insert ordering.

#### `engineer`

Field technician/team-member account.

- `id`: UUID string primary key; required `name`, unique/indexed `email`, password hash; optional phone.
- Required indexed `dma_id` FK to `dma`, `ON DELETE CASCADE`; optional indexed `team_id` FK to `team`; active/inactive `status`; `role` string (normally `engineer` or `team_leader`).
- Invitation, password-reset, setup-completion, and created/updated timestamps.
- May be referenced by assigned reports, team leadership, notifications, and activity records.

#### `tank` (main database)

Canonical storage-facility/tank record, materialized from a utility infrastructure asset and owned by the main database.

- `id`: UUID string primary key; required indexed `utility_id` FK to `utility`, `ON DELETE CASCADE`.
- Optional indexed `dma_id` FK to `dma`, `ON DELETE SET NULL`.
- Required indexed `source_key` identifies the originating GIS feature; optional `name`, `latitude`, `longitude`.
- `status`: active/deactivated; `created_at`, `updated_at`, optional `deactivated_at`.
- Unique `(utility_id, source_key)` prevents duplicate source features within one utility.
- A projection is copied to the sensor database's `tank` table. This main table does not hold sensor readings.

### Reports, files, events, and notifications

#### `report`

Public/field-submitted operational issue. This is a business workflow record, not a sensor sample.

- `id`: UUID string primary key; `tracking_id`: required unique/indexed public tracking identifier.
- Required `description`, `latitude`, `longitude`, `reporter_name`, `reporter_phone`, `sla_deadline`; optional `address`, indexed `region_name`, indexed `district_name`.
- `photos`: JSON value with image URLs/references; binary content is represented separately in `image_upload`.
- `priority`: low/medium/high/critical enum; `report_type`: leakage/non-leakage; `leakage_type`: leakage classification; `status`: new/assigned/in-progress/pending-approval/approved/rejected/closed.
- A database check constraint requires a leakage type for leakage reports and requires it to be null for non-leakage reports.
- Optional `utility_id`, indexed, FK to `utility`; optional indexed `dma_id` FK to `dma`, `ON DELETE CASCADE`; optional `team_id` FK to `team`; optional `assigned_engineer_id` FK to `engineer`.
- Optional workflow notes: `notes`, `engineer_submission_notes`, `team_leader_review_notes`, `dma_review_notes`; optional indexed `public_history_key`.
- `resolved_at`, indexed `created_at`, and `updated_at`.
- `image_upload.report_id` references this row with `ON DELETE CASCADE`; the ORM also cascades/deletes child images when deleting a report.

#### `image_upload`

Image bytes and metadata for reports, submissions, or profiles.

- `id`: UUID string primary key (also indexed); `file_data`: required binary value; `file_name`, `file_type`, `file_size`: required metadata.
- `image_type`: report/submission-before/submission-after/profile enum; `mime_type`: required, default `image/jpeg`; optional `width`, `height`.
- Optional indexed `report_id` FK to `report`, `ON DELETE CASCADE`; optional indexed `user_id` and `engineer_id` FKs with `ON DELETE SET NULL`.
- Indexed `created_at`.
- Images currently consume PostgreSQL table/TOAST, WAL, and backup capacity. `file_size` can be used for logical payload totals, but is not the same as actual on-disk/index/WAL/backup size.

#### `activity_log`

Audit/event history. This table can grow continuously and contains potentially sensitive request metadata.

- `id`: UUID string primary key; required `action`, `user_name`, `user_role`, `entity`, and `entity_id`.
- Optional actor references: indexed `user_id`, `utility_mgr_id`, `dma_mgr_id`, `engineer_id`; these FKs use `ON DELETE SET NULL`. The actor name/role are retained as a snapshot.
- Optional `details`, indexed `event_type`, indexed `status`, `target_name`, `ip_address`, `user_agent`, `request_method`, `request_path`.
- Optional JSON snapshots `before_data`, `after_data`, and `metadata_json`; optional `error_message`.
- Optional indexed `utility_id` and `dma_id` FKs use `ON DELETE SET NULL`.
- Indexed `timestamp` is the event time. There is intentionally no uniqueness constraint on `(entity, entity_id)`, allowing multiple events for one entity.
- Current ORM declares generic JSON columns. A legacy PostgreSQL migration path may have created some of these as JSONB; inspect the deployed schema before assuming an exact physical JSON type.

#### `notification`

User-facing message and read state.

- `id`: UUID string primary key; required `title`, `message`; `type`: info/warning/success/error enum.
- Indexed boolean `read`, optional `link`, optional JSON `data`; indexed `created_at`, `updated_at`.
- Optional owner references `user_id`, `utility_mgr_id`, `dma_mgr_id`, `engineer_id`, each indexed and configured to cascade on owner deletion.
- Ownership is modeled with four nullable columns. There is no database check constraint requiring exactly one owner, so that invariant is enforced by application logic (if enforced at all).

#### `push_device_token`

Mobile Expo push registrations.

- `id`: UUID string primary key; `expo_push_token`: required unique/indexed token; optional `platform`, `device_name`, `device_id`, `app_role`; indexed `active`.
- `last_registered_at`, `created_at`, `updated_at`.
- Optional indexed owner references to the four account types, each cascading on owner deletion.
- Unique `(owner_id, device_id)` constraints exist separately for each owner type, and Expo token itself is globally unique. As with notification, exactly one owner is not enforced by a check constraint.

### Hydraulic model records

#### `hydraulic_model_launch_session`

Temporary workflow/session state for launching an external hydraulic model.

- `id`: UUID string primary key; optional indexed account references (`user_id`, `utility_mgr_id`, `dma_mgr_id`, `engineer_id`) use `ON DELETE SET NULL`.
- Required `user_name`, indexed `user_role`; required indexed `utility_id` and `dma_id` FKs, both cascading on parent deletion.
- Optional `hydraulic_filename`, `hydraulic_file_ref`; optional unique/indexed `launch_token_hash`.
- Required indexed `status` (preparing/ready/prepared/launched/completed/cleaned/failed); optional JSON `readiness_json`, `missing_required_json`, `optional_status_json`; optional `error_message`.
- Required indexed `expires_at`; optional `launched_at`, `completed_at`, `cleaned_at`; indexed `created_at` and `updated_at`.
- Expired rows need an explicit cleanup/retention process to prevent session state from accumulating. The model's `expires_at` alone does not delete rows.

#### `hydraulic_simulation_snapshot`

Persisted result/snapshot from completed hydraulic simulation runs.

- `id`: UUID string primary key; optional indexed `launch_session_id` FK to the launch session (`ON DELETE SET NULL`); optional unique/indexed `report_reference`.
- Optional indexed `utility_id` and `dma_id` FKs (`ON DELETE SET NULL`), plus `utility_name`, `dma_name` snapshots.
- Optional indexed `hydraulic_scenario_id`, `scenario_name`, indexed `scenario_status`.
- Potentially large JSON fields: `input_parameters_json`, `summary_json`, `nrw_json`, `leakage_json`, `alerts_json`, `nodes_geojson`, `pipes_geojson`, `hotspots_geojson`.
- Creator snapshot fields: `created_by_user_id` (not declared as a foreign key), `created_by_role`, `created_by_name`, `created_by_email`.
- Optional indexed `completed_at`, `execution_duration_seconds`, `result_quality`, `error_message`; `snapshot_version` defaults to 1; indexed `created_at`.
- Unique `(launch_session_id, hydraulic_scenario_id)`. Large JSON geometry snapshots can dominate main-database size and should be measured separately.

## Sensor platform database schema

The sensor metadata is separate from the main `Base`. The following current models are owned by `SensorBase`. The sensor data path commits each accepted reading as an individual database transaction. At-least-once device delivery is made idempotent by a unique sensor/timestamp key, not by a broker or bulk-ingest layer.

### `tank` (sensor database)

Mirrored reference/projection of the main database's canonical `tank` row. It is a separate table with the same SQL table name, in a different database.

- `id`: primary key copied from main database; `utility_id`: required indexed string; `dma_id`: optional indexed string.
- `source_key`: required; optional `name`, `latitude`, `longitude`; `status`: active/deactivated; `created_at`, `updated_at`, optional `deactivated_at`.
- `sensor_count`, `active_sensor_count`: denormalized counts refreshed when sensor registry changes or during reconciliation.
- Unique `(utility_id, source_key)`.
- These are not declared as foreign keys to main-database rows; cross-database foreign keys are unavailable. Counts and scope fields can lag until mirroring/reconciliation succeeds.

### `sensor_device`

Unified registry for all categories of devices.

- `id`: UUID string primary key; `device_id`: required unique/indexed external ID.
- `category`: required indexed enum (`water_level`, `water_quality`); `tank_id`: required indexed tank reference; `activated`: required boolean.
- `config`: optional category-specific JSON configuration. Water-level configuration includes `h1_m`, `depth_m`, `warning_height_m`, and `critical_height_m`; water-quality configuration holds parameter threshold bounds.
- `created_at`, `updated_at`.
- Partial unique index `(tank_id, category)` where activated is true: one active sensor of each category per tank, while allowing inactive historical devices. The model defines a PostgreSQL predicate and a SQLite predicate.
- `tank_id` is not a database FK. API code checks tank ownership/scope using the mirrored reference and main database.

### `water_level_reading`

Append-oriented typed time-series row for each accepted water-level message.

- `id`: UUID string primary key; `sensor_id`, `tank_id`, `utility_id`: required indexed identifiers; optional indexed `dma_id`.
- `h1_m`, `water_height_m`: required floats; `depth_m`: required float, defaults to 0; `status`: required indexed sensor-status enum (inactive/critical/warning/active).
- Optional `raw_data` text; required indexed event time `occurred_at`; ingestion/storage time `created_at`.
- Unique `(sensor_id, occurred_at)` makes duplicate delivery for the same sensor and timestamp idempotent at the schema level.
- IDs are copied/denormalized; no foreign keys to registry/tank/utility tables are declared.

### `water_quality_reading`

Append-oriented typed time-series row for each accepted water-quality message. Separate table avoids a generic parameter/value EAV table and avoids storing unused values as non-null zeros.

- `id`: UUID string primary key; `sensor_id`, `tank_id`, `utility_id`: required indexed identifiers; optional indexed `dma_id`.
- Required indexed `status`; optional `raw_data` text.
- Nullable measured floats: `temperature_c`, `ph`, `ec_uscm`, `do_mgl`, `do_pct_sat`, `turbidity_ntu`, `orp_mv`, `free_chlorine_mgl`, `nitrate_mgl`, `ammonia_mgl`, `phosphate_mgl`, `chlorophyll_ugl`, `phycocyanin_ugl`, and `pressure`.
- Required indexed `occurred_at`; `created_at` records storage time.
- Unique `(sensor_id, occurred_at)` provides idempotency. There are no database foreign keys to registry or mirrored tank rows.
- Parameter units/ranges are described and validated in service/schema code, not all represented by SQL check constraints.

### `sensor_pending_reading`

Temporary category-agnostic buffer for recognized payloads from devices not yet registered.

- `id`: UUID string primary key; `device_id`: required indexed external device ID.
- `payload`: required text containing serialized raw JSON; `occurred_at`: required indexed event time; `dedup_key`: required globally unique device/timestamp key; `created_at`.
- Pending rows are promoted to the selected typed reading table when a device is registered, after which the API deletes the pending rows. There is no age/size cap or automatic expiry in the model; unregistered devices can therefore create unbounded buffer growth.

## Main-database mirror outbox

`sensor_mirror_outbox` is a mapped table in the **main database** with a runtime `CREATE TABLE IF NOT EXISTS` compatibility helper. It contains `id` (UUID string primary key), `created_at`, `op`, optional `tank_id`, and optional JSON-serialized `payload` text. Its purpose is to persist a tank mirror operation when the sensor database is unavailable. A drain job processes a bounded batch (default 200); startup also reconciles all tanks.

The current definition has no ORM-managed indexes, retry count, failure/dead-letter state, or explicit retention policy. Monitor backlog age/depth, alert on persistent failures, and decide whether a periodic worker is needed; startup-only retries may not be sufficient for a continuously running service after a sensor-database outage.

## Geographic and binary data behavior

- Utility/DMA boundaries are stored as text GeoJSON and parsed/processed by application code. Coordinates on common records are floating-point latitude/longitude. This design does not currently use PostGIS geometry, spatial indexes, or database-native geographic validation.
- Infrastructure GeoPackages are SQLite-format files stored as full binary `file_data` values in the main database. The file itself may contain complex spatial layers, geometries, and attributes.
- Report/profile images are binary values in `image_upload`; report `photos` JSON is URL/reference metadata, not necessarily the image bytes.
- Hydraulic snapshots store simulation outputs and potentially complete GeoJSON node/pipe/hotspot collections in JSON columns.
- Consequently, a relational-row count alone is insufficient for sizing. File payloads, JSON TOAST storage, indexes, PostgreSQL WAL, replicas, and backups all contribute to capacity and I/O.

## Schema lifecycle, migration, and data transfer

### What the code does

- When enabled outside production, startup can run hand-written safe/heavy migrations and calls main `Base.metadata.create_all` for non-PostgreSQL schema sync. SQLite branch-removal migration makes a timestamped file copy before table rewrites.
- Production setting validation disables startup migration and schema-sync flags. The application does not run hand-written schema migrations or `create_all` for either database in production. Tank outbox draining/reconciliation remains runtime behavior and assumes the schema migrations have already been applied.
- `create_all` creates missing tables only. It does not add new columns, change constraints, rebuild indexes, convert data, or safely replace a deployed schema.
- Alembic is configured independently through `alembic.ini` and `alembic.sensor.ini`; each has a baseline revision and its own version table. Baselines contain no DDL. Fresh databases are initialized from model metadata, then verified and stamped. Existing databases must pass the corresponding schema check before baseline stamping. Follow `migrations/README.md` for the workflow.
- Hand-written startup logic includes legacy cleanup (for example, old sensor tables in the main database and the legacy utility pipe-network table) and schema transformations. Review the exact operation and current backups before enabling a migration on production data.

### Migration caveats to resolve before production growth

- `migrate_sqlite_to_postgres.py` has a current main-table manifest (including service areas, infrastructure assets, tanks, hydraulic records, and the outbox), read-only preflight, batched transfer, enum/JSON validation, a single SQLite read transaction, target table locks, and transactional row/binary-byte verification. It requires the target schema to be migrated separately and rejects unmapped legacy tables or column mismatches; it does not transfer sensor data.
- `scripts/migrate_sensor_data.py` maps legacy/current sensor layouts, including water-level, water-quality, and pending data. It defaults to read-only preflight and requires an empty target for transactional apply. It validates mapped required fields, reads one source snapshot, locks the target, and verifies expected insert and target row counts before commit. It leaves source tables untouched. Ambiguous historical layouts fail rather than being guessed.
- Model changes do not update production databases implicitly. Generate, review, test, and apply Alembic revisions independently for main and sensor stores. `create_all` remains a fresh/local bootstrap, not an upgrade mechanism.
- Before a data move, take restorable backups of both stores and pause source writes/ingest for the apply/cutover window. A consistent source snapshot excludes later writes; use a separately tested change-capture/delta phase if writes cannot be paused. Run read-only preflight, resolve every schema/value error, migrate in FK-safe order, preserve timestamps and IDs, compare row counts and binary byte totals, validate enum/JSON values, and run application/API checks on the target. Keep the source untouched until acceptance and rollback criteria are met.
- Production schema changes use reviewed Alembic revisions from one controlled deployment job. Existing schemas must pass the read-only model comparison before one-time baseline stamping; stamping does not apply or repair schema. Do not run DDL from each API replica. Practice upgrades and restores on a staging copy.

## Current local database snapshot (observed)

The checked-in `Backend/majiscope.db` was inspected using aggregate-only queries:

- Physical file: approximately **2.4 MiB**; SQLite page count 586 at 4096 bytes/page; no free pages reported.
- Tables present: `user`, `utility`, `utility_manager`, `dma`, `dma_manager`, `team`, `engineer`, `report`, `image_upload`, `activity_log`, `notification`, `push_device_token`, and legacy `utility_pipe_network`.
- The snapshot has one row in each of `user`, `utility`, `utility_manager`, `dma`, `dma_manager`, `team`, and `engineer`; zero rows in `report`, `image_upload`, `activity_log`, `notification`, and `push_device_token`.
- No `.sqlite` or second `.db` sensor data file was found under the backend. The snapshot has no current `tank`, `sensor_device`, typed sensor reading, utility service area, infrastructure-layer, hydraulic-session, hydraulic-snapshot, or outbox data.
- The zero image byte total is only for this snapshot. It says nothing about expected production uploads.

This snapshot is evidence about one local development database only. Do not extrapolate its 2.4 MiB to hosted storage, and do not assume its legacy table list is the current schema.

## Large-scale hosting recommendations

### Recommended target architecture

1. **Use managed PostgreSQL**, not a SQLite file on an application container's local/ephemeral disk. Start with the main and sensor data in separate PostgreSQL databases (separate credentials and explicit URLs) on a managed cluster only if the provider's resource limits and workload isolation are adequate. Separate clusters provide stronger isolation and independent scaling, maintenance, failover, and backup policies when sensor throughput rises.
2. **Keep transactional system-of-record data in PostgreSQL.** The main store is well suited to accounts, organization, reports, workflows, metadata, and moderate audit volume.
3. **Move uploaded images and GeoPackage binaries to object storage** (S3-compatible or cloud-native blob storage) as the system grows. Keep metadata, ownership, checksums, object keys, MIME type, byte size, and retention/lifecycle state in PostgreSQL. This requires a code/data migration; the current API writes bytes into PostgreSQL, so object storage is not a drop-in configuration change. Use private buckets, short-lived signed access URLs, encryption, and malware/content validation appropriate to the product.
4. **Isolate telemetry capacity.** Keep current typed tables in PostgreSQL initially if measured load is modest. At high sustained ingestion rates, evaluate a PostgreSQL time-series extension such as TimescaleDB only if the chosen managed provider supports the required extension, backups, and operational features; otherwise use native declarative partitioning or a separately selected time-series store with an explicit data ownership/query plan.
5. **Keep GIS requirements explicit.** Existing GeoJSON/text plus application-side spatial processing may be adequate initially. If spatial containment/nearest-boundary queries become frequent or large, evaluate PostGIS with a planned geometry conversion, SRID validation, GiST indexes, and query migration. PostGIS is not currently required by the models.

### Telemetry volume model

For each sensor category, estimate incoming rows as:

`rows_per_day = active_sensors * readings_per_sensor_per_day`

For a fixed interval in seconds:

`rows_per_day = active_sensors * 86,400 / interval_seconds`

`retained_rows = rows_per_day * retention_days`

Illustrative counts, before pending rows or any replicas:

| Active sensors | Interval | Rows/day | Rows over 90 days |
| ---: | ---: | ---: | ---: |
| 1,000 | 60 seconds | 1.44 million | 129.6 million |
| 10,000 | 60 seconds | 14.4 million | 1.296 billion |
| 10,000 | 5 seconds | 172.8 million | 15.552 billion |

These are arithmetic examples, not a prediction of installed device counts or actual reporting frequency. Calculate water-level and water-quality streams separately, add retries/duplicates (duplicate detection consumes query capacity even when the row is not inserted), pending traffic, and expected sensor growth. Accepted writes generate WAL. Current schema has no retention/rollup policy; every accepted reading is retained unless an external process deletes or archives it.

Estimate live sensor storage from a representative load test, not a guessed universal “bytes per row” value:

`live_bytes = retained_rows * measured_average_table_bytes_per_row`

Measure table, index, and TOAST growth on the target PostgreSQL version with representative null density, `raw_data` payload lengths, indexes, and query patterns. Then add space for WAL/checkpoints, maintenance (vacuum/reindex), temporary query/sort space, growth headroom, replicas, and the provider's storage/IOPS limits. Backups/PITR are separate capacity and cost dimensions; they do not replace primary-disk headroom.

Image and infrastructure storage can be estimated separately:

`image_payload_bytes = uploads_per_day * average_image_bytes * retained_days`

`gis_payload_bytes = sum(current GeoPackage file sizes)`

For database-resident files, add index/row overhead and account for WAL, replicas, and backup copies. Once moved to object storage, budget object versioning, replication, lifecycle rules, request/egress charges, and recovery time instead.

### Sensor partitioning and indexing considerations

- Current readings have individual indexes on `sensor_id`, `tank_id`, `utility_id`, optional `dma_id`, `status`, and `occurred_at`, plus unique `(sensor_id, occurred_at)`. These choices support common filtering but create write amplification and index storage. Validate with real query plans and `EXPLAIN (ANALYZE, BUFFERS)`; remove or replace redundant indexes only after measured evidence.
- Tank history queries filter active sensor IDs, sort newest-first by `occurred_at` and `created_at`, count all matching history, and return up to 200 rows. The separate `COUNT(*)` over an unbounded history can become costly. At scale, consider time-window pagination, cursor-based queries, and reducing/avoiding total counts.
- Time partitioning can bound retention and improve pruning, but PostgreSQL partitioned unique/primary-key constraints must include the partition key. `occurred_at` is included in the sensor/timestamp unique key, but the current `id` primary key is only `id`; moving to time partitions therefore needs a carefully designed primary-key/uniqueness migration (or another supported time-series implementation). Do not turn on partitions without verifying ORM inserts, idempotency, global ID behavior, indexes, retention deletes, and migration/restore procedures.
- Define raw payload policy. `raw_data` and pending JSON can add significant variable-width storage. Decide whether to retain verbatim payloads forever, retain only for a short diagnostic period, compress/archive them, or store a checksum/reference. Keep compliance, replay, and debugging needs in view.
- Set an explicit retention and aggregation policy for each reading category and for pending messages. If long-term graphs only need hourly/daily summaries, preserve those rollups before pruning raw samples. Deletion and rollup jobs must be idempotent and observable.

### Operational sizing and reliability

- Size the main and sensor stores independently from workload measurements: sustained and peak inserts/sec, concurrent dashboard/API queries, p95/p99 latency targets, read/write ratio, data growth, backup window, and recovery objectives.
- Use connection pooling deliberately. SQLAlchemy's default queue pool can allow up to 15 connections per engine per application process (5 base plus 10 overflow). Multiply by workers and both database engines, then budget migration/admin connections and provider limits. Configure bounded pools or a supported pooler such as PgBouncer where appropriate; avoid transaction-pooling incompatibilities with application/session behavior.
- Choose managed storage with automated backups, point-in-time recovery, encryption at rest/in transit, high availability, monitored disk/IOPS, and a tested restore path. Set RPO/RTO targets explicitly. Retain at least one recovery copy in a separate failure domain/account where feasible.
- Monitor per database: allocated/used/free storage and growth rate; row/table/index/TOAST sizes; WAL generation and replication lag; connections/pool wait; CPU, memory, IOPS/latency; slow queries and lock waits; autovacuum; failed backups; restore-test age; mirror-outbox depth/age; pending-buffer age; and sensor ingest/rejection/duplicate rates.
- Establish alerts before disk exhaustion. PostgreSQL cannot reliably write once its volume is full; keep headroom for bursts, maintenance, migrations, WAL, and recovery. Configure a provider-supported autoscaling/maximum policy only after validating cost and hard limits.
- Keep credentials separate and least-privileged; require TLS to hosted databases; rotate secrets; restrict network access; protect PII in account, reporter, IP/user-agent, and audit fields; and define retention/access policies for it.
- Run backups for both databases. A main-database backup alone cannot restore the sensor database, and a sensor backup alone cannot restore tank ownership or utility hierarchy. Because mirror consistency is eventual, document restore order and perform tank reconciliation after restoring both stores.

## Decisions to make before selecting a hosting tier

Collect and record at least these inputs:

- Expected utilities, DMAs, users, teams, tanks, sensors by category, and annual growth.
- Reporting interval per sensor category, offline/retry behavior, peak reconnect/burst volume, payload/raw-data sizes, and acceptable ingest latency.
- Retention duration for raw readings, pending payloads, audit events, launch sessions, hydraulic snapshots, uploaded images, and GIS versions.
- Reports/day, average and maximum photo count/bytes, GeoPackage count/size/change rate, hydraulic run frequency, and typical/maximum snapshot JSON size.
- Interactive read patterns, dashboard time windows, concurrency, expected API workers, and latency/availability objectives.
- Backup/PITR retention, recovery point/time objectives, data residency/compliance requirements, and provider region/failover needs.
- Monthly budget and maximum acceptable growth/egress charges.

With those inputs, run a representative staging load test, measure actual table/index/TOAST/WAL growth, project at least 12-24 months with headroom, and compare provider storage/IOPS/connection limits and backup costs. There is not enough workload evidence in this repository to responsibly name a single disk size or managed database plan without those measurements.

## Implementation facts referenced

Core definitions and wiring are in `app/models/user.py`, `app/models/business.py`, `app/models/uploads.py`, `app/models/sensors.py`, `app/models/sensor_platform/registry.py`, `app/models/sensor_platform/readings.py`, `app/database/session.py`, `app/database/sensor_session.py`, `app/config.py`, `app/main.py`, `app/services/database_migrations.py`, `app/services/sensor_platform_sync.py`, and `app/api/sensors.py`.
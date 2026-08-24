# Water Level Monitoring — Phase 1 Reference (Backend)

Date: 2026-08-17
Status: Approved (backend plan, Phase 1 of 2)

## Goal

Port Waleki's live tank water-level monitoring into MajiScope as a standalone,
role-scoped "Water Level Monitoring" feature. Phase 1 delivers the backend only:
tank materialization, sensor registration, ingestion, live status derivation,
and role-scoped read APIs. Phase 2 (not in this doc) adds the frontend page,
nav item, and polling refresh.

## Domain Model Decisions (settled)

- **Sensors must link to tanks**; not every tank needs a sensor (a utility may
  lack funding/assets). Whole utilities may have zero sensors without error.
- **Tanks are materialized in their own table** from `storage_facilities`
  GPKG/GeoJSON layers on upload. Never hard-delete tanks: missing features ⇒
  soft `deactivated`.
- **Sensor scope is derived server-side** from the sensor→tank link
  (utility/dma/location come from the tank, not from ingest payload).
- **Page name**: "Water Level Monitoring". Frontend phase defers dashboard map
  overlay; uses a dedicated page with polling.
- **Auth for ingest**: authenticated user OR `X-Ingest-Key` header
  (new `SENSOR_INGEST_KEY` environment setting).
- **Tank identity**: auto-detect a name-like GIS property at sync time from
  `{name, tank_name, tank, id, code, asset_id, tank_id}`; fall back to a
  coordinate hash `"{lat:.6f},{lon:.6f}"`. The chosen field name is stored on
  the layer row in `utility_infrastructure_layer.tank_key_field`.
- **dma_id on tanks**: left `NULL` during sync; assigned manually via
  `PATCH /api/tanks/{id}` (containment auto-assign is deferred).

## Phase 1 Deliverables

### 1. Extract scope helpers (behavior-preserving refactor)

Move `_ensure_utility_access` and `_resolve_current_user_utility_id` from
`app/api/utilities.py` into `app/services/hierarchy.py`. Keep original names,
re-import them into `utilities.py` so existing behavior is unchanged. Other
routers adopt them as needed.

### 2. Models (`app/models/sensors.py` + export in `app/models/__init__.py`)

**`tank` table**
- `id` PK
- `utility_id` FK → `utility.id`, not null
- `dma_id` FK → `dma.id`, nullable (manual assignment)
- `source_key` str, not null — layer property value or coordinate hash
- `name` str nullable — human label from layer property / geometry
- `latitude`, `longitude` doubles nullable (feature centroid)
- `status` string enum (`active` / `deactivated`), default `active`
- `created_at`, `updated_at`, `deactivated_at` nullable
- `UniqueConstraint(utility_id, source_key)`

**`sensor_device` table**
- `id` PK
- `device_id` str, globally unique, not null
- `tank_id` FK → `tank.id`, not null
- `h1_m` double nullable — wall measurement height (calibration)
- `depth_m` double nullable — depth reference; defaulted to `0.0` when absent
- `warning_height_m` double default `10.0`
- `critical_height_m` double default `0.0`
- `activated` bool default `False`
- `created_at`, `updated_at`

**`sensor_reading` table**
- `id` PK
- `sensor_id` FK → `sensor_device.id`, not null
- `tank_id` FK → `tank.id`, not null
- `utility_id` FK → `utility.id`, not null (denormalized for scoping)
- `dma_id` FK → `dma.id`, nullable (denormalized)
- `h1_m` double not null — raw snapshot
- `depth_m` double not null
- `water_height_m` double not null — `max(h1_m - depth_m, 0)`
- `status` string enum (`inactive` / `critical` / `warning` / `active`)
- `raw_data` text nullable — optional parser input (Waleki RawData)
- `occurred_at` datetime — message timestamp (parsed) or server now
- `created_at`

### 3. Runtime migrations (`app/services/database_migrations.py`)

- `_migrate_sensor_tables`: create `tank`, `sensor_device`, `sensor_reading`
  with dual-dialect DDL via `_run_postgres_ddl_without_timeout`
  (+ inspector guards, mirroring `_migrate_utility_infrastructure_layer_table`).
- `_migrate_tank_key_field`: add `tank_key_field` to
  `utility_infrastructure_layer` on both dialects.
- Register both in `run_safe_startup_migrations`.

### 4. Tank reconciliation service (`app/services/tank_sync.py`)

`sync_tanks_from_layer(db, utility_id, features, layer_id)`:
- Parse each feature; detect key property via candidate list; compute
  coordinate hash when no name-like property found.
- Match on `(utility_id, source_key)`. Matched ⇒ update fields + reactivate.
  New ⇒ insert (`active`). Missing (present in DB, absent in layer) ⇒ soft
  `deactivated` (+ `deactivated_at`).
- A deactivated tank that still has active sensors ⇒ return a warning for the
  uploader response (no data loss; sensor linkage preserved for manual fix).
- Returns a sync summary dict (`created`, `updated`, `deactivated`,
  `deactivated_with_sensors`, `total`).

### 5. Sensor services (`app/services/sensor_services.py`)

- `compute_water_level(h1_m, depth_m)` ⇒ `max(h1_m - depth_m, 0)`.
- `derive_status(tank, sensor, water_height_m)` ported from Waleki
  (`monitor.js` `getStatus`):
  - not activated ⇒ `inactive`
  - `water_height_m <= critical_height_m` ⇒ `critical`
  - `< warning_height_m` ⇒ `warning`
  - else ⇒ `active`
- `parse_timestamp(value)` — port Waleki's fallbacks: ISO 8601,
  `DD-MM-YYYY HH:MM:SS`, epoch seconds/ms (numeric or str), fallback `None`.
- `extract_depth(raw_data, properties)` — prefer explicit `depth_m`/`Depth`/
  `H2`/`h2` fields; else Waleki `RawData` regexes
  `Depth\s*[=:]\s*([\d.]+)` and `D\s*[=:]\s*([\d.]+)`.
- `ingest_reading(db, device_id, payload)` — resolve sensor by `device_id`
  (unknown ⇒ 404 "unregistered device"); derive tank/utility/dma from link;
  parse timestamp + depth; write `sensor_reading`; return
  `{reading, water_level, status, tank}`.

### 6. Schemas (`app/schemas/sensors.py` + export in `app/schemas/__init__.py`)

- `SensorRegisterRequest` (device_id, tank_id, h1_m?, depth_m?,
  warning_height_m?, critical_height_m?)
- `SensorRegisterResponse`
- `SensorIngestRequest` (device_id, h1_m, raw_data?, occurred_at?)
- `SensorIngestResponse` (ok, water_level_m, status, tank_id, occurred_at)
- `SensorRead` / `SensorListResponse`
- `TankCreate`/`TankPatch` (dma_id, geo fields), `TankRead`
- `TankSyncSummary` — added to `UtilityInfrastructureUploadResponse`
  (rename/extend existing upload response, keeping compatibility).

### 7. Router (`app/api/sensors.py`) + wiring

- `POST /api/sensors/register` — `require_admin` or `require_utility_manager`;
  validates tank exists, is `active`, belongs to caller's utility
  (`utility_id` match); device_id unique ⇒ 409 on conflict.
- `POST /api/sensors/ingest` — auth user **or** `X-Ingest-Key` header equals
  `SENSOR_INGEST_KEY`. Unauthenticated allowed only for the key path; scope is
  derived server-side from the sensor link (payload carries no utility).
- `GET /api/sensors` — role-scoped list (admin all, manager own utility,
  dma_manager own DMA) incl. live status + last reading.
- `PATCH /api/sensors/{device_id}` — manage fields.
- `GET /api/tanks` — role-scoped tank list with sensor count + status.
- `PATCH /api/tanks/{id}` — assign `dma_id` (admin / utility_manager /
  dma_manager aligned to caller scope) + geo fields.
- `GET /api/tanks/{id}` — detail incl. linked sensors and latest reading.

Wiring: register router in `app/main.py`, add to `app/api/__init__.py`, add
`SENSOR_INGEST_KEY` to settings (`app/config.py`, default empty = key auth
disabled).

### 8. Wire tank sync into upload

- In `app/api/utilities.py` `upload_infrastructure_layer`: after parsing
  `storage_facilities` features, call `sync_tanks_from_layer`.
- Extend `UtilityInfrastructureUploadResponse` (in `app/schemas/user.py`) with
  optional `tank_sync` summary; include any deactivated-with-sensors warning.

### 9. Tests (`tests/test_sensors.py`)

Cover: register (validation, utility-scope, duplicate 409); ingest (unknown
device 404, key auth, authenticated auth, reject when key path absent and
unauthenticated, status derivation tiers, timestamp/depth parsing, water-level
clamp at 0); tank sync reconcile (created/updated/deactivated/
deactivated-with-sensors); scoped list behavior; `PATCH /api/tanks/{id}`
dma assignment guards. Reuse `tests/conftest.py` fixtures (in-memory SQLite +
StaticPool). Verify with `pytest` from `Backend/`.

## Verification

1. `pytest` green (add test_sensors.py to run).
2. Boot app; confirm migrations run on both dialects (dev Postgres + SQLite).
3. Manual smoke: register a tank + sensor via API, ingest a reading, confirm
   status derivation and role-scoped listing; upload a `storage_facilities`
   layer and confirm tank sync summary.
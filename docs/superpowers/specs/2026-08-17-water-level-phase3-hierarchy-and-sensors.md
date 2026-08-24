# Water Level Monitoring — Phase 3: Hierarchical Filters, Sensor Management, GPKG Startup Sync

Date: 2026-08-17
Status: Implemented

## Goal

Extend the Phase 2 water-level monitoring surfaces into a self-service hierarchy
workflow:

1. **Hierarchical Utility → DMA filter** on the water-level overview so admins can
   cascade from a utility down to its DMAs, while managers are auto-scoped.
2. **Sensor management** — register sensors on tanks, edit them, activate/deactivate
   them, toggle tank active/deactivated, and delete sensors, via a modal on the
   water-level pages and a dedicated management page.
3. **GPKG startup auto-import** — on backend startup, re-sync tanks from any
   uploaded `storage_facilities` GeoPackage layers so a DB reset or missed sync
   does not lose tanks (resources without sensors, in hierarchy form).

Approach: **A — Minimal reuse.** Reuse existing role-scoped endpoints, existing
`sync_tanks_from_layer`, and existing tank/sensor PATCH endpoints. The only new
backend surface is `DELETE /api/sensors/{device_id}` and a startup backfill
helper.

## Background — what already exists

Backend:

- `POST /api/sensors` — register sensor against an active, access-scoped tank
  (`Backend/app/api/sensors.py:211`).
- `PATCH /api/sensors/{device_id}` — edit sensor fields incl. `activated`
  (`Backend/app/api/sensors.py:284`).
- `PATCH /api/tanks/{tank_id}` — already applies `name`, `latitude`, `longitude`,
  `dma_id`, and `status` (`ACTIVE`/`DEACTIVATED` with `deactivated_at`)
  (`Backend/app/api/sensors.py:427`).
- `GET /api/tanks` — role-scoped tank list with `sensor_count`,
  `active_sensor_count`, `status` (`Backend/app/api/sensors.py:392`).
- `GET /api/sensors` — role-scoped list with `tank_name`, `utility_id`, `dma_id`,
  `status`, `activated`, `last_reading` (`Backend/app/api/sensors.py:349`).
- `GET /api/utilities` — role-scoped (admins all; utility manager own; DMA
  manager/engineer their utility) (`Backend/app/api/utilities.py:1418`).
- `GET /api/dmas?utility_id=` — role-scoped DMA list with optional utility filter
  (`Backend/app/api/dmas.py:180`).
- `POST /api/utilities/{utility_id}/infrastructure/{asset_type}` — GPKG upload;
  for `storage_facilities` it runs `sync_tanks_from_layer`
  (`Backend/app/api/utilities.py:1703`, `Backend/app/services/tank_sync.py:126`).
- `sync_tanks_from_layer` — idempotent reconcile of the `tank` table from layer
  features, keyed on `(utility_id, source_key)`; creates/updates/reactivates/
  soft-deactivates tanks; rejects deactivation when tanks still have sensors
  (`deactivated_with_sensors` warning).
- `UtilityInfrastructureLayer` — stores the raw GPKG `file_data` per
  `(utility_id, asset_type)` with a `(utility_id, asset_type)` unique constraint
  (`Backend/app/models/user.py:179`).
- Startup lifecycle in `app/main.py` `lifespan` — already runs safe migrations,
  optional heavy migrations, schema sync, and the legacy DUWASA import behind
  settings flags.

Frontend:

- Water-level overview (`Frontend/app/(dashboard)/_views/water-level-page.tsx`)
  with a single DMA-only dropdown and cards built purely from `SensorSnap[]`.
- Water-level tank detail (`.../_views/water-level-tank-detail-page.tsx`).
- Data store (`Frontend/store/data-store.ts`) with `fetchUtilities`,
  `fetchDMAs(utilityId?)`, `fetchSensors`, `fetchTankReadings`, and
  `SensorSnap`/`TankReading` types.
- Nav config (`Frontend/lib/constants.ts`) with role-gated `NAV_ITEMS`.
- `CurrentUser` (`Frontend/store/auth-store.ts`) exposes `role`
  (`admin`/`utility_manager`/`dma_manager`), `utilityId`, `dmaId`.

## Scope

In scope:

1. Hierarchical Utility → DMA filter on the water-level overview.
2. Tank-card source switch: overview cards derive from `/api/tanks` (all
   role-scoped tanks, including tanks without sensors) joined with latest sensor
   snapshots.
3. Register-sensor modal (overview + detail + management pages).
4. Dedicated sensor management page `/dashboard/sensors`.
5. `DELETE /api/sensors/{device_id}` (cascade readings; admin/utility-manager).
6. GPKG startup auto-import of `storage_facilities` layers (tanks only).

Out of scope:

- Backfill of utilities/DMAs from GPKG (tanks only — decided).
- Editing utilities/DMAs from these pages.
- Notification/alarm wiring for water-level events.
- Ingest-key provisioning.

## Part 1 — Hierarchical Utility → DMA filter

### Backend

No backend changes. Existing `/api/utilities` and `/api/dmas?utility_id=` are
already role-scoped:

- admin → sees all utilities; DMA list scoped by selected `utility_id`.
- utility_manager → `/api/utilities` returns only their utility; DMA dropdown
  scoped to that utility (already enforced server-side).
- dma_manager → utility filter is locked to their utility (single option);
  DMA dropdown shows their own DMA.

### Frontend

`water-level-page.tsx`:

- Add `utilityFilter` state ("" = all). Utility dropdown lists `utilities`
  from the store (`fetchUtilities()` already exists). For `utility_manager`
  and `dma_manager` the dropdown is locked to their `currentUser.utilityId`
  (render as a single disabled option, or a plain label).
- When `utilityFilter` is set (or locked), fetch DMAs scoped to that utility
  via the existing `fetchDMAs(utilityId)` action so the DMA dropdown lists only
  that utility's DMAs. For `dma_manager`, DMA dropdown is locked to
  `currentUser.dmaId`.
- Empty `utilityFilter` (admin, "All Utilities") → DMA dropdown shows all
  role-scoped DMAs (current behavior).
- Tank cards are filtered by the active utility + DMA filters.

### Tank-card source switch

- Overview fetches tanks via a new `fetchTanks()` store action hitting
  `GET /api/tanks` (role-scoped).
- Card group source changes from `sensors` to `tanks`:
  - Build a `Map<tankId, SensorSnap>` of latest readings from `sensors`.
  - For each tank, show `sensor_count`/`active_sensor_count`, and if a latest
    reading exists, water level + status + percent; otherwise show the
    "No readings yet" empty state with a "Register sensor" affordance
    (opens the modal, only when the user can register: admin/utility_manager).
- Empty state changes: `tanks.length === 0` → skeletons/no tanks; a tank with
  sensors but zero readings still renders a card.

### DMA filter edge cases

- A DMA manager's DMA dropdown shows only their DMA (their utility is implied).
- `dma_manager` cannot re-register sensors (registration remains
  admin/utility_manager; management page for them is read-only scoped).

## Part 2 — Sensor management

### Register-sensor modal

Reusable `components/water-level/register-sensor-modal.tsx`:

- Fields: `device_id`, tank picker, `h1_m`, `depth_m`, `warning_height_m`,
  `critical_height_m`, `activated`.
- Tank picker lists all role-scoped tanks (from `fetchTanks`), each labelled
  with name + utility/DMA, and marked when it already has an activated sensor
  ("sensor attached" badge); tanks without an active sensor shown first.
- Submits `POST /api/sensors`; on success refreshes `sensors` and `tanks`
  stores and closes.
- Role-gated: admin and utility_manager only.

Used by: overview page (empty-tank card "Register sensor" + a header button),
detail page, and management page.

### Sensor management page `/dashboard/sensors`

- New `app/(dashboard)/_views/sensors-page.tsx` + route
  `app/(dashboard)/sensors/page.tsx` (mirrors existing route patterns).
- Nav item in `lib/constants.ts`: title "Sensor Management", href
  `/dashboard/sensors`, roles `["admin", "utility_manager", "dma_manager"]`.
- Table (reuse existing table/card styling from sibling pages):
  device_id, tank, utility, DMA, status pill, activated, last reading + time.
- Actions:
  - Edit (opens the same modal pre-filled) → `PATCH /api/sensors/{device_id}`.
  - Activate/Deactivate toggle → `PATCH /api/sensors/{device_id}` `{activated}`.
  - Tank active/deactivated toggle → `PATCH /api/tanks/{tank_id}`
    `{status: "active"|"deactivated"}` (endpoint already supports this).
  - Delete → `DELETE /api/sensors/{device_id}` with confirm dialog; cascade
    deletes readings (per decision).
- Role behavior:
  - admin / utility_manager: full CRUD within their scope.
  - dma_manager: read-only list scoped to their DMA (registration/edit/delete
    hidden).

### Backend: DELETE sensor

`app/api/sensors.py`:

- `@sensors_router.delete("/{device_id}", status_code=204)` gated by
  `require_utility_manager`.
- Look up sensor by device_id (404 if absent), ensure access via
  `_ensure_sensor_access`.
- Cascade delete readings: `db.query(SensorReading).filter(
  SensorReading.sensor_id == sensor.id).delete()` then `db.delete(sensor)`.
- Audit log `sensor.delete` with `utility_id` from the tank, then commit.

Note: the schema `SensorRegisterResponse` and `TankRead` are unchanged.

## Part 3 — GPKG startup auto-import (tanks only)

### Shared GPKG→features helper

Extract the layer-loading logic currently inlined in
`upload_infrastructure_layer` (the `_load_infrastructure_geojson_with_summary`
path that runs for `storage_facilities`) into a callable used by both:

- `Backend/app/services/tank_sync.py` — add `sync_tanks_from_layer_file(
  db, utility_id, file_name, file_data)` that loads GeoJSON features from the
  stored `.gpkg` bytes and calls `sync_tanks_from_layer`. Reuses existing
  `_load_infrastructure_geojson_with_summary` from `utilities.py` (moved/imported
  to a shared module, or imported from `utilities` — keep imports dependency-free
  by relocating the loader into `tank_sync.py` or a new small module).

### Startup hook

`app/main.py` `lifespan`, after existing startup migrations:

- New setting `run_tank_gpkg_sync_on_startup` (default `true`) in
  `app/config.py`.
- New `app/services/gpkg_startup_sync.py`:
  - Query `UtilityInfrastructureLayer` rows with
    `asset_type == "storage_facilities"`, ordered by utility.
  - For each, call `sync_tanks_from_layer_file(db, utility_id, file_name,
    file_data)`.
  - Print a per-layer summary (`created`/`updated`/`reactivated`/`deactivated`/
    `total`) and an aggregate.
  - Idempotent by `(utility_id, source_key)`; safe to run every boot.
  - Wrap each layer in try/except so one corrupt layer does not abort startup;
    log the failure and continue.
  - Skipped entirely when the flag is false.
- Since `file_data` may be large, run synchronously but bounded (layers are few);
  log progress.

### Relationship to upload path

Uploads keep their existing inline sync. Startup sync only fills gaps — upload
already-created tanks are matched by `source_key` and simply `updated` (no-op
changes), so the two paths are consistent.

## Error handling

- Delete sensor: 404 unknown device_id, 403 out-of-scope, 204 success.
- Register sensor: existing 409 duplicate device_id, 400 inactive tank, 403
  scope — surfaced verbatim in the modal.
- Tank toggle: existing 400 invalid status, 403 scope.
- Startup sync: per-layer try/except; failures logged, never abort startup.
- Overview fetch failures: existing store error handling; skeleton/empty states
  unchanged.

## Testing

Backend (`pytest tests/`):

- `TestSensorDelete`: delete removes readings (cascade) and sensor; 204; 404 for
  unknown device_id; 403 for DMA manager / out-of-scope utility manager; audit
  log row created; duplicate delete → 404.
- `TestTankStatusToggle`: PATCH active→deactivated sets `deactivated_at`;
  deactivated→active clears it; 400 invalid status; 403 out-of-scope.
- `TestGpkgStartupSync`: building a `UtilityInfrastructureLayer` row with a
  small in-memory GPKG fixture, running the startup sync creates missing tanks,
  does not duplicate existing ones, and survives a corrupt layer without raising.

Frontend (`npx tsc --noEmit` + `npm run build`):

- Route `app/(dashboard)/sensors/page.tsx` + `_views/sensors-page.tsx` compile.
- Modal + management page compile with strict types.
- Manual smoke: admin logs in → overview shows Utility + DMA cascade → register
  sensor via modal → management page lists it → edit/toggle/delete works →
  restart backend → tanks still present (startup sync idempotent).

## Files touched

Backend:

- `app/api/sensors.py` — add `DELETE /{device_id}`.
- `app/services/tank_sync.py` — add `sync_tanks_from_layer_file` (+ shared
  GPKG→features loader, moved here or imported cleanly).
- `app/services/gpkg_startup_sync.py` — new startup backfill.
- `app/main.py` — wire startup sync into `lifespan`.
- `app/config.py` — `run_tank_gpkg_sync_on_startup` setting.
- `tests/test_sensors.py` — delete + tank-toggle tests.
- `tests/test_gpkg_startup_sync.py` — new.

Frontend:

- `store/data-store.ts` — add `fetchTanks` action (+ `tanks` state), sensor
  CRUD actions (`registerSensor`, `updateSensor`, `deleteSensor`), tank status
  toggle action.
- `app/(dashboard)/_views/water-level-page.tsx` — hierarchical filter + tank
  cards from `/api/tanks` + register-sensor modal wiring.
- `app/(dashboard)/_views/water-level-tank-detail-page.tsx` — register-sensor
  modal wiring.
- `app/(dashboard)/_views/sensors-page.tsx` — new management page.
- `app/(dashboard)/sensors/page.tsx` — new route.
- `components/water-level/register-sensor-modal.tsx` — new modal.
- `lib/constants.ts` — nav item "Sensor Management".
- `lib/water-level.ts` — any shared helpers (e.g. tank-with-sensor join).

## Risks / decisions

- Card source switch changes what overview shows for tanks without sensors —
  intended (per decision).
- DMA manager sees read-only sensor management — scope consistency with existing
  `_ensure_tank_access`.
- Startup sync loads stored GPKG bytes each boot; bounded by layer count; corrupt
  layers are logged and skipped, never fatal.
- `sync_tanks_from_layer` soft-deactivates tanks absent from a freshly uploaded
  layer; startup re-sync uses the same semantics (a layer replaced since the last
  boot may deactivate removed tanks). This matches the upload path.

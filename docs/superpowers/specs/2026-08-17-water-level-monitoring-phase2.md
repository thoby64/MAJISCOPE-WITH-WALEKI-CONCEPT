# Water Level Monitoring — Phase 2 Reference (Frontend)

Date: 2026-08-17
Status: Implemented (frontend plan, Phase 2 of 2)

## Goal

Port Waleki's live tank water-level monitoring into MajiScope as a standalone,
role-scoped "Water Level Monitoring" feature. Phase 1 delivered the backend
(approved, complete, production-verified). Phase 2 adds the frontend: a nav
item, an overview page with tank cards + DMA filter, a per-tank detail view
with a live tank visualizer and recent-readings table, and 10-second polling to
stay current. It also adds one small backend endpoint (reading history) that the
detail view requires.

## Design Decisions (settled with user)

- **Page name**: "Water Level Monitoring", path `/dashboard/water-level`.
- **Nav item roles**: `["admin", "utility_manager", "dma_manager"]`. Engineers
  are deliberately **excluded** per user decision (backend still scopes them to
  their DMA for future use).
- **Scope**: Full Waleki parity — tank card overview + click-through detail view
  (visualizer, metrics, readings table).
- **Live updates**: poll every **10s**, pauses when the tab is hidden, cleaned
  up on unmount.
- **DMA/zone filter**: on the overview; scoping is enforced server-side via
  existing `_tank_scoped_ids`.
- **Tank length override**: allowed, per-tank value persisted in `localStorage`
  exactly as Waleki does (`waleki:tank-length-m:{tankId}`). It affects only the
  local %-filled display, never server data.
- **Status authority**: backend-derived status from
  `_sensor_status`/`derive_status` is authoritative; the page colors the status
  pill/water from it.

## Source of Truth (Waleki reference)

`waleki/src/pages/dashboard/monitor.js` and `WaterLevelTank` (in
`waleki/src/pages/dashboard/`) are the UX reference: tank card grid → node
detail (animated tank visualizer with water fill + h1/h2 markers, metrics grid,
recent-readings table with status pills, localStorage tank-length override).

## Backend Addition (1 endpoint)

### `GET /api/tanks/{tank_id}/readings?limit=30`

- Auth: `get_current_user`; access enforced via `_ensure_tank_access`.
- Returns newest-first readings from the tank's **active** sensors
  (`sensor_reading` joined through `sensor_device`), limited to `limit`
  (default 30, clamp 1–200).
- Response:
  ```
  { "total": int, "items": [
      { "reading_id", "sensor_id", "tank_id", "water_level_m",
        "h1_m", "depth_m", "status", "occurred_at" } ] }
  ```
  Reuses `_reading_response` / `SensorIngestResponse` field shape for
  consistency.
- No migration needed: `sensor_reading` already exists with an
  `occurred_at` index.

## Frontend Deliverables

### 1. Nav item (`Frontend/lib/constants.ts`)

Add to `NAV_ITEMS`, after "Hydraulic Model Scenarios" (line ~65):
- title "Water Level Monitoring", href `/dashboard/water-level`
- icon `Droplets` (lucide; `WaterTank` is not available in this lucide version).
- roles `["admin", "utility_manager", "dma_manager"]`

### 2. Routes

Following the existing pattern (`app/(dashboard)/<route>/page.tsx` redirect →
`app/(dashboard)/dashboard/<route>/page.tsx`):

- `app/(dashboard)/water-level/page.tsx`
  `redirect("/dashboard/water-level")`
- `app/(dashboard)/dashboard/water-level/page.tsx`
  renders `<WaterLevelPage />` from `_views/water-level-page.tsx`
- `app/(dashboard)/water-level/[tankId]/page.tsx`
  redirect to `/dashboard/water-level/[tankId]`
- `app/(dashboard)/dashboard/water-level/[tankId]/page.tsx`
  renders `<WaterLevelTankDetailPage tankId={id} />` from
  `_views/water-level-tank-detail-page.tsx`

### 3. Data store (`Frontend/store/data-store.ts`)

Add types + fetch actions mirroring existing `fetchDMAs` patterns, consuming the
global `apiClient`:

- Types: `SensorSnap` (from `/api/sensors` item shape: `id`, `device_id`,
  `tank_id`, `tank_name`, `dma_id`, `h1_m`, `depth_m`, `activated`, `status`,
  `last_reading`) and `TankReading` (from the new readings endpoint item).
- `fetchSensors(): Promise<void>` → `/api/sensors`, stores `sensors`.
- `fetchTankReadings(tankId: string, limit?: number): Promise<void>` →
  `/api/tanks/{tankId}/readings`, stores `tankReadingsByTank: Record<string,
  TankReading[]>`.

### 4. Overview view (`app/(dashboard)/_views/water-level-page.tsx`)

Client view using `useDataStore` (as `dmas-page.tsx` does):

- **DMA filter**: dropdown populated from `fetchDMAs()`; local state
  `dmaFilter`, applied client-side to the card list. "All DMAs" default.
- **Tank cards**: derived from `sensors` grouped by `tank_id`, one card per
  tank showing:
  - tank name (`tank_name`), DMA name when known
  - current water level (m) from the tank's latest `last_reading`
  - percentage fill = `water_level_m / overrideOrDefaultLength`
  - horizontal fill bar
  - status pill (`active`/`warning`/`critical`/`inactive`) colored from
    backend status
  - "updated Xs ago" from `last_reading.occurred_at`
  - active sensor count; no sensors ⇒ "No sensor" state
- **Click** a card → router push to `/dashboard/water-level/{tankId}`.
- **Polling**: `setInterval(..., 10_000)` calling `fetchSensors()` (and
  `fetchDMAs()` once on mount). Pause via `document.visibilitychange`;
  cleanup on unmount. Skeleton/loading states matching other views.
- Empty states: no tanks in scope ⇒ friendly message (use `PageHeader` title
  "Water Level Monitoring").

### 5. Tank detail view (`app/(dashboard)/_views/water-level-tank-detail-page.tsx`)

Port of Waleki `NodeDetailFromQuery` on REST instead of Firebase:

- Back link to `/dashboard/water-level`.
- Header: tank name, status pill, "Back to monitoring" button.
- **Visualizer**: port `WaterLevelTank` look — an animated SVG/CSS tank profile
  showing water fill height, `h1_m` (sensor hanging length) and `h2`/depth
  markers, and sensor depth line, colored by status. Uses the tank-length
  override (localStorage fallback logic) or tank length.
- **Metrics grid** (lucide icons, mirroring reference): current water height,
  tank length (editable input, localStorage-persisted), sensor hanging h1,
  sensor reading h2, average height, maximum height, total readings.
- **Recent readings table**: latest 30 from `tankReadingsByTank`, columns Time /
  Water height (m) / Water height (ft) / h1 / h2 / Status pill.
- **Data deps**: `fetchSensors()` to find the tank's sensors, plus
  `fetchTankReadings(tankId)` for history; both on the 10s poll cycle
  (readings only when a tank is open).
- Tank not found / no access ⇒ not-found or empty state with back link.

### 6. Shared visual component (`Frontend/components/water-level/`)

Extract the visualizer + status helpers so overview and detail share them:

- `components/water-level/water-level-tank.tsx` — the tank visualizer.
- `components/water-level/status-pill.tsx` — status badge wrapper (or reuse
  existing `EntityStatusBadge` from `components/shared/status-badge.tsx`).
- `lib/water-level.ts` — `fillPercent(waterLevelM, lengthM)`,
  `tankLengthFor(tank, sensor, localStorageValue)`, `formatRelative(iso)`.

## Consistency / Conventions

- No new dependencies: use existing shadcn `Card`, `Button`, `Input`,
  `DropdownMenu`, `Badge`, `Skeleton`; lucide icons; `PageHeader`; `cn`.
- Follow `dmas-page.tsx` structure: `"use client"`, `useDataStore`, local
  filter state, `useEffect` fetch on mount, `PageHeader`.
- Sensor types go in `store/data-store.ts` (not `lib/types.ts`) to match how
  `DMA`/`Utility` are defined.

## Out of Scope

- Dashboard map overlay integration (deferred in Phase 1 doc).
- `Sensor` registration UI / device management screens (Phase 1 API exists;
  no UI requested).
- Engineer-visible monitoring (user decision: excluded).
- Hard deletes, WebSocket/SSE push, server-side DMA filtering UI.

## Questions for Reviewer

1. "Water Level Monitoring" nav placement (after Hydraulic Scenarios) vs a
   dedicated "Monitoring" section — OK as placed?
2. Reading history limit fixed at 30 — should the detail view offer a more/less
   control now, or defer?
3. `SensorSnap`/`TankReading` types live in `store/data-store.ts` per
   house style — confirm acceptable vs `lib/types.ts`.
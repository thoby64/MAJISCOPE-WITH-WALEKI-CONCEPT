# Water Level Monitoring Phase 2 (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-scoped "Water Level Monitoring" frontend — nav item, overview tank-card page with DMA filter, per-tank detail view (tank visualizer, metrics, readings table, localStorage length override) — plus one small backend readings-history endpoint, all with 10-second polling.

**Architecture:** Backend adds `GET /api/tanks/{tank_id}/readings` (newest-first reading history for a tank's active sensors) reusing existing `_reading_response`/`SensorIngestResponse`. Frontend follows MajiScope's existing patterns: thin route files re-exporting client views in `app/(dashboard)/_views/`, Zustand store actions in `store/data-store.ts` using the global `apiClient` + `transformKeys`, shadcn UI, lucide icons. Data flows: overview polls `/api/sensors`; detail polls `/api/sensors` + `/api/tanks/{id}/readings`.

**Tech Stack:** FastAPI + SQLAlchemy (backend); Next.js App Router 16, React 19, Zustand 5, shadcn/ui, Tailwind, lucide-react (frontend); pytest (backend tests); `tsc --noEmit` (frontend typecheck).

## Global Constraints

- Backend work happens in `/home/thobbs/Documents/PRESENT/Backend`; frontend in `/home/thobbs/Documents/PRESENT/Frontend`.
- Backend test command: `cd Backend && source venv/bin/activate && pytest tests/test_sensors.py -v` (or full `pytest tests/ -v`). Tests run on in-memory SQLite; conftest fixtures: `db`, `client`, `test_user`, `auth_headers`, `admin_user`, `admin_auth_headers`. Test helpers `_make_utility`, `_make_dma`, `_make_tank`, `_make_sensor`, `_utility_manager_headers` live in `tests/test_sensors.py`.
- Frontend verification command: `cd Frontend && npx tsc --noEmit` (there is NO ESLint config and no test runner in Frontend; `next lint` is not configured). Baseline is clean today.
- Nav roles for Water Level Monitoring: exactly `["admin", "utility_manager", "dma_manager"]`. Engineers are excluded (user decision).
- Poll interval: exactly `10_000` ms. Polls pause when `document.visibilityState !== "visible"`; intervals cleared on unmount.
- Reading history limit: default `30`, clamped 1–200 server-side; detail view requests `30`.
- Status display is always the backend-derived status string (`active`/`warning`/`critical`/`inactive`); the UI only colors/derives visual fill from it, never recomputes it.
- Tank-length override is client-only, persisted per tank under `localStorage` key `waleki:tank-length-m:{tankId}` (mirrors Waleki). Never sent to the backend.
- No new npm dependencies. Only existing deps: `zustand`, `lucide-react`, shadcn `Card`/`Button`/`Input`/`Skeleton`/`DropdownMenu`/`Badge`, `sonner`, `@/lib/utils` `cn`.
- No new PyPI dependencies.
- No git repo exists at the workspace root or Frontend (`.git` dirs are empty/uninitialized). Commit steps are marked `(skip if no git repo)`; if a repo exists, commit each task.

---

### Task 1: Backend — readings-history endpoint

**Files:**
- Modify: `Backend/app/schemas/sensors.py` (add `TankReadingsResponse`)
- Modify: `Backend/app/api/sensors.py` (add `GET /api/tanks/{tank_id}/readings`)
- Modify: `Backend/tests/test_sensors.py` (add `TestTankReadings`)

**Interfaces:**
- Consumes: existing `SensorReading` model (fields `sensor_id`, `tank_id`, `utility_id`, `dma_id`, `h1_m`, `depth_m`, `water_height_m`, `status`, `occurred_at`, `created_at`); existing helpers `_get_tank_or_404`, `_ensure_tank_access`, `_reading_response` (all in `app/api/sensors.py`); existing `SensorIngestResponse` schema.
- Produces: `GET /api/tanks/{tank_id}/readings?limit=N` returning `{ "total": int, "items": [SensorIngestResponse] }` newest-first; item shape reuses `SensorIngestResponse` (`reading_id`, `sensor_id`, `tank_id`, `utility_id`, `dma_id`, `water_level_m`, `h1_m`, `depth_m`, `status`, `occurred_at`).

- [ ] **Step 1: Write the failing tests**

Append to `Backend/tests/test_sensors.py` (after `TestUploadTankSync`):

```python
class TestTankReadings:
    """GET /api/tanks/{tank_id}/readings — reading history for a tank's active sensors."""

    def _ingest(
        self,
        client: TestClient,
        auth_headers: dict,
        device_id: str,
        occurred_at: str,
        depth_raw: str = "Depth=2",
    ):
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={
                "device_id": device_id,
                "h1_m": 12.0,
                "raw_data": depth_raw,
                "occurred_at": occurred_at,
            },
        )
        assert response.status_code == 200
        return response.json()

    def test_readings_empty_for_unmonitored_tank(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Quiet Tank")
        response = client.get(f"/api/tanks/{tank.id}/readings", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_readings_latest_first_and_ordered(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Tank R")
        sensor = _make_sensor(db, tank, device_id="dev-read", activated=True)
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T10:00:00", "Depth=1")
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T12:00:00", "Depth=3")
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T11:00:00", "Depth=2")

        response = client.get(f"/api/tanks/{tank.id}/readings", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        times = [item["occurred_at"] for item in data["items"]]
        assert times == sorted(times, reverse=True)
        assert data["items"][0]["water_level_m"] == 9.0
        assert data["items"][1]["water_level_m"] == 10.0
        assert data["items"][2]["water_level_m"] == 11.0

    def test_readings_limit(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Tank L")
        sensor = _make_sensor(db, tank, device_id="dev-lim", activated=True)
        for i in range(5):
            self._ingest(client, auth_headers, sensor.device_id, f"2026-01-01T10:0{i}:00", "Depth=1")
        response = client.get(f"/api/tanks/{tank.id}/readings?limit=2", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        assert len(data["items"]) == 2

    def test_readings_skips_inactive_sensors(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Tank I")
        sensor = _make_sensor(db, tank, device_id="dev-inactive", activated=False)
        self._ingest(client, auth_headers, sensor.device_id, "2026-01-01T10:00:00")
        response = client.get(f"/api/tanks/{tank.id}/readings", headers=auth_headers)
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_readings_scoped_403_other_utility(self, client: TestClient, db: Session):
        utility_a = _make_utility(db, name="Water Co A")
        utility_b = _make_utility(db, name="Water Co B")
        tank = _make_tank(db, utility_a, source_key="Tank S")
        headers_b = _utility_manager_headers(db, utility_b)
        response = client.get(f"/api/tanks/{tank.id}/readings", headers=headers_b)
        assert response.status_code == 403

    def test_readings_404_unknown_tank(self, client: TestClient, auth_headers: dict):
        response = client.get(f"/api/tanks/{uuid4()}/readings", headers=auth_headers)
        assert response.status_code == 404
```

Note: the ingest `occurred_at` values above (`2026-01-01T10:00:00`) parse to naive datetimes; ordering is by `occurred_at` then `created_at` so distinct times give deterministic order.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd Backend && source venv/bin/activate && pytest tests/test_sensors.py::TestTankReadings -v`
Expected: 6 tests FAIL — route returns 404 (endpoint doesn't exist yet).

- [ ] **Step 3: Add the response schema**

In `Backend/app/schemas/sensors.py`, append at end of file (after `SensorListResponse`):

```python
class TankReadingsResponse(BaseModel):
    """Schema for a tank's reading history (newest first)."""
    total: int
    items: List[SensorIngestResponse]
```

- [ ] **Step 4: Add the endpoint**

In `Backend/app/api/sensors.py`:

1. Update the FastAPI import to include `Query`:
```python
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
```
2. Add `TankReadingsResponse` to the schema imports block (alphabetical, after `SensorRead`):
```python
    SensorRead,
    SensorListResponse,
    TankReadingsResponse,
```
3. Append the endpoint after `update_sensor_tank` (end of file):

```python
@tanks_router.get("/{tank_id}/readings", response_model=TankReadingsResponse)
async def list_tank_readings(
    tank_id: str,
    limit: int = Query(30, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Reading history for a tank's active sensors, newest first.

    Scoped to the caller's utility/DMA. Only readings from *activated*
    sensors are returned; inactive sensors and their history are excluded.
    """
    tank = _get_tank_or_404(db, tank_id)
    _ensure_tank_access(tank, current_user, db, action="access")

    active_sensor_ids = [
        row[0]
        for row in db.query(SensorDevice.id)
        .filter(SensorDevice.tank_id == tank.id, SensorDevice.activated.is_(True))
        .all()
    ]

    query = db.query(SensorReading)
    if active_sensor_ids:
        query = query.filter(SensorReading.sensor_id.in_(active_sensor_ids))
    else:
        query = query.filter(SensorReading.id.is_(None))

    total = query.count()
    readings = (
        query.order_by(SensorReading.occurred_at.desc(), SensorReading.created_at.desc())
        .limit(limit)
        .all()
    )
    return TankReadingsResponse(
        total=total,
        items=[_reading_response(r) for r in readings],
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd Backend && source venv/bin/activate && pytest tests/test_sensors.py -v`
Expected: all sensor tests PASS (existing 26 + 6 new).

- [ ] **Step 6: Run the full backend suite**

Run: `cd Backend && source venv/bin/activate && pytest tests/ -v`
Expected: all 80+ tests pass (no regressions).

- [ ] **Step 7: Commit** (skip if no git repo)

```bash
git add Backend/app/schemas/sensors.py Backend/app/api/sensors.py Backend/tests/test_sensors.py
git commit -m "feat(sensors): add tank readings history endpoint"
```

---

### Task 2: Frontend — data store: sensor types + fetch actions

**Files:**
- Modify: `Frontend/store/data-store.ts`

**Interfaces:**
- Consumes: `apiClient` (`get`), `transformKeys`, `isAbortLikeError` (all already in file).
- Produces:
  - Types: `interface SensorSnap` and `interface TankReading` (fields below, already camelCase after `transformKeys`).
  - State: `sensors: SensorSnap[]`, `tankReadingsByTank: Record<string, TankReading[]>`.
  - Actions: `fetchSensors(): Promise<void>` (GET `/sensors`, stores `sensors`), `fetchTankReadings(tankId: string, limit?: number): Promise<void>` (GET `/tanks/{tankId}/readings?limit=N`, stores under `tankReadingsByTank[tankId]`).
- `SensorSnap` mirrors the backend `SensorRead` schema. `TankReading` mirrors `SensorIngestResponse` (the readings item shape).

- [ ] **Step 1: Add type interfaces**

Insert after the `getUtilityInfrastructureAsset` function (~line 89), before `serializeUtilityPayload`:

```ts
export interface SensorSnap {
  id: string
  deviceId: string
  tankId: string
  tankName: string | null
  utilityId: string
  dmaId: string | null
  h1M: number | null
  depthM: number | null
  warningHeightM: number
  criticalHeightM: number
  activated: boolean
  status: string
  lastReading: SensorLastReading | null
  createdAt: string
  updatedAt: string
}

export interface SensorLastReading {
  ok: boolean
  readingId: string
  sensorId: string
  tankId: string
  utilityId: string
  dmaId: string | null
  waterLevelM: number
  h1M: number
  depthM: number
  status: string
  occurredAt: string
}

export interface TankReading {
  ok: boolean
  readingId: string
  sensorId: string
  tankId: string
  utilityId: string
  dmaId: string | null
  waterLevelM: number
  h1M: number
  depthM: number
  status: string
  occurredAt: string
}
```

- [ ] **Step 2: Add state fields to the interface**

In `interface DataState`, in the "Data" block (after `notifications: Notification[]` at ~line 318):

```ts
  sensors: SensorSnap[]
  tankReadingsByTank: Record<string, TankReading[]>
```

- [ ] **Step 3: Add action signatures to the interface**

In `interface DataState`, in "Fetch Actions" (after `fetchNotifications: (userId: string) => Promise<void>` at ~line 341):

```ts
  fetchSensors: () => Promise<void>
  fetchTankReadings: (tankId: string, limit?: number) => Promise<void>
```

- [ ] **Step 4: Add initial state values**

In the store creation initial state (after `notifications: [],` at ~line 397):

```ts
  sensors: [],
  tankReadingsByTank: {},
```

- [ ] **Step 5: Implement the fetch actions**

Insert after `fetchNotifications` implementation. Find its body — it follows `fetchTeams` (~line 520). The notification implementation pattern is:

```ts
  fetchNotifications: async (userId: string) => {
    try {
      const response = await apiClient.get(`/notifications?user_id=${userId}`, { cacheTtl: NOTIFICATION_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ notifications: transformed })
      }
      ...
```

Add after that action (before the CRUD section at ~line 346 of the interface / corresponding impl location):

```ts
  fetchSensors: async () => {
    try {
      const response = await apiClient.get("/sensors", { skipCache: true })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ sensors: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching sensors:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching sensors:", error)
    }
  },

  fetchTankReadings: async (tankId: string, limit = 30) => {
    try {
      const response = await apiClient.get(`/tanks/${tankId}/readings?limit=${limit}`, { skipCache: true })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set((state) => ({
          tankReadingsByTank: { ...state.tankReadingsByTank, [tankId]: transformed as TankReading[] },
        }))
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching tank readings:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching tank readings:", error)
    }
  },
```

Note: `skipCache: true` forces a fresh HTTP request on every poll tick (the default `cacheTtl: 0` already skips caching, but `skipCache` also bypasses in-flight GET dedupe so overlapping polls always resolve).

- [ ] **Step 6: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit** (skip if no git repo)

```bash
git add Frontend/store/data-store.ts
git commit -m "feat(frontend): add sensor and tank-reading data store actions"
```

---

### Task 3: Frontend — nav item + routes

**Files:**
- Modify: `Frontend/lib/constants.ts`
- Create: `Frontend/app/(dashboard)/water-level/page.tsx`
- Create: `Frontend/app/(dashboard)/dashboard/water-level/page.tsx`
- Create: `Frontend/app/(dashboard)/water-level/[tankId]/page.tsx`
- Create: `Frontend/app/(dashboard)/dashboard/water-level/[tankId]/page.tsx`

**Interfaces:**
- Consumes: `UserRole` type, `NavItem` shape.
- Produces: `NAV_ITEMS` entry `{ title: "Water Level Monitoring", href: "/dashboard/water-level", icon: Droplets, roles: ["admin","utility_manager","dma_manager"] }`; four route files following the existing redirect→re-export pattern (see `app/(dashboard)/dmas/page.tsx` and `app/(dashboard)/dashboard/reports/[reportId]/page.tsx`).

- [ ] **Step 1: Add the nav item**

In `Frontend/lib/constants.ts`:

1. Add `Droplets` to the lucide import list (after `FileChartColumn`):
```ts
  FileChartColumn,
  Droplets,
} from "lucide-react"
```
2. Insert after the "Hydraulic Model Scenarios" entry (~line 65):

```ts
  {
    title: "Water Level Monitoring",
    href: "/dashboard/water-level",
    icon: Droplets,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
```

- [ ] **Step 2: Create the overview redirect route**

Create `Frontend/app/(dashboard)/water-level/page.tsx`:

```tsx
import { redirect } from "next/navigation"

export default function WaterLevelRedirectPage() {
  redirect("/dashboard/water-level")
}
```

- [ ] **Step 3: Create the overview dashboard route**

Create `Frontend/app/(dashboard)/dashboard/water-level/page.tsx`:

```tsx
export { default } from "../../_views/water-level-page"
```

- [ ] **Step 4: Create the tank detail redirect route**

Create `Frontend/app/(dashboard)/water-level/[tankId]/page.tsx`:

```tsx
import { redirect } from "next/navigation"

export default async function WaterLevelTankDetailRedirectPage({
  params,
}: {
  params: Promise<{ tankId: string }>
}) {
  const { tankId } = await params
  redirect(`/dashboard/water-level/${tankId}`)
}
```

- [ ] **Step 5: Create the tank detail dashboard route**

Create `Frontend/app/(dashboard)/dashboard/water-level/[tankId]/page.tsx`:

```tsx
export { default } from "../../../_views/water-level-tank-detail-page"
```

- [ ] **Step 6: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: no errors (the two `_views` files are not created until Task 5/6; TypeScript resolves module paths lazily — to be safe, confirm no error is reported for the missing modules; if it errors, create empty placeholder exports in Tasks 5/6 first, or run this typecheck again after Task 5).

- [ ] **Step 7: Commit** (skip if no git repo)

```bash
git add Frontend/lib/constants.ts "Frontend/app/(dashboard)/water-level" "Frontend/app/(dashboard)/dashboard/water-level"
git commit -m "feat(frontend): add water level monitoring nav item and routes"
```

---

### Task 4: Frontend — shared water-level helpers + components

**Files:**
- Create: `Frontend/lib/water-level.ts`
- Create: `Frontend/components/water-level/status-pill.tsx`
- Create: `Frontend/components/water-level/water-level-tank.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, `Card`/`CardContent` from `@/components/ui/card`, `formatTanzaniaDateTime` from `@/lib/date-time`, lucide icons.
- Produces:
  - `WATER_LEVEL_POLL_INTERVAL_MS = 10_000`
  - `DEFAULT_TANK_LENGTH_M = 2`
  - `READING_HISTORY_LIMIT = 30`
  - `getTankLengthStorageKey(tankId: string): string` → `waleki:tank-length-m:{tankId}`
  - `readStoredTankLength(tankId: string): number | null`
  - `stashTankLength(tankId: string, meters: number): void`
  - `tankLengthFor(sensor: { h1M?: number | null }, override: number | null): number`
  - `fillPercent(waterLevelM: number, tankLengthM: number): number`
  - `formatRelativeTime(iso: string, now?: number): string`
  - `WaterStatusPill({ status, className }): JSX` component
  - `WaterLevelTank({ tankName, waterHeightM, tankDepthM, sensorHangingM, sensorDepthM, status, readingCount, lastReadingLabel }): JSX` component

- [ ] **Step 1: Create the helpers module**

Create `Frontend/lib/water-level.ts`:

```ts
export const WATER_LEVEL_POLL_INTERVAL_MS = 10_000
export const DEFAULT_TANK_LENGTH_M = 2
export const READING_HISTORY_LIMIT = 30

export function getTankLengthStorageKey(tankId: string) {
  return `waleki:tank-length-m:${tankId}`
}

export function readStoredTankLength(tankId: string): number | null {
  if (typeof window === "undefined") return null
  const stored = window.localStorage.getItem(getTankLengthStorageKey(tankId))
  const parsed = Number.parseFloat(stored)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function stashTankLength(tankId: string, meters: number) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(getTankLengthStorageKey(tankId), String(meters))
}

export function tankLengthFor(
  sensor: { h1M?: number | null },
  override: number | null
): number {
  const fallback = Math.max(sensor?.h1M ?? 0, DEFAULT_TANK_LENGTH_M)
  return override && override > 0 ? override : fallback
}

export function fillPercent(waterLevelM: number, tankLengthM: number): number {
  const safe = tankLengthM > 0 ? tankLengthM : DEFAULT_TANK_LENGTH_M
  return Math.min(100, Math.max(0, (waterLevelM / safe) * 100))
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "unknown"
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000))
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
```

- [ ] **Step 2: Create the status pill component**

Create `Frontend/components/water-level/status-pill.tsx`:

```tsx
"use client"

import { cn } from "@/lib/utils"

type WaterStatus = "active" | "warning" | "critical" | "inactive"

const WATER_STATUS_CONFIG: Record<WaterStatus, { label: string; color: string; bgColor: string }> = {
  active: { label: "Active", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200" },
  warning: { label: "Warning", color: "text-amber-700", bgColor: "bg-amber-50 border-amber-200" },
  critical: { label: "Critical", color: "text-red-700", bgColor: "bg-red-50 border-red-200" },
  inactive: { label: "Inactive", color: "text-slate-600", bgColor: "bg-slate-100 border-slate-300" },
}

interface WaterStatusPillProps {
  status: string
  className?: string
}

export function WaterStatusPill({ status, className }: WaterStatusPillProps) {
  const config = WATER_STATUS_CONFIG[status as WaterStatus] ?? WATER_STATUS_CONFIG.inactive
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.color,
        config.bgColor,
        className
      )}
    >
      {config.label}
    </span>
  )
}
```

- [ ] **Step 3: Create the tank visualizer component**

Create `Frontend/components/water-level/water-level-tank.tsx`. This is a Tailwind port of Waleki's `WaterLevelTank.jsx` (tank body with fill, scale ticks, sensor cable at h1, surface marker) plus its metrics readout:

```tsx
"use client"

import type { CSSProperties } from "react"
import { Activity, Droplets, Gauge, Ruler } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const STATUS_WATER_CLASS: Record<string, string> = {
  active: "from-cyan-400 to-cyan-600",
  warning: "from-amber-400 to-amber-600",
  critical: "from-rose-500 to-red-600",
  inactive: "from-slate-200 to-slate-300",
}

const STATUS_TEXT_CLASS: Record<string, string> = {
  active: "text-emerald-700 border-emerald-200 bg-emerald-50",
  warning: "text-amber-700 border-amber-200 bg-amber-50",
  critical: "text-red-700 border-red-200 bg-red-50",
  inactive: "text-slate-600 border-slate-300 bg-slate-100",
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const asNumber = (value: number | null | undefined, fallback = 0) => {
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : fallback
}
const formatMeter = (value: number | null | undefined) => `${asNumber(value).toFixed(2)}m`

interface WaterLevelTankProps {
  tankName: string
  waterHeightM: number
  tankDepthM: number
  sensorHangingM: number
  sensorDepthM: number
  status: string
  readingCount: number
  lastReadingLabel?: string
}

export function WaterLevelTank({
  tankName,
  waterHeightM,
  tankDepthM,
  sensorHangingM,
  sensorDepthM,
  status,
  readingCount,
  lastReadingLabel,
}: WaterLevelTankProps) {
  const depth = asNumber(tankDepthM)
  const height = asNumber(waterHeightM)
  const sensorHanging = asNumber(sensorHangingM)
  const sensorDepth = asNumber(sensorDepthM)
  const percent = depth > 0 ? clamp((height / depth) * 100, 0, 100) : 0
  const surfaceTop = 100 - percent
  const probeTop = depth > 0 ? clamp((sensorHanging / depth) * 100, 0, 100) : null
  const safeStatus = String(status || "inactive").toLowerCase()
  const displayStatus = safeStatus === "low" ? "warning" : safeStatus
  const waterClass = STATUS_WATER_CLASS[displayStatus] ?? STATUS_WATER_CLASS.inactive
  const statusTextClass = STATUS_TEXT_CLASS[displayStatus] ?? STATUS_TEXT_CLASS.inactive
  const markersOverlap = probeTop !== null && Math.abs(probeTop - surfaceTop) < 7
  const ticks = [100, 75, 50, 25, 0]

  return (
    <Card className="border-slate-200/70 bg-white shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Live tank level</p>
            <h4 className="mt-0.5 text-lg font-semibold text-slate-800">{tankName}</h4>
          </div>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", statusTextClass)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {safeStatus}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          {/* Tank instrument */}
          <div className="flex flex-1 items-stretch justify-center gap-3">
            {/* Scale */}
            <div className="relative w-14 shrink-0" aria-hidden="true">
              {ticks.map((tick) => (
                <div key={tick} className="absolute right-0 flex w-full -translate-y-1/2 items-center justify-end gap-1.5" style={{ top: `${100 - tick}%` }}>
                  <span className="text-[10px] text-slate-400">{depth > 0 ? formatMeter((depth * tick) / 100) : `${tick}%`}</span>
                  <span className="h-px w-3 bg-slate-300" />
                </div>
              ))}
            </div>

            {/* Tank body */}
            <div
              className="relative h-64 w-28 overflow-hidden rounded-b-xl rounded-t-lg border-2 border-slate-300 bg-slate-100"
              role="img"
              aria-label={`Water level ${percent.toFixed(0)} percent`}
            >
              <div className="absolute inset-x-0 top-0 h-1.5 rounded-b bg-slate-300" />
              {/* Empty region above surface */}
              <div className="absolute inset-x-0 top-0 bottom-[var(--surface-top)] bg-slate-100 transition-[bottom] duration-700" style={{ "--surface-top": `${surfaceTop}%` } as CSSProperties} />
              {/* Water fill */}
              <div className={cn("absolute inset-x-0 bottom-0 top-[var(--surface-top)] bg-gradient-to-b transition-[top] duration-700", waterClass)} style={{ "--surface-top": `${surfaceTop}%` } as CSSProperties}>
                <div className="absolute inset-x-0 top-0 h-1.5 rounded-b bg-white/50" />
              </div>
              {/* Sensor cable + probe at h1 */}
              {probeTop !== null && (
                <div className={cn("absolute inset-x-0 transition-[top] duration-700", markersOverlap && "opacity-80")} style={{ top: `${probeTop}%` }}>
                  <div className="mx-auto h-px w-px bg-slate-500" />
                  <div className="mx-auto h-1.5 w-3 rounded-full bg-slate-500" />
                </div>
              )}
              {/* Surface marker */}
              <div className="absolute inset-x-0 -translate-y-1/2 border-t border-dashed border-white/80" style={{ top: `${surfaceTop}%` }}>
                <span className="absolute right-0 -top-6 rounded bg-slate-800/85 px-1.5 py-0.5 text-right text-[10px] leading-tight text-white">
                  <small className="block text-[9px] opacity-70">Level</small>
                  <strong>{formatMeter(height)}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Readout */}
          <div className="flex w-full flex-col justify-center gap-3 sm:max-w-[220px]">
            <div className="flex items-center gap-2">
              <Droplets className="h-5 w-5 text-cyan-600" />
              <span className="text-xl font-bold text-slate-800">{formatMeter(height)}</span>
            </div>
            <div>
              <p className="text-xs text-slate-500">Current water height</p>
              <strong className="text-sm text-slate-700">{percent.toFixed(0)}% full</strong>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className={cn("h-full rounded-full bg-gradient-to-r transition-[width] duration-700", waterClass)} style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <Ruler className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">Tank length</p>
                <strong className="text-slate-700">{formatMeter(depth)}</strong>
              </div>
              <div>
                <Ruler className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">Sensor hanging</p>
                <strong className="text-slate-700">{formatMeter(sensorHanging)}</strong>
              </div>
              <div>
                <Gauge className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">h2 reading</p>
                <strong className="text-slate-700">{formatMeter(sensorDepth)}</strong>
              </div>
              <div>
                <Activity className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">Readings</p>
                <strong className="text-slate-700">{readingCount ?? 0}</strong>
              </div>
            </div>
            {lastReadingLabel && <p className="text-[11px] text-slate-400">Last reading: {lastReadingLabel}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

Note: `--surface-top` uses a CSS custom property; the `as CSSProperties` cast (via `import type { CSSProperties } from "react"`) satisfies TS without importing the whole `React` namespace.

- [ ] **Step 4: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit** (skip if no git repo)

```bash
git add Frontend/lib/water-level.ts Frontend/components/water-level/
git commit -m "feat(frontend): add water level helpers, status pill, and tank visualizer"
```

---

### Task 5: Frontend — overview page

**Files:**
- Create: `Frontend/app/(dashboard)/_views/water-level-page.tsx`

**Interfaces:**
- Consumes: `useDataStore` (`sensors`, `dmas`, `fetchSensors`, `fetchDMAs`), `useAuthStore` (`currentUser.role`), `WaterStatusPill`, helpers (`WATER_LEVEL_POLL_INTERVAL_MS`, `fillPercent`, `readStoredTankLength`, `tankLengthFor`, `formatRelativeTime`), `cn`, shadcn `Card`/`CardContent`/`Skeleton`, `PageHeader`, lucide `Droplets`/`Gauge`/`MapPin`/`RefreshCw`.
- Produces: default export `WaterLevelPage` — the `/dashboard/water-level` overview. Groups `sensors` by `tankId`, renders one card per tank (name, DMA name, status pill, fill bar, water level m, "updated Xs ago", active sensor count), DMA filter dropdown, 10s polling with visibility pause.

- [ ] **Step 1: Create the view file**

Create `Frontend/app/(dashboard)/_views/water-level-page.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Droplets, Gauge, MapPin, RefreshCw } from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorSnap } from "@/store/data-store"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import {
  WATER_LEVEL_POLL_INTERVAL_MS,
  fillPercent,
  formatRelativeTime,
  readStoredTankLength,
  tankLengthFor,
} from "@/lib/water-level"
import { cn } from "@/lib/utils"

interface TankGroup {
  tankId: string
  tankName: string
  dmaId: string | null
  dmaName: string
  representative: SensorSnap
  sensorCount: number
}

export default function WaterLevelPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { sensors, dmas, fetchSensors, fetchDMAs } = useDataStore()
  const [dmaFilter, setDmaFilter] = useState("")
  const [now, setNow] = useState(() => Date.now())

  const canView =
    currentUser?.role === "admin" ||
    currentUser?.role === "utility_manager" ||
    currentUser?.role === "dma_manager"

  // Initial load + poll
  useEffect(() => {
    void fetchSensors()
    void fetchDMAs()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchSensors()
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    const ticker = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      clearInterval(interval)
      clearInterval(ticker)
    }
  }, [fetchSensors, fetchDMAs])

  const dmaById = useMemo(() => new Map(dmas.map((d) => [d.id, d])), [dmas])

  const tankGroups = useMemo(() => {
    const byTank = new Map<string, TankGroup>()
    for (const sensor of sensors) {
      const group = byTank.get(sensor.tankId)
      if (group) {
        group.sensorCount += 1
        // prefer an activated sensor with the newest reading as the representative
        if (
          sensor.activated &&
          sensor.lastReading &&
          (!group.representative.lastReading ||
            new Date(sensor.lastReading.occurredAt) > new Date(group.representative.lastReading.occurredAt))
        ) {
          group.representative = sensor
        }
      } else {
        const dma = sensor.dmaId ? dmaById.get(sensor.dmaId) : undefined
        byTank.set(sensor.tankId, {
          tankId: sensor.tankId,
          tankName: sensor.tankName || sensor.tankId,
          dmaId: sensor.dmaId,
          dmaName: dma?.name || "Unassigned",
          representative: sensor,
          sensorCount: 1,
        })
      }
    }
    return Array.from(byTank.values())
  }, [sensors, dmaById])

  const dmaOptions = useMemo(() => {
    const names = new Map<string, string>()
    for (const group of tankGroups) {
      const key = group.dmaId || "unassigned"
      if (!names.has(key)) names.set(key, group.dmaName)
    }
    return Array.from(names.entries())
  }, [tankGroups])

  const filteredGroups = useMemo(() => {
    if (!dmaFilter) return tankGroups
    return tankGroups.filter((group) =>
      dmaFilter === "unassigned" ? !group.dmaId : group.dmaId === dmaFilter
    )
  }, [tankGroups, dmaFilter])

  const openTank = useCallback(
    (tankId: string) => router.push(`/dashboard/water-level/${tankId}`),
    [router]
  )

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Water Level Monitoring" description="Access restricted" />
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="mt-1 text-sm text-slate-500">
                  Only admin, utility manager, and DMA manager roles can view water levels.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Water Level Monitoring"
        description="Live tank water levels from connected sensors. Refreshes every 10 seconds."
        actionLabel="Refresh"
        actionIcon={RefreshCw}
        onAction={() => void fetchSensors()}
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={dmaFilter}
            onChange={(e) => setDmaFilter(e.target.value)}
            className={cn(
              "h-10 rounded-xl border bg-slate-50/60 px-3 text-xs font-medium shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-cyan-400/20",
              dmaFilter ? "border-cyan-400/70 text-cyan-700" : "border-slate-200/80 text-slate-500"
            )}
          >
            <option value="">All DMAs</option>
            {dmaOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
            <Gauge className="h-4 w-4" />
            <span>
              {filteredGroups.length} tank{filteredGroups.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Cards */}
      {sensors.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">No tanks found</p>
                <p className="mt-1 text-sm text-slate-500">
                  No monitored tanks match the current filter.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredGroups.map((group) => {
            const sensor = group.representative
            const reading = sensor.lastReading
            const tankLength = tankLengthFor(sensor, readStoredTankLength(group.tankId))
            const percent = reading ? fillPercent(reading.waterLevelM, tankLength) : 0
            return (
              <Card
                key={group.tankId}
                onClick={() => openTank(group.tankId)}
                className="cursor-pointer overflow-hidden rounded-xl border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:shadow-slate-200/60"
              >
                <div className={cn("h-1", sensor.status === "critical" ? "bg-gradient-to-r from-rose-400 to-red-500" : sensor.status === "warning" ? "bg-gradient-to-r from-amber-400 to-orange-500" : sensor.status === "active" ? "bg-gradient-to-r from-cyan-400 to-sky-500" : "bg-slate-200")} />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                        <h3 className="truncate font-semibold text-slate-800">{group.tankName}</h3>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {group.dmaName}
                      </p>
                    </div>
                    <WaterStatusPill status={sensor.status} />
                  </div>

                  <div className="mt-4">
                    <div className="flex items-end justify-between text-sm">
                      <div>
                        <p className="text-xs text-slate-500">Water level</p>
                        <p className="font-semibold text-slate-800">
                          {reading ? `${reading.waterLevelM.toFixed(2)} m` : "—"}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-slate-500">{percent.toFixed(0)}%</span>
                    </div>
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-700",
                          sensor.status === "critical"
                            ? "bg-gradient-to-r from-rose-400 to-red-500"
                            : sensor.status === "warning"
                              ? "bg-gradient-to-r from-amber-400 to-orange-500"
                              : sensor.status === "active"
                                ? "bg-gradient-to-r from-cyan-400 to-sky-500"
                                : "bg-slate-300"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span>{reading ? `Updated ${formatRelativeTime(reading.occurredAt, now)}` : "No readings yet"}</span>
                    <span>{group.sensorCount} sensor{group.sensorCount !== 1 ? "s" : ""}</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

Note: `cn` is used by the card/fill classes; `Skeleton` by the loading state. All imports above are used.

- [ ] **Step 2: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit** (skip if no git repo)

```bash
git add "Frontend/app/(dashboard)/_views/water-level-page.tsx"
git commit -m "feat(frontend): add water level monitoring overview page"
```

---

### Task 6: Frontend — tank detail page

**Files:**
- Create: `Frontend/app/(dashboard)/_views/water-level-tank-detail-page.tsx`

**Interfaces:**
- Consumes: `useParams` from `next/navigation` (segment `tankId`), `useDataStore` (`sensors`, `tankReadingsByTank`, `fetchSensors`, `fetchTankReadings`), `WaterLevelTank`, `WaterStatusPill`, helpers (`WATER_LEVEL_POLL_INTERVAL_MS`, `READING_HISTORY_LIMIT`, `readStoredTankLength`, `stashTankLength`, `tankLengthFor`), `formatTanzaniaDateTime` from `@/lib/date-time`, shadcn `Card`/`CardContent`/`Button`/`Input`, lucide `ArrowLeft`/`Droplets`/`Ruler`/`Gauge`/`TrendingUp`/`Clock`/`Activity`/`Calendar`.
- Produces: default export `WaterLevelTankDetailPage` — the `/dashboard/water-level/[tankId]` detail view. Finds the tank's sensors, renders the visualizer, metrics grid (current height, editable tank length persisted to localStorage, h1, h2, avg, max, total readings), and a newest-first readings table (Time, height m, height ft, h1, h2, status pill). 10s polling of both sensors and readings.

- [ ] **Step 1: Create the view file**

Create `Frontend/app/(dashboard)/_views/water-level-tank-detail-page.tsx`:

```tsx
"use client"

import type { ChangeEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Activity, ArrowLeft, Calendar, Clock, Droplets, Gauge, Ruler, TrendingUp } from "lucide-react"
import { useDataStore, type SensorSnap, type TankReading } from "@/store/data-store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WaterLevelTank } from "@/components/water-level/water-level-tank"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import {
  READING_HISTORY_LIMIT,
  WATER_LEVEL_POLL_INTERVAL_MS,
  readStoredTankLength,
  stashTankLength,
  tankLengthFor,
} from "@/lib/water-level"

export default function WaterLevelTankDetailPage() {
  const router = useRouter()
  const params = useParams<{ tankId: string }>()
  const tankId = Array.isArray(params?.tankId) ? params.tankId[0] : params?.tankId

  const { sensors, tankReadingsByTank, fetchSensors, fetchTankReadings } = useDataStore()

  const [lengthOverride, setLengthOverride] = useState<number | null>(() =>
    tankId ? readStoredTankLength(tankId) : null
  )

  useEffect(() => {
    if (!tankId) return
    void fetchSensors()
    void fetchTankReadings(tankId, READING_HISTORY_LIMIT)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSensors()
        void fetchTankReadings(tankId, READING_HISTORY_LIMIT)
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [tankId, fetchSensors, fetchTankReadings])

  const tankSensors = useMemo(
    () => sensors.filter((s) => s.tankId === tankId),
    [sensors, tankId]
  )

  const representative: SensorSnap | undefined = useMemo(() => {
    return (
      tankSensors.find((s) => s.activated && s.lastReading) ??
      tankSensors.find((s) => s.activated) ??
      tankSensors[0]
    )
  }, [tankSensors])

  const readings: TankReading[] = useMemo(
    () => tankReadingsByTank[tankId ?? ""] ?? [],
    [tankReadingsByTank, tankId]
  )

  const latest = representative?.lastReading ?? null
  const status = latest?.status ?? representative?.status ?? "inactive"
  const tankName = representative?.tankName || tankId || "Tank"
  const tankLength = representative
    ? tankLengthFor(representative, lengthOverride)
    : lengthOverride || 2

  const summary = useMemo(() => {
    const heights = readings.map((r) => r.waterLevelM)
    return {
      avg: heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0,
      max: heights.length ? Math.max(...heights) : 0,
      min: heights.length ? Math.min(...heights) : 0,
    }
  }, [readings])

  if (!representative) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Tank not found</p>
                <p className="mt-1 text-sm text-slate-500">
                  This tank has no registered sensors or is outside your scope.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push("/dashboard/water-level")}
                className="mt-2 rounded-xl"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to monitoring
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  function handleLengthChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Number.parseFloat(event.target.value)
    if (!Number.isFinite(next) || next <= 0 || !tankId) return
    const normalized = Number.parseFloat(next.toFixed(2))
    setLengthOverride(normalized)
    stashTankLength(tankId, normalized)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard/water-level")}
          className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to monitoring
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">{tankName}</h1>
          <WaterStatusPill status={status} />
        </div>
        <p className="text-sm text-slate-500">
          Detailed readings, sensor hanging length, h2 reading, and live tank level.
        </p>
      </div>

      {/* Visualizer + metrics */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <WaterLevelTank
          tankName={tankName}
          waterHeightM={latest?.waterLevelM ?? 0}
          tankDepthM={tankLength}
          sensorHangingM={representative.h1M ?? 0}
          sensorDepthM={latest?.depthM ?? representative.depthM ?? 0}
          status={status}
          readingCount={readings.length}
          lastReadingLabel={latest ? formatTanzaniaDateTime(latest.occurredAt) : "No readings yet"}
        />

        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Current height</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(latest?.waterLevelM ?? 0).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Ruler className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Tank length</span>
                <label className="ml-auto flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={tankLength}
                    onChange={handleLengthChange}
                    className="h-8 w-20 rounded-lg px-2 text-right text-sm"
                  />
                  <strong className="text-sm font-semibold text-slate-800">m</strong>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Ruler className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor h1</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(representative.h1M ?? 0).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Gauge className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor h2</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(latest?.depthM ?? representative.depthM ?? 0).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Activity className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Average height</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {summary.avg.toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <TrendingUp className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Maximum height</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {summary.max.toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Total readings</span>
                <strong className="ml-auto font-semibold text-slate-800">{readings.length}</strong>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Readings table */}
      <Card className="border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-slate-800">Recent readings</h2>
          </div>
          {readings.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No readings found for this tank.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="pb-3 pr-4 font-medium">Time</th>
                    <th className="pb-3 pr-4 font-medium">Water height</th>
                    <th className="pb-3 pr-4 font-medium">Height (ft)</th>
                    <th className="pb-3 pr-4 font-medium">h1</th>
                    <th className="pb-3 pr-4 font-medium">h2</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.slice(0, 30).map((reading) => (
                    <tr key={reading.readingId} className="border-b border-slate-50 last:border-0">
                      <td className="py-3 pr-4 text-slate-600">
                        {formatTanzaniaDateTime(reading.occurredAt)}
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-800">
                        {reading.waterLevelM.toFixed(2)}m
                      </td>
                      <td className="py-3 pr-4 text-slate-500">
                        {(reading.waterLevelM * 3.28084).toFixed(2)}ft
                      </td>
                      <td className="py-3 pr-4 text-slate-500">{reading.h1M.toFixed(2)}m</td>
                      <td className="py-3 pr-4 text-slate-500">{reading.depthM.toFixed(2)}m</td>
                      <td className="py-3">
                        <WaterStatusPill status={reading.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build (full app)**

Run: `cd Frontend && npm run build`
Expected: build succeeds, including the two new routes `/dashboard/water-level` and `/dashboard/water-level/[tankId]`.

- [ ] **Step 4: Commit** (skip if no git repo)

```bash
git add "Frontend/app/(dashboard)/_views/water-level-tank-detail-page.tsx"
git commit -m "feat(frontend): add water level tank detail page"
```

---

### Task 7: End-to-end smoke verification

**Files:** (no code changes — verification only)

- [x] **Step 1: Full backend suite**

Run: `cd Backend && source venv/bin/activate && pytest tests/ -v`
Expected: all tests pass (sensor tests now include `TestTankReadings`).
VERIFIED: 86 passed.

- [x] **Step 2: Typecheck + build**

Run: `cd Frontend && npx tsc --noEmit && npm run build`
Expected: clean typecheck and successful production build.
VERIFIED: tsc 0 errors; build lists both routes.

- [x] **Step 3: Manual smoke against Postgres**

With the dev server running against the Phase 1 Postgres DB, as an admin/utility_manager/dma_manager user:
1. Visit `/dashboard/water-level` — expect tank cards (or empty state) and the nav item present.
2. Verify the DMA filter dropdown lists DMAs.
3. Click a tank card → `/dashboard/water-level/{tankId}` — expect visualizer, metrics, readings table.
4. Change the tank-length input → refresh → the value persists (localStorage).
5. Confirm the page auto-refreshes within ~10s when new readings are ingested via `/api/sensors/ingest`.
VERIFIED in browser by user: tank cards + nav present, DMA filter lists DMAs, detail page shows visualizer/metrics/readings table (Smoke Test Tank 80% full, warning, 3 readings), tank-length persists across refresh (localStorage), page auto-refreshes on ingest within ~10s.

- [x] **Step 4: Update spec status**

In `docs/superpowers/specs/2026-08-17-water-level-monitoring-phase2.md`, change `Status: Draft` → `Status: Implemented` after the above checks pass.

- [x] **Step 5: Commit** (skip if no git repo)

```bash
git add docs/superpowers/specs/2026-08-17-water-level-monitoring-phase2.md
git commit -m "docs(spec): mark water level monitoring phase 2 implemented"
```
SKIPPED — no git repo anywhere in the workspace.

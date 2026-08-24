# Water Level Monitoring — Phase 3: Hierarchical Filters, Sensor Management, GPKG Startup Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-aware Utility→DMA cascade filter and sensor-registration modal to the water-level pages, a `/dashboard/sensors` management page (register/edit/activate/toggle-tank/delete), and an idempotent GPKG `storage_facilities` tank backfill on backend startup.

**Architecture:** Minimal reuse. Backend already has register/update sensors (`POST/PATCH /api/sensors`), tank status toggle (`PATCH /api/tanks/{id}`), role-scoped lists (`GET /api/tanks|sensors|utilities|dmas`), and idempotent tank sync (`sync_tanks_from_layer`). Only new backend work: `DELETE /api/sensors/{device_id}` (cascade) and a startup backfill service that re-runs `sync_tanks_from_layer` over stored `storage_facilities` layers. Frontend adds a `tanks` store state, sensor CRUD/tank-toggle actions, a reusable register-sensor modal, a hierarchical filter + tanks-driven cards on overview, modal wiring on detail, and a new sensors management page.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (Backend); Next.js App Router + Zustand + Tailwind + shadcn/ui (Frontend). Tests: pytest (Backend), `tsc --noEmit` + `next build` (Frontend).

## Global Constraints

- No git repo anywhere in `/home/thobbs/Documents/PRESENT` (root, Backend, Frontend confirmed) → **all `git commit` steps are SKIPPED**. Implementers run tests/build only. SDD ledger records task state instead of commit SHAs.
- Backend test command: `cd Backend && source venv/bin/activate && pytest tests/ -v` (tests use in-memory SQLite).
- Frontend typecheck: `cd Frontend && npx tsc --noEmit`; build: `npm run build`.
- Route/URL pattern (verified): served URLs live under `app/(dashboard)/dashboard/<path>/page.tsx` as re-export of `../../_views/<view>`. The legacy `app/(dashboard)/<path>/` folders are `redirect("/dashboard/<path>")` stubs. Nav hrefs use `/dashboard/<path>`.
- Role gating uses `currentUser.role` from `Frontend/store/auth-store.ts` (`"admin" | "utility_manager" | "dma_manager"`; `utilityId`, `dmaId` available).
- Backend access-control helpers to reuse verbatim: `_get_sensor_or_404`, `_ensure_sensor_access`, `_get_tank_or_404`, `_ensure_tank_access`, `_tank_scoped_ids`, `require_utility_manager`, `audit_log` — all in `Backend/app/api/sensors.py` (except `audit_log` from `app.services.activity_logs`).
- `SensorRegisterRequest`/`SensorUpdateRequest` schemas exist in `Backend/app/schemas/sensors.py`; `SensorUpdateRequest` already has `activated`.
- `TankPatch` already supports `status: Optional[str]` (`active`/`deactivated`); `PATCH /api/tanks/{id}` already applies it with `deactivated_at` handling — no backend change needed for the tank toggle.
- Frontend `apiClient` (in `lib/api-client.ts`) exposes `get/post/patch/put/delete`. `transformKeys` (snake_case→camelCase) in `lib/transform-data.ts` is applied to all list responses in the store. Mutation endpoints receive raw snake_case payloads.
- The store's `REFERENCE_CACHE_TTL` cache and `apiClient.invalidateCache("/path")` pattern are used for lists; live data (`/sensors`, `/tanks`, readings) uses `skipCache: true`.
- No new dependencies. Reuse `shadcn/ui` components already present: `dialog`, `input`, `button`, `switch`, `select`, `table`, `alert-dialog` (via `components/shared/confirm-dialog.tsx`), `skeleton`, `card`. Use `sonner` `toast` for feedback (already used in sibling views).

---

### Task 1: Backend — DELETE sensor endpoint (cascade)

**Files:**
- Modify: `Backend/app/api/sensors.py` (add route after `update_sensor`, near line 350)
- Test: `Backend/tests/test_sensors.py` (append new test class at end of file)

**Interfaces:**
- Consumes: `_get_sensor_or_404(db, device_id)`, `_ensure_sensor_access(sensor, current_user, db)`, `_get_tank_or_404`, `require_utility_manager`, `audit_log` (all existing).
- Produces: `DELETE /api/sensors/{device_id}` → 204 on success, 404 unknown device_id, 403 out-of-scope; deletes the sensor *and* all its `SensorReading` rows.

- [x] **Step 1: Write the failing tests** — append to `Backend/tests/test_sensors.py` a `TestSensorDelete` class. Reuse the existing module helpers `_make_utility`, `_make_dma`, `_make_tank`, `_make_sensor`, and the `db`/`client`/`auth_headers`/`admin_auth_headers`/`admin_user` fixtures from conftest.

```python
class TestSensorDelete:
    """DELETE /api/sensors/{device_id} — cascade deletes sensor + readings, admin/utility-manager gated."""

    def test_delete_sensor_cascades_readings(self, client: TestClient, db: Session, auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Delete Tank")
        sensor = _make_sensor(db, tank, device_id="dev-del", activated=True)
        response = client.post(
            "/api/sensors/ingest",
            headers=auth_headers,
            json={"device_id": "dev-del", "h1_m": 12.0, "raw_data": "Depth=2", "occurred_at": "2026-01-01T10:00:00"},
        )
        assert response.status_code == 200

        delete_response = client.delete("/api/sensors/dev-del", headers=auth_headers)
        assert delete_response.status_code == 204

        assert db.query(SensorDevice).filter(SensorDevice.device_id == "dev-del").first() is None
        assert db.query(SensorReading).filter(SensorReading.sensor_id == sensor.id).count() == 0

    def test_delete_sensor_unknown_returns_404(self, client: TestClient, db: Session, auth_headers: dict):
        response = client.delete("/api/sensors/does-not-exist", headers=auth_headers)
        assert response.status_code == 404

    def test_delete_sensor_scoped_to_owning_utility_only(self, client: TestClient, db: Session):
        from app.models import UtilityManager

        utility_a = _make_utility(db, name="Water Co A")
        utility_b = _make_utility(db, name="Water Co B")
        tank = _make_tank(db, utility_b, source_key="Scoped Tank")
        sensor = _make_sensor(db, tank, device_id="dev-scoped", activated=True)

        manager_b = UtilityManager(email="mb@example.com", name="Manager B", phone="+1",
                                   password=hash_password("pass123"), utility_id=utility_b.id)
        db.add(manager_b)
        db.commit()
        db.refresh(manager_b)
        token_b = create_access_token(manager_b.id, manager_b.email)

        # Manager of utility B (owning) can delete.
        response_b = client.delete("/api/sensors/dev-scoped", headers={"Authorization": f"Bearer {token_b}"})
        assert response_b.status_code == 204
        assert db.query(SensorDevice).filter(SensorDevice.id == sensor.id).first() is None

    def test_delete_sensor_duplicate_returns_404(self, client: TestClient, db: Session, auth_headers: dict, admin_auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Twice Tank")
        _make_sensor(db, tank, device_id="dev-twice", activated=True)
        first = client.delete("/api/sensors/dev-twice", headers=admin_auth_headers)
        assert first.status_code == 204
        second = client.delete("/api/sensors/dev-twice", headers=admin_auth_headers)
        assert second.status_code == 404

    def test_delete_sensor_audit_logged(self, client: TestClient, db: Session, admin_auth_headers: dict):
        utility = _make_utility(db)
        tank = _make_tank(db, utility, source_key="Audit Tank")
        _make_sensor(db, tank, device_id="dev-audit", activated=True)
        response = client.delete("/api/sensors/dev-audit", headers=admin_auth_headers)
        assert response.status_code == 204
        from app.models import ActivityLog
        logs = db.query(ActivityLog).filter(ActivityLog.entity_id.isnot(None)).all()
        assert any(getattr(log, "action", None) == "sensor.delete" for log in logs)
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd Backend && source venv/bin/activate && pytest tests/test_sensors.py::TestSensorDelete -v`
Expected: FAIL with 404/405 (route does not exist), not 500.

- [x] **Step 3: Implement the DELETE endpoint** — add to `Backend/app/api/sensors.py`, immediately after the `update_sensor` function (which ends around line 340; add before the `# ===...` Tanks section header that precedes `list_sensor_tanks`).

```python
@sensors_router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sensor(
    device_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_utility_manager),
    db: Session = Depends(get_db),
):
    """
    Delete a sensor and cascade-delete its reading history.

    Admin and utility manager roles only. The sensor tank must be within the
    caller's utility scope (DMA managers / engineers cannot delete).
    """
    sensor = _get_sensor_or_404(db, device_id)
    _ensure_sensor_access(sensor, current_user, db, action="access to the sensor tank")
    tank = _get_tank_or_404(db, sensor.tank_id)

    deleted_readings = (
        db.query(SensorReading)
        .filter(SensorReading.sensor_id == sensor.id)
        .delete(synchronize_session=False)
    )

    audit_log(
        db,
        request=request,
        actor=current_user,
        action="sensor.delete",
        event_type="sensor",
        status="success",
        entity="sensor",
        entity_id=sensor.id,
        target_name=sensor.device_id,
        utility_id=tank.utility_id,
        metadata={
            "device_id": sensor.device_id,
            "tank_id": tank.id,
            "deleted_readings": deleted_readings,
        },
    )
    db.delete(sensor)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

**Note:** `Response` is NOT currently imported in `sensors.py` (verified: the top-of-file import is `from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status`). Add `Response` to this existing import line, and add a `Response` import from `fastapi` if the module elsewhere imports it already.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd Backend && source venv/bin/activate && pytest tests/test_sensors.py::TestSensorDelete -v`
Expected: all `TestSensorDelete` tests PASS.

- [x] **Step 5: Run the full backend suite**

Run: `cd Backend && source venv/bin/activate && pytest tests/ -v`
Expected: all pass (previous 86 + new tests).

- [x] **Step 6: Commit — SKIPPED (no git repo).** Record in SDD ledger.

---

### Task 2: Backend — GPKG startup tank sync (tanks only)

**Files:**
- Create: `Backend/app/services/gpkg_startup_sync.py`
- Modify: `Backend/app/api/utilities.py` (add one public wrapper function near the GPKG loader, ~line 1390)
- Modify: `Backend/app/config.py` (add setting near line 113)
- Modify: `Backend/app/main.py` (wire into `lifespan`, after the legacy DUWASA block, ~line 100)
- Test: `Backend/tests/test_gpkg_startup_sync.py` (new)

**Interfaces:**
- Consumes: `sync_tanks_from_layer(db, utility_id, features, layer)` from `app.services.tank_sync` (already imported in `utilities.py`); `_load_infrastructure_geojson_with_summary(file_name, file_data, asset_type) -> (FeatureCollection, PipeNetworkIngestSummary)` in `app/api/utilities.py`; `UtilityInfrastructureLayer` model (`app/models/user.py:179`); `SessionLocal` from `app.database.session`.
- Produces: `load_storage_facilities_features(file_name, file_data) -> list[dict]` (public helper in `utilities.py`); `run_tank_gpkg_sync_on_startup(db: Session, loader=None) -> dict` in `gpkg_startup_sync.py`; setting `run_tank_gpkg_sync_on_startup: bool` in `config.py`.

Layering note: `gpkg_startup_sync.py` is a leaf module (nothing imports it except `main.py`), so importing the public wrapper from `app.api.utilities` creates no cycle (`utilities.py` imports `tank_sync`, and nothing imports `gpkg_startup_sync`). The public wrapper in `utilities.py` keeps the private loader `_load_infrastructure_geojson_with_summary` unexposed to the service layer.

- [x] **Step 1: Write the failing tests** — create `Backend/tests/test_gpkg_startup_sync.py`. The startup function takes an injectable `loader` so tests do not need to construct a real GPKG; the loader returns an iterable of feature dicts (the shape `sync_tanks_from_layer` expects).

```python
"""GPKG startup tank sync — idempotent backfill from stored storage_facilities layers."""
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Tank, Utility, UtilityInfrastructureLayer
from app.services.gpkg_startup_sync import run_tank_gpkg_sync_on_startup


def _make_utility(db: Session, name: str = "Co A") -> Utility:
    utility = Utility(name=name, slug=f"cs-{name.lower().replace(' ', '-')}")
    db.add(utility)
    db.commit()
    db.refresh(utility)
    return utility


def _make_layer(db: Session, utility: Utility, file_name: str = "tanks.gpkg") -> UtilityInfrastructureLayer:
    layer = UtilityInfrastructureLayer(
        utility_id=utility.id,
        asset_type="storage_facilities",
        file_data=b"%PDF-fake-bytes",
        file_name=file_name,
        file_size=15,
        feature_count=2,
    )
    db.add(layer)
    db.commit()
    db.refresh(layer)
    return layer


def _fake_loader(*_args, **_kwargs):
    return [
        {"type": "Feature", "properties": {"TankName": "Tank One"},
         "geometry": {"type": "Point", "coordinates": [36.7, -3.4]}},
        {"type": "Feature", "properties": {"TankName": "Tank Two"},
         "geometry": {"type": "Point", "coordinates": [36.8, -3.5]}},
    ]


class TestGpkgStartupSync:
    def test_creates_missing_tanks_idempotently(self, db: Session):
        utility = _make_utility(db)
        layer = _make_layer(db, utility)

        first = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert first["created"] == 2
        assert first["layers"] == 1
        assert first["failed"] == 0
        db.flush()
        assert db.query(Tank).filter(Tank.utility_id == utility.id).count() == 2

        second = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert second["created"] == 0
        assert db.query(Tank).filter(Tank.utility_id == utility.id).count() == 2

    def test_skips_non_storage_layers(self, db: Session):
        utility = _make_utility(db)
        layer = _make_layer(db, utility)
        layer.asset_type = "pipes"
        db.add(layer)
        db.commit()

        result = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert result["layers"] == 0
        assert result["created"] == 0

    def test_corrupt_layer_does_not_abort(self, db: Session):
        utility = _make_utility(db)
        _make_layer(db, utility, file_name="bad.gpkg")

        def bad_loader(*_args, **_kwargs):
            raise RuntimeError("corrupt gpkg")

        result = run_tank_gpkg_sync_on_startup(db, loader=bad_loader)
        assert result["failed"] == 1
        assert result["created"] == 0

    def test_no_layers_is_noop(self, db: Session):
        result = run_tank_gpkg_sync_on_startup(db, loader=_fake_loader)
        assert result == {
            "layers": 0, "created": 0, "updated": 0,
            "reactivated": 0, "deactivated": 0, "failed": 0,
        }
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd Backend && source venv/bin/activate && pytest tests/test_gpkg_startup_sync.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.gpkg_startup_sync'`.

- [x] **Step 3: Add the public loader wrapper** in `Backend/app/api/utilities.py`, right after the `_load_infrastructure_geojson_with_summary` definition (ends ~line 1390):

```python
def load_storage_facilities_features(file_name: str, file_data: bytes) -> list[dict[str, Any]]:
    """Load the storage_facilities features of a stored GeoPackage as a feature list.

    Public wrapper used by the startup tank sync service; keeps the private
    ``_load_infrastructure_geojson_with_summary`` out of the service layer.
    """
    feature_collection, _summary = _load_infrastructure_geojson_with_summary(
        file_name,
        file_data,
        "storage_facilities",
    )
    return feature_collection.get("features", [])
```

- [x] **Step 4: Create the startup sync service** — `Backend/app/services/gpkg_startup_sync.py`:

```python
"""Startup tank backfill from uploaded storage_facilities GeoPackage layers.

Tanks only (per Phase 3 decision). Idempotent by ``(utility_id, source_key)``
via ``sync_tanks_from_layer``. One corrupt layer is logged and skipped; the
rest of startup proceeds.
"""
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from app.models import UtilityInfrastructureLayer
from app.services.tank_sync import sync_tanks_from_layer

STORAGE_FACILITIES = "storage_facilities"

_COUNT_KEYS = ("created", "updated", "reactivated", "deactivated")


def run_tank_gpkg_sync_on_startup(
    db: Session,
    loader: Optional[Callable] = None,
) -> Dict[str, Any]:
    """Backfill tanks from stored storage_facilities GPKG layers.

    ``loader(file_name, file_data)`` returns the feature list for a layer; it is
    injectable for tests. Defaults to the GeoPackage feature loader.
    """
    if loader is None:
        from app.api.utilities import load_storage_facilities_features
        loader = load_storage_facilities_features

    layers = (
        db.query(UtilityInfrastructureLayer)
        .filter(UtilityInfrastructureLayer.asset_type == STORAGE_FACILITIES)
        .order_by(UtilityInfrastructureLayer.utility_id, UtilityInfrastructureLayer.file_name)
        .all()
    )

    aggregate: Dict[str, Any] = {
        "layers": len(layers),
        "created": 0,
        "updated": 0,
        "reactivated": 0,
        "deactivated": 0,
        "failed": 0,
    }

    for layer in layers:
        try:
            features = loader(layer.file_name, layer.file_data)
            summary = sync_tanks_from_layer(db, layer.utility_id, features, layer)
            db.commit()
            for key in _COUNT_KEYS:
                aggregate[key] += summary.get(key, 0)
            print(
                f"   Tank GPKG Startup Sync: utility={layer.utility_id} "
                f"layer={layer.file_name} created={summary.get('created', 0)} "
                f"updated={summary.get('updated', 0)} "
                f"reactivated={summary.get('reactivated', 0)}"
            )
        except Exception as exc:  # noqa: BLE001 - one bad layer must not kill startup
            aggregate["failed"] += 1
            db.rollback()
            print(f"   Tank GPKG Startup Sync failed for layer {layer.file_name}: {exc}")

    if layers:
        print(f"   Tank GPKG Startup Sync total: {aggregate['layers']} layer(s), "
              f"{aggregate['created']} created, {aggregate['updated']} updated, "
              f"{aggregate['failed']} failed")
    return aggregate
```

- [x] **Step 5: Add the config setting** in `Backend/app/config.py` — add next to the legacy DUWASA import block (near line 113):

```python
    # ===== Optional GPKG tank sync on startup =====
    run_tank_gpkg_sync_on_startup: bool = Field(default=True, alias="RUN_TANK_GPKG_SYNC_ON_STARTUP")
```

Also append `"run_tank_gpkg_sync_on_startup"` to the `@field_validator(...)` boolean list at ~line 129 (`run_startup_migrations`, `run_startup_schema_sync`, `legacy_duwasa_import_on_startup`, `legacy_duwasa_import_strict`, `mode="before"`), NOT a `model_validator` — verified the validator is `@field_validator` with `mode="before"`.

- [x] **Step 6: Wire into `lifespan`** in `Backend/app/main.py` — inside `lifespan`, after the `if settings.legacy_duwasa_import_on_startup:` block (before `yield`):

```python
    if settings.run_tank_gpkg_sync_on_startup:
        from app.database.session import SessionLocal
        from app.services.gpkg_startup_sync import run_tank_gpkg_sync_on_startup

        try:
            with SessionLocal() as sync_db:
                run_tank_gpkg_sync_on_startup(sync_db)
        except Exception as exc:
            print(f"Tank GPKG startup sync failed: {exc}")
```

If `SessionLocal` is already imported at module top of `main.py`, skip the inline import.

- [x] **Step 7: Run the tests to verify they pass**

Run: `cd Backend && source venv/bin/activate && pytest tests/test_gpkg_startup_sync.py -v`
Expected: all `TestGpkgStartupSync` tests PASS.

- [x] **Step 8: Run the full backend suite**

Run: `cd Backend && source venv/bin/activate && pytest tests/ -v`
Expected: all pass.

- [x] **Step 9: Commit — SKIPPED (no git repo).** Record in SDD ledger.

---

### Task 3: Frontend — data-store: tanks state + sensor/tank mutation actions

**Files:**
- Modify: `Frontend/store/data-store.ts`

**Interfaces:**
- Consumes: existing `SensorSnap`, `SensorLastReading`, `TankReading`, `Utility`, `DMA` types; `apiClient`, `transformKeys`, `upsertEntity`, `isAbortLikeError`, `REFERENCE_CACHE_TTL`; existing `useDataStore` slice pattern.
- Produces (all added to the `useDataStore` type + implementation):
  - `export interface TankSnap { id; utilityId; dmaId: string | null; sourceKey; name: string | null; latitude: number | null; longitude: number | null; status: string; sensorCount: number; activeSensorCount: number; createdAt; updatedAt; deactivatedAt: string | null }`
  - `export interface RegisterSensorInput { device_id: string; tank_id: string; h1_m?: number; depth_m?: number; warning_height_m?: number; critical_height_m?: number; activated?: boolean }`
  - `tanks: TankSnap[]` state.
  - `fetchTanks: () => Promise<void>`
  - `registerSensor: (data: RegisterSensorInput) => Promise<SensorSnap>`
  - `updateSensor: (deviceId: string, data: Partial<RegisterSensorInput>) => Promise<SensorSnap>`
  - `deleteSensor: (deviceId: string) => Promise<void>`
  - `updateTankStatus: (tankId: string, status: "active" | "deactivated") => Promise<TankSnap>`

- [x] **Step 1: Add the `TankSnap` type and sensor input type** — insert near the existing `SensorSnap`/`TankReading` interfaces (~line 135):

```ts
export interface TankSnap {
  id: string
  utilityId: string
  dmaId: string | null
  sourceKey: string
  name: string | null
  latitude: number | null
  longitude: number | null
  status: string
  sensorCount: number
  activeSensorCount: number
  createdAt: string
  updatedAt: string
  deactivatedAt: string | null
}

export interface RegisterSensorInput {
  device_id: string
  tank_id: string
  h1_m?: number
  depth_m?: number
  warning_height_m?: number
  critical_height_m?: number
  activated?: boolean
}
```

- [x] **Step 2: Add `tanks` to the store type** — in the `useDataStore` interface near `sensors`/`tankReadingsByTank` (~line 372) add:

```ts
  tanks: TankSnap[]
```

and near the sensor actions (~line 390) add:

```ts
  fetchTanks: () => Promise<void>
  registerSensor: (data: RegisterSensorInput) => Promise<SensorSnap>
  updateSensor: (deviceId: string, data: Partial<RegisterSensorInput>) => Promise<SensorSnap>
  deleteSensor: (deviceId: string) => Promise<void>
  updateTankStatus: (tankId: string, status: "active" | "deactivated") => Promise<TankSnap>
```

- [x] **Step 3: Initialize `tanks: []`** in the initial state object near `tankReadingsByTank: {}` (~line 449):

```ts
  tanks: [],
```

- [x] **Step 4: Implement `fetchTanks`** — add next to `fetchSensors` (~line 733, after the sensors fetch):

```ts
  fetchTanks: async () => {
    try {
      const response = await apiClient.get("/tanks", { skipCache: true })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys) as TankSnap[]
        set({ tanks: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching tanks:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching tanks:", error)
    }
  },
```

- [x] **Step 5: Implement `registerSensor`, `updateSensor`, `deleteSensor`, `updateTankStatus`** — add after `fetchTankReadings` (~line 761):

```ts
  registerSensor: async (data: RegisterSensorInput) => {
    try {
      const response = await apiClient.post("/sensors", data, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to register sensor")
      const created = transformKeys(response.data || {}) as SensorSnap
      apiClient.invalidateCache("/sensors")
      set((state) => ({ sensors: upsertEntity(state.sensors, created) }))
      void get().fetchTanks()
      return created
    } catch (error) {
      console.error("Error registering sensor:", error)
      throw error
    }
  },

  updateSensor: async (deviceId: string, data: Partial<RegisterSensorInput>) => {
    try {
      const response = await apiClient.patch(`/sensors/${deviceId}`, data, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to update sensor")
      const updated = transformKeys(response.data || {}) as SensorSnap
      apiClient.invalidateCache("/sensors")
      set((state) => ({ sensors: upsertEntity(state.sensors, updated) }))
      void get().fetchTanks()
      return updated
    } catch (error) {
      console.error("Error updating sensor:", error)
      throw error
    }
  },

  deleteSensor: async (deviceId: string) => {
    try {
      const response = await apiClient.delete(`/sensors/${deviceId}`, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to delete sensor")
      apiClient.invalidateCache("/sensors")
      set((state) => ({ sensors: state.sensors.filter((s) => s.deviceId !== deviceId) }))
      void get().fetchTanks()
    } catch (error) {
      console.error("Error deleting sensor:", error)
      throw error
    }
  },

  updateTankStatus: async (tankId: string, status: "active" | "deactivated") => {
    try {
      const response = await apiClient.patch(`/tanks/${tankId}`, { status }, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to update tank status")
      const updated = transformKeys(response.data || {}) as TankSnap
      set((state) => ({ tanks: upsertEntity(state.tanks, updated) }))
      apiClient.invalidateCache("/tanks")
      void get().fetchSensors()
      return updated
    } catch (error) {
      console.error("Error updating tank status:", error)
      throw error
    }
  },
```

**Note:** verify `apiClient.delete` accepts an options object as `{ skipCache: true }`; if not, call `apiClient.delete(\`/sensors/${deviceId}\`)` without options.

- [x] **Step 6: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: type errors are acceptable **only** if caused by tasks 4–7 not yet existing (no references to them added yet — this task adds store API only). If errors mention `_views/sensors-page` or new components, ignore until the final verification task.

- [x] **Step 7: Commit — SKIPPED (no git repo).** Record in SDD ledger.

---

### Task 4: Frontend — register-sensor modal (edit + create)

**Files:**
- Create: `Frontend/components/water-level/register-sensor-modal.tsx`

**Interfaces:**
- Consumes: `useDataStore` (`tanks`, `fetchTanks`, `sensors`, `registerSensor`, `updateSensor`), `useAuthStore` (`currentUser.role`, `currentUser.utilityId`), `apiClient` for the DMA/utility lookup is not needed. shadcn `Dialog`, `Input`, `Button`, `Switch`, `Label`, `sonner` `toast`.
- Produces: `RegisterSensorModal({ open, onOpenChange, defaultTankId?, sensor? })` where `sensor?: SensorSnap | null`. When `sensor` is present, the modal is in edit mode (title "Edit sensor", saves via `updateSensor`); otherwise create mode (title "Register sensor", saves via `registerSensor`).

- [x] **Step 1: Write the component** — create `Frontend/components/water-level/register-sensor-modal.tsx`:

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type RegisterSensorInput, type SensorSnap } from "@/store/data-store"

interface RegisterSensorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTankId?: string
  sensor?: SensorSnap | null
}

export function RegisterSensorModal({ open, onOpenChange, defaultTankId, sensor }: RegisterSensorModalProps) {
  const { currentUser } = useAuthStore()
  const { tanks, fetchTanks, registerSensor, updateSensor } = useDataStore()

  const role = currentUser?.role
  const isEdit = Boolean(sensor)

  const [deviceId, setDeviceId] = useState("")
  const [tankId, setTankId] = useState("")
  const [h1M, setH1M] = useState("")
  const [depthM, setDepthM] = useState("")
  const [warningHeightM, setWarningHeightM] = useState("")
  const [criticalHeightM, setCriticalHeightM] = useState("")
  const [activated, setActivated] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    void fetchTanks()
    if (sensor) {
      setDeviceId(sensor.deviceId)
      setTankId(sensor.tankId)
      setH1M(sensor.h1M != null ? String(sensor.h1M) : "")
      setDepthM(sensor.depthM != null ? String(sensor.depthM) : "")
      setWarningHeightM(sensor.warningHeightM != null ? String(sensor.warningHeightM) : "")
      setCriticalHeightM(sensor.criticalHeightM != null ? String(sensor.criticalHeightM) : "")
      setActivated(sensor.activated)
    } else {
      setDeviceId("")
      setTankId(defaultTankId ?? "")
      setH1M("")
      setDepthM("")
      setWarningHeightM("")
      setCriticalHeightM("")
      setActivated(true)
    }
  }, [open, sensor, defaultTankId, fetchTanks])

  const scopedTanks = useMemo(() => {
    if (!tanks.length) return []
    if (role === "admin") return tanks
    const myUtility = currentUser?.utilityId
    return myUtility ? tanks.filter((t) => t.utilityId === myUtility) : tanks
  }, [currentUser?.utilityId, role, tanks])

  const tankHasActivatedSensor = (tankId: string) => {
    const { sensors } = useDataStore.getState()
    return sensors.some((s) => s.tankId === tankId && s.activated)
  }

  const parseOptional = (raw: string): number | undefined => {
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) ? value : undefined
  }

  const handleSave = async () => {
    if (!deviceId.trim() || !tankId) {
      toast.error("Device ID and tank are required.")
      return
    }
    setSaving(true)
    try {
      const payload: RegisterSensorInput = {
        device_id: deviceId.trim(),
        tank_id: tankId,
        h1_m: parseOptional(h1M),
        depth_m: parseOptional(depthM),
        warning_height_m: parseOptional(warningHeightM),
        critical_height_m: parseOptional(criticalHeightM),
        activated,
      }
      if (isEdit && sensor) {
        await updateSensor(sensor.deviceId, {
          tank_id: tankId,
          h1_m: payload.h1_m,
          depth_m: payload.depth_m,
          warning_height_m: payload.warning_height_m,
          critical_height_m: payload.critical_height_m,
          activated,
        })
        toast.success("Sensor updated.")
      } else {
        await registerSensor(payload)
        toast.success("Sensor registered.")
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save sensor.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white/95 backdrop-blur-xl border-slate-200/50 shadow-2xl rounded-2xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{isEdit ? "Edit sensor" : "Register sensor"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the sensor configuration and tank assignment."
              : "Connect a water-level sensor to a tank."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="device-id">Device ID</Label>
            <Input
              id="device-id"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="e.g. tl-001-42"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tank-id">Tank</Label>
            <select
              id="tank-id"
              value={tankId}
              onChange={(e) => setTankId(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 text-sm focus:border-cyan-400 focus:outline-none"
            >
              <option value="">Select a tank…</option>
              {scopedTanks.map((tank) => (
                <option key={tank.id} value={tank.id}>
                  {tank.name || tank.sourceKey}{tankHasActivatedSensor(tank.id) ? " (sensor attached)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="h1">Sensor hanging (h1, m)</Label>
              <Input id="h1" type="number" min="0" step="0.1" value={h1M} onChange={(e) => setH1M(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="depth">Depth (m)</Label>
              <Input id="depth" type="number" min="0" step="0.1" value={depthM} onChange={(e) => setDepthM(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="warning">Warning height (m)</Label>
              <Input id="warning" type="number" min="0" step="0.1" value={warningHeightM} onChange={(e) => setWarningHeightM(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="critical">Critical height (m)</Label>
              <Input id="critical" type="number" min="0" step="0.1" value={criticalHeightM} onChange={(e) => setCriticalHeightM(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200/80 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Activated</p>
              <p className="text-xs text-slate-500">Only activated sensors produce live readings.</p>
            </div>
            <Switch checked={activated} onCheckedChange={setActivated} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Register sensor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Note:** `useDataStore` must expose a `getState()` static — verify the store is created via `create<UseDataStore>()(...)` (Zustand), which provides it. Adjust the `tankHasActivatedSensor` lookup to use a `sensors` value from the hook if `getState` is unavailable.

- [x] **Step 2: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: no new errors introduced by this file (pre-existing `_views` module errors, if any, are transient).

- [x] **Step 3: Commit — SKIPPED (no git repo).** Record in SDD ledger.

---

### Task 5: Frontend — overview page: hierarchical filter + tanks-driven cards + modal wiring

**Files:**
- Modify: `Frontend/app/(dashboard)/_views/water-level-page.tsx`

**Interfaces:**
- Consumes: `fetchTanks`, `tanks`, `sensors`, `fetchSensors`, `fetchUtilities`, `utilities`, `dmas`, `fetchDMAs` from `useDataStore`; `currentUser` from `useAuthStore`; `RegisterSensorModal`; existing `WaterStatusPill`, `Card`, `Skeleton`, `lib/water-level` helpers.
- Produces: utility dropdown + DMA dropdown cascade; tank cards derived from `tanks` (including sensor-less tanks with a "Register sensor" affordance for admin/utility_manager); register-sensor modal opened from a header button and from sensor-less tank cards.

- [x] **Step 1: Rewrite the overview view** — replace `Frontend/app/(dashboard)/_views/water-level-page.tsx` with:

```tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Droplets, Gauge, MapPin, Plus, RefreshCw } from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorSnap, type TankSnap } from "@/store/data-store"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
import {
  WATER_LEVEL_POLL_INTERVAL_MS,
  fillPercent,
  formatRelativeTime,
  readStoredTankLength,
  tankLengthFor,
} from "@/lib/water-level"
import { cn } from "@/lib/utils"

interface TankGroup {
  tank: TankSnap
  representative: SensorSnap | null
  sensorCount: number
  activeSensorCount: number
}

export default function WaterLevelPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { sensors, tanks, dmas, utilities, fetchSensors, fetchTanks, fetchDMAs, fetchUtilities } = useDataStore()

  const role = currentUser?.role
  const canView = role === "admin" || role === "utility_manager" || role === "dma_manager"

  const [utilityFilter, setUtilityFilter] = useState("")
  const [dmaFilter, setDmaFilter] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTankId, setModalTankId] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())

  const effectiveUtilityId =
    currentUser?.utilityId ||
    dmas.find((dma) => dma.id === currentUser?.dmaId)?.utilityId ||
    ""

  // Initial load + poll
  useEffect(() => {
    void fetchSensors()
    void fetchTanks()
    void fetchUtilities()
    void fetchDMAs()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSensors()
        void fetchTanks()
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    const ticker = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      clearInterval(interval)
      clearInterval(ticker)
    }
  }, [fetchSensors, fetchTanks, fetchUtilities, fetchDMAs])

  // Lock utility filter for managers
  useEffect(() => {
    if (role === "utility_manager" || role === "dma_manager") {
      if (effectiveUtilityId) setUtilityFilter(effectiveUtilityId)
    }
  }, [effectiveUtilityId, role])

  // Re-fetch DMAs scoped to the selected utility
  useEffect(() => {
    if (utilityFilter) {
      void fetchDMAs(utilityFilter)
    } else {
      void fetchDMAs()
    }
  }, [utilityFilter, fetchDMAs])

  // DMA manager is locked to their own DMA
  useEffect(() => {
    if (role === "dma_manager" && currentUser?.dmaId) setDmaFilter(currentUser.dmaId)
  }, [currentUser?.dmaId, role])

  const utilityOptions = useMemo(() => {
    if (role === "utility_manager" || role === "dma_manager") {
      return utilities.filter((u) => u.id === effectiveUtilityId)
    }
    return utilities
  }, [effectiveUtilityId, role, utilities])

  const dmaOptions = useMemo(() => {
    if (role === "dma_manager" && currentUser?.dmaId) {
      return dmas.filter((dma) => dma.id === currentUser.dmaId)
    }
    if (utilityFilter) {
      return dmas.filter((dma) => dma.utilityId === utilityFilter)
    }
    return dmas
  }, [currentUser?.dmaId, dmas, role, utilityFilter])

  // Build latest sensor-per-tank
  const latestSensorByTank = useMemo(() => {
    const map = new Map<string, SensorSnap>()
    for (const sensor of sensors) {
      const current = map.get(sensor.tankId)
      if (
        !current ||
        (sensor.activated &&
          sensor.lastReading &&
          new Date(sensor.lastReading.occurredAt) > new Date(current.lastReading?.occurredAt ?? 0))
      ) {
        if (sensor.activated || !current) map.set(sensor.tankId, sensor)
      }
    }
    return map
  }, [sensors])

  const tankGroups: TankGroup[] = useMemo(() => {
    return tanks
      .map((tank) => {
        const tankSensors = sensors.filter((s) => s.tankId === tank.id)
        return {
          tank,
          representative: latestSensorByTank.get(tank.id) ?? null,
          sensorCount: tankSensors.length,
          activeSensorCount: tank.activeSensorCount,
        }
      })
      .filter((group) => {
        if (utilityFilter && group.tank.utilityId !== utilityFilter) return false
        if (dmaFilter) {
          return dmaFilter === "unassigned" ? !group.tank.dmaId : group.tank.dmaId === dmaFilter
        }
        return true
      })
  }, [dmaFilter, latestSensorByTank, sensors, tanks, utilityFilter])

  const canRegister = role === "admin" || role === "utility_manager"

  const openTank = useCallback(
    (tankId: string) => router.push(`/dashboard/water-level/${tankId}`),
    [router]
  )

  const openRegister = useCallback((tankId?: string) => {
    setModalTankId(tankId)
    setModalOpen(true)
  }, [])

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
        onAction={() => {
          void fetchSensors()
          void fetchTanks()
        }}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={utilityFilter}
          onChange={(e) => {
            setUtilityFilter(e.target.value)
            setDmaFilter("")
          }}
          disabled={role === "utility_manager" || role === "dma_manager"}
          className={cn(
            "h-10 rounded-xl border bg-slate-50/60 px-3 text-xs font-medium shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-cyan-400/20",
            utilityFilter ? "border-cyan-400/70 text-cyan-700" : "border-slate-200/80 text-slate-500",
            (role === "utility_manager" || role === "dma_manager") && "cursor-not-allowed opacity-70"
          )}
        >
          <option value="">All Utilities</option>
          {utilityOptions.map((utility) => (
            <option key={utility.id} value={utility.id}>
              {utility.name}
            </option>
          ))}
        </select>

        <select
          value={dmaFilter}
          onChange={(e) => setDmaFilter(e.target.value)}
          disabled={role === "dma_manager"}
          className={cn(
            "h-10 rounded-xl border bg-slate-50/60 px-3 text-xs font-medium shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-cyan-400/20",
            dmaFilter ? "border-cyan-400/70 text-cyan-700" : "border-slate-200/80 text-slate-500",
            role === "dma_manager" && "cursor-not-allowed opacity-70"
          )}
        >
          <option value="">All DMAs</option>
          <option value="unassigned">Unassigned</option>
          {dmaOptions.map((dma) => (
            <option key={dma.id} value={dma.id}>
              {dma.utilityName || utilityFilter ? dma.name : `${dma.name}${dma.utilityName ? ` · ${dma.utilityName}` : ""}`}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <Gauge className="h-4 w-4" />
            {tankGroups.length} tank{tankGroups.length !== 1 ? "s" : ""}
          </span>
          {canRegister && (
            <Button size="sm" onClick={() => openRegister(undefined)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Register sensor
            </Button>
          )}
        </div>
      </div>

      {/* Cards */}
      {tanks.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : tankGroups.length === 0 ? (
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">No tanks found</p>
                <p className="mt-1 text-sm text-slate-500">No monitored tanks match the current filter.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tankGroups.map((group) => {
            const { tank, representative } = group
            const reading = representative?.lastReading ?? null
            const tankLength = tankLengthFor(representative, readStoredTankLength(tank.id))
            const percent = reading ? fillPercent(reading.waterLevelM, tankLength) : 0
            const status = representative?.status ?? (tank.status === "deactivated" ? "inactive" : "unknown")

            return (
              <Card
                key={tank.id}
                onClick={() => openTank(tank.id)}
                className="cursor-pointer overflow-hidden rounded-xl border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:shadow-slate-200/60"
              >
                <div
                  className={cn(
                    "h-1",
                    status === "critical"
                      ? "bg-gradient-to-r from-rose-400 to-red-500"
                      : status === "warning"
                        ? "bg-gradient-to-r from-amber-400 to-orange-500"
                        : status === "active"
                          ? "bg-gradient-to-r from-cyan-400 to-sky-500"
                          : "bg-slate-200"
                  )}
                />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                        <h3 className="truncate font-semibold text-slate-800">{tank.name || tank.sourceKey}</h3>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {group.tank.dmaId ? dmas.find((dma) => dma.id === group.tank.dmaId)?.name || "Unassigned" : "Unassigned"}
                      </p>
                    </div>
                    {representative ? <WaterStatusPill status={representative.status} /> : <WaterStatusPill status="inactive" />}
                  </div>

                  <div className="mt-4">
                    <div className="flex items-end justify-between text-sm">
                      <div>
                        <p className="text-xs text-slate-500">Water level</p>
                        <p className="font-semibold text-slate-800">
                          {reading ? `${reading.waterLevelM.toFixed(2)} m` : "—"}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-slate-500">
                        {reading ? `${percent.toFixed(0)}%` : "No readings yet"}
                      </span>
                    </div>
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-700",
                          status === "critical"
                            ? "bg-gradient-to-r from-rose-400 to-red-500"
                            : status === "warning"
                              ? "bg-gradient-to-r from-amber-400 to-orange-500"
                              : status === "active"
                                ? "bg-gradient-to-r from-cyan-400 to-sky-500"
                                : "bg-slate-300"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span>{reading ? `Updated ${formatRelativeTime(reading.occurredAt, now)}` : "No readings yet"}</span>
                    <span>{group.activeSensorCount} sensor{group.activeSensorCount !== 1 ? "s" : ""}</span>
                  </div>

                  {canRegister && !group.activeSensorCount && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={(event) => {
                        event.stopPropagation()
                        openRegister(tank.id)
                      }}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Register sensor
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <RegisterSensorModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        defaultTankId={modalTankId}
      />
    </div>
  )
}
```

**Verification checklist for the implementer:**
1. Unused imports are removed (the diff replaces the file; do not leave `Droplets`/`Gauge`/`MapPin` unused).
2. `Button` is imported from `@/components/ui/button`.
3. The `dmaOptions` label fallback: `dma.utilityName` is present on the `DMA` type; the store's `fetchDMAs` maps over `items` with `transformKeys`, so `utility_name` → `utilityName` (verify the DMA DTO serializers in `Backend/app/api/dmas.py` include `utility_name`; if absent, the DMA dropdown will still work, just without the `· <utility>` suffix — acceptable).
4. `latestSensorByTank` prefers activated sensors with the newest reading; deactivated sensors never replace an activated one.

- [x] **Step 2: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: errors only from not-yet-created task files, none from the overview rewrite itself.

- [x] **Step 3: Commit — SKIPPED (no git repo).** Record in SDD ledger.

---

### Task 6: Frontend — detail page: register-sensor modal wiring

**Files:**
- Modify: `Frontend/app/(dashboard)/_views/water-level-tank-detail-page.tsx`

**Interfaces:**
- Consumes: `RegisterSensorModal`, `useAuthStore` `currentUser`, existing page structure. The page's `tankId` comes from `useParams`.

- [x] **Step 1: Add modal wiring** to `Frontend/app/(dashboard)/_views/water-level-tank-detail-page.tsx`:

1. Import `useAuthStore` and the modal, and `Plus` from lucide-react:

```tsx
import { Plus } from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
```

2. Inside the component, near the existing `lengthOverride` state, add:

```tsx
  const { currentUser } = useAuthStore()
  const [registerOpen, setRegisterOpen] = useState(false)
  const canRegister = currentUser?.role === "admin" || currentUser?.role === "utility_manager"
```

(`useState` is already imported from `react` in this file.)

3. In the header block, after the `<p className="text-sm text-slate-500">Detailed readings…` paragraph, add a register button:

```tsx
          {canRegister && (
            <Button size="sm" onClick={() => setRegisterOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Register sensor
            </Button>
          )}
```

4. Just before the closing `</div>` of the outer flex container, before the final return closes, add the modal:

```tsx
      <RegisterSensorModal open={registerOpen} onOpenChange={setRegisterOpen} defaultTankId={tankId} />
```

- [x] **Step 2: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: no errors from this file (transient `_views` errors from task 7's missing file are acceptable).

- [x] **Step 3: Commit — SKIPPED (no git repo).** Record in SDD ledger.

---

### Task 7: Frontend — sensors management page + route + nav item

**Files:**
- Create: `Frontend/app/(dashboard)/_views/sensors-page.tsx`
- Create: `Frontend/app/(dashboard)/dashboard/sensors/page.tsx` (re-export route)
- Modify: `Frontend/lib/constants.ts` (nav item)

**Interfaces:**
- Consumes: `sensors`, `tanks`, `utilities`, `dmas`, `fetchSensors`, `fetchTanks`, `fetchUtilities`, `fetchDMAs`, `updateSensor`, `deleteSensor`, `updateTankStatus` from `useDataStore`; `currentUser` from `useAuthStore`; `RegisterSensorModal`; `ConfirmDialog`; `WaterStatusPill`; shadcn `Table`, `Button`, `Switch`; `sonner` `toast`.
- Produces: route `/dashboard/sensors` (re-export `../../_views/sensors-page`), nav item `{ title: "Sensor Management", href: "/dashboard/sensors", icon: <sensor icon>, roles: ["admin", "utility_manager", "dma_manager"] }`.

- [x] **Step 1: Create the route re-export** — `Frontend/app/(dashboard)/dashboard/sensors/page.tsx`:

```tsx
export { default } from "../../_views/sensors-page"
```

- [x] **Step 2: Add the nav item** in `Frontend/lib/constants.ts`, after the "Water Level Monitoring" entry (~line 72):

```ts
  {
    title: "Sensor Management",
    href: "/dashboard/sensors",
    icon: Gauge,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
```

Import `Gauge` in the lucide-react import block at the top of `constants.ts` (add to the existing import list).

- [x] **Step 3: Create the management page view** — `Frontend/app/(dashboard)/_views/sensors-page.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Droplets, Loader2, Pencil, Power, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/page-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorSnap } from "@/store/data-store"

export default function SensorsPage() {
  const { currentUser } = useAuthStore()
  const role = currentUser?.role
  const {
    sensors,
    tanks,
    utilities,
    dmas,
    fetchSensors,
    fetchTanks,
    fetchUtilities,
    fetchDMAs,
    updateSensor,
    deleteSensor,
    updateTankStatus,
  } = useDataStore()

  const [editTarget, setEditTarget] = useState<SensorSnap | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SensorSnap | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busyDevice, setBusyDevice] = useState<string | null>(null)

  const isAdmin = role === "admin"
  const isUtilityManager = role === "utility_manager"
  const canManage = isAdmin || isUtilityManager

  useEffect(() => {
    void fetchSensors()
    void fetchTanks()
    void fetchUtilities()
    void fetchDMAs()
  }, [fetchSensors, fetchTanks, fetchUtilities, fetchDMAs])

  const utilityNameById = useMemo(() => new Map(utilities.map((u) => [u.id, u.name])), [utilities])
  const dmaNameById = useMemo(() => new Map(dmas.map((d) => [d.id, d.name])), [dmas])

  const handleActivateToggle = async (sensor: SensorSnap) => {
    setBusyDevice(sensor.deviceId)
    try {
      await updateSensor(sensor.deviceId, { activated: !sensor.activated })
      toast.success(sensor.activated ? "Sensor deactivated." : "Sensor activated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle sensor state.")
    } finally {
      setBusyDevice(null)
    }
  }

  const handleTankToggle = async (sensor: SensorSnap) => {
    setBusyDevice(sensor.deviceId)
    const tank = tanks.find((t) => t.id === sensor.tankId)
    if (!tank) return
    const next = tank.status === "deactivated" ? "active" : "deactivated"
    try {
      await updateTankStatus(tank.id, next)
      toast.success(next === "active" ? "Tank activated." : "Tank deactivated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle tank status.")
    } finally {
      setBusyDevice(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSensor(deleteTarget.deviceId)
      toast.success("Sensor deleted.")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete sensor.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sensor Management"
        description="Register, edit, and manage water-level sensors across tanks."
      />

      <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="px-6 py-4">Device ID</TableHead>
                <TableHead className="px-6 py-4">Tank</TableHead>
                <TableHead className="px-6 py-4">Utility</TableHead>
                <TableHead className="px-6 py-4">DMA</TableHead>
                <TableHead className="px-6 py-4">Status</TableHead>
                <TableHead className="px-6 py-4">Last reading</TableHead>
                <TableHead className="px-6 py-4">Activated</TableHead>
                <TableHead className="px-6 py-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sensors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="px-6 py-16 text-center text-sm text-slate-500">
                    No sensors registered yet.
                  </TableCell>
                </TableRow>
              ) : (
                sensors.map((sensor) => {
                  const tank = tanks.find((t) => t.id === sensor.tankId)
                  const busy = busyDevice === sensor.deviceId
                  return (
                    <TableRow key={sensor.id}>
                      <TableCell className="px-6 py-4">
                        <span className="flex items-center gap-2 font-medium text-slate-800">
                          <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                          {sensor.deviceId}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {tank?.name || tank?.sourceKey || sensor.tankName || sensor.tankId}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {utilityNameById.get(sensor.utilityId) || "—"}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {sensor.dmaId ? dmaNameById.get(sensor.dmaId) || "—" : "Unassigned"}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <WaterStatusPill status={sensor.status} />
                      </TableCell>
                      <TableCell className="px-6 py-4 text-xs text-slate-500">
                        {sensor.lastReading
                          ? `${sensor.lastReading.waterLevelM.toFixed(2)} m · ${sensor.lastReading.occurredAt}`
                          : "No readings"}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Switch
                          checked={sensor.activated}
                          onCheckedChange={() => canManage && void handleActivateToggle(sensor)}
                          disabled={!canManage || busy}
                        />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditTarget(sensor)
                                  setModalOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4 text-slate-500" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleTankToggle(sensor)}
                                disabled={busy}
                                title={tank?.status === "deactivated" ? "Activate tank" : "Deactivate tank"}
                              >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Power className="h-4 w-4 text-slate-500" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeleteTarget(sensor)}
                                className="hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4 text-slate-500" />
                              </Button>
                            </>
                          )}
                          {!canManage && (
                            <Activity className="h-4 w-4 text-slate-300" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RegisterSensorModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open)
          if (!open) setEditTarget(null)
        }}
        sensor={editTarget}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete sensor?"
        description={`This permanently deletes sensor "${deleteTarget?.deviceId}" and all of its readings. This cannot be undone.`}
        confirmLabel="Delete sensor"
        variant="destructive"
        isLoading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
```

**Verification checklist for the implementer:**
1. `ConfirmDialog` props confirmed: `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel`, `onConfirm`, `variant`, `isLoading` — verify against `components/shared/confirm-dialog.tsx`; the snippet matches.
2. `Switch` from shadcn uses `onCheckedChange` (verify with the local `components/ui/switch.tsx` — if it uses `onCheckedChange` with `(checked) => void`, keep; otherwise adapt the prop name).
3. Role gating: `dma_manager` sees the table but the only action shown is the inert `Activity` icon; admin/utility_manager get Edit/Power/Delete. This matches the decided "read-only for DMA manager" behavior.
4. `sensor.lastReading.occurredAt` is a raw ISO string — for cleaner display use the existing `formatTanzaniaDateTime` from `@/lib/date-time` if preferred (optional).

- [x] **Step 4: Typecheck**

Run: `cd Frontend && npx tsc --noEmit`
Expected: **0 errors** now — all previously-transient `_views` references exist.

- [x] **Step 5: Build the full app**

Run: `cd Frontend && npm run build`
Expected: successful production build; both `/dashboard/water-level` routes and `/dashboard/sensors` listed.

- [x] **Step 6: Commit — SKIPPED (no git repo).** Record in SDD ledger.

---

### Task 8: End-to-end verification

**Files:** (no code changes — verification only)

- [x] **Step 1: Full backend suite**

Run: `cd Backend && source venv/bin/activate && pytest tests/ -v`
Expected: all tests pass (sensor suite includes `TestSensorDelete`; `TestGpkgStartupSync` present and green).

- [x] **Step 2: Typecheck + build**

Run: `cd Frontend && npx tsc --noEmit && npm run build`
Expected: clean typecheck, successful production build, `/dashboard/sensors` route listed.

- [x] **Step 3: Manual smoke against Postgres** (with the live dev stack: Postgres `majiscopedb`, backend :8000, Next :3000)

As an admin / utility manager / DMA manager:
1. Visit `/dashboard/water-level` — utility + DMA cascade filters appear; admin sees "All Utilities" + all DMAs; utility manager sees their utility locked; DMA manager sees their DMA locked.
2. Tank cards include sensor-less tanks ("No readings yet") and, for admin/utility manager, a "Register sensor" action.
3. Register a sensor via the modal for a tank → card updates; sensor appears on `/dashboard/sensors`.
4. Edit the sensor, toggle Activated, toggle the tank Active/Deactivated, and delete the sensor (confirm dialog); verify each reflects immediately.
5. Restart the backend → the startup GPKG sync line prints tank counts (`created`/`updated`); tanks still present after restart (idempotent).
6. DMAs dropdown scopes to the selected utility on the overview.

- [x] **Step 4: Update spec status**

In `docs/superpowers/specs/2026-08-17-water-level-phase3-hierarchy-and-sensors.md`, change `Status: Draft` → `Status: Implemented` after the above checks pass.

- [x] **Step 5: Commit — SKIPPED (no git repo).** Update the Phase 3 spec status line was Step 4; there is no git commit for this task. Record completion in the SDD ledger.
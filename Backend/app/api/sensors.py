"""
Sensor Routes
Registration, ingest, and role-scoped read APIs for the water-level monitoring feature.
"""

import secrets
from datetime import datetime
from typing import Any, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database.session import get_db
from app.models import (
    Tank,
    TankStatusEnum,
    SensorDevice,
    SensorReading,
    DMA,
)
from app.schemas.sensors import (
    TankPatch,
    TankRead,
    TankListResponse,
    SensorRegisterRequest,
    SensorRegisterResponse,
    SensorUpdateRequest,
    SensorIngestRequest,
    SensorIngestResponse,
    SensorPendingIngestResponse,
    SensorRead,
    SensorListResponse,
    TankReadingsResponse,
)
from app.security.dependencies import (
    get_current_user,
    require_utility_manager,
    CurrentUser,
)
from app.services.activity_logs import audit_log
from app.services.hierarchy import resolve_current_user_utility_id
from app.services.sensor_services import (
    compute_water_level,
    derive_status,
    ingest_reading,
    promote_pending_readings,
    store_pending_reading,
)

sensors_router = APIRouter(prefix="/api/sensors", tags=["sensors"])
tanks_router = APIRouter(prefix="/api/tanks", tags=["tanks"])


def _get_tank_or_404(db: Session, tank_id: str) -> Tank:
    tank = db.query(Tank).filter(Tank.id == tank_id).first()
    if tank is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tank not found")
    return tank


def _get_sensor_or_404(db: Session, device_id: str) -> SensorDevice:
    sensor = db.query(SensorDevice).filter(SensorDevice.device_id == device_id).first()
    if sensor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")
    return sensor


def _latest_reading(db: Session, sensor_id: str) -> Optional[SensorReading]:
    return (
        db.query(SensorReading)
        .filter(SensorReading.sensor_id == sensor_id)
        .order_by(SensorReading.occurred_at.desc(), SensorReading.created_at.desc())
        .first()
    )


def _sensor_status(sensor: SensorDevice, tank: Tank, db: Session) -> Tuple[str, Optional[SensorReading]]:
    reading = _latest_reading(db, sensor.id)
    if reading is not None:
        return reading.status.value, reading
    height = compute_water_level(sensor.h1_m or 0.0, sensor.depth_m or 0.0)
    return derive_status(tank, sensor, height).value, None


def _reading_response(reading: SensorReading) -> SensorIngestResponse:
    return SensorIngestResponse(
        reading_id=reading.id,
        sensor_id=reading.sensor_id,
        tank_id=reading.tank_id,
        utility_id=reading.utility_id,
        dma_id=reading.dma_id,
        water_level_m=reading.water_height_m,
        h1_m=reading.h1_m,
        depth_m=reading.depth_m,
        status=reading.status.value,
        occurred_at=reading.occurred_at,
        dedup_key=reading.dedup_key,
    )


def _tank_read(tank: Tank, db: Session) -> TankRead:
    sensor_count = db.query(SensorDevice.id).filter(SensorDevice.tank_id == tank.id).count()
    active_count = (
        db.query(SensorDevice.id)
        .filter(SensorDevice.tank_id == tank.id, SensorDevice.activated.is_(True))
        .count()
    )
    return TankRead(
        id=tank.id,
        utility_id=tank.utility_id,
        dma_id=tank.dma_id,
        source_key=tank.source_key,
        name=tank.name,
        latitude=tank.latitude,
        longitude=tank.longitude,
        status=tank.status.value if hasattr(tank.status, "value") else tank.status,
        sensor_count=sensor_count,
        active_sensor_count=active_count,
        created_at=tank.created_at,
        updated_at=tank.updated_at,
        deactivated_at=tank.deactivated_at,
    )


def _tank_scoped_ids(current_user: CurrentUser, db: Session) -> Optional[set[str]]:
    """
    Return the set of tank IDs the user may access, or ``None`` for admins
    (unrestricted). Scope is derived from utility for utility managers and
    from DMA for DMA managers / engineers.
    """
    if current_user.user_type == "user":
        return None

    utility_id = resolve_current_user_utility_id(current_user, db)
    if current_user.user_type == "dma_manager" and current_user.dma_id:
        tanks = db.query(Tank.id).filter(Tank.dma_id == current_user.dma_id).all()
        return {tank_id for (tank_id,) in tanks}

    if utility_id:
        tanks = db.query(Tank.id).filter(Tank.utility_id == utility_id).all()
        return {tank_id for (tank_id,) in tanks}

    return set()


def _ensure_tank_access(
    tank: Tank,
    current_user: CurrentUser,
    db: Session,
    *,
    action: str = "access",
) -> None:
    if current_user.user_type == "user":
        return

    if current_user.user_type == "dma_manager" and current_user.dma_id == tank.dma_id:
        return

    utility_id = resolve_current_user_utility_id(current_user, db)
    if utility_id and tank.utility_id == utility_id:
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"You do not have {action} to this tank",
    )


def _ensure_sensor_access(
    sensor: SensorDevice,
    current_user: CurrentUser,
    db: Session,
) -> None:
    tank = _get_tank_or_404(db, sensor.tank_id)
    _ensure_tank_access(tank, current_user, db, action="access to the sensor tank")


# ============================================================================
# Ingest
# ============================================================================

async def _current_user_or_ingest_key(
    x_ingest_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if x_ingest_key:
        configured_key = (settings.sensor_ingest_key or "").strip()
        if configured_key and secrets.compare_digest(x_ingest_key.strip(), configured_key):
            return CurrentUser(id="ingest-server", email="ingest@device", user_type="ingest_server")
    return await get_current_user(authorization=authorization, db=db)


@sensors_router.post("/ingest", response_model=SensorIngestResponse | SensorPendingIngestResponse)
async def ingest_sensor_reading(
    payload: SensorIngestRequest,
    current_user: CurrentUser = Depends(_current_user_or_ingest_key),
    db: Session = Depends(get_db),
):
    """
    Accept a reading from a registered or unregistered device.

    Registered devices: scope is resolved from the sensor's tank link.
    Unregistered devices: reading is stored as pending, ready for
    association when the sensor is later registered.
    Accepts either a valid bearer token or the shared X-Ingest-Key header.
    """
    sensor = db.query(SensorDevice).filter(SensorDevice.device_id == payload.device_id).first()
    if sensor is not None:
        result = ingest_reading(db, payload.device_id, payload.model_dump())
        return SensorIngestResponse(**result)

    result = store_pending_reading(db, payload.device_id, payload.model_dump())
    return SensorPendingIngestResponse(**result)


# ============================================================================
# Sensor Devices
# ============================================================================

@sensors_router.post("", response_model=SensorRegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_sensor(
    payload: SensorRegisterRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_utility_manager),
    db: Session = Depends(get_db),
):
    """
    Register a new water-level sensor against an existing active tank.

    Admin and utility manager roles only. The target tank must be active and
    within the caller's utility scope; device_ids are globally unique.
    """
    existing = db.query(SensorDevice).filter(SensorDevice.device_id == payload.device_id).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A sensor with this device_id is already registered",
        )

    tank = _get_tank_or_404(db, payload.tank_id)
    if tank.status != TankStatusEnum.ACTIVE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tank is not active")
    _ensure_tank_access(tank, current_user, db, action="access")

    sensor = SensorDevice(
        device_id=payload.device_id,
        tank_id=tank.id,
        h1_m=payload.h1_m,
        depth_m=payload.depth_m,
        warning_height_m=payload.warning_height_m if payload.warning_height_m is not None else 10.0,
        critical_height_m=payload.critical_height_m if payload.critical_height_m is not None else 0.0,
        activated=payload.activated,
    )
    db.add(sensor)
    db.flush()

    db.commit()
    db.refresh(sensor)

    promoted = promote_pending_readings(db, sensor, tank)

    audit_log(
        db,
        request=request,
        actor=current_user,
        action="sensor.register",
        event_type="sensor",
        status="success",
        entity="sensor",
        entity_id=sensor.id,
        target_name=payload.device_id,
        utility_id=tank.utility_id,
        metadata={
            "device_id": payload.device_id,
            "tank_id": tank.id,
            "activated": payload.activated,
            "promoted_readings": promoted,
        },
    )
    if promoted:
        db.commit()

    return SensorRegisterResponse(
        id=sensor.id,
        device_id=sensor.device_id,
        tank_id=sensor.tank_id,
        utility_id=tank.utility_id,
        h1_m=sensor.h1_m,
        depth_m=sensor.depth_m,
        warning_height_m=sensor.warning_height_m,
        critical_height_m=sensor.critical_height_m,
        activated=sensor.activated,
        promoted_readings=promoted,
        created_at=sensor.created_at,
        updated_at=sensor.updated_at,
    )


@sensors_router.patch("/{device_id}", response_model=SensorRegisterResponse)
async def update_sensor(
    device_id: str,
    payload: SensorUpdateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_utility_manager),
    db: Session = Depends(get_db),
):
    sensor = _get_sensor_or_404(db, device_id)
    _ensure_sensor_access(sensor, current_user, db)

    changes: dict[str, Any] = {}
    if payload.tank_id and payload.tank_id != sensor.tank_id:
        new_tank = _get_tank_or_404(db, payload.tank_id)
        if new_tank.status != TankStatusEnum.ACTIVE:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tank is not active")
        _ensure_tank_access(new_tank, current_user, db, action="access")
        sensor.tank_id = new_tank.id
        changes["tank_id"] = new_tank.id
    if payload.h1_m is not None:
        sensor.h1_m = payload.h1_m
        changes["h1_m"] = payload.h1_m
    if payload.depth_m is not None:
        sensor.depth_m = payload.depth_m
        changes["depth_m"] = payload.depth_m
    if payload.warning_height_m is not None:
        sensor.warning_height_m = payload.warning_height_m
        changes["warning_height_m"] = payload.warning_height_m
    if payload.critical_height_m is not None:
        sensor.critical_height_m = payload.critical_height_m
        changes["critical_height_m"] = payload.critical_height_m
    if payload.activated is not None:
        sensor.activated = payload.activated
        changes["activated"] = payload.activated

    audit_log(
        db,
        request=request,
        actor=current_user,
        action="sensor.update",
        event_type="sensor",
        status="success",
        entity="sensor",
        entity_id=sensor.id,
        target_name=sensor.device_id,
        utility_id=sensor.tank.utility_id,
        metadata=changes,
    )
    db.commit()
    db.refresh(sensor)
    tank = _get_tank_or_404(db, sensor.tank_id)
    return SensorRegisterResponse(
        id=sensor.id,
        device_id=sensor.device_id,
        tank_id=sensor.tank_id,
        utility_id=tank.utility_id,
        h1_m=sensor.h1_m,
        depth_m=sensor.depth_m,
        warning_height_m=sensor.warning_height_m,
        critical_height_m=sensor.critical_height_m,
        activated=sensor.activated,
        created_at=sensor.created_at,
        updated_at=sensor.updated_at,
    )


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
    # NOTE (controller pre-flight correction): `_ensure_sensor_access` takes NO
    # `action` kwarg (signature is `(sensor, current_user, db)` only, and its
    # internal 403 message is already "access to the sensor tank"). Do NOT pass
    # `action=...` here — it would raise TypeError.
    _ensure_sensor_access(sensor, current_user, db)
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


@sensors_router.get("", response_model=SensorListResponse)
async def list_sensors(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scoped_tank_ids = _tank_scoped_ids(current_user, db)

    query = db.query(SensorDevice)
    if scoped_tank_ids is not None:
        query = query.filter(SensorDevice.tank_id.in_(scoped_tank_ids))

    sensors = query.all()
    items: list[SensorRead] = []
    for sensor in sensors:
        tank = _get_tank_or_404(db, sensor.tank_id)
        status_value, reading = _sensor_status(sensor, tank, db)
        items.append(
            SensorRead(
                id=sensor.id,
                device_id=sensor.device_id,
                tank_id=sensor.tank_id,
                tank_name=tank.name or tank.source_key,
                utility_id=tank.utility_id,
                dma_id=tank.dma_id,
                h1_m=sensor.h1_m,
                depth_m=sensor.depth_m,
                warning_height_m=sensor.warning_height_m,
                critical_height_m=sensor.critical_height_m,
                activated=sensor.activated,
                status=status_value,
                last_reading=_reading_response(reading) if reading else None,
                created_at=sensor.created_at,
                updated_at=sensor.updated_at,
            )
        )

    return SensorListResponse(total=len(items), items=items)


# ============================================================================
# Tanks
# ============================================================================

@tanks_router.get("", response_model=TankListResponse)
async def list_sensor_tanks(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Role-scoped tank list including sensor counts.

    Admin sees all tanks; utility managers see their own; DMA managers see the
    tanks linked to their DMA.
    """
    scoped_tank_ids = _tank_scoped_ids(current_user, db)

    query = db.query(Tank)
    if scoped_tank_ids is not None:
        query = query.filter(Tank.id.in_(scoped_tank_ids))

    tanks = query.order_by(Tank.created_at.desc()).all()
    return TankListResponse(
        total=len(tanks),
        items=[_tank_read(tank, db) for tank in tanks],
    )


@tanks_router.get("/{tank_id}", response_model=TankRead)
async def get_sensor_tank(
    tank_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tank = _get_tank_or_404(db, tank_id)
    _ensure_tank_access(tank, current_user, db, action="access")
    return _tank_read(tank, db)


@tanks_router.patch("/{tank_id}", response_model=TankRead)
async def update_sensor_tank(
    tank_id: str,
    payload: TankPatch,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update tank assignment and geography.

    dma_id may be assigned by admins, the owning utility manager, or the DMA
    manager of the target DMA.
    """
    tank = _get_tank_or_404(db, tank_id)
    _ensure_tank_access(tank, current_user, db, action="access")

    changes: dict[str, Any] = {}
    if payload.dma_id is not None:
        dma = db.query(DMA).filter(DMA.id == payload.dma_id).first()
        if dma is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DMA not found")
        if dma.utility_id != tank.utility_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="DMA does not belong to the tank's utility",
            )
        if current_user.user_type == "dma_manager" and current_user.dma_id != dma.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only assign a tank to your own DMA",
            )
        if tank.dma_id != dma.id:
            tank.dma_id = dma.id
            changes["dma_id"] = dma.id
    if payload.name is not None and payload.name.strip():
        tank.name = payload.name.strip()
        changes["name"] = tank.name
    if payload.latitude is not None:
        tank.latitude = payload.latitude
        changes["latitude"] = payload.latitude
    if payload.longitude is not None:
        tank.longitude = payload.longitude
        changes["longitude"] = payload.longitude
    if payload.status is not None:
        if payload.status == "deactivated":
            tank.status = TankStatusEnum.DEACTIVATED
            tank.deactivated_at = datetime.utcnow()
        elif payload.status == "active":
            tank.status = TankStatusEnum.ACTIVE
            tank.deactivated_at = None
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tank status")
        changes["status"] = tank.status.value

    audit_log(
        db,
        request=request,
        actor=current_user,
        action="tank.update",
        event_type="tank",
        status="success",
        entity="tank",
        entity_id=tank.id,
        target_name=tank.name or tank.source_key,
        utility_id=tank.utility_id,
        metadata=changes,
    )
    db.commit()
    db.refresh(tank)
    return _tank_read(tank, db)


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
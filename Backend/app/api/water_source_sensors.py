"""Water-source entities, their dedicated sensor registry, and ingest API."""

import secrets
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database.sensor_session import get_sensor_db
from app.database.session import get_db
from app.models import DMA, Utility, WaterSource as MainWaterSource, WaterSourceStatusEnum
from app.models.sensor_platform import (
    SensorCategoryEnum,
    SensorDevice,
    SensorStatusEnum,
    WaterSourceRef,
    WaterSourceSensorDevice,
    WaterSourceSensorPendingReading,
    WaterSourceStatusEnum as PlatformWaterSourceStatusEnum,
    WaterSourceWaterLevelReading,
    WaterSourceWaterQualityReading,
)
from app.schemas.sensors import SensorIngestRequest, SensorPendingIngestResponse
from app.schemas.water_source_sensors import (
    WaterSourceListResponse,
    WaterSourcePatch,
    WaterSourceRead,
    WaterSourceReadingsResponse,
    WaterSourceSensorLastReading,
    WaterSourceSensorListResponse,
    WaterSourceSensorRead,
    WaterSourceSensorRegisterRequest,
    WaterSourceSensorRegisterResponse,
    WaterSourceSensorUpdateRequest,
    WaterSourceWaterLevelIngestResponse,
    WaterSourceWaterQualityIngestResponse,
)
from app.security.dependencies import CurrentUser, get_current_user, require_utility_manager
from app.services.activity_logs import audit_log
from app.services.hierarchy import resolve_current_user_utility_id
from app.services.sensor_platform_sync import (
    ensure_water_source_ref,
    mirror_water_source,
    refresh_water_source_sensor_counts,
    upsert_water_source_ref,
)
from app.services.sensor_services import load_pending_payloads, store_pending_reading, take_pending_rows
from app.services.water_level_services import (
    compute_water_level,
    derive_status as derive_water_level_status,
    ingest_water_level_reading,
    promote_pending_water_level,
    wl_config,
)
from app.services.water_quality_services import (
    extract_water_quality,
    ingest_water_quality_reading,
    promote_pending_water_quality,
)
from app.api.sensors import _water_level_payload_recognised

water_sources_router = APIRouter(prefix="/api/water-sources", tags=["water-sources"])
water_source_sensors_router = APIRouter(prefix="/api/water-source-sensors", tags=["water-source-sensors"])


def _source_or_404(sensor_db: Session, source_id: str) -> WaterSourceRef:
    source = sensor_db.get(WaterSourceRef, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Water source not found")
    return source


def _source_ids_for_user(current_user: CurrentUser, db: Session, sensor_db: Session) -> Optional[set[str]]:
    if current_user.user_type in {"admin", "user"}:
        return None
    query = sensor_db.query(WaterSourceRef.id)
    if current_user.user_type == "dma_manager" and current_user.dma_id:
        query = query.filter(WaterSourceRef.dma_id == current_user.dma_id)
    else:
        utility_id = resolve_current_user_utility_id(current_user, db)
        if not utility_id:
            return set()
        query = query.filter(WaterSourceRef.utility_id == utility_id)
    return {source_id for (source_id,) in query.all()}


def _ensure_source_access(
    source: WaterSourceRef,
    current_user: CurrentUser,
    db: Session,
    action: str = "access",
) -> None:
    if current_user.user_type in {"admin", "user"}:
        return
    if current_user.user_type == "dma_manager" and source.dma_id == current_user.dma_id:
        return
    utility_id = resolve_current_user_utility_id(current_user, db)
    if utility_id and source.utility_id == utility_id:
        return
    raise HTTPException(status_code=403, detail=f"You do not have {action} to this water source")


def _source_read(source: WaterSourceRef) -> WaterSourceRead:
    return WaterSourceRead(
        id=source.id,
        utility_id=source.utility_id,
        dma_id=source.dma_id,
        source_key=source.source_key,
        name=source.name,
        source_type=source.source_type,
        latitude=source.latitude,
        longitude=source.longitude,
        status=source.status.value if hasattr(source.status, "value") else source.status,
        sensor_count=source.sensor_count or 0,
        active_sensor_count=source.active_sensor_count or 0,
        created_at=source.created_at,
        updated_at=source.updated_at,
        deactivated_at=source.deactivated_at,
    )


def _reading_model(category: str):
    return WaterSourceWaterQualityReading if category == "water_quality" else WaterSourceWaterLevelReading


def _latest_reading(sensor_db: Session, sensor: WaterSourceSensorDevice):
    return (
        sensor_db.query(_reading_model(sensor.category.value))
        .filter(_reading_model(sensor.category.value).sensor_id == sensor.id)
        .order_by(_reading_model(sensor.category.value).occurred_at.desc())
        .first()
    )


def _sensor_status(sensor_db: Session, sensor: WaterSourceSensorDevice) -> tuple[str, Any]:
    reading = _latest_reading(sensor_db, sensor)
    if reading is not None:
        return reading.status.value, reading
    if sensor.category == SensorCategoryEnum.WATER_QUALITY:
        return SensorStatusEnum.INACTIVE.value, None
    config = wl_config(sensor)
    height = compute_water_level(float(config.get("h1_m") or 0.0), float(config.get("depth_m") or 0.0))
    return derive_water_level_status(sensor, height).value, None


def _last_reading(sensor: WaterSourceSensorDevice, reading: Any) -> Optional[WaterSourceSensorLastReading]:
    if reading is None:
        return None
    result: dict[str, Any] = {
        "category": sensor.category.value,
        "reading_id": reading.id,
        "sensor_id": reading.sensor_id,
        "water_source_id": reading.water_source_id,
        "utility_id": reading.utility_id,
        "dma_id": reading.dma_id,
        "status": reading.status.value,
        "occurred_at": reading.occurred_at,
        "is_duplicate": False,
    }
    if sensor.category == SensorCategoryEnum.WATER_QUALITY:
        from app.services.water_quality_services import WQ_PARAMETERS

        result["parameters"] = {
            field: getattr(reading, field)
            for field in WQ_PARAMETERS
            if getattr(reading, field, None) is not None
        }
    else:
        result.update(
            water_level_m=reading.water_height_m,
            h1_m=reading.h1_m,
            depth_m=reading.depth_m,
        )
    return WaterSourceSensorLastReading(**result)


def _sensor_read(sensor_db: Session, sensor: WaterSourceSensorDevice) -> WaterSourceSensorRead:
    source = _source_or_404(sensor_db, sensor.water_source_id)
    sensor_status, reading = _sensor_status(sensor_db, sensor)
    return WaterSourceSensorRead(
        id=sensor.id,
        device_id=sensor.device_id,
        category=sensor.category.value,
        water_source_id=sensor.water_source_id,
        water_source_name=source.name or source.source_key,
        utility_id=source.utility_id,
        dma_id=source.dma_id,
        config=sensor.config,
        activated=sensor.activated,
        status=sensor_status,
        last_reading=_last_reading(sensor, reading),
        created_at=sensor.created_at,
        updated_at=sensor.updated_at,
    )


async def _current_user_or_ingest_key(
    x_ingest_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> CurrentUser:
    configured_key = (settings.sensor_ingest_key or "").strip()
    if x_ingest_key and configured_key and secrets.compare_digest(x_ingest_key.strip(), configured_key):
        return CurrentUser(id="ingest-server", email="ingest@device", user_type="ingest_server")
    from app.security.dependencies import get_current_user as authenticate

    return await authenticate(authorization=authorization, db=db)


@water_sources_router.get("", response_model=WaterSourceListResponse)
async def list_water_sources(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    scoped_ids = _source_ids_for_user(current_user, db, sensor_db)
    query = sensor_db.query(WaterSourceRef)
    if scoped_ids is not None:
        query = query.filter(WaterSourceRef.id.in_(scoped_ids))
    sources = query.order_by(WaterSourceRef.created_at.desc()).all()
    return WaterSourceListResponse(total=len(sources), items=[_source_read(source) for source in sources])


@water_sources_router.get("/{water_source_id}", response_model=WaterSourceRead)
async def get_water_source(
    water_source_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    source = _source_or_404(sensor_db, water_source_id)
    _ensure_source_access(source, current_user, db)
    return _source_read(source)


@water_sources_router.get("/{water_source_id}/detect-dma")
async def detect_water_source_dma(
    water_source_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    source_ref = _source_or_404(sensor_db, water_source_id)
    _ensure_source_access(source_ref, current_user, db)
    source = db.query(MainWaterSource).filter(MainWaterSource.id == water_source_id).first()
    if source is None or source.latitude is None or source.longitude is None:
        return {"dma_id": None, "dma_name": None}
    utility = db.query(Utility).filter(Utility.id == source.utility_id).first()
    from app.services.hierarchy import find_dma_within_utility_by_boundary

    dma = find_dma_within_utility_by_boundary(source.latitude, source.longitude, utility, db)
    return {"dma_id": dma.id if dma else None, "dma_name": dma.name if dma else None}


@water_sources_router.patch("/{water_source_id}", response_model=WaterSourceRead)
async def update_water_source(
    water_source_id: str,
    payload: WaterSourcePatch,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    source_ref = _source_or_404(sensor_db, water_source_id)
    _ensure_source_access(source_ref, current_user, db, "update")
    source = db.query(MainWaterSource).filter(MainWaterSource.id == water_source_id).first()
    if source is None:
        raise HTTPException(status_code=404, detail="Water source not found")

    changes: dict[str, Any] = {}
    if payload.dma_id is not None:
        dma = db.query(DMA).filter(DMA.id == payload.dma_id).first()
        if dma is None:
            raise HTTPException(status_code=404, detail="DMA not found")
        if dma.utility_id != source.utility_id:
            raise HTTPException(status_code=400, detail="DMA does not belong to the water source's utility")
        if current_user.user_type == "dma_manager" and current_user.dma_id != dma.id:
            raise HTTPException(status_code=403, detail="You can only assign a water source to your own DMA")
        source.dma_id = dma.id
        changes["dma_id"] = dma.id
    if payload.name is not None and payload.name.strip():
        source.name = payload.name.strip()
        changes["name"] = source.name
    if payload.latitude is not None:
        source.latitude = payload.latitude
        changes["latitude"] = payload.latitude
    if payload.longitude is not None:
        source.longitude = payload.longitude
        changes["longitude"] = payload.longitude
    if payload.status is not None:
        if payload.status not in {"active", "deactivated"}:
            raise HTTPException(status_code=400, detail="Invalid water source status")
        source.status = WaterSourceStatusEnum(payload.status)
        source.deactivated_at = datetime.utcnow() if payload.status == "deactivated" else None
        changes["status"] = payload.status

    audit_log(
        db,
        request=request,
        actor=current_user,
        action="water_source.update",
        event_type="water_source",
        status="success",
        entity="water_source",
        entity_id=source.id,
        target_name=source.name or source.source_key,
        utility_id=source.utility_id,
        metadata=changes,
    )
    db.commit()
    db.refresh(source)
    mirror_water_source(db, source)
    sensor_db.refresh(source_ref)
    return _source_read(source_ref)


def _registration_config(payload: WaterSourceSensorRegisterRequest) -> dict[str, Any]:
    if payload.category == "water_quality":
        return {
            "parameters": {
                field: bounds.model_dump(exclude_none=True)
                for field, bounds in (payload.parameter_thresholds or {}).items()
            }
        }
    return {
        "h1_m": payload.h1_m,
        "depth_m": payload.depth_m,
        "warning_height_m": payload.warning_height_m if payload.warning_height_m is not None else 10.0,
        "critical_height_m": payload.critical_height_m if payload.critical_height_m is not None else 0.0,
    }


@water_source_sensors_router.post(
    "",
    response_model=WaterSourceSensorRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_water_source_sensor(
    payload: WaterSourceSensorRegisterRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_utility_manager),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    if (
        sensor_db.query(SensorDevice.id).filter(SensorDevice.device_id == payload.device_id).first()
        or sensor_db.query(WaterSourceSensorDevice.id).filter(
            WaterSourceSensorDevice.device_id == payload.device_id
        ).first()
    ):
        raise HTTPException(status_code=409, detail="A sensor with this device_id is already registered")

    source = db.query(MainWaterSource).filter(MainWaterSource.id == payload.water_source_id).first()
    if source is None:
        raise HTTPException(status_code=404, detail="Water source not found")
    if source.status != WaterSourceStatusEnum.ACTIVE:
        raise HTTPException(status_code=400, detail="Water source is not active")
    source_ref = ensure_water_source_ref(db, sensor_db, source.id)
    if source_ref is None:
        raise HTTPException(status_code=404, detail="Water source not found")
    source_ref.dma_id = source.dma_id
    _ensure_source_access(source_ref, current_user, db)

    dma_auto_assigned = False
    if source.dma_id is None and source.latitude is not None and source.longitude is not None:
        utility = db.query(Utility).filter(Utility.id == source.utility_id).first()
        from app.services.hierarchy import find_dma_within_utility_by_boundary

        matched_dma = find_dma_within_utility_by_boundary(source.latitude, source.longitude, utility, db)
        if matched_dma:
            source.dma_id = matched_dma.id
            source_ref.dma_id = matched_dma.id
            dma_auto_assigned = True
            db.flush()

    category = SensorCategoryEnum(payload.category)
    if payload.activated:
        clash = sensor_db.query(WaterSourceSensorDevice.id).filter(
            WaterSourceSensorDevice.water_source_id == source.id,
            WaterSourceSensorDevice.category == category,
            WaterSourceSensorDevice.activated.is_(True),
        ).first()
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"Water source already has an active {payload.category} sensor",
            )

    sensor = WaterSourceSensorDevice(
        device_id=payload.device_id.strip(),
        category=category,
        water_source_id=source.id,
        activated=payload.activated,
        config=_registration_config(payload),
    )
    sensor_db.add(sensor)
    try:
        sensor_db.commit()
    except IntegrityError as exc:
        sensor_db.rollback()
        raise HTTPException(status_code=409, detail="Sensor ID or active category assignment already exists") from exc
    sensor_db.refresh(sensor)

    pending = load_pending_payloads(sensor_db, sensor.device_id, WaterSourceSensorPendingReading)
    if category == SensorCategoryEnum.WATER_QUALITY:
        promoted = promote_pending_water_quality(
            sensor_db, sensor, source_ref, pending,
            reading_model=WaterSourceWaterQualityReading,
            parent_field="water_source_id",
        )
    else:
        promoted = promote_pending_water_level(
            sensor_db, sensor, source_ref, pending,
            reading_model=WaterSourceWaterLevelReading,
            parent_field="water_source_id",
        )
    if pending:
        take_pending_rows(sensor_db, sensor.device_id, WaterSourceSensorPendingReading)
        sensor_db.commit()
    refresh_water_source_sensor_counts(sensor_db, source.id)
    db.commit()

    audit_log(
        db,
        request=request,
        actor=current_user,
        action="water_source_sensor.register",
        event_type="sensor",
        status="success",
        entity="water_source_sensor",
        entity_id=sensor.id,
        target_name=sensor.device_id,
        utility_id=source.utility_id,
        metadata={
            "device_id": sensor.device_id,
            "category": category.value,
            "water_source_id": source.id,
            "activated": sensor.activated,
            "promoted_readings": promoted,
        },
    )
    db.commit()
    return WaterSourceSensorRegisterResponse(
        id=sensor.id,
        device_id=sensor.device_id,
        category=sensor.category.value,
        water_source_id=sensor.water_source_id,
        utility_id=source_ref.utility_id,
        dma_id=source_ref.dma_id,
        dma_auto_assigned=dma_auto_assigned,
        config=sensor.config,
        activated=sensor.activated,
        promoted_readings=promoted,
        created_at=sensor.created_at,
        updated_at=sensor.updated_at,
    )


@water_source_sensors_router.get("", response_model=WaterSourceSensorListResponse)
async def list_water_source_sensors(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    scoped_ids = _source_ids_for_user(current_user, db, sensor_db)
    query = sensor_db.query(WaterSourceSensorDevice)
    if scoped_ids is not None:
        query = query.filter(WaterSourceSensorDevice.water_source_id.in_(scoped_ids))
    sensors = query.order_by(WaterSourceSensorDevice.created_at.desc()).all()
    items = [_sensor_read(sensor_db, sensor) for sensor in sensors]
    return WaterSourceSensorListResponse(total=len(items), items=items)


@water_source_sensors_router.get("/{device_id}", response_model=WaterSourceSensorRead)
async def get_water_source_sensor(
    device_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    sensor = sensor_db.query(WaterSourceSensorDevice).filter(
        WaterSourceSensorDevice.device_id == device_id
    ).first()
    if sensor is None:
        raise HTTPException(status_code=404, detail="Water-source sensor not found")
    source = _source_or_404(sensor_db, sensor.water_source_id)
    _ensure_source_access(source, current_user, db)
    return _sensor_read(sensor_db, sensor)


@water_source_sensors_router.patch("/{device_id}", response_model=WaterSourceSensorRegisterResponse)
async def update_water_source_sensor(
    device_id: str,
    payload: WaterSourceSensorUpdateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_utility_manager),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    sensor = sensor_db.query(WaterSourceSensorDevice).filter(
        WaterSourceSensorDevice.device_id == device_id
    ).first()
    if sensor is None:
        raise HTTPException(status_code=404, detail="Water-source sensor not found")
    old_ref = _source_or_404(sensor_db, sensor.water_source_id)
    _ensure_source_access(old_ref, current_user, db, "manage")
    source = db.query(MainWaterSource).filter(MainWaterSource.id == sensor.water_source_id).first()
    config = dict(sensor.config) if isinstance(sensor.config, dict) else {}
    changes: dict[str, Any] = {}

    if payload.water_source_id and payload.water_source_id != sensor.water_source_id:
        new_source = db.query(MainWaterSource).filter(MainWaterSource.id == payload.water_source_id).first()
        if new_source is None:
            raise HTTPException(status_code=404, detail="Water source not found")
        if new_source.status != WaterSourceStatusEnum.ACTIVE:
            raise HTTPException(status_code=400, detail="Water source is not active")
        new_ref = ensure_water_source_ref(db, sensor_db, new_source.id)
        if new_ref is None:
            raise HTTPException(status_code=404, detail="Water source not found")
        _ensure_source_access(new_ref, current_user, db, "manage")
        sensor.water_source_id = new_source.id
        source = new_source
        source_ref = new_ref
        changes["water_source_id"] = new_source.id
    else:
        source_ref = old_ref

    if sensor.category == SensorCategoryEnum.WATER_QUALITY:
        if payload.parameter_thresholds is not None:
            config["parameters"] = {
                key: value.model_dump(exclude_none=True)
                for key, value in payload.parameter_thresholds.items()
            }
            changes["parameter_thresholds"] = config["parameters"]
    else:
        for field in ("h1_m", "depth_m", "warning_height_m", "critical_height_m"):
            value = getattr(payload, field)
            if value is not None:
                config[field] = value
                changes[field] = value

    if payload.activated is True or sensor.activated:
        clash = sensor_db.query(WaterSourceSensorDevice.id).filter(
            WaterSourceSensorDevice.water_source_id == sensor.water_source_id,
            WaterSourceSensorDevice.category == sensor.category,
            WaterSourceSensorDevice.activated.is_(True),
            WaterSourceSensorDevice.id != sensor.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Water source already has an active sensor of this category")
    if payload.activated is not None:
        sensor.activated = payload.activated
        changes["activated"] = payload.activated

    if payload.dma_id == "":
        payload = payload.model_copy(update={"dma_id": None})
    if payload.dma_id is not None and source is not None:
        dma = db.query(DMA).filter(DMA.id == payload.dma_id).first()
        if dma is None:
            raise HTTPException(status_code=404, detail="DMA not found")
        if dma.utility_id != source.utility_id:
            raise HTTPException(status_code=400, detail="DMA does not belong to the water source's utility")
        if current_user.user_type == "dma_manager" and current_user.dma_id != dma.id:
            raise HTTPException(status_code=403, detail="You can only assign a sensor to your own DMA")
        source.dma_id = dma.id
        source_ref.dma_id = dma.id
        changes["dma_id"] = dma.id

    sensor.config = config
    if changes:
        sensor.updated_at = datetime.utcnow()
    audit_log(
        db,
        request=request,
        actor=current_user,
        action="water_source_sensor.update",
        event_type="sensor",
        status="success",
        entity="water_source_sensor",
        entity_id=sensor.id,
        target_name=sensor.device_id,
        utility_id=source.utility_id if source else source_ref.utility_id,
        metadata=changes,
    )
    db.commit()
    sensor_db.commit()
    refresh_water_source_sensor_counts(sensor_db, old_ref.id)
    refresh_water_source_sensor_counts(sensor_db, source_ref.id)
    if source is not None:
        db.refresh(source)
        mirror_water_source(db, source)
    sensor_db.refresh(sensor)
    return WaterSourceSensorRegisterResponse(
        id=sensor.id,
        device_id=sensor.device_id,
        category=sensor.category.value,
        water_source_id=sensor.water_source_id,
        utility_id=source_ref.utility_id,
        dma_id=source_ref.dma_id,
        config=sensor.config,
        activated=sensor.activated,
        created_at=sensor.created_at,
        updated_at=sensor.updated_at,
    )


@water_source_sensors_router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_water_source_sensor(
    device_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_utility_manager),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    sensor = sensor_db.query(WaterSourceSensorDevice).filter(
        WaterSourceSensorDevice.device_id == device_id
    ).first()
    if sensor is None:
        raise HTTPException(status_code=404, detail="Water-source sensor not found")
    source = _source_or_404(sensor_db, sensor.water_source_id)
    _ensure_source_access(source, current_user, db, "manage")
    model = _reading_model(sensor.category.value)
    deleted = sensor_db.query(model).filter(model.sensor_id == sensor.id).delete(synchronize_session=False)
    audit_log(
        db,
        request=request,
        actor=current_user,
        action="water_source_sensor.delete",
        event_type="sensor",
        status="success",
        entity="water_source_sensor",
        entity_id=sensor.id,
        target_name=sensor.device_id,
        utility_id=source.utility_id,
        metadata={"device_id": sensor.device_id, "deleted_readings": deleted},
    )
    db.commit()
    sensor_db.delete(sensor)
    sensor_db.commit()
    refresh_water_source_sensor_counts(sensor_db, source.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@water_sources_router.get("/{water_source_id}/readings", response_model=WaterSourceReadingsResponse)
async def list_water_source_readings(
    water_source_id: str,
    category: str = Query("water_level", pattern="^(water_level|water_quality)$"),
    limit: int = Query(30, ge=1, le=5000),
    sensor_id: Optional[str] = Query(None),
    start_at: Optional[datetime] = Query(None),
    end_at: Optional[datetime] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    source = _source_or_404(sensor_db, water_source_id)
    _ensure_source_access(source, current_user, db)
    sensors = sensor_db.query(WaterSourceSensorDevice).filter(
        WaterSourceSensorDevice.water_source_id == source.id,
        WaterSourceSensorDevice.activated.is_(True),
        WaterSourceSensorDevice.category == SensorCategoryEnum(category),
    ).all()
    sensor_ids = [sensor.id for sensor in sensors]
    model = _reading_model(category)
    query = sensor_db.query(model)
    if sensor_id:
        if sensor_id not in sensor_ids:
            raise HTTPException(status_code=404, detail="Active sensor not found on this water source")
        query = query.filter(model.sensor_id == sensor_id)
    elif sensor_ids:
        query = query.filter(model.sensor_id.in_(sensor_ids))
    else:
        query = query.filter(model.id.is_(None))
    if start_at is not None:
        query = query.filter(model.occurred_at >= start_at)
    if end_at is not None:
        query = query.filter(model.occurred_at <= end_at)
    total = query.count()
    rows = query.order_by(model.occurred_at.desc(), model.created_at.desc()).limit(limit).all()
    sensor_by_id = {sensor.id: sensor for sensor in sensors}
    items: list[dict[str, Any]] = []
    for row in rows:
        result: dict[str, Any] = {
            "ok": True,
            "category": category,
            "reading_id": row.id,
            "sensor_id": row.sensor_id,
            "water_source_id": row.water_source_id,
            "utility_id": row.utility_id,
            "dma_id": row.dma_id,
            "status": row.status.value,
            "occurred_at": row.occurred_at,
            "is_duplicate": False,
        }
        if category == "water_quality":
            from app.services.water_quality_services import WQ_PARAMETERS

            result["parameters"] = {
                field: getattr(row, field)
                for field in WQ_PARAMETERS
                if getattr(row, field, None) is not None
            }
        else:
            result.update(water_level_m=row.water_height_m, h1_m=row.h1_m, depth_m=row.depth_m)
        if row.sensor_id not in sensor_by_id:
            continue
        items.append(result)
    return WaterSourceReadingsResponse(total=total, items=items)


@water_source_sensors_router.post(
    "/ingest",
    response_model=(
        WaterSourceWaterLevelIngestResponse
        | WaterSourceWaterQualityIngestResponse
        | SensorPendingIngestResponse
    ),
)
async def ingest_water_source_sensor_reading(
    payload: SensorIngestRequest,
    current_user: CurrentUser = Depends(_current_user_or_ingest_key),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    sensor = sensor_db.query(WaterSourceSensorDevice).filter(
        WaterSourceSensorDevice.device_id == payload.device_id
    ).first()
    if sensor is None:
        if sensor_db.query(SensorDevice.id).filter(SensorDevice.device_id == payload.device_id).first():
            raise HTTPException(status_code=409, detail="This device is registered as a storage-facility sensor; use /api/storage-facility-sensors/ingest")
        flat = payload.model_dump()
        properties = flat.get("properties") or {}
        recognized = _water_level_payload_recognised(flat, properties) or bool(
            extract_water_quality(flat, properties, flat.get("raw_data"))
        )
        if not recognized:
            raise HTTPException(
                status_code=422,
                detail="Depth reading or at least one recognizable water-quality parameter is required",
            )
        return SensorPendingIngestResponse(
            **store_pending_reading(
                sensor_db,
                payload.device_id,
                flat,
                recognised=True,
                pending_model=WaterSourceSensorPendingReading,
            )
        )

    source_ref = _source_or_404(sensor_db, sensor.water_source_id)
    flat = payload.model_dump()
    if sensor.category == SensorCategoryEnum.WATER_QUALITY:
        result = ingest_water_quality_reading(
            sensor_db,
            sensor,
            source_ref,
            flat,
            reading_model=WaterSourceWaterQualityReading,
            parent_field="water_source_id",
        )
        return WaterSourceWaterQualityIngestResponse(**result)
    else:
        result = ingest_water_level_reading(
            sensor_db,
            sensor,
            source_ref,
            flat,
            reading_model=WaterSourceWaterLevelReading,
            parent_field="water_source_id",
        )
        return WaterSourceWaterLevelIngestResponse(**result)

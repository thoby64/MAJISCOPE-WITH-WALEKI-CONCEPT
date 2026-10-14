"""
Sensor Routes
Registration, ingest, and role-scoped read APIs for the water-level and
water-quality monitoring features.

All sensor/storage_facility-registry state lives in the SENSOR PLATFORM database
(get_sensor_db). StorageFacility ownership (creation, updates, DMA assignment) remains
in the main database; storage_facility reference rows are mirrored for scoped reads.
"""

import secrets
from datetime import datetime
from typing import Any, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database.session import get_db
from app.database.sensor_session import get_sensor_db
from app.models import (
    DMA,
    Utility,
)
from app.models.sensors import StorageFacility as MainStorageFacility
from app.models.sensor_platform import (
    SensorCategoryEnum,
    SensorDevice,
    SensorStatusEnum,
    StorageFacilityRef,
    StorageFacilityStatusEnum,
    WaterLevelReading,
    WaterQualityReading,
    WaterSourceSensorDevice,
)
from app.schemas.sensors import (
    StorageFacilityPatch,
    StorageFacilityRead,
    StorageFacilityListResponse,
    SensorRegisterRequest,
    SensorRegisterResponse,
    SensorUpdateRequest,
    SensorIngestRequest,
    SensorPendingIngestResponse,
    WaterLevelIngestResponse,
    WaterQualityIngestResponse,
    SensorLastReading,
    SensorRead,
    SensorListResponse,
    StorageFacilityReadingsResponse,
)
from app.security.dependencies import (
    get_current_user,
    require_utility_manager,
    CurrentUser,
)
from app.services.activity_logs import audit_log
from app.services.hierarchy import resolve_current_user_utility_id
from app.services.sensor_platform_sync import (
    drain_outbox,
    mirror_storage_facility,
    refresh_storage_facility_sensor_counts,
    upsert_storage_facility_ref,
)
from app.services.sensor_services import (
    load_pending_payloads,
    parse_timestamp,
    store_pending_reading,
    take_pending_rows,
)
from app.services.water_level_services import (
    derive_status as wl_derive_status,
    ingest_water_level_reading,
    promote_pending_water_level,
    wl_config,
)
from app.services.water_quality_services import (
    extract_water_quality,
    ingest_water_quality_reading,
    promote_pending_water_quality,
    wq_config,
)

sensors_router = APIRouter(prefix="/api/sensors", tags=["sensors"])
storage_facility_sensors_router = APIRouter(prefix="/api/storage-facility-sensors", tags=["storage-facility-sensors"])
storage_facilities_router = APIRouter(prefix="/api/storage-facilities", tags=["storage-facilities"])


# ============================================================================
# Sensor-DB lookups
# ============================================================================

def _get_storage_facility_ref_or_404(sensor_db: Session, storage_facility_id: str) -> StorageFacilityRef:
    storage_facility = sensor_db.get(StorageFacilityRef, storage_facility_id)
    if storage_facility is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="StorageFacility not found")
    return storage_facility


def _get_sensor_or_404(sensor_db: Session, device_id: str) -> SensorDevice:
    sensor = (
        sensor_db.query(SensorDevice).filter(SensorDevice.device_id == device_id).first()
    )
    if sensor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sensor not found")
    return sensor


def _latest_reading(sensor_db: Session, sensor: SensorDevice):
    model = WaterQualityReading if sensor.category == SensorCategoryEnum.WATER_QUALITY else WaterLevelReading
    return (
        sensor_db.query(model)
        .filter(model.sensor_id == sensor.id)
        .order_by(model.occurred_at.desc(), model.created_at.desc())
        .first()
    )


def _sensor_status(sensor_db: Session, sensor: SensorDevice) -> Tuple[str, Any]:
    reading = _latest_reading(sensor_db, sensor)
    if reading is not None:
        return reading.status.value, reading
    if sensor.category == SensorCategoryEnum.WATER_QUALITY:
        return SensorStatusEnum.INACTIVE.value, None
    cfg = wl_config(sensor)
    from app.services.water_level_services import compute_water_level

    height = compute_water_level(float(cfg.get("h1_m") or 0.0), float(cfg.get("depth_m") or 0.0))
    return wl_derive_status(sensor, height).value, None


def _reading_summary(sensor: SensorDevice, reading: Any) -> Optional[SensorLastReading]:
    if reading is None:
        return None
    base = {
        "ok": True,
        "category": sensor.category.value,
        "reading_id": reading.id,
        "sensor_id": reading.sensor_id,
        "storage_facility_id": reading.storage_facility_id,
        "utility_id": reading.utility_id,
        "dma_id": reading.dma_id,
        "status": reading.status.value,
        "occurred_at": reading.occurred_at,
        "is_duplicate": False,
    }
    if isinstance(reading, WaterQualityReading):
        from app.services.water_quality_services import WQ_PARAMETERS

        parameters = {
            field: getattr(reading, field)
            for field in WQ_PARAMETERS
            if getattr(reading, field, None) is not None
        }
        base["parameters"] = parameters
    else:
        base["water_level_m"] = reading.water_height_m
        base["h1_m"] = reading.h1_m
        base["depth_m"] = reading.depth_m
    return SensorLastReading(**base)


# ============================================================================
# Role scoping (main DB resolves user scope; sensor DB applies it)
# ============================================================================

def _storage_facility_scoped_ids(current_user: CurrentUser, db: Session, sensor_db: Session) -> Optional[set[str]]:
    """
    Return the set of storage_facility IDs the user may access, or ``None`` for admins.
    Scoping is resolved against storage_facility references (which carry utility/dma ids
    mirrored from the main DB).
    """
    if current_user.user_type == "user":
        return None

    from app.models import DMA as MainDMA

    if current_user.user_type == "dma_manager" and current_user.dma_id:
        storage_facilities = sensor_db.query(StorageFacilityRef.id).filter(StorageFacilityRef.dma_id == current_user.dma_id).all()
        return {storage_facility_id for (storage_facility_id,) in storage_facilities}

    utility_id = resolve_current_user_utility_id(current_user, db)
    if utility_id:
        storage_facilities = sensor_db.query(StorageFacilityRef.id).filter(StorageFacilityRef.utility_id == utility_id).all()
        return {storage_facility_id for (storage_facility_id,) in storage_facilities}

    return set()


def _ensure_storage_facility_access(
    storage_facility: StorageFacilityRef,
    current_user: CurrentUser,
    db: Session,
    *,
    action: str = "access",
) -> None:
    if current_user.user_type == "user":
        return

    if current_user.user_type == "dma_manager" and current_user.dma_id == storage_facility.dma_id:
        return

    utility_id = resolve_current_user_utility_id(current_user, db)
    if utility_id and storage_facility.utility_id == utility_id:
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"You do not have {action} to this storage_facility",
    )


def _ensure_sensor_access(
    sensor: SensorDevice,
    current_user: CurrentUser,
    db: Session,
    sensor_db: Session,
) -> None:
    storage_facility = _get_storage_facility_ref_or_404(sensor_db, sensor.storage_facility_id)
    _ensure_storage_facility_access(storage_facility, current_user, db, action="access to the sensor storage_facility")


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


@storage_facility_sensors_router.post(
    "/ingest",
    response_model=WaterLevelIngestResponse | WaterQualityIngestResponse | SensorPendingIngestResponse,
)
async def ingest_sensor_reading(
    payload: SensorIngestRequest,
    current_user: CurrentUser = Depends(_current_user_or_ingest_key),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    """
    Accept a reading from a registered or unregistered device.

    Registered devices: parsed + stored per the device's registered category.
    Unregistered devices: buffered as a pending raw payload, ready for
    association when the sensor is later registered.
    Accepts either a valid bearer token or the shared X-Ingest-Key header.
    """
    sensor = (
        sensor_db.query(SensorDevice)
        .filter(SensorDevice.device_id == payload.device_id)
        .first()
    )
    if sensor is not None:
        storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, sensor.storage_facility_id)
        if sensor.category == SensorCategoryEnum.WATER_QUALITY:
            result = ingest_water_quality_reading(sensor_db, sensor, storage_facility_ref, payload.model_dump())
            return WaterQualityIngestResponse(**result)

        result = ingest_water_level_reading(sensor_db, sensor, storage_facility_ref, payload.model_dump())
        return WaterLevelIngestResponse(**result)

    source_sensor = (
        sensor_db.query(WaterSourceSensorDevice.id)
        .filter(WaterSourceSensorDevice.device_id == payload.device_id)
        .first()
    )
    if source_sensor is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This device is registered as a water-source sensor; use /api/water-source-sensors/ingest",
        )

    # Unregistered device: only buffer when the payload carries recognizable
    # data for at least one known category (else 422, like today's depth rule).
    flat = payload.model_dump()
    properties = flat.get("properties") or {}
    wl_recognised = _water_level_payload_recognised(flat, properties)
    wq_recognised = bool(
        extract_water_quality(flat, properties, flat.get("raw_data"))
    )
    if not wl_recognised and not wq_recognised:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Depth reading is required (depth_m, Depth, raw_data, etc.) "
                   "or at least one recognizable water-quality parameter",
        )

    result = store_pending_reading(sensor_db, payload.device_id, flat, recognised=True)
    return SensorPendingIngestResponse(**result)


def _water_level_payload_recognised(flat: dict, properties: dict) -> bool:
    from app.services.water_level_services import extract_depth

    depth = extract_depth(properties, flat.get("raw_data"), flat)
    return depth is not None and depth > 0.0


# ============================================================================
# Sensor Devices
# ============================================================================

def _registration_config(payload: SensorRegisterRequest) -> dict:
    """Build the category-specific config JSONB for a new sensor."""
    if payload.category == "water_quality":
        cfg: dict = {}
        if payload.parameter_thresholds:
            cfg["parameters"] = {
                field: bounds.model_dump(exclude_none=True)
                for field, bounds in payload.parameter_thresholds.items()
            }
        return cfg

    wl_cfg: dict = {}
    if payload.h1_m is not None:
        wl_cfg["h1_m"] = payload.h1_m
    if payload.depth_m is not None:
        wl_cfg["depth_m"] = payload.depth_m
    wl_cfg["warning_height_m"] = payload.warning_height_m if payload.warning_height_m is not None else 10.0
    wl_cfg["critical_height_m"] = payload.critical_height_m if payload.critical_height_m is not None else 0.0
    return wl_cfg


@sensors_router.post("", response_model=SensorRegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_sensor(
    payload: SensorRegisterRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_utility_manager),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    """
    Register a new sensor (water level or water quality) against an existing
    active storage_facility.

    Admin and utility manager roles only. The target storage_facility must be active and
    within the caller's utility scope; device_ids are globally unique and
    follow the {UTILITY}_{DMA}_{SEQ} convention. One active sensor per
    category per storage_facility is enforced.
    """
    from app.services.sensor_platform_sync import ensure_storage_facility_ref

    existing = (
        sensor_db.query(SensorDevice)
        .filter(SensorDevice.device_id == payload.device_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A sensor with this device_id is already registered",
        )

    # Validate + scope the storage_facility in the MAIN db (source of truth), then ensure
    # its reference row exists in the sensor DB (self-heals mirror lag).
    main_storage_facility = db.query(MainStorageFacility).filter(MainStorageFacility.id == payload.storage_facility_id).first()
    if main_storage_facility is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="StorageFacility not found")
    if main_storage_facility.status != StorageFacilityStatusEnum.ACTIVE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="StorageFacility is not active")

    storage_facility_ref = ensure_storage_facility_ref(db, sensor_db, payload.storage_facility_id)
    if storage_facility_ref is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="StorageFacility not found")
    # Keep the mirrored dma_id in step with the main-DB storage_facility.
    if storage_facility_ref.dma_id != main_storage_facility.dma_id:
        storage_facility_ref.dma_id = main_storage_facility.dma_id
        sensor_db.commit()
    _ensure_storage_facility_access(storage_facility_ref, current_user, db, action="access")

    # DMA auto-assignment stays a main-DB concern (boundaries live there).
    dma_auto_assigned = False
    if main_storage_facility.dma_id is None and main_storage_facility.latitude is not None and main_storage_facility.longitude is not None:
        utility = db.query(Utility).filter(Utility.id == main_storage_facility.utility_id).first()
        from app.services.hierarchy import find_dma_within_utility_by_boundary

        matched_dma = find_dma_within_utility_by_boundary(
            main_storage_facility.latitude, main_storage_facility.longitude, utility, db
        )
        if matched_dma is not None:
            main_storage_facility.dma_id = matched_dma.id
            db.flush()
            dma_auto_assigned = True
            storage_facility_ref.dma_id = matched_dma.id
            sensor_db.commit()

    # One active sensor per category per storage_facility (partial unique index also
    # guards this at the DB level).
    if payload.activated:
        clash = (
            sensor_db.query(SensorDevice)
            .filter(
                SensorDevice.storage_facility_id == payload.storage_facility_id,
                SensorDevice.category == SensorCategoryEnum(payload.category),
                SensorDevice.activated.is_(True),
                SensorDevice.id != existing.id if existing is not None else True,
            )
            .first()
        )
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"StorageFacility already has an active {payload.category} sensor "
                       f"({clash.device_id}); only one active sensor per category per storage_facility is allowed",
            )

    config = _registration_config(payload)
    sensor = SensorDevice(
        device_id=payload.device_id,
        category=SensorCategoryEnum(payload.category),
        storage_facility_id=storage_facility_ref.id,
        activated=payload.activated,
        config=config,
    )
    sensor_db.add(sensor)
    sensor_db.commit()
    sensor_db.refresh(sensor)

    # Promote any readings buffered while the device was unregistered,
    # parsing them per the chosen category.
    pending_payloads = load_pending_payloads(sensor_db, payload.device_id)
    if payload.category == "water_quality":
        promoted = promote_pending_water_quality(sensor_db, sensor, storage_facility_ref, pending_payloads)
    else:
        promoted = promote_pending_water_level(sensor_db, sensor, storage_facility_ref, pending_payloads)
    if pending_payloads:
        take_pending_rows(sensor_db, payload.device_id)
        sensor_db.commit()
    refresh_storage_facility_sensor_counts(sensor_db, storage_facility_ref.id)

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
        utility_id=storage_facility_ref.utility_id,
        metadata={
            "device_id": payload.device_id,
            "category": payload.category,
            "storage_facility_id": storage_facility_ref.id,
            "activated": payload.activated,
            "promoted_readings": promoted,
        },
    )
    db.commit()

    return SensorRegisterResponse(
        id=sensor.id,
        device_id=sensor.device_id,
        category=sensor.category.value,
        storage_facility_id=sensor.storage_facility_id,
        utility_id=storage_facility_ref.utility_id,
        dma_id=storage_facility_ref.dma_id,
        dma_auto_assigned=dma_auto_assigned,
        config=sensor.config,
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
    sensor_db: Session = Depends(get_sensor_db),
):
    sensor = _get_sensor_or_404(sensor_db, device_id)
    _ensure_sensor_access(sensor, current_user, db, sensor_db)
    storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, sensor.storage_facility_id)

    if payload.dma_id == "":
        payload = payload.model_copy(update={"dma_id": None})

    changes: dict[str, Any] = {}
    config = dict(sensor.config) if isinstance(sensor.config, dict) else {}

    if payload.storage_facility_id and payload.storage_facility_id != sensor.storage_facility_id:
        main_storage_facility = db.query(MainStorageFacility).filter(MainStorageFacility.id == payload.storage_facility_id).first()
        if main_storage_facility is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="StorageFacility not found")
        if main_storage_facility.status != StorageFacilityStatusEnum.ACTIVE:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="StorageFacility is not active")
        from app.services.sensor_platform_sync import ensure_storage_facility_ref

        new_ref = ensure_storage_facility_ref(db, sensor_db, payload.storage_facility_id)
        if new_ref is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="StorageFacility not found")
        _ensure_storage_facility_access(new_ref, current_user, db, action="access")
        sensor.storage_facility_id = new_ref.id
        changes["storage_facility_id"] = new_ref.id
        storage_facility_ref = new_ref

    is_wq = sensor.category == SensorCategoryEnum.WATER_QUALITY

    if is_wq:
        if payload.parameter_thresholds is not None:
            config["parameters"] = {
                field: bounds.model_dump(exclude_none=True)
                for field, bounds in payload.parameter_thresholds.items()
            }
            changes["parameter_thresholds"] = config["parameters"]
    else:
        if payload.h1_m is not None:
            config["h1_m"] = payload.h1_m
            changes["h1_m"] = payload.h1_m
        if payload.depth_m is not None:
            config["depth_m"] = payload.depth_m
            changes["depth_m"] = payload.depth_m
        if payload.warning_height_m is not None:
            config["warning_height_m"] = payload.warning_height_m
            changes["warning_height_m"] = payload.warning_height_m
        if payload.critical_height_m is not None:
            config["critical_height_m"] = payload.critical_height_m
            changes["critical_height_m"] = payload.critical_height_m

    if payload.activated is not None:
        if payload.activated:
            clash = (
                sensor_db.query(SensorDevice)
                .filter(
                    SensorDevice.storage_facility_id == sensor.storage_facility_id,
                    SensorDevice.category == sensor.category,
                    SensorDevice.activated.is_(True),
                    SensorDevice.id != sensor.id,
                )
                .first()
            )
            if clash is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"StorageFacility already has an active {sensor.category.value} sensor "
                           f"({clash.device_id}); only one active sensor per category per storage_facility is allowed",
                )
        sensor.activated = payload.activated
        changes["activated"] = payload.activated

    sensor.config = config
    if changes:
        sensor.updated_at = datetime.utcnow()

    dma_auto_assigned = False
    if "storage_facility_id" in changes:
        # StorageFacility moved: auto-detect the DMA from the new storage_facility's coordinates,
        # exactly like registration. Detection takes priority over the
        # manually supplied dma_id.
        main_storage_facility = db.query(MainStorageFacility).filter(MainStorageFacility.id == sensor.storage_facility_id).first()
        if main_storage_facility is not None and main_storage_facility.latitude is not None and main_storage_facility.longitude is not None:
            utility = db.query(Utility).filter(Utility.id == main_storage_facility.utility_id).first()
            from app.services.hierarchy import find_dma_within_utility_by_boundary

            detected = find_dma_within_utility_by_boundary(
                main_storage_facility.latitude, main_storage_facility.longitude, utility, db
            )
            if detected is not None and detected.id != main_storage_facility.dma_id:
                main_storage_facility.dma_id = detected.id
                db.flush()
                storage_facility_ref.dma_id = detected.id
                sensor_db.commit()
                changes["dma_id"] = detected.id
                dma_auto_assigned = True
            if detected is not None:
                payload = payload.model_copy(update={"dma_id": None})

    if payload.dma_id is not None:
        main_storage_facility = db.query(MainStorageFacility).filter(MainStorageFacility.id == sensor.storage_facility_id).first()
        if main_storage_facility is not None and payload.dma_id != main_storage_facility.dma_id:
            dma = db.query(DMA).filter(DMA.id == payload.dma_id).first()
            if dma is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DMA not found")
            if dma.utility_id != main_storage_facility.utility_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="DMA does not belong to the sensor's utility",
                )
            if current_user.user_type == "dma_manager" and current_user.dma_id != dma.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only assign a sensor to your own DMA",
                )
            main_storage_facility.dma_id = dma.id
            db.flush()
            storage_facility_ref.dma_id = dma.id
            changes["dma_id"] = dma.id

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
        utility_id=storage_facility_ref.utility_id,
        metadata=changes,
    )
    db.commit()
    sensor_db.commit()
    sensor_db.refresh(sensor)
    refresh_storage_facility_sensor_counts(sensor_db, storage_facility_ref.id)
    return SensorRegisterResponse(
        id=sensor.id,
        device_id=sensor.device_id,
        category=sensor.category.value,
        storage_facility_id=sensor.storage_facility_id,
        utility_id=storage_facility_ref.utility_id,
        dma_id=storage_facility_ref.dma_id,
        dma_auto_assigned=dma_auto_assigned,
        config=sensor.config,
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
    sensor_db: Session = Depends(get_sensor_db),
):
    """
    Delete a sensor and cascade-delete its reading history.

    Admin and utility manager roles only. The sensor storage_facility must be within the
    caller's utility scope (DMA managers / engineers cannot delete).
    """
    sensor = _get_sensor_or_404(sensor_db, device_id)
    _ensure_sensor_access(sensor, current_user, db, sensor_db)
    storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, sensor.storage_facility_id)

    reading_model = (
        WaterQualityReading
        if sensor.category == SensorCategoryEnum.WATER_QUALITY
        else WaterLevelReading
    )
    deleted_readings = (
        sensor_db.query(reading_model)
        .filter(reading_model.sensor_id == sensor.id)
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
        utility_id=storage_facility_ref.utility_id,
        metadata={
            "device_id": sensor.device_id,
            "category": sensor.category.value,
            "storage_facility_id": storage_facility_ref.id,
            "deleted_readings": deleted_readings,
        },
    )
    db.commit()
    sensor_db.delete(sensor)
    sensor_db.commit()
    refresh_storage_facility_sensor_counts(sensor_db, storage_facility_ref.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@sensors_router.get("", response_model=SensorListResponse)
async def list_sensors(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    scoped_storage_facility_ids = _storage_facility_scoped_ids(current_user, db, sensor_db)

    query = sensor_db.query(SensorDevice)
    if scoped_storage_facility_ids is not None:
        query = query.filter(SensorDevice.storage_facility_id.in_(scoped_storage_facility_ids))

    sensors = query.all()
    items: list[SensorRead] = []
    for sensor in sensors:
        storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, sensor.storage_facility_id)
        status_value, reading = _sensor_status(sensor_db, sensor)
        items.append(
            SensorRead(
                id=sensor.id,
                device_id=sensor.device_id,
                category=sensor.category.value,
                storage_facility_id=sensor.storage_facility_id,
                storage_facility_name=storage_facility_ref.name or storage_facility_ref.source_key,
                utility_id=storage_facility_ref.utility_id,
                dma_id=storage_facility_ref.dma_id,
                config=sensor.config,
                activated=sensor.activated,
                status=status_value,
                last_reading=_reading_summary(sensor, reading),
                created_at=sensor.created_at,
                updated_at=sensor.updated_at,
            )
        )

    return SensorListResponse(total=len(items), items=items)


# ============================================================================
# StorageFacilitys (sensor-platform registry reads; ownership stays in the main DB)
# ============================================================================

def _storage_facility_read(storage_facility_ref: StorageFacilityRef) -> StorageFacilityRead:
    return StorageFacilityRead(
        id=storage_facility_ref.id,
        utility_id=storage_facility_ref.utility_id,
        dma_id=storage_facility_ref.dma_id,
        source_key=storage_facility_ref.source_key,
        name=storage_facility_ref.name,
        latitude=storage_facility_ref.latitude,
        longitude=storage_facility_ref.longitude,
        status=storage_facility_ref.status.value if hasattr(storage_facility_ref.status, "value") else storage_facility_ref.status,
        sensor_count=storage_facility_ref.sensor_count or 0,
        active_sensor_count=storage_facility_ref.active_sensor_count or 0,
        created_at=storage_facility_ref.created_at,
        updated_at=storage_facility_ref.updated_at,
        deactivated_at=storage_facility_ref.deactivated_at,
    )


@storage_facilities_router.get("", response_model=StorageFacilityListResponse)
async def list_sensor_storage_facilities(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    """
    Role-scoped storage_facility list including sensor counts.

    Admin sees all storage_facilities; utility managers see their own; DMA managers see the
    storage_facilities linked to their DMA.
    """
    # Drain any mirror backlog so lists reflect recent main-DB storage_facility changes.
    try:
        drain_outbox(db)
    except Exception:
        pass

    scoped_storage_facility_ids = _storage_facility_scoped_ids(current_user, db, sensor_db)

    query = sensor_db.query(StorageFacilityRef)
    if scoped_storage_facility_ids is not None:
        query = query.filter(StorageFacilityRef.id.in_(scoped_storage_facility_ids))

    storage_facilities = query.order_by(StorageFacilityRef.created_at.desc()).all()
    return StorageFacilityListResponse(
        total=len(storage_facilities),
        items=[_storage_facility_read(t) for t in storage_facilities],
    )


@storage_facilities_router.get("/{storage_facility_id}", response_model=StorageFacilityRead)
async def get_sensor_storage_facility(
    storage_facility_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, storage_facility_id)
    _ensure_storage_facility_access(storage_facility_ref, current_user, db, action="access")
    return _storage_facility_read(storage_facility_ref)


@storage_facilities_router.get("/{storage_facility_id}/detect-dma")
async def detect_storage_facility_dma(
    storage_facility_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    """
    Detect which of the storage_facility's utility DMA boundaries contain the storage_facility's
    coordinates (main-DB geometry). Returns null values when no boundary
    matches so the client can fall back to manual selection.
    """
    storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, storage_facility_id)
    _ensure_storage_facility_access(storage_facility_ref, current_user, db, action="access")

    main_storage_facility = db.query(MainStorageFacility).filter(MainStorageFacility.id == storage_facility_id).first()
    if main_storage_facility is None or main_storage_facility.latitude is None or main_storage_facility.longitude is None:
        return {"dma_id": None, "dma_name": None}
    utility = db.query(Utility).filter(Utility.id == main_storage_facility.utility_id).first()
    from app.services.hierarchy import find_dma_within_utility_by_boundary

    dma = find_dma_within_utility_by_boundary(main_storage_facility.latitude, main_storage_facility.longitude, utility, db)
    return {
        "dma_id": dma.id if dma else None,
        "dma_name": dma.name if dma else None,
    }


@storage_facilities_router.patch("/{storage_facility_id}", response_model=StorageFacilityRead)
async def update_sensor_storage_facility(
    storage_facility_id: str,
    payload: StorageFacilityPatch,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    """
    Update storage_facility assignment and geography.

    The main-DB storage_facility row is the source of truth; changes are applied there
    first, then mirrored to the sensor platform. dma_id may be assigned by
    admins, the owning utility manager, or the DMA manager of the target DMA.
    """
    storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, storage_facility_id)
    _ensure_storage_facility_access(storage_facility_ref, current_user, db, action="access")

    main_storage_facility = db.query(MainStorageFacility).filter(MainStorageFacility.id == storage_facility_id).first()
    if main_storage_facility is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="StorageFacility not found")

    changes: dict[str, Any] = {}
    if payload.dma_id is not None:
        dma = db.query(DMA).filter(DMA.id == payload.dma_id).first()
        if dma is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DMA not found")
        if dma.utility_id != main_storage_facility.utility_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="DMA does not belong to the storage_facility's utility",
            )
        if current_user.user_type == "dma_manager" and current_user.dma_id != dma.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only assign a storage_facility to your own DMA",
            )
        if main_storage_facility.dma_id != dma.id:
            main_storage_facility.dma_id = dma.id
            changes["dma_id"] = dma.id
    if payload.name is not None and payload.name.strip():
        main_storage_facility.name = payload.name.strip()
        changes["name"] = main_storage_facility.name
    if payload.latitude is not None:
        main_storage_facility.latitude = payload.latitude
        changes["latitude"] = payload.latitude
    if payload.longitude is not None:
        main_storage_facility.longitude = payload.longitude
        changes["longitude"] = payload.longitude
    if payload.status is not None:
        if payload.status == "deactivated":
            main_storage_facility.status = StorageFacilityStatusEnum.DEACTIVATED
            main_storage_facility.deactivated_at = datetime.utcnow()
        elif payload.status == "active":
            main_storage_facility.status = StorageFacilityStatusEnum.ACTIVE
            main_storage_facility.deactivated_at = None
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid storage_facility status")
        changes["status"] = main_storage_facility.status.value

    audit_log(
        db,
        request=request,
        actor=current_user,
        action="storage_facility.update",
        event_type="storage_facility",
        status="success",
        entity="storage_facility",
        entity_id=main_storage_facility.id,
        target_name=main_storage_facility.name or main_storage_facility.source_key,
        utility_id=main_storage_facility.utility_id,
        metadata=changes,
    )
    db.commit()
    db.refresh(main_storage_facility)

    # Mirror the updated storage_facility into the sensor platform.
    mirror_storage_facility(db, main_storage_facility)
    sensor_db.expire_all()
    storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, storage_facility_id)
    return _storage_facility_read(storage_facility_ref)


@storage_facilities_router.get("/{storage_facility_id}/readings", response_model=StorageFacilityReadingsResponse)
async def list_storage_facility_readings(
    storage_facility_id: str,
    category: str = Query("water_level", pattern="^(water_level|water_quality)$"),
    limit: int = Query(30, ge=1, le=5000),
    sensor_id: Optional[str] = Query(None),
    start_at: Optional[datetime] = Query(None),
    end_at: Optional[datetime] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    sensor_db: Session = Depends(get_sensor_db),
):
    """
    Reading history for active sensors on a storage_facility, newest first. An optional
    sensor_id narrows the result to one sensor; start_at/end_at bound the
    occurrence time. Scoped to the caller's utility/DMA. Inactive sensors and
    their history are excluded.
    """
    storage_facility_ref = _get_storage_facility_ref_or_404(sensor_db, storage_facility_id)
    _ensure_storage_facility_access(storage_facility_ref, current_user, db, action="access")

    active_sensor_ids = [
        row[0]
        for row in sensor_db.query(SensorDevice.id)
        .filter(
            SensorDevice.storage_facility_id == storage_facility_ref.id,
            SensorDevice.activated.is_(True),
            SensorDevice.category == SensorCategoryEnum(category),
        )
        .all()
    ]

    model = WaterQualityReading if category == "water_quality" else WaterLevelReading
    query = sensor_db.query(model)
    if sensor_id:
        if sensor_id not in active_sensor_ids:
            raise HTTPException(status_code=404, detail="Active sensor not found on this storage_facility")
        query = query.filter(model.sensor_id == sensor_id)
    elif active_sensor_ids:
        query = query.filter(model.sensor_id.in_(active_sensor_ids))
    else:
        query = query.filter(model.id.is_(None))

    if start_at is not None:
        query = query.filter(model.occurred_at >= start_at)
    if end_at is not None:
        query = query.filter(model.occurred_at <= end_at)

    total = query.count()
    readings = (
        query.order_by(model.occurred_at.desc(), model.created_at.desc())
        .limit(limit)
        .all()
    )
    return StorageFacilityReadingsResponse(
        total=total,
        items=[
            _history_item(_sensors_by_id(sensor_db, active_sensor_ids), r)
            for r in readings
        ],
    )


def _sensors_by_id(sensor_db: Session, sensor_ids: list[str]) -> dict[str, SensorDevice]:
    sensors = {}
    if sensor_ids:
        for s in sensor_db.query(SensorDevice).filter(SensorDevice.id.in_(sensor_ids)).all():
            sensors[s.id] = s
    return sensors


def _history_item(sensors: dict[str, SensorDevice], reading: Any) -> dict:
    sensor = sensors.get(reading.sensor_id)
    category = sensor.category.value if sensor is not None else "water_level"
    if isinstance(reading, WaterQualityReading):
        from app.services.water_quality_services import WQ_PARAMETERS

        parameters = {
            field: getattr(reading, field)
            for field in WQ_PARAMETERS
            if getattr(reading, field, None) is not None
        }
        return {
            "ok": True,
            "category": "water_quality",
            "reading_id": reading.id,
            "sensor_id": reading.sensor_id,
            "storage_facility_id": reading.storage_facility_id,
            "utility_id": reading.utility_id,
            "dma_id": reading.dma_id,
            "status": reading.status.value,
            "parameters": parameters,
            "occurred_at": reading.occurred_at,
            "is_duplicate": False,
        }
    return {
        "ok": True,
        "category": "water_level",
        "reading_id": reading.id,
        "sensor_id": reading.sensor_id,
        "storage_facility_id": reading.storage_facility_id,
        "utility_id": reading.utility_id,
        "dma_id": reading.dma_id,
        "water_level_m": reading.water_height_m,
        "h1_m": reading.h1_m,
        "depth_m": reading.depth_m,
        "status": reading.status.value,
        "occurred_at": reading.occurred_at,
        "is_duplicate": False,
    }

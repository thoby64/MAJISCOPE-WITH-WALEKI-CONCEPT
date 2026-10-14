"""
Sensor Platform Sync Service

One-directional replication of MAIN-DB state into the sensor platform DB:

  - storage_facility rows (owned by the main DB) are mirrored into the sensor DB's
    ``storage_facility`` reference table
  - the sensor registry and readings are written directly to the sensor DB
    by the API layer (app.database.sensor_session.get_sensor_db) — they are
    NOT mirrored

Failure isolation: when the sensor DB is unreachable, a storage_facility write in the
main DB still succeeds — the mirror intent is persisted in a durable
``sensor_mirror_outbox`` table (main DB) and drained later. StorageFacility creation in
the main system is therefore never blocked by sensor-platform availability.

Hook contract: call ``mirror_storage_facility`` AFTER the business transaction commits.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.database.sensor_session import SensorSessionLocal
from app.models.sensor_platform import (
    SensorDevice as PlatformSensorDevice,
    StorageFacilityRef,
    StorageFacilityStatusEnum,
    WaterSourceRef,
    WaterSourceSensorDevice,
    WaterSourceStatusEnum,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Outbox (lives in the MAIN database so mirror failures never block writers)
# ============================================================================

def ensure_outbox_table(db: Session) -> None:
    """Create the outbox table in the main DB if missing (idempotent)."""
    ddl = """
    CREATE TABLE IF NOT EXISTS sensor_mirror_outbox (
        id VARCHAR(36) PRIMARY KEY,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        op VARCHAR(30) NOT NULL,
        storage_facility_id VARCHAR(36),
        payload TEXT
    )
    """
    db.execute(sql_text(ddl))


def _queue_outbox(db: Session, op: str, storage_facility_id: Optional[str], payload: Optional[Dict[str, Any]] = None) -> None:
    """Persist a mirror intent in the main DB so it survives outages."""
    ensure_outbox_table(db)
    db.execute(
        sql_text(
            "INSERT INTO sensor_mirror_outbox (id, op, storage_facility_id, payload) "
            "VALUES (:id, :op, :storage_facility_id, :payload)"
        ),
        {
            "id": str(uuid.uuid4()),
            "op": op,
            "storage_facility_id": storage_facility_id,
            "payload": json.dumps(payload, default=str) if payload is not None else None,
        },
    )
    db.commit()


# ============================================================================
# Sensor-DB upserts
# ============================================================================

def upsert_storage_facility_ref(sensor_db: Session, payload: Dict[str, Any]) -> None:
    """Insert or refresh a storage_facility reference row in the sensor DB (idempotent)."""
    storage_facility_id = payload["id"]
    status_value = payload.get("status") or "active"
    storage_facility_ref = sensor_db.get(StorageFacilityRef, storage_facility_id)
    if storage_facility_ref is None:
        storage_facility_ref = StorageFacilityRef(
            id=storage_facility_id,
            utility_id=payload["utility_id"],
            dma_id=payload.get("dma_id"),
            source_key=payload["source_key"],
            name=payload.get("name"),
            latitude=payload.get("latitude"),
            longitude=payload.get("longitude"),
            status=StorageFacilityStatusEnum(status_value),
            created_at=payload.get("created_at") or datetime.utcnow(),
            updated_at=payload.get("updated_at") or datetime.utcnow(),
            deactivated_at=payload.get("deactivated_at"),
        )
        sensor_db.add(storage_facility_ref)
    else:
        storage_facility_ref.utility_id = payload["utility_id"]
        storage_facility_ref.dma_id = payload.get("dma_id")
        storage_facility_ref.source_key = payload["source_key"]
        storage_facility_ref.name = payload.get("name")
        storage_facility_ref.latitude = payload.get("latitude")
        storage_facility_ref.longitude = payload.get("longitude")
        storage_facility_ref.status = StorageFacilityStatusEnum(status_value)
        storage_facility_ref.updated_at = payload.get("updated_at") or datetime.utcnow()
        storage_facility_ref.deactivated_at = payload.get("deactivated_at")
    sensor_db.commit()


def refresh_storage_facility_sensor_counts(sensor_db: Session, storage_facility_id: str) -> None:
    """Recompute denormalized sensor counts on storage_facility_ref from the registry."""
    storage_facility_ref = sensor_db.get(StorageFacilityRef, storage_facility_id)
    if storage_facility_ref is None:
        return
    devices = (
        sensor_db.query(PlatformSensorDevice)
        .filter(PlatformSensorDevice.storage_facility_id == storage_facility_id)
        .all()
    )
    storage_facility_ref.sensor_count = len(devices)
    storage_facility_ref.active_sensor_count = sum(1 for d in devices if d.activated)
    sensor_db.commit()


def ensure_storage_facility_ref(db: Session, sensor_db: Session, storage_facility_id: str) -> Optional[StorageFacilityRef]:
    """
    Self-heal: return the storage_facility_ref row, mirroring it from the main DB on
    demand if the mirror is lagging (e.g. registration right after creation).
    """
    storage_facility_ref = sensor_db.get(StorageFacilityRef, storage_facility_id)
    if storage_facility_ref is not None:
        return storage_facility_ref
    from app.models.sensors import StorageFacility

    storage_facility = db.query(StorageFacility).filter(StorageFacility.id == storage_facility_id).first()
    if storage_facility is None:
        return None
    payload = _storage_facility_payload_from_row(storage_facility)
    upsert_storage_facility_ref(sensor_db, payload)
    return sensor_db.get(StorageFacilityRef, storage_facility_id)


def _storage_facility_payload_from_row(row: Any) -> Dict[str, Any]:
    return {
        "id": row.id,
        "utility_id": row.utility_id,
        "dma_id": row.dma_id,
        "source_key": row.source_key,
        "name": row.name,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "status": row.status.value if hasattr(row.status, "value") else str(row.status),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "deactivated_at": row.deactivated_at,
    }


def upsert_water_source_ref(sensor_db: Session, payload: Dict[str, Any]) -> None:
    """Insert or refresh a water-source projection in the sensor database."""
    source = sensor_db.get(WaterSourceRef, payload["id"])
    status_value = payload.get("status") or "active"
    values = {
        "utility_id": payload["utility_id"],
        "dma_id": payload.get("dma_id"),
        "source_key": payload["source_key"],
        "name": payload.get("name"),
        "source_type": payload.get("source_type"),
        "latitude": payload.get("latitude"),
        "longitude": payload.get("longitude"),
        "status": WaterSourceStatusEnum(status_value),
        "updated_at": payload.get("updated_at") or datetime.utcnow(),
        "deactivated_at": payload.get("deactivated_at"),
    }
    if source is None:
        source = WaterSourceRef(
            id=payload["id"],
            created_at=payload.get("created_at") or datetime.utcnow(),
            **values,
        )
        sensor_db.add(source)
    else:
        for field, value in values.items():
            setattr(source, field, value)
    sensor_db.commit()


def refresh_water_source_sensor_counts(sensor_db: Session, water_source_id: str) -> None:
    source = sensor_db.get(WaterSourceRef, water_source_id)
    if source is None:
        return
    sensors = sensor_db.query(WaterSourceSensorDevice).filter(
        WaterSourceSensorDevice.water_source_id == water_source_id
    ).all()
    source.sensor_count = len(sensors)
    source.active_sensor_count = sum(sensor.activated for sensor in sensors)
    sensor_db.commit()


def ensure_water_source_ref(
    db: Session,
    sensor_db: Session,
    water_source_id: str,
) -> Optional[WaterSourceRef]:
    source_ref = sensor_db.get(WaterSourceRef, water_source_id)
    if source_ref is not None:
        return source_ref
    from app.models.sensors import WaterSource

    source = db.query(WaterSource).filter(WaterSource.id == water_source_id).first()
    if source is None:
        return None
    upsert_water_source_ref(sensor_db, _water_source_payload_from_row(source))
    return sensor_db.get(WaterSourceRef, water_source_id)


def _water_source_payload_from_row(row: Any) -> Dict[str, Any]:
    return {
        "id": row.id,
        "utility_id": row.utility_id,
        "dma_id": row.dma_id,
        "source_key": row.source_key,
        "name": row.name,
        "source_type": row.source_type,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "status": row.status.value if hasattr(row.status, "value") else str(row.status),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "deactivated_at": row.deactivated_at,
    }


def _ensure_water_source_outbox_table(db: Session) -> None:
    db.execute(sql_text("""
        CREATE TABLE IF NOT EXISTS water_source_sensor_mirror_outbox (
            id VARCHAR(36) PRIMARY KEY,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            payload TEXT NOT NULL
        )
    """))


def mirror_water_source(db: Session, row: Any) -> None:
    payload = _water_source_payload_from_row(row)
    try:
        with SensorSessionLocal() as sensor_db:
            upsert_water_source_ref(sensor_db, payload)
    except Exception as exc:
        logger.warning("Water-source mirror deferred for %s: %s", payload["id"], exc)
        try:
            _ensure_water_source_outbox_table(db)
            db.execute(
                sql_text(
                    "INSERT INTO water_source_sensor_mirror_outbox (id, payload) "
                    "VALUES (:id, :payload)"
                ),
                {"id": str(uuid.uuid4()), "payload": json.dumps(payload, default=str)},
            )
            db.commit()
        except Exception as queue_exc:
            logger.error("Failed to queue water-source mirror for %s: %s", payload["id"], queue_exc)


def reconcile_all_water_sources(db: Session) -> Dict[str, int]:
    from app.models.sensors import WaterSource

    _ensure_water_source_outbox_table(db)
    rows = db.execute(
        sql_text(
            "SELECT id, payload FROM water_source_sensor_mirror_outbox "
            "ORDER BY created_at LIMIT 200"
        )
    ).fetchall()
    drained = 0
    for outbox_id, payload_text in rows:
        try:
            payload = json.loads(payload_text)
            with SensorSessionLocal() as sensor_db:
                upsert_water_source_ref(sensor_db, payload)
            db.execute(
                sql_text("DELETE FROM water_source_sensor_mirror_outbox WHERE id = :id"),
                {"id": outbox_id},
            )
            db.commit()
            drained += 1
        except Exception as exc:
            logger.warning("Water-source mirror outbox entry %s remains queued: %s", outbox_id, exc)
            db.rollback()

    sources = db.query(WaterSource).all()
    mirrored = 0
    for source in sources:
        try:
            with SensorSessionLocal() as sensor_db:
                upsert_water_source_ref(sensor_db, _water_source_payload_from_row(source))
                refresh_water_source_sensor_counts(sensor_db, source.id)
            mirrored += 1
        except Exception as exc:
            logger.warning("Water-source reconcile failed for %s: %s", source.id, exc)
    return {"mirrored": mirrored, "total": len(sources), "drained": drained}


# ============================================================================
# Public hook API (call AFTER the main-DB business transaction commits)
# ============================================================================

def mirror_storage_facility(db: Session, storage_facility_row: Any) -> None:
    """
    Immediately attempt a storage_facility mirror upsert; on sensor-DB failure, queue the
    intent durably in the main-DB outbox instead of blocking the writer.
    """
    payload = _storage_facility_payload_from_row(storage_facility_row)
    try:
        with SensorSessionLocal() as sensor_db:
            upsert_storage_facility_ref(sensor_db, payload)
    except Exception as exc:
        logger.warning("StorageFacility mirror deferred for %s: %s", payload["id"], exc)
        try:
            _queue_outbox(db, "upsert_storage_facility", payload["id"], payload)
        except Exception as queue_exc:
            logger.error("Failed to queue storage_facility mirror for %s: %s", payload["id"], queue_exc)


# ============================================================================
# Outbox drain + full reconcile
# ============================================================================

def drain_outbox(db: Session, limit: int = 200) -> int:
    """
    Apply queued mirror entries left over from sensor-DB outages.
    Returns the number of applied entries.
    """
    ensure_outbox_table(db)
    rows = db.execute(
        sql_text(
            "SELECT id, op, storage_facility_id, payload FROM sensor_mirror_outbox "
            "ORDER BY created_at LIMIT :limit"
        ),
        {"limit": limit},
    ).fetchall()
    applied = 0
    for outbox_id, op, storage_facility_id, payload_text in rows:
        try:
            payload = json.loads(payload_text) if payload_text else None
            if op in {"upsert_storage_facility", "upsert_tank"} and payload is not None:
                with SensorSessionLocal() as sensor_db:
                    upsert_storage_facility_ref(sensor_db, payload)
            else:
                logger.warning("Unknown outbox op %r ignored", op)
            db.execute(sql_text("DELETE FROM sensor_mirror_outbox WHERE id = :id"), {"id": outbox_id})
            db.commit()
            applied += 1
        except Exception as exc:
            logger.warning("Outbox entry %s still failing: %s", outbox_id, exc)
            db.rollback()
    return applied


def reconcile_all_storage_facilities(db: Session) -> Dict[str, int]:
    """
    Full reconciliation: re-mirror every main-DB storage_facility into the sensor DB and
    refresh counts. Fixes any drift (missed updates, manual changes).
    """
    from app.models.sensors import StorageFacility

    storage_facilities = db.query(StorageFacility).all()
    mirrored = 0
    for storage_facility in storage_facilities:
        payload = _storage_facility_payload_from_row(storage_facility)
        try:
            with SensorSessionLocal() as sensor_db:
                upsert_storage_facility_ref(sensor_db, payload)
                refresh_storage_facility_sensor_counts(sensor_db, payload["id"])
            mirrored += 1
        except Exception as exc:
            logger.warning("Reconcile failed for storage_facility %s: %s", payload["id"], exc)
    return {"mirrored": mirrored, "total": len(storage_facilities)}

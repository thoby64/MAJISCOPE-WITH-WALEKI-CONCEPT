"""
Sensor Platform Sync Service

One-directional replication of MAIN-DB state into the sensor platform DB:

  - tank rows (owned by the main DB) are mirrored into the sensor DB's
    ``tank`` reference table
  - the sensor registry and readings are written directly to the sensor DB
    by the API layer (app.database.sensor_session.get_sensor_db) — they are
    NOT mirrored

Failure isolation: when the sensor DB is unreachable, a tank write in the
main DB still succeeds — the mirror intent is persisted in a durable
``sensor_mirror_outbox`` table (main DB) and drained later. Tank creation in
the main system is therefore never blocked by sensor-platform availability.

Hook contract: call ``mirror_tank`` AFTER the business transaction commits.
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
    TankRef,
    TankStatusEnum,
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
        tank_id VARCHAR(36),
        payload TEXT
    )
    """
    db.execute(sql_text(ddl))


def _queue_outbox(db: Session, op: str, tank_id: Optional[str], payload: Optional[Dict[str, Any]] = None) -> None:
    """Persist a mirror intent in the main DB so it survives outages."""
    ensure_outbox_table(db)
    db.execute(
        sql_text(
            "INSERT INTO sensor_mirror_outbox (id, op, tank_id, payload) "
            "VALUES (:id, :op, :tank_id, :payload)"
        ),
        {
            "id": str(uuid.uuid4()),
            "op": op,
            "tank_id": tank_id,
            "payload": json.dumps(payload, default=str) if payload is not None else None,
        },
    )
    db.commit()


# ============================================================================
# Sensor-DB upserts
# ============================================================================

def upsert_tank_ref(sensor_db: Session, payload: Dict[str, Any]) -> None:
    """Insert or refresh a tank reference row in the sensor DB (idempotent)."""
    tank_id = payload["id"]
    status_value = payload.get("status") or "active"
    tank_ref = sensor_db.get(TankRef, tank_id)
    if tank_ref is None:
        tank_ref = TankRef(
            id=tank_id,
            utility_id=payload["utility_id"],
            dma_id=payload.get("dma_id"),
            source_key=payload["source_key"],
            name=payload.get("name"),
            latitude=payload.get("latitude"),
            longitude=payload.get("longitude"),
            status=TankStatusEnum(status_value),
            created_at=payload.get("created_at") or datetime.utcnow(),
            updated_at=payload.get("updated_at") or datetime.utcnow(),
            deactivated_at=payload.get("deactivated_at"),
        )
        sensor_db.add(tank_ref)
    else:
        tank_ref.utility_id = payload["utility_id"]
        tank_ref.dma_id = payload.get("dma_id")
        tank_ref.source_key = payload["source_key"]
        tank_ref.name = payload.get("name")
        tank_ref.latitude = payload.get("latitude")
        tank_ref.longitude = payload.get("longitude")
        tank_ref.status = TankStatusEnum(status_value)
        tank_ref.updated_at = payload.get("updated_at") or datetime.utcnow()
        tank_ref.deactivated_at = payload.get("deactivated_at")
    sensor_db.commit()


def refresh_tank_sensor_counts(sensor_db: Session, tank_id: str) -> None:
    """Recompute denormalized sensor counts on tank_ref from the registry."""
    tank_ref = sensor_db.get(TankRef, tank_id)
    if tank_ref is None:
        return
    devices = (
        sensor_db.query(PlatformSensorDevice)
        .filter(PlatformSensorDevice.tank_id == tank_id)
        .all()
    )
    tank_ref.sensor_count = len(devices)
    tank_ref.active_sensor_count = sum(1 for d in devices if d.activated)
    sensor_db.commit()


def ensure_tank_ref(db: Session, sensor_db: Session, tank_id: str) -> Optional[TankRef]:
    """
    Self-heal: return the tank_ref row, mirroring it from the main DB on
    demand if the mirror is lagging (e.g. registration right after creation).
    """
    tank_ref = sensor_db.get(TankRef, tank_id)
    if tank_ref is not None:
        return tank_ref
    from app.models.sensors import Tank

    tank = db.query(Tank).filter(Tank.id == tank_id).first()
    if tank is None:
        return None
    payload = _tank_payload_from_row(tank)
    upsert_tank_ref(sensor_db, payload)
    return sensor_db.get(TankRef, tank_id)


def _tank_payload_from_row(row: Any) -> Dict[str, Any]:
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


# ============================================================================
# Public hook API (call AFTER the main-DB business transaction commits)
# ============================================================================

def mirror_tank(db: Session, tank_row: Any) -> None:
    """
    Immediately attempt a tank mirror upsert; on sensor-DB failure, queue the
    intent durably in the main-DB outbox instead of blocking the writer.
    """
    payload = _tank_payload_from_row(tank_row)
    try:
        with SensorSessionLocal() as sensor_db:
            upsert_tank_ref(sensor_db, payload)
    except Exception as exc:
        logger.warning("Tank mirror deferred for %s: %s", payload["id"], exc)
        try:
            _queue_outbox(db, "upsert_tank", payload["id"], payload)
        except Exception as queue_exc:
            logger.error("Failed to queue tank mirror for %s: %s", payload["id"], queue_exc)


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
            "SELECT id, op, tank_id, payload FROM sensor_mirror_outbox "
            "ORDER BY created_at LIMIT :limit"
        ),
        {"limit": limit},
    ).fetchall()
    applied = 0
    for outbox_id, op, tank_id, payload_text in rows:
        try:
            payload = json.loads(payload_text) if payload_text else None
            if op == "upsert_tank" and payload is not None:
                with SensorSessionLocal() as sensor_db:
                    upsert_tank_ref(sensor_db, payload)
            else:
                logger.warning("Unknown outbox op %r ignored", op)
            db.execute(sql_text("DELETE FROM sensor_mirror_outbox WHERE id = :id"), {"id": outbox_id})
            db.commit()
            applied += 1
        except Exception as exc:
            logger.warning("Outbox entry %s still failing: %s", outbox_id, exc)
            db.rollback()
    return applied


def reconcile_all_tanks(db: Session) -> Dict[str, int]:
    """
    Full reconciliation: re-mirror every main-DB tank into the sensor DB and
    refresh counts. Fixes any drift (missed updates, manual changes).
    """
    from app.models.sensors import Tank

    tanks = db.query(Tank).all()
    mirrored = 0
    for tank in tanks:
        payload = _tank_payload_from_row(tank)
        try:
            with SensorSessionLocal() as sensor_db:
                upsert_tank_ref(sensor_db, payload)
                refresh_tank_sensor_counts(sensor_db, payload["id"])
            mirrored += 1
        except Exception as exc:
            logger.warning("Reconcile failed for tank %s: %s", payload["id"], exc)
    return {"mirrored": mirrored, "total": len(tanks)}

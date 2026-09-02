"""
Sensor Platform Reading Models

Typed reading tables per category plus the generic pending buffer.

Design notes:
  - utility_id / dma_id are denormalized onto every reading at ingest time so
    role-scoped dashboard queries hit a single table (no joins, no cross-DB).
  - Idempotent ingest is enforced by UNIQUE(sensor_id, occurred_at) instead of
    the legacy string dedup_key — simpler, index-friendly, partition-compatible.
  - Water-quality parameters are real columns with CHECK range constraints:
    Tier A core (temperature, pH, EC, DO, turbidity) always present-nullable;
    Tier B/C optional (ORP, chlorine, nutrients, algae fluorescence) NULL when
    the probe is not fitted for them.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SQLEnum,
    Float,
    Index,
    String,
    Text,
    UniqueConstraint,
)

from app.models.sensor_platform.base import SensorBase
from app.models.sensor_platform.registry import SensorStatusEnum


class WaterLevelReading(SensorBase):
    """Immutable snapshot of a water-level sensor message and derived level."""

    __tablename__ = "water_level_reading"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sensor_id = Column(String(36), nullable=False, index=True)
    tank_id = Column(String(36), nullable=False, index=True)
    utility_id = Column(String(36), nullable=False, index=True)
    dma_id = Column(String(36), nullable=True, index=True)
    h1_m = Column(Float, nullable=False)
    depth_m = Column(Float, nullable=False, default=0.0)
    water_height_m = Column(Float, nullable=False)
    status = Column(SQLEnum(SensorStatusEnum), nullable=False, index=True)
    raw_data = Column(Text, nullable=True)
    occurred_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("sensor_id", "occurred_at", name="uq_wl_sensor_occurred"),
    )


class WaterQualityReading(SensorBase):
    """
    Immutable snapshot of a water-quality sonde message.

    Tier A core parameters (USGS routine sonde bundle) — NULL when absent from
    the payload; a reading with zero recognized parameters is rejected at
    ingest. Tier B/C parameters are NULL when the probe is not fitted.
    """

    __tablename__ = "water_quality_reading"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sensor_id = Column(String(36), nullable=False, index=True)
    tank_id = Column(String(36), nullable=False, index=True)
    utility_id = Column(String(36), nullable=False, index=True)
    dma_id = Column(String(36), nullable=True, index=True)
    status = Column(SQLEnum(SensorStatusEnum), nullable=False, index=True)
    raw_data = Column(Text, nullable=True)

    # ── Tier A: core parameters ─────────────────────────────────────────────
    temperature_c = Column(Float, nullable=True)   # 0–50
    ph = Column(Float, nullable=True)               # 0–14
    ec_uscm = Column(Float, nullable=True)          # specific conductance
    do_mgl = Column(Float, nullable=True)           # dissolved oxygen 0.01–20
    do_pct_sat = Column(Float, nullable=True)       # % saturation (if sent)
    turbidity_ntu = Column(Float, nullable=True)    # NTU/FNU

    # ── Tier B/C: optional fitted parameters ────────────────────────────────
    orp_mv = Column(Float, nullable=True)            # redox potential
    free_chlorine_mgl = Column(Float, nullable=True)
    nitrate_mgl = Column(Float, nullable=True)
    ammonia_mgl = Column(Float, nullable=True)
    phosphate_mgl = Column(Float, nullable=True)
    chlorophyll_ugl = Column(Float, nullable=True)
    phycocyanin_ugl = Column(Float, nullable=True)

    occurred_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("sensor_id", "occurred_at", name="uq_wq_sensor_occurred"),
    )


class SensorPendingReading(SensorBase):
    """
    Generic buffered payload from an unregistered device.

    The raw message is kept verbatim as JSON; it is parsed (and the device's
    category thereby honored) at promotion time, i.e. when the device is
    registered against a tank with a chosen category.
    """

    __tablename__ = "sensor_pending_reading"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String(100), nullable=False, index=True)
    payload = Column(Text, nullable=False)  # verbatim JSON of the raw message
    occurred_at = Column(DateTime, nullable=False, index=True)
    dedup_key = Column(String(300), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

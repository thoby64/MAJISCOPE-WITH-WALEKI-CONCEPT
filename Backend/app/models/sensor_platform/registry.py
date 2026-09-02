"""
Sensor Platform Registry Models

- TankRef: mirrored reference of a main-DB tank (NOT owned here — upserts only)
- SensorDevice: the single sensor registry for every category
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum as SQLEnum,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)

from app.models.sensor_platform.base import SensorBase


class TankStatusEnum(str, enum.Enum):
    """Tank lifecycle status (mirrors the main-DB enum)."""

    ACTIVE = "active"
    DEACTIVATED = "deactivated"


class SensorCategoryEnum(str, enum.Enum):
    """Sensor device category. Determines config schema + reading table."""

    WATER_LEVEL = "water_level"
    WATER_QUALITY = "water_quality"


class SensorStatusEnum(str, enum.Enum):
    """Live sensor status (worst-of across parameters for water quality)."""

    INACTIVE = "inactive"
    CRITICAL = "critical"
    WARNING = "warning"
    ACTIVE = "active"


class TankRef(SensorBase):
    """
    Mirrored reference of a main-DB tank.

    The main database owns Tank lifecycle (creation via storage facilities /
    GPKG sync, updates, DMA assignment). Rows here are projections maintained
    by app.services.sensor_platform_sync so that sensor-platform reads
    (dashboards, role-scoped lists) never need a cross-database join.
    """

    __tablename__ = "tank"

    id = Column(String(36), primary_key=True)
    utility_id = Column(String(36), nullable=False, index=True)
    dma_id = Column(String(36), nullable=True, index=True)
    source_key = Column(String(500), nullable=False)
    name = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    status = Column(SQLEnum(TankStatusEnum), default=TankStatusEnum.ACTIVE, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deactivated_at = Column(DateTime, nullable=True)

    # Denormalized sensor counts, refreshed on registry changes so tank lists
    # (e.g. storage-facility dashboard cards) don't need a join.
    sensor_count = Column(Integer, nullable=False, default=0)
    active_sensor_count = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("utility_id", "source_key", name="uq_tank_ref_utility_source_key"),
    )


class SensorDevice(SensorBase):
    """
    Registered sensor device attached to a tank — all categories.

    Category-specific configuration lives in `config` JSONB and is validated by
    per-category Pydantic schemas at the API boundary:

      water_level:     {h1_m, depth_m, warning_height_m, critical_height_m}
      water_quality:   {parameters: {ph: {min_ok, max_ok, critical_below,
                         critical_above}, ...}}

    One active sensor per category per tank is enforced by the partial unique
    index uq_sensor_device_tank_category_active.
    """

    __tablename__ = "sensor_device"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Field device identity, e.g. AU_NAM_0001 (UTILITY_DMA_SEQ convention).
    device_id = Column(String(100), unique=True, nullable=False, index=True)
    category = Column(SQLEnum(SensorCategoryEnum), nullable=False, index=True)
    tank_id = Column(String(36), nullable=False, index=True)
    activated = Column(Boolean, nullable=False, default=False)
    config = Column(JSON, nullable=True)  # validated per category at the API
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index(
            "uq_sensor_device_tank_category_active",
            "tank_id",
            "category",
            unique=True,
            postgresql_where=text("activated IS TRUE"),
            sqlite_where=text("activated IS 1"),
        ),
    )

"""
Sensor Models
SQLAlchemy ORM models for tank water-level monitoring.
"""

from sqlalchemy import Column, String, DateTime, Float, Boolean, Text, ForeignKey, Enum as SQLEnum, UniqueConstraint, Index as SAIndex
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from app.models.base import Base


class TankStatusEnum(str, enum.Enum):
    """Tank lifecycle status enumeration"""
    ACTIVE = "active"
    DEACTIVATED = "deactivated"


class SensorStatusEnum(str, enum.Enum):
    """Live sensor status enumeration ported from Waleki getStatus"""
    INACTIVE = "inactive"
    CRITICAL = "critical"
    WARNING = "warning"
    ACTIVE = "active"


class Tank(Base):
    """Materialized water storage tank reconciled from utility infrastructure layers."""

    __tablename__ = "tank"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    utility_id = Column(String(36), ForeignKey("utility.id", ondelete="CASCADE"), nullable=False, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="SET NULL"), nullable=True, index=True)
    source_key = Column(String(500), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    status = Column(SQLEnum(TankStatusEnum), default=TankStatusEnum.ACTIVE, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deactivated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("utility_id", "source_key", name="uq_tank_utility_source_key"),
    )

    utility = relationship("Utility", foreign_keys=[utility_id])
    dma = relationship("DMA", foreign_keys=[dma_id])


class SensorDevice(Base):
    """Registered water-level sensor attached to a tank."""

    __tablename__ = "sensor_device"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String(100), unique=True, nullable=False, index=True)
    tank_id = Column(String(36), ForeignKey("tank.id", ondelete="CASCADE"), nullable=False, index=True)
    h1_m = Column(Float, nullable=True)
    depth_m = Column(Float, nullable=True)
    warning_height_m = Column(Float, nullable=False, default=10.0)
    critical_height_m = Column(Float, nullable=False, default=0.0)
    activated = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tank = relationship("Tank", foreign_keys=[tank_id])


class SensorReading(Base):
    """Immutable snapshot of a sensor message and its derived water level."""

    __tablename__ = "sensor_reading"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sensor_id = Column(String(36), ForeignKey("sensor_device.id", ondelete="CASCADE"), nullable=False, index=True)
    tank_id = Column(String(36), ForeignKey("tank.id", ondelete="CASCADE"), nullable=False, index=True)
    utility_id = Column(String(36), ForeignKey("utility.id", ondelete="CASCADE"), nullable=False, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="SET NULL"), nullable=True, index=True)
    h1_m = Column(Float, nullable=False)
    depth_m = Column(Float, nullable=False, default=0.0)
    water_height_m = Column(Float, nullable=False)
    status = Column(SQLEnum(SensorStatusEnum), nullable=False, index=True)
    raw_data = Column(Text, nullable=True)
    occurred_at = Column(DateTime, nullable=False, index=True)
    dedup_key = Column(String(300), nullable=True, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    sensor = relationship("SensorDevice", foreign_keys=[sensor_id])
    tank = relationship("Tank", foreign_keys=[tank_id])
    utility = relationship("Utility", foreign_keys=[utility_id])
    dma = relationship("DMA", foreign_keys=[dma_id])


class SensorPendingReading(Base):
    """Buffered reading from an unregistered device, pending association.

    Stored when a device sends data before being registered in MajiScope.
    Promoted to a real SensorReading when the device is registered and
    associated with a tank.
    """

    __tablename__ = "sensor_pending_reading"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String(100), nullable=False, index=True)
    depth_m = Column(Float, nullable=False)
    raw_data = Column(Text, nullable=True)
    occurred_at = Column(DateTime, nullable=False, index=True)
    dedup_key = Column(String(300), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
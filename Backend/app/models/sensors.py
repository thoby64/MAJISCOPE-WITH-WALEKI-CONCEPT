"""
Sensor-era legacy models — STORAGE_FACILITY ONLY.

The sensor registry and readings moved to the dedicated sensor platform
database (app.models.sensor_platform, app.database.sensor_session). The main
database keeps StorageFacility as the source of truth for storage-facility lifecycle;
storage_facility rows are mirrored into the sensor platform's reference table.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Float, ForeignKey, Enum as SQLEnum, UniqueConstraint
from sqlalchemy.orm import relationship

from app.models.base import Base


class StorageFacilityStatusEnum(str, enum.Enum):
    """StorageFacility lifecycle status enumeration"""
    ACTIVE = "active"
    DEACTIVATED = "deactivated"


class StorageFacility(Base):
    """Materialized water storage storage_facility reconciled from utility infrastructure layers."""

    __tablename__ = "storage_facilities"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    utility_id = Column(String(36), ForeignKey("utility.id", ondelete="CASCADE"), nullable=False, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="SET NULL"), nullable=True, index=True)
    source_key = Column(String(500), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    status = Column(SQLEnum(StorageFacilityStatusEnum), default=StorageFacilityStatusEnum.ACTIVE, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deactivated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("utility_id", "source_key", name="uq_storage_facilities_utility_source_key"),
    )

    utility = relationship("Utility", foreign_keys=[utility_id])
    dma = relationship("DMA", foreign_keys=[dma_id])


class WaterSourceStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    DEACTIVATED = "deactivated"


class WaterSource(Base):
    """Materialized water source reconciled from utility infrastructure layers."""

    __tablename__ = "water_sources"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    utility_id = Column(String(36), ForeignKey("utility.id", ondelete="CASCADE"), nullable=False, index=True)
    dma_id = Column(String(36), ForeignKey("dma.id", ondelete="SET NULL"), nullable=True, index=True)
    source_key = Column(String(500), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    source_type = Column(String(100), nullable=True, index=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    status = Column(SQLEnum(WaterSourceStatusEnum), default=WaterSourceStatusEnum.ACTIVE, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deactivated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("utility_id", "source_key", name="uq_water_sources_utility_source_key"),
    )

    utility = relationship("Utility", foreign_keys=[utility_id])
    dma = relationship("DMA", foreign_keys=[dma_id])
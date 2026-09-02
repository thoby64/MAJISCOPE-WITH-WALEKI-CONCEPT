"""
Sensor-era legacy models — TANK ONLY.

The sensor registry and readings moved to the dedicated sensor platform
database (app.models.sensor_platform, app.database.sensor_session). The main
database keeps Tank as the source of truth for storage-facility lifecycle;
tank rows are mirrored into the sensor platform's reference table.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Float, ForeignKey, Enum as SQLEnum, UniqueConstraint
from sqlalchemy.orm import relationship

from app.models.base import Base


class TankStatusEnum(str, enum.Enum):
    """Tank lifecycle status enumeration"""
    ACTIVE = "active"
    DEACTIVATED = "deactivated"


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
"""Durable intents for mirroring main-database storage_facilities into the sensor store."""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, String, Text, text

from app.models.base import Base


class SensorMirrorOutbox(Base):
    __tablename__ = "sensor_mirror_outbox"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("CURRENT_TIMESTAMP"))
    op = Column(String(30), nullable=False)
    storage_facility_id = Column(String(36), nullable=True)
    payload = Column(Text, nullable=True)


class WaterSourceSensorMirrorOutbox(Base):
    __tablename__ = "water_source_sensor_mirror_outbox"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, server_default=text("CURRENT_TIMESTAMP"))
    payload = Column(Text, nullable=False)
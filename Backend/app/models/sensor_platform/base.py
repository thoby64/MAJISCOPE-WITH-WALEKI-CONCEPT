"""
Declarative base for the sensor platform database.

Deliberately separate from app.models.base.Base so the two databases never
share MetaData, and `Base.metadata.create_all()` on the main engine can never
leak sensor tables (and vice versa).
"""

from sqlalchemy.orm import declarative_base

SensorBase = declarative_base()

__all__ = ["SensorBase"]

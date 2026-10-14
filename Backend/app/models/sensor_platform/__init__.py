"""
Sensor Platform Models

ORM models for the sensor platform database — a separate store from the main
MajiScope database. This package has its own declarative Base (own MetaData),
own engine (app.database.sensor_session), and owns:

  - storage_facility            : mirrored reference of main-DB storage_facilities (read scope helper)
  - sensor_device   : single registry for all sensor categories
  - water_level_reading
  - water_quality_reading
  - sensor_pending_reading : generic JSONB buffer for unregistered devices

The main database remains the source of truth for StorageFacility creation and updates;
rows here are mirrored via app.services.sensor_platform_sync.
"""

from app.models.sensor_platform.base import SensorBase  # noqa: F401
from app.models.sensor_platform.registry import (  # noqa: F401
    SensorCategoryEnum,
    SensorStatusEnum,
    StorageFacilityStatusEnum,
    StorageFacilityRef,
    WaterSourceStatusEnum,
    WaterSourceRef,
    SensorDevice,
    WaterSourceSensorDevice,
)
from app.models.sensor_platform.readings import (  # noqa: F401
    WaterLevelReading,
    WaterQualityReading,
    SensorPendingReading,
    WaterSourceWaterLevelReading,
    WaterSourceWaterQualityReading,
    WaterSourceSensorPendingReading,
)

__all__ = [
    "SensorBase",
    "SensorCategoryEnum",
    "SensorStatusEnum",
    "StorageFacilityStatusEnum",
    "StorageFacilityRef",
    "WaterSourceStatusEnum",
    "WaterSourceRef",
    "SensorDevice",
    "WaterSourceSensorDevice",
    "WaterLevelReading",
    "WaterQualityReading",
    "SensorPendingReading",
    "WaterSourceWaterLevelReading",
    "WaterSourceWaterQualityReading",
    "WaterSourceSensorPendingReading",
]

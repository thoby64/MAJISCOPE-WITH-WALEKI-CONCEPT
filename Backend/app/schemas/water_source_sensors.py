"""Water-source sensor and monitoring response schemas."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.schemas.sensors import WaterQualityThresholds
from app.schemas.utc_datetime import UTCDateTime


class WaterSourceRead(BaseModel):
    id: str
    utility_id: str
    dma_id: Optional[str] = None
    source_key: str
    name: Optional[str] = None
    source_type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str
    sensor_count: int = 0
    active_sensor_count: int = 0
    created_at: UTCDateTime
    updated_at: UTCDateTime
    deactivated_at: Optional[UTCDateTime] = None

    class Config:
        from_attributes = True


class WaterSourceListResponse(BaseModel):
    total: int
    items: List[WaterSourceRead]


class WaterSourcePatch(BaseModel):
    dma_id: Optional[str] = None
    name: Optional[str] = Field(None, max_length=255)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    status: Optional[str] = None


class WaterSourceSensorRegisterRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=100)
    water_source_id: str
    category: str = Field("water_level", pattern="^(water_level|water_quality)$")
    activated: bool = False
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    warning_height_m: Optional[float] = Field(None, gt=0)
    critical_height_m: Optional[float] = Field(None, ge=0)
    parameter_thresholds: Optional[Dict[str, WaterQualityThresholds]] = None


class WaterSourceSensorUpdateRequest(BaseModel):
    water_source_id: Optional[str] = None
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    warning_height_m: Optional[float] = Field(None, gt=0)
    critical_height_m: Optional[float] = Field(None, ge=0)
    activated: Optional[bool] = None
    dma_id: Optional[str] = None
    parameter_thresholds: Optional[Dict[str, WaterQualityThresholds]] = None


class WaterSourceSensorLastReading(BaseModel):
    ok: bool = True
    category: str
    reading_id: str
    sensor_id: str
    water_source_id: str
    utility_id: str
    dma_id: Optional[str] = None
    status: str
    occurred_at: UTCDateTime
    water_level_m: Optional[float] = None
    h1_m: Optional[float] = None
    depth_m: Optional[float] = None
    parameters: Optional[Dict[str, float]] = None
    is_duplicate: bool = False


class WaterSourceSensorRead(BaseModel):
    id: str
    device_id: str
    category: str
    water_source_id: str
    water_source_name: Optional[str] = None
    utility_id: str
    dma_id: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    activated: bool
    status: str
    last_reading: Optional[WaterSourceSensorLastReading] = None
    created_at: UTCDateTime
    updated_at: UTCDateTime


class WaterSourceSensorListResponse(BaseModel):
    total: int
    items: List[WaterSourceSensorRead]


class WaterSourceSensorRegisterResponse(BaseModel):
    id: str
    device_id: str
    category: str
    water_source_id: str
    utility_id: str
    dma_id: Optional[str] = None
    dma_auto_assigned: bool = False
    config: Optional[Dict[str, Any]] = None
    activated: bool
    promoted_readings: int = 0
    created_at: UTCDateTime
    updated_at: UTCDateTime


class WaterSourceReadingsResponse(BaseModel):
    total: int
    items: List[Any]


class WaterSourceWaterLevelIngestResponse(BaseModel):
    ok: bool = True
    category: str = "water_level"
    reading_id: str
    sensor_id: str
    water_source_id: str
    utility_id: str
    dma_id: Optional[str] = None
    water_level_m: float
    h1_m: float
    depth_m: float
    status: str
    occurred_at: UTCDateTime
    is_duplicate: bool = False


class WaterSourceWaterQualityIngestResponse(BaseModel):
    ok: bool = True
    category: str = "water_quality"
    reading_id: str
    sensor_id: str
    water_source_id: str
    utility_id: str
    dma_id: Optional[str] = None
    status: str
    parameters: Dict[str, float] = Field(default_factory=dict)
    occurred_at: UTCDateTime
    is_duplicate: bool = False

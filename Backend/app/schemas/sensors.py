"""
Pydantic schemas for sensor and tank models.
Request and response models for the water-level monitoring API.
"""

from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field


# ============================================================================
# Tank Schemas
# ============================================================================

class TankCreate(BaseModel):
    """Schema for creating a tank manually (optional; usually from layer sync)"""
    source_key: str = Field(..., min_length=1, max_length=500)
    name: Optional[str] = Field(None, max_length=255)
    dma_id: Optional[str] = Field(None)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    status: str = "active"


class TankPatch(BaseModel):
    """Schema for updating a tank's assignment and geography"""
    dma_id: Optional[str] = Field(None)
    name: Optional[str] = Field(None, max_length=255)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    status: Optional[str] = Field(None)


class TankRead(BaseModel):
    """Schema for tank response"""
    id: str
    utility_id: str
    dma_id: Optional[str] = None
    source_key: str
    name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str
    sensor_count: int = 0
    active_sensor_count: int = 0
    created_at: datetime
    updated_at: datetime
    deactivated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TankListResponse(BaseModel):
    """Schema for list of tanks"""
    total: int
    items: List[TankRead]


class TankSyncSummary(BaseModel):
    """Tank reconciliation summary produced during storage layer uploads."""

    created: int = 0
    updated: int = 0
    reactivated: int = 0
    deactivated: int = 0
    deactivated_with_sensors: int = 0
    skipped_duplicates: int = 0
    total: int = 0
    has_warnings: bool = False


# ============================================================================
# Sensor Device Schemas
# ============================================================================

class SensorRegisterRequest(BaseModel):
    """Schema for registering a new water-level sensor"""
    device_id: str = Field(..., min_length=1, max_length=100)
    tank_id: str
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    warning_height_m: Optional[float] = Field(None, gt=0)
    critical_height_m: Optional[float] = Field(None, ge=0)
    activated: bool = False


class SensorUpdateRequest(BaseModel):
    """Schema for updating an existing sensor's configuration"""
    tank_id: Optional[str] = None
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    warning_height_m: Optional[float] = Field(None, gt=0)
    critical_height_m: Optional[float] = Field(None, ge=0)
    activated: Optional[bool] = None
    dma_id: Optional[str] = None


class SensorRegisterResponse(BaseModel):
    """Schema for sensor registration response"""
    id: str
    device_id: str
    tank_id: str
    utility_id: str
    dma_id: Optional[str] = None
    dma_auto_assigned: bool = False
    h1_m: Optional[float] = None
    depth_m: Optional[float] = None
    warning_height_m: float
    critical_height_m: float
    activated: bool
    promoted_readings: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SensorPendingIngestResponse(BaseModel):
    """Schema for a buffered reading from an unregistered device."""
    ok: bool = True
    is_pending: bool = True
    reading_id: str
    device_id: str
    occurred_at: datetime
    dedup_key: Optional[str] = None
    is_duplicate: bool = False


class SensorIngestRequest(BaseModel):
    """Schema for a raw sensor message received via the ingest endpoint"""
    device_id: str
    h1_m: Optional[float] = Field(None, ge=0)
    raw_data: Optional[str] = None
    properties: Optional[dict[str, Any]] = None
    occurred_at: Optional[Any] = None
    Timestamp: Optional[Any] = None
    # Flat top-level fields (how real LoRa firmware sends data)
    depth_m: Optional[float] = Field(None, ge=0)
    Depth: Optional[float] = Field(None, ge=0)
    depth: Optional[float] = Field(None, ge=0)
    H2: Optional[float] = Field(None, ge=0)
    h2: Optional[float] = Field(None, ge=0)
    Depth_mm: Optional[float] = Field(None, ge=0)
    depth_mm: Optional[float] = Field(None, ge=0)


class SensorIngestResponse(BaseModel):
    """Schema for a processed sensor reading response"""
    ok: bool = True
    reading_id: str
    sensor_id: str
    tank_id: str
    utility_id: str
    dma_id: Optional[str] = None
    water_level_m: float
    h1_m: float
    depth_m: float
    status: str
    occurred_at: datetime
    dedup_key: Optional[str] = None
    is_duplicate: bool = False


class SensorRead(BaseModel):
    """Schema for a sensor in list/detail responses with live status"""
    id: str
    device_id: str
    tank_id: str
    tank_name: Optional[str] = None
    utility_id: str
    dma_id: Optional[str] = None
    h1_m: Optional[float] = None
    depth_m: Optional[float] = None
    warning_height_m: float
    critical_height_m: float
    activated: bool
    status: str
    last_reading: Optional[SensorIngestResponse] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SensorListResponse(BaseModel):
    """Schema for list of sensors"""
    total: int
    items: List[SensorRead]


class TankReadingsResponse(BaseModel):
    """Schema for a tank's reading history (newest first)."""
    total: int
    items: List[SensorIngestResponse]
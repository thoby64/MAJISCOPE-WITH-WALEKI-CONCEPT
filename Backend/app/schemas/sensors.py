"""
Pydantic schemas for sensor and tank models.
Request and response models for the water-level monitoring API.
"""

from datetime import datetime
from app.schemas.utc_datetime import UTCDateTime
from typing import Any, Dict, List, Optional
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
    created_at: UTCDateTime
    updated_at: UTCDateTime
    deactivated_at: Optional[UTCDateTime] = None

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

class WaterLevelConfig(BaseModel):
    """Category configuration for water-level sensors."""
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    warning_height_m: Optional[float] = Field(None, gt=0)
    critical_height_m: Optional[float] = Field(None, ge=0)


class WaterQualityThresholds(BaseModel):
    """Per-parameter threshold bounds for one water-quality parameter.

    Any bound may be omitted; omitted bounds are not evaluated. There are no
    universal defaults for ORP (WHO: case-specific).
    """
    warning_below: Optional[float] = None
    warning_above: Optional[float] = None
    critical_below: Optional[float] = None
    critical_above: Optional[float] = None


class WaterQualityConfig(BaseModel):
    """Category configuration for water-quality sensors."""
    parameters: Dict[str, WaterQualityThresholds] = Field(default_factory=dict)


class SensorRegisterRequest(BaseModel):
    """Schema for registering a new sensor device (any category)."""
    device_id: str = Field(..., min_length=1, max_length=100)
    tank_id: str
    category: str = Field("water_level", pattern="^(water_level|water_quality)$")
    activated: bool = False
    # Water-level configuration (ignored unless category == water_level)
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    warning_height_m: Optional[float] = Field(None, gt=0)
    critical_height_m: Optional[float] = Field(None, ge=0)
    # Water-quality threshold overrides (ignored unless category == water_quality)
    parameter_thresholds: Optional[Dict[str, WaterQualityThresholds]] = None


class SensorUpdateRequest(BaseModel):
    """Schema for updating an existing sensor's configuration"""
    tank_id: Optional[str] = None
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    warning_height_m: Optional[float] = Field(None, gt=0)
    critical_height_m: Optional[float] = Field(None, ge=0)
    activated: Optional[bool] = None
    dma_id: Optional[str] = None
    parameter_thresholds: Optional[Dict[str, WaterQualityThresholds]] = None


class SensorRegisterResponse(BaseModel):
    """Schema for sensor registration response"""
    id: str
    device_id: str
    category: str
    tank_id: str
    utility_id: str
    dma_id: Optional[str] = None
    dma_auto_assigned: bool = False
    config: Optional[Dict[str, Any]] = None
    activated: bool
    promoted_readings: int = 0
    created_at: UTCDateTime
    updated_at: UTCDateTime

    class Config:
        from_attributes = True


class SensorPendingIngestResponse(BaseModel):
    """Schema for a buffered reading from an unregistered device."""
    ok: bool = True
    is_pending: bool = True
    reading_id: str
    device_id: str
    occurred_at: UTCDateTime
    dedup_key: Optional[str] = None
    is_duplicate: bool = False


class SensorIngestRequest(BaseModel):
    """Schema for a raw sensor message received via the ingest endpoint.

    Water-level flat fields (how real LoRa firmware sends data) plus
    water-quality flat fields are all optional; parsing is dispatched by the
    registered device's category.
    """
    device_id: str
    raw_data: Optional[str] = None
    properties: Optional[dict[str, Any]] = None
    occurred_at: Optional[Any] = None
    Timestamp: Optional[Any] = None
    # ── water level ──────────────────────────────────────────────────────────
    h1_m: Optional[float] = Field(None, ge=0)
    depth_m: Optional[float] = Field(None, ge=0)
    Depth: Optional[float] = Field(None, ge=0)
    depth: Optional[float] = Field(None, ge=0)
    H2: Optional[float] = Field(None, ge=0)
    h2: Optional[float] = Field(None, ge=0)
    Depth_mm: Optional[float] = Field(None, ge=0)
    depth_mm: Optional[float] = Field(None, ge=0)
    # ── water quality (flat top-level, alias-matched) ───────────────────────
    temperature_c: Optional[float] = None
    Temperature: Optional[float] = None
    ph: Optional[float] = None
    pH: Optional[float] = None
    ec_uscm: Optional[float] = None
    Conductivity: Optional[float] = None
    do_mgl: Optional[float] = None
    DissolvedOxygen: Optional[float] = None
    do_pct_sat: Optional[float] = None
    turbidity_ntu: Optional[float] = None
    Turbidity: Optional[float] = None
    orp_mv: Optional[float] = None
    free_chlorine_mgl: Optional[float] = None
    nitrate_mgl: Optional[float] = None
    ammonia_mgl: Optional[float] = None
    phosphate_mgl: Optional[float] = None
    chlorophyll_ugl: Optional[float] = None
    phycocyanin_ugl: Optional[float] = None

    class Config:
        # Vendor payloads may include arbitrary extra fields — accept them so
        # the raw payload can be buffered verbatim for unregistered devices.
        extra = "allow"


class WaterLevelIngestResponse(BaseModel):
    """Schema for a processed water-level reading response"""
    ok: bool = True
    category: str = "water_level"
    reading_id: str
    sensor_id: str
    tank_id: str
    utility_id: str
    dma_id: Optional[str] = None
    water_level_m: float
    h1_m: float
    depth_m: float
    status: str
    occurred_at: UTCDateTime
    is_duplicate: bool = False


class WaterQualityIngestResponse(BaseModel):
    """Schema for a processed water-quality reading response"""
    ok: bool = True
    category: str = "water_quality"
    reading_id: str
    sensor_id: str
    tank_id: str
    utility_id: str
    dma_id: Optional[str] = None
    status: str
    parameters: Dict[str, float] = Field(default_factory=dict)
    occurred_at: UTCDateTime
    is_duplicate: bool = False


# Backwards-compatible union used by ingest route + reading history helpers.
SensorIngestResponse = WaterLevelIngestResponse


class SensorLastReading(BaseModel):
    """Category-aware last-reading summary for sensor lists."""
    ok: bool = True
    category: str
    reading_id: str
    sensor_id: str
    tank_id: str
    utility_id: str
    dma_id: Optional[str] = None
    status: str
    occurred_at: UTCDateTime
    # water level
    water_level_m: Optional[float] = None
    h1_m: Optional[float] = None
    depth_m: Optional[float] = None
    # water quality
    parameters: Optional[Dict[str, float]] = None
    is_duplicate: bool = False


class SensorRead(BaseModel):
    """Schema for a sensor in list/detail responses with live status"""
    id: str
    device_id: str
    category: str
    tank_id: str
    tank_name: Optional[str] = None
    utility_id: str
    dma_id: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    activated: bool
    status: str
    last_reading: Optional[SensorLastReading] = None
    created_at: UTCDateTime
    updated_at: UTCDateTime

    class Config:
        from_attributes = True


class SensorListResponse(BaseModel):
    """Schema for list of sensors"""
    total: int
    items: List[SensorRead]


class TankReadingsResponse(BaseModel):
    """Schema for a tank's reading history (newest first)."""
    total: int
    items: List[Any]

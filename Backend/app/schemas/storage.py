"""
Storage Facility Schemas
Request/response models for manual storage facility creation.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# ============================================================================
# Request Schemas
# ============================================================================

class StorageFacilityCreateRequest(BaseModel):
    """Request to manually create a storage facility."""
    
    # Required fields
    name: str = Field(..., min_length=1, max_length=255, description="Tank name")
    latitude: float = Field(..., ge=-90, le=90, description="Latitude (WGS84)")
    longitude: float = Field(..., ge=-180, le=180, description="Longitude (WGS84)")
    
    # Common optional fields from GPKG schema
    material: Optional[str] = Field(None, max_length=100, description="Tank material (e.g., BRICK, CONCRETE, STEEL, PLASTIC)")
    capacity: Optional[float] = Field(None, ge=0, description="Tank capacity in cubic meters")
    depth_m: Optional[float] = Field(None, ge=0, description="Tank depth in meters")
    elevation_m: Optional[float] = Field(None, description="Ground elevation in meters")
    tank_shape: Optional[str] = Field(None, max_length=50, description="Tank shape (e.g., CYLINDRICAL, RECTANGULAR, SPHERICAL)")
    status: Optional[str] = Field(None, max_length=50, description="Operational status (e.g., ACTIVE, INACTIVE, MAINTENANCE)")
    condition: Optional[str] = Field(None, max_length=50, description="Physical condition (e.g., GOOD, FAIR, POOR)")
    location: Optional[str] = Field(None, max_length=255, description="Location description")
    zone_location: Optional[str] = Field(None, max_length=255, description="Zone/area location")
    asset_id: Optional[str] = Field(None, max_length=100, description="Asset ID")
    installer: Optional[str] = Field(None, max_length=255, description="Installer name")
    service_area: Optional[str] = Field(None, max_length=255, description="Service area")
    inlet_diameter_mm: Optional[float] = Field(None, ge=0, description="Inlet diameter in mm")
    inlet_diameter_in: Optional[float] = Field(None, ge=0, description="Inlet diameter in inches")
    outlet_diameter_mm: Optional[float] = Field(None, ge=0, description="Outlet diameter in mm")
    outlet_diameter_in: Optional[float] = Field(None, ge=0, description="Outlet diameter in inches")
    operating_level_m: Optional[float] = Field(None, description="Operating water level in meters")
    tank_base_elevation_m: Optional[float] = Field(None, description="Tank base elevation in meters")
    operating_level_m_2: Optional[float] = Field(None, description="Secondary operating level in meters")
    installation_date: Optional[float] = Field(None, description="Installation year")
    remark: Optional[str] = Field(None, max_length=500, description="Remarks")
    image: Optional[str] = Field(None, max_length=500, description="Image reference")
    drawing: Optional[str] = Field(None, max_length=500, description="Drawing reference")
    
    # Dynamic custom attributes (key-value pairs)
    custom_attributes: Dict[str, str] = Field(
        default_factory=dict,
        description="Additional custom attributes as key-value pairs"
    )
    
    # Optional sensor registration
    register_sensor: bool = Field(False, description="Whether to register a sensor for this tank")
    sensor_device_id: Optional[str] = Field(None, max_length=100, description="Sensor device ID (required if register_sensor=true)")
    sensor_h1_m: Optional[float] = Field(None, ge=0, description="Sensor H1 parameter in meters")
    sensor_depth_m: Optional[float] = Field(None, ge=0, description="Sensor depth parameter in meters")
    sensor_activated: bool = Field(False, description="Whether sensor is activated")
    
    @field_validator("sensor_device_id")
    @classmethod
    def validate_sensor_device_id(cls, v: Optional[str], info) -> Optional[str]:
        if info.data.get("register_sensor") and not v:
            raise ValueError("sensor_device_id is required when register_sensor is true")
        return v
    
    @field_validator("custom_attributes")
    @classmethod
    def validate_custom_attributes(cls, v: Dict[str, str]) -> Dict[str, str]:
        # Ensure no duplicate keys (case-insensitive)
        seen = set()
        for key in v:
            lower_key = key.lower()
            if lower_key in seen:
                raise ValueError(f"Duplicate custom attribute key: {key}")
            seen.add(lower_key)
        return v


class StorageFacilityCreateRequestWithUtility(StorageFacilityCreateRequest):
    """Extended request with utility_id for service layer."""
    utility_id: str


# ============================================================================
# Response Schemas
# ============================================================================

class StorageFacilityCreateResponse(BaseModel):
    """Response after creating storage facility."""
    
    tank_id: str
    name: str
    latitude: float
    longitude: float
    utility_id: str
    dma_id: Optional[str] = None
    source_key: str
    status: str
    sensor_count: int = 0
    active_sensor_count: int = 0
    created_at: datetime
    updated_at: datetime
    deactivated_at: Optional[datetime] = None
    
    # Sensor info (if registered)
    sensor_device_id: Optional[str] = None
    sensor_h1_m: Optional[float] = None
    sensor_depth_m: Optional[float] = None
    sensor_activated: Optional[bool] = None
    sensor_created_at: Optional[datetime] = None
    
    # GPKG info
    gpkg_updated: bool = True
    warnings: List[str] = Field(default_factory=list)


class StorageFacilityListResponse(BaseModel):
    """Response for listing storage facilities (from GPKG)."""
    
    total: int
    items: List[StorageFacilityCreateResponse]


# ============================================================================
# GPKG Feature Schema (for reference)
# ============================================================================

GPKG_STORAGE_COLUMNS = {
    "fid": "INTEGER PRIMARY KEY AUTOINCREMENT",
    "geom": "POINT",
    "TankCapaci": "REAL",
    "TankDepthM": "REAL",
    "OperatingM": "REAL",
    "InletDiamM": "REAL",
    "InletDiamI": "REAL",
    "OutletDiam": "REAL",
    "OutletDi_1": "REAL",
    "TankMateri": "TEXT",
    "ObjectID": "INTEGER",
    "AssetID": "TEXT",
    "Installati": "REAL",
    "Location": "TEXT",
    "ZoneLocati": "TEXT",
    "Status": "TEXT",
    "Condition": "TEXT",
    "ElevationM": "REAL",
    "Name": "TEXT",
    "remark": "TEXT",
    "Image": "TEXT",
    "Drawing": "TEXT",
    "Operatin_1": "REAL",
    "ServiceAre": "TEXT",
    "TankBaseEl": "REAL",
    "Installer": "TEXT",
    "TankShape": "TEXT",
    "X": "REAL",
    "Y": "REAL",
}

FORM_TO_GPKG_COLUMN = {
    "name": "Name",
    "material": "TankMateri",
    "capacity": "TankCapaci",
    "depth_m": "TankDepthM",
    "elevation_m": "ElevationM",
    "tank_shape": "TankShape",
    "status": "Status",
    "condition": "Condition",
    "location": "Location",
    "zone_location": "ZoneLocati",
    "asset_id": "AssetID",
    "installer": "Installer",
    "service_area": "ServiceAre",
    "inlet_diameter_mm": "InletDiamM",
    "inlet_diameter_in": "InletDiamI",
    "outlet_diameter_mm": "OutletDiam",
    "outlet_diameter_in": "OutletDi_1",
    "operating_level_m": "OperatingM",
    "tank_base_elevation_m": "TankBaseEl",
    "operating_level_m_2": "Operatin_1",
    "installation_date": "Installati",
    "remark": "remark",
    "image": "Image",
    "drawing": "Drawing",
}

AUTO_COLUMNS = {"fid", "geom", "ObjectID", "X", "Y"}
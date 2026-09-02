"""
GPKG Storage Facility Append Service

Appends new storage facility features to existing GeoPackage files
or creates new GPKG files with proper schema when none exists.
"""

from __future__ import annotations

import sqlite3
import tempfile
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

from sqlalchemy.orm import Session
from shapely.geometry import Point, mapping
from shapely import wkb

from app.models import (
    Tank,
    TankStatusEnum,
    UtilityInfrastructureLayer,
    Utility,
)
from app.models.sensor_platform import SensorDevice as PlatformSensorDevice, SensorCategoryEnum
from app.services.tank_sync import sync_tanks_from_layer
from app.services.gpkg_utils import load_storage_facilities_features
from app.services.activity_logs import audit_log


# GPKG Geometry encoding constants (matching utilities.py)
GPKG_HEADER_MAGIC = b"GP"
GPKG_VERSION = 1
GPKG_FLAGS_NO_ENVELOPE = 0b000


# Standard storage_facilities table schema (from existing GPKG analysis)
STORAGE_TABLE_SCHEMA = {
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

# Columns that are auto-managed (not user-set)
AUTO_COLUMNS = {"fid", "geom", "ObjectID", "X", "Y"}

# Mapping from form field names to GPKG column names
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


class StorageFacilityCreateData:
    """Data class for storage facility creation."""
    
    def __init__(
        self,
        name: str,
        latitude: float,
        longitude: float,
        attributes: Dict[str, Any],
        custom_attributes: Dict[str, str],
    ):
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.attributes = attributes
        self.custom_attributes = custom_attributes


def _gpkg_geometry_wkb(latitude: float, longitude: float) -> bytes:
    """
    Create GPKG-compliant WKB for a Point geometry.
    Matches the encoding used in utilities.py _gpkg_geometry_wkb.
    """
    point = Point(longitude, latitude)  # WKB uses (x, y) = (lon, lat)
    wkb_bytes = wkb.dumps(point, srid=4326)  # Include SRID
    
    # GPKG header: magic(2) + version(1) + flags(1) + srs_id(4) = 8 bytes
    # flags: bit 0-2 = envelope code (0 = no envelope), bit 3 = empty, bit 4-7 = reserved
    flags = GPKG_FLAGS_NO_ENVELOPE
    header = (
        GPKG_HEADER_MAGIC
        + bytes([GPKG_VERSION])
        + bytes([flags])
        + (4326).to_bytes(4, byteorder="little")
    )
    
    return header + wkb_bytes


def _get_existing_storage_layer(db: Session, utility_id: str) -> Optional[UtilityInfrastructureLayer]:
    """Get the existing storage_facilities layer for a utility."""
    return (
        db.query(UtilityInfrastructureLayer)
        .filter(
            UtilityInfrastructureLayer.utility_id == utility_id,
            UtilityInfrastructureLayer.asset_type == "storage_facilities",
        )
        .first()
    )


def _load_gpkg_features(file_data: bytes, file_name: str) -> List[Dict[str, Any]]:
    """Load features from GPKG file data using existing loader."""
    # Use the existing loader from utilities.py
    features = load_storage_facilities_features(file_name, file_data)
    return features


def _get_table_columns(conn: sqlite3.Connection, table_name: str) -> List[str]:
    """Get column names for a table."""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    return [row[1] for row in cursor.fetchall()]


def _get_max_fid(conn: sqlite3.Connection, table_name: str) -> int:
    """Get maximum FID value from table."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT MAX(fid) FROM {table_name}")
    result = cursor.fetchone()
    return (result[0] or 0) + 1


def _create_new_gpkg() -> bytes:
    """Create a new GPKG file with storage_facilities schema."""
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as f:
        temp_path = f.name
    
    try:
        conn = sqlite3.connect(temp_path)
        conn.enable_load_extension(True)
        
        try:
            # Load SpatiaLite if available (for spatial index)
            try:
                conn.load_extension("mod_spatialite")
            except Exception:
                pass  # Spatialite not available, continue without
            
            cursor = conn.cursor()
            
            # Create GPKG metadata tables
            cursor.execute("""
                CREATE TABLE gpkg_spatial_ref_sys (
                    srs_name TEXT NOT NULL,
                    srs_id INTEGER NOT NULL PRIMARY KEY,
                    organization TEXT NOT NULL,
                    organization_coordsys_id INTEGER NOT NULL,
                    definition TEXT NOT NULL,
                    description TEXT
                )
            """)
            
            # Insert WGS84 (EPSG:4326)
            cursor.execute("""
                INSERT INTO gpkg_spatial_ref_sys 
                (srs_name, srs_id, organization, organization_coordsys_id, definition, description)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                "WGS 84",
                4326,
                "EPSG",
                4326,
                "GEOGCS[\"WGS 84\",DATUM[\"WGS_1984\",SPHEROID[\"WGS 84\",6378137,298.257223563,AUTHORITY[\"EPSG\",\"7030\"]],AUTHORITY[\"EPSG\",\"6326\"]],PRIMEM[\"Greenwich\",0,AUTHORITY[\"EPSG\",\"8901\"]],UNIT[\"degree\",0.0174532925199433,AUTHORITY[\"EPSG\",\"9122\"]],AUTHORITY[\"EPSG\",\"4326\"]]",
                "WGS 84 latitude/longitude"
            ))
            
            cursor.execute("""
                CREATE TABLE gpkg_contents (
                    table_name TEXT NOT NULL PRIMARY KEY,
                    data_type TEXT NOT NULL,
                    identifier TEXT UNIQUE,
                    description TEXT DEFAULT '',
                    last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                    min_x DOUBLE,
                    min_y DOUBLE,
                    max_x DOUBLE,
                    max_y DOUBLE,
                    srs_id INTEGER,
                    CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
                )
            """)
            
            cursor.execute("""
                CREATE TABLE gpkg_geometry_columns (
                    table_name TEXT NOT NULL,
                    column_name TEXT NOT NULL,
                    geometry_type_name TEXT NOT NULL,
                    srs_id INTEGER NOT NULL,
                    z TINYINT NOT NULL DEFAULT 0,
                    m TINYINT NOT NULL DEFAULT 0,
                    CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
                    CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
                    CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
                )
            """)
            
            # Create storage table
            columns_def = ",\n    ".join(f"{col} {dtype}" for col, dtype in STORAGE_TABLE_SCHEMA.items())
            cursor.execute(f"""
                CREATE TABLE storage (
                    {columns_def}
                )
            """)
            
            # Add geometry column metadata
            cursor.execute("""
                INSERT INTO gpkg_geometry_columns 
                (table_name, column_name, geometry_type_name, srs_id, z, m)
                VALUES (?, ?, ?, ?, ?, ?)
            """, ("storage", "geom", "POINT", 4326, 0, 0))
            
            # Add contents entry
            cursor.execute("""
                INSERT INTO gpkg_contents 
                (table_name, data_type, identifier, description, srs_id)
                VALUES (?, ?, ?, ?, ?)
            """, ("storage", "features", "storage_facilities", "Water storage facilities", 4326))
            
            # Create spatial index (if spatialite available)
            try:
                cursor.execute("SELECT CreateSpatialIndex('storage', 'geom')")
            except Exception:
                pass  # Spatial index creation failed, continue
            
            conn.commit()
            
            # Read the created GPKG
            with open(temp_path, "rb") as f:
                gpkg_data = f.read()
            
            return gpkg_data
            
        finally:
            conn.close()
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def _append_feature_to_gpkg(
    gpkg_data: bytes,
    file_name: str,
    tank_data: StorageFacilityCreateData,
    next_fid: int,
) -> bytes:
    """Append a new feature to the storage table in GPKG."""
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as f:
        f.write(gpkg_data)
        temp_path = f.name
    
    try:
        conn = sqlite3.connect(temp_path)
        conn.enable_load_extension(True)
        
        try:
            cursor = conn.cursor()
            
            # Get existing columns
            existing_columns = _get_table_columns(conn, "storage")
            
            # Prepare feature data
            geometry_wkb = _gpkg_geometry_wkb(tank_data.latitude, tank_data.longitude)
            
            # Build column list and values
            columns = []
            values = []
            placeholders = []
            
            # FID
            columns.append("fid")
            values.append(next_fid)
            placeholders.append("?")
            
            # Geometry
            columns.append("geom")
            values.append(geometry_wkb)
            placeholders.append("?")
            
            # Standard attributes from form
            for form_key, gpkg_col in FORM_TO_GPKG_COLUMN.items():
                if gpkg_col in existing_columns and gpkg_col not in AUTO_COLUMNS:
                    # Check tank_data.attributes first, then custom_attributes
                    value = tank_data.attributes.get(form_key)
                    if value is None:
                        value = tank_data.custom_attributes.get(form_key)
                    
                    if value is not None:
                        columns.append(gpkg_col)
                        values.append(value)
                        placeholders.append("?")
            
            # Add X, Y columns
            if "X" in existing_columns:
                columns.append("X")
                values.append(tank_data.longitude)
                placeholders.append("?")
            if "Y" in existing_columns:
                columns.append("Y")
                values.append(tank_data.latitude)
                placeholders.append("?")
            
            # Insert the feature
            columns_str = ", ".join(f'"{col}"' for col in columns)
            placeholders_str = ", ".join(placeholders)
            
            query = f'INSERT INTO "storage" ({columns_str}) VALUES ({placeholders_str})'
            cursor.execute(query, values)
            
            conn.commit()
            
            # Read updated GPKG
            with open(temp_path, "rb") as f:
                updated_gpkg_data = f.read()
            
            return updated_gpkg_data
            
        finally:
            conn.close()
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def append_storage_facility(
    db: Session,
    utility_id: str,
    tank_data: StorageFacilityCreateData,
    current_user_id: str,
    register_sensor: bool = False,
    sensor_device_id: Optional[str] = None,
    sensor_h1_m: Optional[float] = None,
    sensor_depth_m: Optional[float] = None,
    sensor_activated: bool = False,
) -> Tuple[bytes, Tank, Optional[PlatformSensorDevice]]:
    """
    Append a storage facility to GPKG and materialize in database.
    
    Returns:
        Tuple of (updated_gpkg_bytes, created_tank, created_sensor_or_none)
    """
    # 1. Get existing layer or create new GPKG
    existing_layer = _get_existing_storage_layer(db, utility_id)
    
    if existing_layer and existing_layer.file_data:
        # Load existing features to get next FID
        features = _load_gpkg_features(existing_layer.file_data, existing_layer.file_name)
        next_fid = len(features) + 1
        
        # Append to existing GPKG
        updated_gpkg_data = _append_feature_to_gpkg(
            existing_layer.file_data,
            existing_layer.file_name,
            tank_data,
            next_fid,
        )
    else:
        # Create new GPKG
        updated_gpkg_data = _create_new_gpkg()
        next_fid = 1
        
        # Append first feature
        updated_gpkg_data = _append_feature_to_gpkg(
            updated_gpkg_data,
            "storage.gpkg",
            tank_data,
            next_fid,
        )
    
    # 2. Update or create UtilityInfrastructureLayer
    if existing_layer:
        existing_layer.file_data = updated_gpkg_data
        existing_layer.file_size = len(updated_gpkg_data)
        existing_layer.feature_count = next_fid
        existing_layer.updated_at = datetime.utcnow()
        existing_layer.uploaded_by_manager_id = current_user_id
        layer = existing_layer
    else:
        layer = UtilityInfrastructureLayer(
            utility_id=utility_id,
            asset_type="storage_facilities",
            file_data=updated_gpkg_data,
            file_name="storage.gpkg",
            mime_type="application/geopackage+sqlite3",
            file_size=len(updated_gpkg_data),
            feature_count=next_fid,
            uploaded_by_manager_id=current_user_id,
        )
        db.add(layer)
    
    db.flush()
    
    # 3. Run sync_tanks_from_layer to materialize tank
    features = _load_gpkg_features(updated_gpkg_data, "storage.gpkg")
    sync_result = sync_tanks_from_layer(db, utility_id, features, layer)
    
    # 4. Find the newly created tank (by source_key matching name or coordinate hash)
    from app.services.tank_sync import detect_tank_key_field, coordinate_hash
    
    new_tank = None
    for feature in features:
        props = feature.get("properties", {})
        key_field = detect_tank_key_field(props)
        geom = feature.get("geometry")
        
        source_key = None
        if key_field and props.get(key_field):
            source_key = str(props[key_field]).strip()
        elif geom and geom.get("type") == "Point":
            coords = geom.get("coordinates", [])
            if len(coords) >= 2:
                source_key = coordinate_hash(coords[1], coords[0])  # lat, lon
        
        if source_key and source_key == tank_data.name:
            new_tank = (
                db.query(Tank)
                .filter(Tank.utility_id == utility_id, Tank.source_key == source_key)
                .first()
            )
            break
    
    # Fallback: find tank by name and location
    if not new_tank:
        new_tank = (
            db.query(Tank)
            .filter(
                Tank.utility_id == utility_id,
                Tank.name == tank_data.name,
                Tank.latitude == tank_data.latitude,
                Tank.longitude == tank_data.longitude,
            )
            .order_by(Tank.created_at.desc())
            .first()
        )
    
    if not new_tank:
        raise ValueError("Failed to find newly created tank after sync")
    
    # 4. Optionally register sensor (sensor registry lives in the sensor DB)
    created_sensor = None
    if register_sensor and sensor_device_id:
        from app.database.sensor_session import SensorSessionLocal
        from app.services.sensor_platform_sync import (
            ensure_tank_ref,
            refresh_tank_sensor_counts,
        )

        with SensorSessionLocal() as sensor_db:
            # Check if sensor already exists (globally unique device_id)
            existing_sensor = (
                sensor_db.query(PlatformSensorDevice)
                .filter(PlatformSensorDevice.device_id == sensor_device_id)
                .first()
            )
            if existing_sensor:
                raise ValueError(f"Sensor with device_id {sensor_device_id} already exists")

            # Mirror the new tank into the sensor DB (self-heals if needed)
            tank_ref = ensure_tank_ref(db, sensor_db, new_tank.id)
            if tank_ref is None:
                raise ValueError("Failed to mirror tank to sensor platform")

            if sensor_activated:
                clash = (
                    sensor_db.query(PlatformSensorDevice)
                    .filter(
                        PlatformSensorDevice.tank_id == tank_ref.id,
                        PlatformSensorDevice.category == SensorCategoryEnum.WATER_LEVEL,
                        PlatformSensorDevice.activated.is_(True),
                    )
                    .first()
                )
                if clash is not None:
                    raise ValueError(
                        f"Tank already has an active water_level sensor ({clash.device_id})"
                    )

            created_sensor = PlatformSensorDevice(
                device_id=sensor_device_id,
                category=SensorCategoryEnum.WATER_LEVEL,
                tank_id=tank_ref.id,
                activated=sensor_activated,
                config={
                    "h1_m": sensor_h1_m,
                    "depth_m": sensor_depth_m,
                    "warning_height_m": 10.0,
                    "critical_height_m": 0.0,
                },
            )
            sensor_db.add(created_sensor)
            sensor_db.commit()
            sensor_db.refresh(created_sensor)
            refresh_tank_sensor_counts(sensor_db, tank_ref.id)
    
    # 5. Audit log for GPKG update
    # (Will be called by API endpoint with proper request context)
    
    return updated_gpkg_data, new_tank, created_sensor
#!/usr/bin/env python
"""
Generate sample GPKG template files for each infrastructure asset type.
These templates show the expected schema/columns for each asset type.
"""

import sqlite3
import tempfile
import os
from pathlib import Path
from typing import Dict, Any, List
from shapely.geometry import Point, LineString, mapping
from shapely import wkb


# GPKG Geometry encoding constants
GPKG_HEADER_MAGIC = b"GP"
GPKG_VERSION = 1
GPKG_FLAGS_NO_ENVELOPE = 0b000


def _gpkg_geometry_wkb(geometry) -> bytes:
    """Create GPKG-compliant WKB for a geometry."""
    wkb_bytes = wkb.dumps(geometry, srid=4326)
    flags = GPKG_FLAGS_NO_ENVELOPE
    header = (
        GPKG_HEADER_MAGIC
        + bytes([GPKG_VERSION])
        + bytes([flags])
        + (4326).to_bytes(4, byteorder="little")
    )
    return header + wkb_bytes


def _quote_sqlite_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


# ============================================================================
# SCHEMAS FOR EACH ASSET TYPE
# ============================================================================

ASSET_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "pipe_network": {
        "table_name": "pipes",
        "geometry_type": "LINESTRING",
        "geometry_column": "geom",
        "columns": {
            "fid": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "geom": "LINESTRING",
            "PipeID": "TEXT",
            "Name": "TEXT",
            "DiameterMM": "REAL",
            "Material": "TEXT",
            "LengthM": "REAL",
            "InstallDate": "TEXT",
            "Status": "TEXT",
            "Zone": "TEXT",
            "PressureZone": "TEXT",
        },
        "sample_features": [
            {
                "geometry": LineString([(35.74, -6.20), (35.75, -6.21), (35.76, -6.205)]),
                "properties": {
                    "PipeID": "PIPE-001",
                    "Name": "Main Supply Line",
                    "DiameterMM": 200,
                    "Material": "Ductile Iron",
                    "LengthM": 1250.5,
                    "InstallDate": "2020-01-15",
                    "Status": "Active",
                    "Zone": "Central Zone",
                    "PressureZone": "High",
                }
            },
            {
                "geometry": LineString([(35.76, -6.205), (35.77, -6.22), (35.78, -6.215)]),
                "properties": {
                    "PipeID": "PIPE-002",
                    "Name": "Distribution Branch",
                    "DiameterMM": 150,
                    "Material": "HDPE",
                    "LengthM": 890.2,
                    "InstallDate": "2021-03-22",
                    "Status": "Active",
                    "Zone": "North Zone",
                    "PressureZone": "Medium",
                }
            },
        ]
    },
    "valves": {
        "table_name": "valves",
        "geometry_type": "POINT",
        "geometry_column": "geom",
        "columns": {
            "fid": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "geom": "POINT",
            "ValveID": "TEXT",
            "Name": "TEXT",
            "Type": "TEXT",
            "DiameterMM": "REAL",
            "Status": "TEXT",
            "Zone": "TEXT",
            "InstallDate": "TEXT",
            "Manufacturer": "TEXT",
        },
        "sample_features": [
            {
                "geometry": Point(35.745, -6.205),
                "properties": {
                    "ValveID": "VALVE-001",
                    "Name": "Main Line Gate Valve",
                    "Type": "Gate Valve",
                    "DiameterMM": 200,
                    "Status": "Open",
                    "Zone": "Central Zone",
                    "InstallDate": "2020-01-15",
                    "Manufacturer": "AVK",
                }
            },
            {
                "geometry": Point(35.765, -6.210),
                "properties": {
                    "ValveID": "VALVE-002",
                    "Name": "Distribution Control Valve",
                    "Type": "Butterfly Valve",
                    "DiameterMM": 150,
                    "Status": "Open",
                    "Zone": "North Zone",
                    "InstallDate": "2021-03-22",
                    "Manufacturer": "Mueller",
                }
            },
        ]
    },
    "water_sources": {
        "table_name": "water_sources",
        "geometry_type": "POINT",
        "geometry_column": "geom",
        "columns": {
            "fid": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "geom": "POINT",
            "SourceID": "TEXT",
            "Name": "TEXT",
            "SourceType": "TEXT",
            "CapacityLPS": "REAL",
            "Status": "TEXT",
            "Zone": "TEXT",
            "InstallDate": "TEXT",
            "DepthM": "REAL",
            "YieldLPS": "REAL",
        },
        "sample_features": [
            {
                "geometry": Point(35.73, -6.19),
                "properties": {
                    "SourceID": "SRC-001",
                    "Name": "Main Borehole",
                    "SourceType": "Borehole",
                    "CapacityLPS": 50.0,
                    "Status": "Active",
                    "Zone": "Central Zone",
                    "InstallDate": "2018-06-10",
                    "DepthM": 120.0,
                    "YieldLPS": 45.5,
                }
            },
            {
                "geometry": Point(35.79, -6.23),
                "properties": {
                    "SourceID": "SRC-002",
                    "Name": "River Intake",
                    "SourceType": "Surface Water Intake",
                    "CapacityLPS": 200.0,
                    "Status": "Active",
                    "Zone": "South Zone",
                    "InstallDate": "2019-11-05",
                    "DepthM": 0.0,
                    "YieldLPS": 180.0,
                }
            },
        ]
    },
    "storage_facilities": {
        "table_name": "storage",
        "geometry_type": "POINT",
        "geometry_column": "geom",
        "columns": {
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
        },
        "sample_features": [
            {
                "geometry": Point(35.75, -6.20),
                "properties": {
                    "Name": "MAIN RESERVOIR",
                    "TankCapaci": 5000.0,
                    "TankDepthM": 10.0,
                    "OperatingM": 8.5,
                    "InletDiamM": 200,
                    "InletDiamI": 8,
                    "OutletDiam": 200,
                    "OutletDi_1": 8,
                    "TankMateri": "Concrete",
                    "AssetID": "TANK-001",
                    "Location": "Main Treatment Plant",
                    "ZoneLocati": "Central Zone",
                    "Status": "Active",
                    "Condition": "Good",
                    "ElevationM": 1250.0,
                    "TankShape": "Circular",
                    "Installer": "ABC Construction",
                    "ServiceAre": "Central Distribution",
                }
            },
            {
                "geometry": Point(35.77, -6.22),
                "properties": {
                    "Name": "ELEVATED TANK NORTH",
                    "TankCapaci": 2000.0,
                    "TankDepthM": 8.0,
                    "OperatingM": 6.5,
                    "InletDiamM": 150,
                    "InletDiamI": 6,
                    "OutletDiam": 150,
                    "OutletDi_1": 6,
                    "TankMateri": "Steel",
                    "AssetID": "TANK-002",
                    "Location": "North Hill",
                    "ZoneLocati": "North Zone",
                    "Status": "Active",
                    "Condition": "Good",
                    "ElevationM": 1320.0,
                    "TankShape": "Elevated",
                    "Installer": "XYZ Engineering",
                    "ServiceAre": "North Distribution",
                }
            },
        ]
    },
    "bulk_meters": {
        "table_name": "bulk_meters",
        "geometry_type": "POINT",
        "geometry_column": "geom",
        "columns": {
            "fid": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "geom": "POINT",
            "MeterID": "TEXT",
            "Name": "TEXT",
            "MeterType": "TEXT",
            "DiameterMM": "REAL",
            "Status": "TEXT",
            "Zone": "TEXT",
            "InstallDate": "TEXT",
            "Manufacturer": "TEXT",
            "SerialNumber": "TEXT",
            "Multiplier": "REAL",
        },
        "sample_features": [
            {
                "geometry": Point(35.74, -6.20),
                "properties": {
                    "MeterID": "BM-001",
                    "Name": "Main Inlet Bulk Meter",
                    "MeterType": "Electromagnetic",
                    "DiameterMM": 200,
                    "Status": "Active",
                    "Zone": "Central Zone",
                    "InstallDate": "2020-01-15",
                    "Manufacturer": "Kamstrup",
                    "SerialNumber": "KM2020001",
                    "Multiplier": 1.0,
                }
            },
            {
                "geometry": Point(35.76, -6.21),
                "properties": {
                    "MeterID": "BM-002",
                    "Name": "Zone Boundary Meter",
                    "MeterType": "Ultrasonic",
                    "DiameterMM": 150,
                    "Status": "Active",
                    "Zone": "North Zone",
                    "InstallDate": "2021-03-22",
                    "Manufacturer": "Sensus",
                    "SerialNumber": "SN2021002",
                    "Multiplier": 1.0,
                }
            },
        ]
    },
}


def create_gpkg_file(schema: Dict[str, Any], output_path: Path) -> None:
    """Create a GPKG file with the given schema and sample features."""
    table_name = schema["table_name"]
    geometry_column = schema["geometry_column"]
    columns = schema["columns"]
    sample_features = schema["sample_features"]
    geometry_type = schema["geometry_type"]

    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as f:
        temp_path = f.name

    try:
        conn = sqlite3.connect(temp_path)
        conn.enable_load_extension(True)

        try:
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

            # Create asset table
            columns_def = ",\n    ".join(f"{col} {dtype}" for col, dtype in columns.items())
            cursor.execute(f"""
                CREATE TABLE {table_name} (
                    {columns_def}
                )
            """)

            # Add geometry column metadata
            cursor.execute("""
                INSERT INTO gpkg_geometry_columns 
                (table_name, column_name, geometry_type_name, srs_id, z, m)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (table_name, geometry_column, geometry_type, 4326, 0, 0))

            # Add contents entry
            cursor.execute("""
                INSERT INTO gpkg_contents 
                (table_name, data_type, identifier, description, srs_id)
                VALUES (?, ?, ?, ?, ?)
            """, (table_name, "features", table_name, f"{table_name} assets", 4326))

            # Create spatial index (if spatialite available)
            try:
                cursor.execute(f"SELECT CreateSpatialIndex('{table_name}', '{geometry_column}')")
            except Exception:
                pass  # Spatial index creation failed, continue

            # Insert sample features
            for idx, feature in enumerate(sample_features, 1):
                geometry_wkb = _gpkg_geometry_wkb(feature["geometry"])
                props = feature["properties"]

                # Build column list and values
                cols = ["fid", geometry_column]
                vals = [idx, geometry_wkb]
                placeholders = ["?", "?"]

                for col_name in columns:
                    if col_name in {"fid", geometry_column}:
                        continue
                    if col_name in props:
                        cols.append(col_name)
                        vals.append(props[col_name])
                        placeholders.append("?")

                cols_str = ", ".join(f'"{c}"' for c in cols)
                placeholders_str = ", ".join(placeholders)
                query = f'INSERT INTO "{table_name}" ({cols_str}) VALUES ({placeholders_str})'
                cursor.execute(query, vals)

            # Update bounding box in gpkg_contents
            minx = min(f["geometry"].bounds[0] for f in sample_features)
            miny = min(f["geometry"].bounds[1] for f in sample_features)
            maxx = max(f["geometry"].bounds[2] for f in sample_features)
            maxy = max(f["geometry"].bounds[3] for f in sample_features)

            cursor.execute("""
                UPDATE gpkg_contents 
                SET min_x=?, min_y=?, max_x=?, max_y=?, last_change=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE table_name=?
            """, (minx, miny, maxx, maxy, table_name))

            conn.commit()

            # Read the created GPKG
            with open(temp_path, "rb") as f:
                gpkg_data = f.read()

        finally:
            conn.close()

    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)

    # Write to output path
    output_path.write_bytes(gpkg_data)
    print(f"Created template: {output_path} ({len(gpkg_data)} bytes)")


def main():
    output_dir = Path("/home/thobbs/Documents/PRESENT/Backend/app/templates/infrastructure")
    output_dir.mkdir(parents=True, exist_ok=True)

    for asset_type, schema in ASSET_SCHEMAS.items():
        output_file = output_dir / f"{asset_type}_template.gpkg"
        create_gpkg_file(schema, output_file)

    print(f"\nAll templates created in: {output_dir}")
    print("Files:")
    for f in output_dir.iterdir():
        print(f"  - {f.name}")


if __name__ == "__main__":
    main()
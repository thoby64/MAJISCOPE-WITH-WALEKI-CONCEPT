"""
GPKG Utilities
Shared functions for loading and manipulating GeoPackage files.
"""

import sqlite3
import tempfile
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from shapely import wkb
from shapely.geometry import mapping, shape


# ============================================================================
# GPKG Geometry Encoding (matching utilities.py)
# ============================================================================

GPKG_HEADER_MAGIC = b"GP"
GPKG_VERSION = 1
GPKG_FLAGS_NO_ENVELOPE = 0b000


def _gpkg_geometry_wkb(geometry_blob: bytes) -> bytes:
    """Extract WKB from GPKG geometry blob."""
    if len(geometry_blob) < 8 or geometry_blob[:2] != b"GP":
        raise ValueError("Invalid GPKG geometry blob")
    
    flags = geometry_blob[3]
    envelope_code = (flags >> 1) & 0b111
    header_length = 8
    
    if envelope_code == 1:
        header_length += 32
    elif envelope_code in {2, 3}:
        header_length += 48
    elif envelope_code == 4:
        header_length += 64
    
    return geometry_blob[header_length:]


def _decode_text_bytes(data: bytes) -> str:
    """Decode bytes to text with multiple encoding attempts."""
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode text bytes")


def _quote_sqlite_identifier(identifier: str) -> str:
    """Quote SQLite identifier."""
    return '"' + identifier.replace('"', '""') + '"'


# ============================================================================
# GPKG Feature Loading
# ============================================================================

def load_storage_facilities_features(file_name: str, file_data: bytes) -> List[Dict[str, Any]]:
    """
    Load the storage_facilities features of a stored GeoPackage as a feature list.
    
    Public wrapper used by the startup tank sync service.
    """
    feature_collection = _load_infrastructure_geojson_with_summary(
        file_name,
        file_data,
        "storage_facilities",
    )[0]
    return feature_collection.get("features", [])


def _load_pipe_network_geojson_with_summary(file_name: str, file_data: bytes) -> Tuple[Dict[str, Any], Any]:
    """Load pipe network GeoJSON with ingest summary."""
    extension = Path(file_name).suffix.lower()
    if extension == ".gpkg":
        return _load_gpkg_geojson_with_stats(file_data)
    # For other formats, we'd need the full implementation from utilities.py
    # But for storage_facilities, we only support GPKG
    raise ValueError(f"Unsupported file format for storage facilities: {extension}")


def _load_infrastructure_geojson_with_summary(file_name: str, file_data: bytes, asset_type: str) -> Tuple[Dict[str, Any], Any]:
    """Load infrastructure GeoJSON with summary, filtered by asset type."""
    feature_collection, _ = _load_pipe_network_geojson_with_summary(file_name, file_data)
    filtered_collection = _filter_feature_collection_by_asset_type(feature_collection, asset_type)
    return filtered_collection, None


# ============================================================================
# Asset Type Filtering
# ============================================================================

UTILITY_INFRASTRUCTURE_ASSETS = {
    "pipe_network": {
        "label": "Pipe network",
        "geometry_types": {"LineString", "MultiLineString"},
    },
    "valves": {
        "label": "Valves",
        "geometry_types": {"Point", "MultiPoint"},
    },
    "water_sources": {
        "label": "Water sources",
        "geometry_types": {"Point", "MultiPoint"},
    },
    "storage_facilities": {
        "label": "Storage facilities",
        "geometry_types": {"Point", "MultiPoint"},
    },
    "bulk_meters": {
        "label": "Bulk meters",
        "geometry_types": {"Point", "MultiPoint"},
    },
}


def _asset_label(asset_type: str) -> str:
    return str(UTILITY_INFRASTRUCTURE_ASSETS.get(asset_type, {}).get("label") or asset_type.replace("_", " ").title())


def _filter_feature_collection_by_asset_type(feature_collection: Dict[str, Any], asset_type: str) -> Dict[str, Any]:
    """Filter feature collection by asset type geometry types."""
    allowed_geometry_types = UTILITY_INFRASTRUCTURE_ASSETS[asset_type]["geometry_types"]
    features: List[Dict[str, Any]] = []

    for feature in feature_collection.get("features", []):
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            continue
        geometry_type = geometry.get("type")
        if geometry_type not in allowed_geometry_types:
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            properties = {}
        features.append({
            **feature,
            "properties": {
                **properties,
                "asset_type": asset_type,
                "asset_label": _asset_label(asset_type),
            },
        })

    if not features:
        label = _asset_label(asset_type).lower()
        raise ValueError(f"Uploaded file did not contain previewable {label} geometry.")

    return {"type": "FeatureCollection", "features": features}


# ============================================================================
# GPKG Loading
# ============================================================================

def _load_gpkg_geojson_with_stats(data: bytes) -> Tuple[Dict[str, Any], Any]:
    """Load GPKG file and return feature collection with stats."""
    temp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as temp_file:
            temp_file.write(data)
            temp_path = temp_file.name

        connection = sqlite3.connect(temp_path)
        try:
            cursor = connection.cursor()
            geometry_layers = cursor.execute(
                "SELECT table_name, column_name FROM gpkg_geometry_columns"
            ).fetchall()

            if not geometry_layers:
                raise ValueError("GeoPackage did not contain any spatial layers")

            features: List[Dict[str, Any]] = []
            source_layers: List[str] = []
            total_features_read = 0
            skipped_missing_geometry = 0
            skipped_invalid_geometry = 0
            skipped_unsupported_geometry = 0

            for table_name, geometry_column in geometry_layers:
                columns = [row[1] for row in cursor.execute(f"PRAGMA table_info({_quote_sqlite_identifier(table_name)})").fetchall()]
                if geometry_column not in columns:
                    continue
                source_layers.append(table_name)

                property_columns = [column for column in columns if column != geometry_column]
                select_columns = [geometry_column, *property_columns]
                query = (
                    "SELECT "
                    + ", ".join(_quote_sqlite_identifier(column) for column in select_columns)
                    + f" FROM {_quote_sqlite_identifier(table_name)}"
                )

                for row in cursor.execute(query):
                    total_features_read += 1
                    geometry_blob = row[0]
                    if not geometry_blob:
                        skipped_missing_geometry += 1
                        continue

                    try:
                        shape_geometry = wkb.loads(_gpkg_geometry_wkb(bytes(geometry_blob)))
                        geometry = mapping(shape_geometry)
                    except Exception:
                        skipped_invalid_geometry += 1
                        continue

                    if not isinstance(geometry, dict) or geometry.get("type") in {None, ""}:
                        skipped_unsupported_geometry += 1
                        continue

                    properties = {
                        column: value
                        for column, value in zip(property_columns, row[1:])
                        if value not in (None, "") and not isinstance(value, (bytes, bytearray))
                    }
                    properties.setdefault("source_table", table_name)

                    features.append(
                        {
                            "type": "Feature",
                            "properties": properties,
                            "geometry": geometry,
                        }
                    )

            if not features:
                raise ValueError("GeoPackage could not be converted into previewable map features")

            feature_collection = {
                "type": "FeatureCollection",
                "features": features,
            }
            return feature_collection, None
        finally:
            connection.close()
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)
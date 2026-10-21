"""Local DMA-scoped feature counts for hydraulic model readiness."""

import json
import logging
import os
import sqlite3
import tempfile
from typing import Optional

from pyproj import CRS, Transformer
from pyproj.exceptions import ProjError
from shapely import wkb
from shapely.errors import GEOSException
from shapely.geometry import shape
from shapely.ops import transform
from shapely.prepared import prep

from app.models import DMA, UtilityInfrastructureLayer
from app.services.gpkg_utils import _gpkg_geometry_wkb, _quote_sqlite_identifier

logger = logging.getLogger(__name__)

_DMA_BOUNDARY_TOLERANCE_METERS = 5
_ASSET_COUNT_KEYS = {
    "pipe_network": "waterpipes",
    "water_sources": "watersources",
    "storage_facilities": "storagefacility",
    "valves": "valves",
    "bulk_meters": "bulk_meters",
}


def _layer_feature_count(layer: UtilityInfrastructureLayer, dma_boundary) -> int:
    file_data = bytes(layer.file_data or b"")
    if not file_data:
        return 0

    temp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as temp_file:
            temp_file.write(file_data)
            temp_path = temp_file.name

        with sqlite3.connect(temp_path) as connection:
            geometry_metadata = connection.execute(
                """
                SELECT table_name, column_name, srs_id
                FROM gpkg_geometry_columns
                ORDER BY rowid
                LIMIT 1
                """
            ).fetchone()
            if not geometry_metadata:
                raise ValueError("GeoPackage does not contain a spatial layer")

            table_name, geometry_column, srs_id = geometry_metadata
            srs = connection.execute(
                """
                SELECT organization, organization_coordsys_id, definition
                FROM gpkg_spatial_ref_sys
                WHERE srs_id = ?
                """,
                (srs_id,),
            ).fetchone()
            source_crs = CRS.from_epsg(4326)
            if srs:
                organization, organization_coordsys_id, definition = srs
                if organization and organization.upper() == "EPSG" and organization_coordsys_id > 0:
                    source_crs = CRS.from_epsg(organization_coordsys_id)
                elif definition and definition.lower() != "undefined":
                    source_crs = CRS.from_wkt(definition)

            to_wgs84 = Transformer.from_crs(source_crs, CRS.from_epsg(4326), always_xy=True)
            to_mercator = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_epsg(3857), always_xy=True)
            from_mercator = Transformer.from_crs(CRS.from_epsg(3857), CRS.from_epsg(4326), always_xy=True)
            buffered_boundary = transform(
                from_mercator.transform,
                transform(to_mercator.transform, dma_boundary).buffer(_DMA_BOUNDARY_TOLERANCE_METERS),
            )
            buffered_boundary_prepared = prep(buffered_boundary)

            quoted_table = _quote_sqlite_identifier(table_name)
            quoted_geometry = _quote_sqlite_identifier(geometry_column)
            rows = connection.execute(
                f"SELECT {quoted_geometry} FROM {quoted_table} WHERE {quoted_geometry} IS NOT NULL"
            )

            count = 0
            for (geometry_blob,) in rows:
                geometry = wkb.loads(_gpkg_geometry_wkb(bytes(geometry_blob)))
                geometry_wgs84 = transform(to_wgs84.transform, geometry)
                if not geometry_wgs84.is_empty and buffered_boundary_prepared.intersects(geometry_wgs84):
                    count += 1

            return count
    finally:
        if temp_path:
            os.unlink(temp_path)


def count_hydraulic_features_in_dma(
    dma: DMA,
    layers: dict[str, UtilityInfrastructureLayer],
) -> dict[str, int]:
    """Count uploaded GeoPackage features intersecting the DMA boundary."""
    if not dma.boundary_geojson:
        return {}

    counts: dict[str, int] = {}
    try:
        boundary = shape(json.loads(dma.boundary_geojson))
        for asset_type, count_key in _ASSET_COUNT_KEYS.items():
            layer = layers.get(asset_type)
            if layer:
                counts[count_key] = _layer_feature_count(layer, boundary)
    except (OSError, sqlite3.Error, ValueError, TypeError, GEOSException, ProjError) as exc:
        logger.warning(
            "Could not locally validate hydraulic infrastructure for DMA %s: %s",
            dma.id,
            exc,
            exc_info=True,
        )
        raise ValueError("Local GeoPackage readiness validation failed.") from exc

    return counts

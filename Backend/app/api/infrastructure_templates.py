"""
Infrastructure Template Routes

Serves downloadable GeoPackage (.gpkg) template files for each utility
infrastructure asset type. Templates give users a correctly-structured file
(prefilled with sample features and the expected attribute columns) so their
own data uploads align with the system instead of being rejected for missing
geometry or columns.

Templates are shipped with the backend under
``app/templates/infrastructure/{asset_type}_template.gpkg``.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Response, status

INFRASTRUCTURE_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "infrastructure"

SUPPORTED_TEMPLATE_ASSET_TYPES = {
    "pipe_network",
    "valves",
    "water_sources",
    "storage_facilities",
    "bulk_meters",
}

infrastructure_templates_router = APIRouter(
    prefix="/api/infrastructure-templates",
    tags=["infrastructure-templates"],
)


@infrastructure_templates_router.get("")
async def list_infrastructure_templates():
    """List the downloadable infrastructure templates."""
    return {
        "templates": [
            {"asset_type": asset_type, "file_name": f"{asset_type}_template.gpkg"}
            for asset_type in sorted(SUPPORTED_TEMPLATE_ASSET_TYPES)
        ]
    }


@infrastructure_templates_router.get("/{asset_type}")
async def download_infrastructure_template(asset_type: str):
    """Download the sample GeoPackage template for an infrastructure asset type."""
    if asset_type not in SUPPORTED_TEMPLATE_ASSET_TYPES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No template available for asset type '{asset_type}'",
        )

    template_path = INFRASTRUCTURE_TEMPLATES_DIR / f"{asset_type}_template.gpkg"
    if not template_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template file not found on the server",
        )

    content = template_path.read_bytes()
    headers = {"Content-Disposition": f'attachment; filename="{asset_type}_template.gpkg"'}
    return Response(
        content=content,
        media_type="application/geopackage+sqlite3",
        headers=headers,
    )

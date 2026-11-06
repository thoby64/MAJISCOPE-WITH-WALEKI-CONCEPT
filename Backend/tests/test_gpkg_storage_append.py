import sqlite3
from unittest.mock import Mock

import app.services.gpkg_storage_append as gpkg_storage_append
from app.models import Utility, UtilityInfrastructureLayer
from app.services.gpkg_storage_append import (
    StorageFacilityCreateData,
    append_storage_facility,
    _load_spatialite,
)
from app.services.gpkg_utils import load_storage_facilities_features


def test_spatialite_is_optional():
    connection = Mock()
    connection.load_extension.side_effect = sqlite3.OperationalError("extension not found")

    assert _load_spatialite(connection) is False


def test_storage_facility_can_be_created_without_spatialite(db, monkeypatch):
    monkeypatch.setattr(gpkg_storage_append, "_load_spatialite", lambda connection: False)
    utility = Utility(id="utility-1", name="Test Utility")
    db.add(utility)
    db.commit()

    updated_gpkg_data, storage_facility, sensor = append_storage_facility(
        db=db,
        utility_id=utility.id,
        storage_facility_data=StorageFacilityCreateData(
            name="Reservoir A",
            latitude=-6.8,
            longitude=39.2,
            attributes={},
            custom_attributes={},
        ),
        uploaded_by_manager_id=None,
    )

    features = load_storage_facilities_features("storage.gpkg", updated_gpkg_data)

    assert sensor is None
    assert storage_facility.name == "Reservoir A"
    assert len(features) == 1
    assert features[0]["geometry"]["type"] == "Point"
    assert features[0]["properties"]["Name"] == "Reservoir A"


def test_admin_can_create_storage_facility_without_manager_foreign_key(
    client, db, admin_user, admin_auth_headers, monkeypatch
):
    monkeypatch.setattr(gpkg_storage_append, "_load_spatialite", lambda connection: False)
    utility = Utility(id="utility-admin", name="Admin Utility")
    db.add(utility)
    db.commit()

    response = client.post(
        f"/api/utilities/{utility.id}/storage-facilities/manual",
        headers=admin_auth_headers,
        json={
            "name": "Admin Reservoir",
            "latitude": -6.8,
            "longitude": 39.2,
        },
    )

    assert response.status_code == 201, response.text
    layer = (
        db.query(UtilityInfrastructureLayer)
        .filter(UtilityInfrastructureLayer.utility_id == utility.id)
        .one()
    )
    assert layer.uploaded_by_manager_id is None

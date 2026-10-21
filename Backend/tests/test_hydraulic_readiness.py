from app.api import hydraulic_model
from app.models import DMA, Utility, UtilityInfrastructureLayer
from app.security.dependencies import CurrentUser


def _create_utility_with_infrastructure(db):
    utility = Utility(name="Hydraulic readiness utility")
    db.add(utility)
    db.flush()

    dma = DMA(
        name="Hydraulic readiness DMA",
        utility_id=utility.id,
        boundary_geojson='{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
    )
    db.add(dma)
    db.flush()

    db.add_all(
        [
            UtilityInfrastructureLayer(
                utility_id=utility.id,
                asset_type="pipe_network",
                file_data=b"gpkg",
                file_name="pipes.gpkg",
                file_size=4,
            ),
            UtilityInfrastructureLayer(
                utility_id=utility.id,
                asset_type="storage_facilities",
                file_data=b"gpkg",
                file_name="storage.gpkg",
                file_size=4,
            ),
        ]
    )
    db.commit()
    return utility, dma


def test_readiness_marks_uploaded_infrastructure_unavailable_when_validator_is_down(db, monkeypatch):
    utility, dma = _create_utility_with_infrastructure(db)
    error = "Hydraulic model service is not reachable: connection refused"
    monkeypatch.setattr(
        hydraulic_model,
        "_call_hydraulic_gpkg_validator",
        lambda **_kwargs: ({}, error),
    )
    admin = CurrentUser(id="admin-1", email="admin@example.com", user_type="user")

    readiness = hydraulic_model._build_readiness(db, admin, utility.id, dma.id)

    requirements = {item.key: item for item in readiness.required}
    assert readiness.ready is False
    assert readiness.can_prepare is False
    assert requirements["dma_boundary"].check_status == "available"
    assert requirements["pipe_network"].present is False
    assert requirements["pipe_network"].check_status == "unavailable"
    assert requirements["water_supply_point"].present is False
    assert requirements["water_supply_point"].check_status == "unavailable"
    assert "could not be verified" in readiness.message


def test_readiness_reports_uploaded_features_after_successful_validation(db, monkeypatch):
    utility, dma = _create_utility_with_infrastructure(db)
    monkeypatch.setattr(
        hydraulic_model,
        "_call_hydraulic_gpkg_validator",
        lambda **_kwargs: ({"waterpipes": 3, "storagefacility": 1}, None),
    )
    admin = CurrentUser(id="admin-1", email="admin@example.com", user_type="user")

    readiness = hydraulic_model._build_readiness(db, admin, utility.id, dma.id)

    requirements = {item.key: item for item in readiness.required}
    assert readiness.ready is True
    assert readiness.can_prepare is True
    assert requirements["pipe_network"].check_status == "available"
    assert requirements["water_supply_point"].check_status == "available"


def test_validator_404_identifies_misconfigured_service_url(monkeypatch):
    class NotFoundResponse:
        status_code = 404
        text = "Not Found"

        def json(self):
            raise ValueError("Response body is not JSON")

    class NotFoundClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            return NotFoundResponse()

    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://wrong-service.onrender.com")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-api-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: NotFoundClient())

    _, error = hydraulic_model._call_hydraulic_gpkg_validator(
        dma=DMA(
            id="test-dma",
            name="Test DMA",
            boundary_geojson='{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
        ),
        layers={},
    )

    assert error is not None
    assert "HTTP 404" in error
    assert "HYDRAULIC_MODEL_BASE_URL" in error
    assert "without an /api suffix" in error


def test_validator_429_reports_retry_after(monkeypatch):
    class RateLimitedResponse:
        status_code = 429
        headers = {"Retry-After": "30"}

    class RateLimitedClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            return RateLimitedResponse()

    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://hydraulic.example.com")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-api-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: RateLimitedClient())

    _, error = hydraulic_model._call_hydraulic_gpkg_validator(
        dma=DMA(
            id="test-dma",
            name="Test DMA",
            boundary_geojson='{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}',
        ),
        layers={},
    )

    assert error is not None
    assert "HTTP 429" in error
    assert "HYDRAULIC_MODEL_BASE_URL" in error
    assert "Internal Address" in error
    assert "Retry-After: 30" in error

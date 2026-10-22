import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pyproj import Transformer
from shapely import wkb
from shapely.geometry import Point

from app.api import hydraulic_model
from app.models import DMA, Utility, UtilityInfrastructureLayer
from app.security.dependencies import CurrentUser
from app.services.hydraulic_readiness import count_hydraulic_features_in_dma


def _fail_local_validation(*_args):
    raise ValueError("Local GeoPackage readiness validation failed with internal details")


def _create_gpkg(points, srs_id=4326):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "test.gpkg"
        with sqlite3.connect(path) as connection:
            connection.executescript(
                """
                CREATE TABLE gpkg_spatial_ref_sys (
                    srs_name TEXT NOT NULL,
                    srs_id INTEGER NOT NULL PRIMARY KEY,
                    organization TEXT NOT NULL,
                    organization_coordsys_id INTEGER NOT NULL,
                    definition TEXT NOT NULL,
                    description TEXT
                );
                CREATE TABLE gpkg_contents (
                    table_name TEXT NOT NULL PRIMARY KEY,
                    data_type TEXT NOT NULL,
                    identifier TEXT,
                    description TEXT,
                    last_change DATETIME DEFAULT CURRENT_TIMESTAMP,
                    min_x DOUBLE,
                    min_y DOUBLE,
                    max_x DOUBLE,
                    max_y DOUBLE,
                    srs_id INTEGER
                );
                CREATE TABLE gpkg_geometry_columns (
                    table_name TEXT NOT NULL,
                    column_name TEXT NOT NULL,
                    geometry_type_name TEXT NOT NULL,
                    srs_id INTEGER NOT NULL,
                    z TINYINT NOT NULL DEFAULT 0,
                    m TINYINT NOT NULL DEFAULT 0,
                    PRIMARY KEY (table_name, column_name)
                );
                CREATE TABLE pipes (fid INTEGER PRIMARY KEY, geom BLOB);
                """
            )
            if srs_id == 4326:
                srs_name, organization, organization_coordsys_id, definition = (
                    "WGS 84",
                    "EPSG",
                    4326,
                    "undefined",
                )
            else:
                srs_name, organization, organization_coordsys_id, definition = (
                    "WGS 84 / Pseudo-Mercator",
                    "EPSG",
                    srs_id,
                    "undefined",
                )
            connection.execute(
                "INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)",
                (srs_name, srs_id, organization, organization_coordsys_id, definition, srs_name),
            )
            connection.execute(
                "INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES (?, ?, ?, ?)",
                ("pipes", "features", "pipes", srs_id),
            )
            connection.execute(
                "INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, 0, 0)",
                ("pipes", "geom", "POINT", srs_id),
            )
            for fid, point in enumerate(points, start=1):
                geometry_blob = b"GP\x00\x00" + srs_id.to_bytes(4, "little") + wkb.dumps(point)
                connection.execute("INSERT INTO pipes (fid, geom) VALUES (?, ?)", (fid, geometry_blob))
        return path.read_bytes()


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


def test_readiness_marks_uploaded_infrastructure_unavailable_when_local_validation_fails(db, monkeypatch):
    utility, dma = _create_utility_with_infrastructure(db)
    monkeypatch.setattr(
        hydraulic_model,
        "count_hydraulic_features_in_dma",
        _fail_local_validation,
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
    assert readiness.message == "An error occurred. Please reselect the utility and DMA later."
    assert readiness.action_hint is None
    assert all(
        "internal details" not in (item.message or "")
        for item in readiness.required + readiness.optional
    )


def test_readiness_hides_local_validation_error_from_dma_manager(db, monkeypatch):
    utility, dma = _create_utility_with_infrastructure(db)
    monkeypatch.setattr(
        hydraulic_model,
        "count_hydraulic_features_in_dma",
        _fail_local_validation,
    )
    manager = CurrentUser(
        id="dma-manager-1",
        email="manager@example.com",
        user_type="dma_manager",
        utility_id=utility.id,
        dma_id=dma.id,
    )

    readiness = hydraulic_model._build_readiness(db, manager, utility.id, dma.id)

    assert readiness.message == "An error occurred. Please try again later."
    assert readiness.action_hint is None
    assert all(
        "internal details" not in (item.message or "")
        for item in readiness.required + readiness.optional
    )


def test_readiness_reports_uploaded_features_after_local_validation(db, monkeypatch):
    utility, dma = _create_utility_with_infrastructure(db)
    monkeypatch.setattr(
        hydraulic_model,
        "count_hydraulic_features_in_dma",
        lambda *_args: {"waterpipes": 3, "storagefacility": 1},
    )
    admin = CurrentUser(id="admin-1", email="admin@example.com", user_type="user")

    readiness = hydraulic_model._build_readiness(db, admin, utility.id, dma.id)

    requirements = {item.key: item for item in readiness.required}
    assert readiness.ready is True
    assert readiness.can_prepare is True
    assert requirements["pipe_network"].check_status == "available"
    assert requirements["water_supply_point"].check_status == "available"


def test_readiness_reports_real_missing_features_when_local_validation_succeeds(db, monkeypatch):
    utility, dma = _create_utility_with_infrastructure(db)
    monkeypatch.setattr(
        hydraulic_model,
        "count_hydraulic_features_in_dma",
        lambda *_args: {"waterpipes": 0, "storagefacility": 0},
    )
    admin = CurrentUser(id="admin-1", email="admin@example.com", user_type="user")

    readiness = hydraulic_model._build_readiness(db, admin, utility.id, dma.id)

    requirements = {item.key: item for item in readiness.required}
    assert readiness.ready is False
    assert requirements["pipe_network"].check_status == "missing"
    assert requirements["pipe_network"].message == (
        "The uploaded pipe network has no features inside or on this DMA boundary."
    )
    assert requirements["water_supply_point"].check_status == "missing"
    assert requirements["water_supply_point"].message == (
        "Uploaded water source and storage layers have no features inside or on this DMA boundary."
    )


def test_local_readiness_counts_using_layer_crs_and_dma_boundary_tolerance():
    to_mercator = Transformer.from_crs(4326, 3857, always_xy=True)
    boundary_x, boundary_y = to_mercator.transform(39.0, -6.0)
    layer = UtilityInfrastructureLayer(
        asset_type="pipe_network",
        file_data=_create_gpkg(
            [
                Point(boundary_x - 1, boundary_y),
                Point(boundary_x - 3, boundary_y),
                Point(boundary_x - 10, boundary_y),
            ],
            srs_id=3857,
        ),
        file_name="pipes.gpkg",
        file_size=1,
    )
    dma = DMA(
        id="test-dma",
        name="Test DMA",
        boundary_geojson=(
            '{"type":"Polygon","coordinates":[[[39,-6],[39.001,-6],'
            '[39.001,-5.999],[39,-5.999],[39,-6]]]}'
        ),
    )

    counts = count_hydraulic_features_in_dma(dma, {"pipe_network": layer})

    assert counts["waterpipes"] == 2


class _FakeHydraulicResponse:
    def __init__(self, status_code, payload=None, headers=None, text=""):
        self.status_code = status_code
        self.payload = payload or {}
        self.headers = headers or {}
        self.text = text

    def json(self):
        return self.payload


class _FakeHydraulicClient:
    """Minimal stand-in for `httpx.Client` used by the hydraulic model client."""

    def __init__(self, responses=None, post_error=None):
        self.responses = list(responses or [])
        self.post_error = post_error
        self.posts = []
        self.gets = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, url, **_kwargs):
        self.gets.append(url)
        return _FakeHydraulicResponse(200)

    def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        if self.post_error is not None:
            error = self.post_error
            self.post_error = None
            raise error
        return self.responses.pop(0)


def _prepare(session_id="session-id"):
    return SimpleNamespace(
        id=session_id,
        expires_at=datetime(2026, 1, 1),
        utility_id="utility-id",
        dma_id="dma-id",
    )


def test_prepare_preserves_hydraulic_service_rate_limit_and_retry_after(monkeypatch):
    client = _FakeHydraulicClient(
        responses=[
            _FakeHydraulicResponse(429, headers={"Retry-After": "30"}),
            _FakeHydraulicResponse(429, headers={"Retry-After": "30"}),
            _FakeHydraulicResponse(429, headers={"Retry-After": "30"}),
        ]
    )
    sleeps = []
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://model.test")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: client)
    monkeypatch.setattr(hydraulic_model.time, "sleep", sleeps.append)

    with pytest.raises(HTTPException) as error:
        hydraulic_model._call_hydraulic_gpkg_builder(
            session=_prepare(),
            launch_token="launch-token",
            dma=SimpleNamespace(id="dma-id", name="DMA", boundary_geojson="{}"),
            layers={},
            reported_leaks_geojson={},
        )

    assert error.value.status_code == 429
    assert error.value.detail == (
        "The hydraulic model service is temporarily busy. Please try again shortly."
    )
    assert error.value.headers == {"Retry-After": "30"}
    # The platform asked for a 30 second pause, so the request is retried that
    # long instead of being abandoned straight away.
    assert sleeps == [30.0, 30.0]
    assert len(client.posts) == hydraulic_model.HYDRAULIC_MODEL_PREPARE_ATTEMPTS


def test_prepare_honours_http_date_retry_after(monkeypatch):
    retry_at = datetime.now(timezone.utc) + timedelta(seconds=10)
    client = _FakeHydraulicClient(
        responses=[
            _FakeHydraulicResponse(429, headers={"Retry-After": format_datetime(retry_at)}),
            _FakeHydraulicResponse(201, {"filename": "prepared.gpkg"}),
        ]
    )
    sleeps = []
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://model.test")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: client)
    monkeypatch.setattr(hydraulic_model.time, "sleep", sleeps.append)

    prepared = hydraulic_model._call_hydraulic_gpkg_builder(
        session=_prepare(),
        launch_token="launch-token",
        dma=SimpleNamespace(id="dma-id", name="DMA", boundary_geojson="{}"),
        layers={},
        reported_leaks_geojson={},
    )

    assert prepared == {"filename": "prepared.gpkg"}
    assert len(sleeps) == 1
    assert 8.0 <= sleeps[0] <= 10.0


def test_prepare_warms_up_cold_hydraulic_service_before_upload(monkeypatch):
    client = _FakeHydraulicClient(
        responses=[_FakeHydraulicResponse(201, {"filename": "prepared.gpkg"})]
    )
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://model.test")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: client)

    hydraulic_model._call_hydraulic_gpkg_builder(
        session=_prepare(),
        launch_token="launch-token",
        dma=SimpleNamespace(id="dma-id", name="DMA", boundary_geojson="{}"),
        layers={},
        reported_leaks_geojson={},
    )

    assert client.gets == ["https://model.test/health"]
    assert client.posts[0][0] == "https://model.test/majiscope/prepare-gpkg"


def test_prepare_falls_back_to_next_base_url_when_first_is_unreachable(monkeypatch):
    client = _FakeHydraulicClient(
        responses=[_FakeHydraulicResponse(201, {"filename": "prepared.gpkg"})],
        post_error=hydraulic_model.httpx.ConnectError("connection refused"),
    )
    monkeypatch.setattr(
        hydraulic_model.settings,
        "hydraulic_model_base_url",
        "http://epanet-model:10000,https://epanet-model.onrender.com",
    )
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: client)

    prepared = hydraulic_model._call_hydraulic_gpkg_builder(
        session=_prepare(),
        launch_token="launch-token",
        dma=SimpleNamespace(id="dma-id", name="DMA", boundary_geojson="{}"),
        layers={},
        reported_leaks_geojson={},
    )

    assert prepared == {"filename": "prepared.gpkg"}
    assert [url for url, _ in client.posts] == [
        "http://epanet-model:10000/majiscope/prepare-gpkg",
        "https://epanet-model.onrender.com/majiscope/prepare-gpkg",
    ]


def test_prepare_reports_unavailable_service_after_retries(monkeypatch):
    client = _FakeHydraulicClient(
        responses=[
            _FakeHydraulicResponse(502, text="Bad Gateway"),
            _FakeHydraulicResponse(502, text="Bad Gateway"),
            _FakeHydraulicResponse(502, text="Bad Gateway"),
        ]
    )
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://model.test")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: client)
    monkeypatch.setattr(hydraulic_model.time, "sleep", lambda _delay: None)

    with pytest.raises(HTTPException) as error:
        hydraulic_model._call_hydraulic_gpkg_builder(
            session=_prepare(),
            launch_token="launch-token",
            dma=SimpleNamespace(id="dma-id", name="DMA", boundary_geojson="{}"),
            layers={},
            reported_leaks_geojson={},
        )

    assert error.value.status_code == 502
    assert error.value.detail == hydraulic_model.HYDRAULIC_MODEL_UNAVAILABLE_DETAIL
    assert len(client.posts) == hydraulic_model.HYDRAULIC_MODEL_PREPARE_ATTEMPTS


def test_hydraulic_model_public_url_falls_back_to_base_url(monkeypatch):
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://model.test/")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_public_url", "")
    assert hydraulic_model._hydraulic_model_public_url() == "https://model.test"

    monkeypatch.setattr(
        hydraulic_model.settings,
        "hydraulic_model_base_url",
        "http://epanet-model:10000,https://model.test",
    )
    monkeypatch.setattr(
        hydraulic_model.settings,
        "hydraulic_model_public_url",
        "https://epanet-model.onrender.com/",
    )
    assert hydraulic_model._hydraulic_model_public_url() == "https://epanet-model.onrender.com"
    assert hydraulic_model._hydraulic_model_base_urls() == [
        "http://epanet-model:10000",
        "https://model.test",
    ]


def test_prepare_retries_brief_hydraulic_service_rate_limit(monkeypatch):
    class FakeResponse:
        headers = {"Retry-After": "1"}
        text = ""

        def __init__(self, status_code, payload=None):
            self.status_code = status_code
            self.payload = payload or {}

        def json(self):
            return self.payload

    class FakeClient:
        def __init__(self):
            self.responses = [FakeResponse(429), FakeResponse(201, {"filename": "prepared.gpkg"})]

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def get(self, *_args, **_kwargs):
            return FakeResponse(200)

        def post(self, *_args, **_kwargs):
            return self.responses.pop(0)

    client = FakeClient()
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_base_url", "https://model.test")
    monkeypatch.setattr(hydraulic_model.settings, "hydraulic_model_api_key", "test-key")
    monkeypatch.setattr(hydraulic_model.httpx, "Client", lambda **_kwargs: client)
    monkeypatch.setattr(hydraulic_model.time, "sleep", lambda _delay: None)

    prepared = hydraulic_model._call_hydraulic_gpkg_builder(
        session=SimpleNamespace(
            id="session-id",
            expires_at=datetime(2026, 1, 1),
            utility_id="utility-id",
            dma_id="dma-id",
        ),
        launch_token="launch-token",
        dma=SimpleNamespace(id="dma-id", name="DMA", boundary_geojson="{}"),
        layers={},
        reported_leaks_geojson={},
    )

    assert prepared == {"filename": "prepared.gpkg"}
    assert client.responses == []

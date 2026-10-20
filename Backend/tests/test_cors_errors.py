from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app, fastapi_app


def test_unhandled_server_error_includes_cors_headers():
    origin = "https://latest-majiscope.onrender.com"

    def fail_unexpectedly():
        raise RuntimeError("test failure")

    fastapi_app.add_api_route(
        "/__tests__/unhandled-error",
        fail_unexpectedly,
        methods=["GET"],
    )
    route = fastapi_app.router.routes[-1]
    try:
        response = TestClient(app, raise_server_exceptions=False).get(
            "/__tests__/unhandled-error",
            headers={"Origin": origin},
        )
    finally:
        fastapi_app.router.routes.remove(route)

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == origin


def test_handled_http_error_includes_cors_headers():
    origin = "https://latest-majiscope.onrender.com"

    def fail_with_http_exception():
        raise HTTPException(status_code=503, detail="Unavailable")

    fastapi_app.add_api_route(
        "/__tests__/handled-error",
        fail_with_http_exception,
        methods=["GET"],
    )
    route = fastapi_app.router.routes[-1]
    try:
        response = TestClient(app).get(
            "/__tests__/handled-error",
            headers={"Origin": origin},
        )
    finally:
        fastapi_app.router.routes.remove(route)

    assert response.status_code == 503
    assert response.headers["access-control-allow-origin"] == origin

import hashlib
import json
from io import BytesIO
from urllib.error import HTTPError
from unittest.mock import patch

from botocore.exceptions import ClientError, ResponseStreamingError
from app.config import settings
from app.models import ImageUpload
from app.services import media_storage
from app.services.media_storage_migration import migrate_report_media


def test_http_storage_operations_use_the_configured_api(monkeypatch):
    monkeypatch.setattr(settings, "media_storage_backend", "http")
    monkeypatch.setattr(settings, "media_storage_api_url", "http://storage.local:8082/")
    monkeypatch.setattr(settings, "media_storage_api_key", "secret")

    put_response = json.dumps({
        "key": "reports/image one.jpg",
        "size": len(b"payload"),
        "sha256": hashlib.sha256(b"payload").hexdigest(),
    }).encode()
    with patch.object(
        media_storage,
        "_http_request",
        side_effect=[put_response, b"payload", b""],
    ) as request:
        media_storage.put_object("reports/image one.jpg", b"payload", "image/jpeg")
        assert media_storage.get_object("reports/image one.jpg") == b"payload"
        media_storage.delete_object("reports/image one.jpg")

    assert request.call_args_list[0].args == (
        "reports/image one.jpg",
        "PUT",
        b"payload",
        "image/jpeg",
    )
    assert request.call_args_list[1].args == ("reports/image one.jpg", "GET")
    assert request.call_args_list[2].args == ("reports/image one.jpg", "DELETE")


def test_http_request_escapes_object_key_and_sends_service_token(monkeypatch):
    monkeypatch.setattr(settings, "media_storage_api_url", "http://storage.local:8082")
    monkeypatch.setattr(settings, "media_storage_api_key", "private-token")

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def read(self):
            return b"stored"

    with patch.object(media_storage, "urlopen", return_value=Response()) as open_url:
        assert media_storage._http_request("reports/a b#c", "GET") == b"stored"

    request = open_url.call_args.args[0]
    assert request.full_url == "http://storage.local:8082/internal/objects/reports/a%20b%23c"
    assert request.get_header("Authorization") == "Bearer private-token"


def test_http_put_retries_rate_limit_and_honors_retry_after(monkeypatch):
    monkeypatch.setattr(settings, "media_storage_api_url", "http://storage.local:8082")
    monkeypatch.setattr(settings, "media_storage_api_key", "private-token")
    rate_limited = HTTPError(
        "http://storage.local:8082/internal/objects/reports/test",
        429,
        "Too Many Requests",
        {"Retry-After": "2"},
        BytesIO(),
    )

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def read(self):
            return b"stored"

    with (
        patch.object(media_storage, "urlopen", side_effect=[rate_limited, Response()]) as open_url,
        patch.object(media_storage.time, "sleep") as sleep,
    ):
        assert media_storage._http_request("reports/test", "PUT", b"payload", "image/jpeg") == b"stored"

    assert open_url.call_count == 2
    sleep.assert_called_once_with(2.0)


def test_http_put_rate_limit_retries_are_bounded(monkeypatch):
    monkeypatch.setattr(settings, "media_storage_api_url", "http://storage.local:8082")
    monkeypatch.setattr(settings, "media_storage_api_key", "private-token")
    rate_limits = [
        HTTPError(
            "http://storage.local:8082/internal/objects/reports/test",
            429,
            "Too Many Requests",
            {},
            BytesIO(),
        )
        for _ in range(media_storage.HTTP_PUT_MAX_ATTEMPTS)
    ]

    with (
        patch.object(media_storage, "urlopen", side_effect=rate_limits) as open_url,
        patch.object(media_storage.time, "sleep") as sleep,
    ):
        try:
            media_storage._http_request("reports/test", "PUT", b"payload", "image/jpeg")
        except RuntimeError as exc:
            assert str(exc) == "HTTP media storage returned status 429"
        else:
            raise AssertionError("Expected the final HTTP 429 to surface after bounded retries")

    assert open_url.call_count == media_storage.HTTP_PUT_MAX_ATTEMPTS
    assert [call.args[0] for call in sleep.call_args_list] == [0.5, 1.0, 2.0]


def test_media_backfill_without_purging_finishes_and_can_be_rerun(db, monkeypatch):
    monkeypatch.setattr(settings, "media_storage_backend", "http")
    image = ImageUpload(
        id="e6d2adf8-867f-4e75-9ba1-3fd0d369b5a0",
        file_data=b"legacy bytes",
        file_name="legacy.jpg",
        file_type="image/jpeg",
        file_size=12,
        mime_type="image/jpeg",
    )
    db.add(image)
    db.commit()

    with (
        patch("app.services.media_storage_migration.put_object") as put_object,
        patch("app.services.media_storage_migration.get_object", return_value=b"legacy bytes") as get_object,
    ):
        result = migrate_report_media(db, purge_binary=False)
        assert result["objects_verified"] == 1
        assert result["database_payloads"] == 1
        assert image.storage_backend == "http"
        assert image.file_data == b"legacy bytes"
        get_object.assert_called_once_with("reports/e6d2adf8-867f-4e75-9ba1-3fd0d369b5a0", "http")

        result = migrate_report_media(db, purge_binary=True)
        assert result["objects_verified"] == 1
        assert result["payloads_purged"] == 1
        assert image.file_data is None
        assert put_object.call_count == 2


def test_missing_legacy_s3_object_is_counted_without_failing_backfill(db, monkeypatch):
    monkeypatch.setattr(settings, "media_storage_backend", "http")
    image = ImageUpload(
        id="a17d9c3a-a2a5-4ef0-ae8a-17bd306043be",
        file_data=None,
        storage_backend="s3",
        storage_key="reports/missing-object",
        sha256=None,
        file_name="missing.jpg",
        file_type="image/jpeg",
        file_size=100,
        mime_type="image/jpeg",
    )
    db.add(image)
    db.commit()

    missing_object = ClientError(
        {"Error": {"Code": "NoSuchKey", "Message": "Key not found"}},
        "GetObject",
    )
    with patch(
        "app.services.media_storage_migration.get_object",
        side_effect=missing_object,
    ) as get_object:
        result = migrate_report_media(db, purge_binary=True)

    get_object.assert_called_once_with("reports/missing-object", "s3")
    assert result["database_payloads"] == 0
    assert result["objects_verified"] == 0
    assert result["source_objects_missing"] == 1
    assert image.storage_backend == "s3"
    assert image.storage_key == "reports/missing-object"


def test_unreadable_legacy_s3_object_is_counted_without_failing_backfill(db, monkeypatch):
    monkeypatch.setattr(settings, "media_storage_backend", "http")
    image = ImageUpload(
        id="b8d2adf8-867f-4e75-9ba1-3fd0d369b5a0",
        file_data=None,
        storage_backend="s3",
        storage_key="reports/unreadable-object",
        sha256=None,
        file_name="unreadable.jpg",
        file_type="image/jpeg",
        file_size=100,
        mime_type="image/jpeg",
    )
    db.add(image)
    db.commit()

    with patch(
        "app.services.media_storage_migration.get_object",
        side_effect=ResponseStreamingError(error=ConnectionError("Incomplete object body")),
    ) as get_object:
        result = migrate_report_media(db, purge_binary=True)

    get_object.assert_called_once_with("reports/unreadable-object", "s3")
    assert result["objects_verified"] == 0
    assert result["source_objects_missing"] == 0
    assert result["source_objects_unreadable"] == 1
    assert image.storage_backend == "s3"
    assert image.storage_key == "reports/unreadable-object"

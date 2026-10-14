import json
import os
import sys
import tempfile
import threading
import unittest
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

os.environ["CS3_STORAGE_API_KEY"] = "test-storage-api-key-that-is-long-enough"
os.environ["CS3_UI_PASSPHRASE"] = "test-dashboard-passphrase"
sys.path.insert(0, str(Path(__file__).resolve().parent))

import webui
import copy_bucket


class StorageHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        webui.DATA_ROOT = root
        webui.OBJECT_ROOT = root / "files"
        webui.METADATA_ROOT = root / "file-metadata"
        webui.API_KEY = "test-storage-api-key-that-is-long-enough"
        webui.PASSPHRASE = "test-dashboard-passphrase"
        webui.MAX_OBJECT_BYTES = 1024
        self.server = webui.ThreadingHTTPServer(("127.0.0.1", 0), webui.Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def request(self, method, path, data=None, token=None, content_type=None):
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if content_type:
            headers["Content-Type"] = content_type
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        return urlopen(request, timeout=3)

    def test_upload_read_list_and_delete_share_one_http_listener(self):
        key = "reports/sample name#.jpg"
        payload = b"image bytes"
        object_path = f"/internal/objects/{quote(key, safe='/')}"
        with self.request("PUT", object_path, payload, webui.API_KEY, "image/jpeg") as response:
            result = json.loads(response.read())
            self.assertEqual(response.status, 201)
            self.assertEqual(result["size"], len(payload))

        with self.request("GET", object_path, token=webui.API_KEY) as response:
            self.assertEqual(response.read(), payload)
            self.assertEqual(response.headers["Content-Type"], "image/jpeg")

        with self.request(
            "GET",
            f"/api/objects?{urlencode({'unused': 'value'})}",
            token=webui.PASSPHRASE,
        ) as response:
            listing = json.loads(response.read())
        self.assertEqual([item["key"] for item in listing["objects"]], [key])

        with self.request(
            "GET",
            f"/api/object?{urlencode({'key': key})}",
            token=webui.PASSPHRASE,
        ) as response:
            self.assertEqual(response.read(), payload)

        with self.request("DELETE", object_path, token=webui.API_KEY) as response:
            self.assertEqual(response.status, 204)

        with self.assertRaises(HTTPError) as error:
            self.request("GET", object_path, token=webui.API_KEY)
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_storage_routes_require_the_backend_token(self):
        with self.assertRaises(HTTPError) as error:
            self.request("PUT", "/internal/objects/reports/unauthorized", b"x")
        self.assertEqual(error.exception.code, 401)
        error.exception.close()

    def test_upload_limit_is_enforced(self):
        webui.MAX_OBJECT_BYTES = 3
        with self.assertRaises(HTTPError) as error:
            self.request(
                "PUT",
                "/internal/objects/reports/too-large",
                b"four",
                webui.API_KEY,
            )
        self.assertEqual(error.exception.code, 413)
        error.exception.close()

    def test_health_check_is_served_by_the_same_listener(self):
        with self.request("GET", "/healthz") as response:
            self.assertEqual(json.loads(response.read()), {"status": "ok"})

    def test_legacy_migration_upload_is_verified_by_readback(self):
        payload = b"legacy object data"
        digest = copy_bucket.upload_and_hash(
            self.base_url,
            webui.API_KEY,
            "reports/legacy object.bin",
            BytesIO(payload),
            len(payload),
            "application/octet-stream",
        )
        copy_bucket.verify_target(
            self.base_url,
            webui.API_KEY,
            "reports/legacy object.bin",
            digest,
        )


if __name__ == "__main__":
    unittest.main()

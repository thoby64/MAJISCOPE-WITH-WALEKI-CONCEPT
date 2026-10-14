#!/usr/bin/env python3
"""Single-port file storage API and passphrase-protected object browser."""

from __future__ import annotations

import hmac
import hashlib
import json
import os
import shutil
import signal
import tempfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote_to_bytes, urlparse

SERVER_DIR = Path(__file__).resolve().parent


def load_local_environment() -> None:
    env_file = SERVER_DIR / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name and name not in os.environ:
            os.environ[name] = value.strip().strip("\"'")


load_local_environment()

HOST = os.environ.get("CS3_UI_BIND_ADDRESS", "127.0.0.1")
PORT = int(os.environ.get("PORT") or os.environ.get("CS3_UI_PORT", "8082"))
DATA_ROOT_SETTING = Path(os.environ.get("CS3_STORAGE_ROOT", SERVER_DIR / "data"))
if not DATA_ROOT_SETTING.is_absolute():
    DATA_ROOT_SETTING = SERVER_DIR / DATA_ROOT_SETTING
DATA_ROOT = DATA_ROOT_SETTING.resolve()
OBJECT_ROOT = (DATA_ROOT / "files").resolve()
METADATA_ROOT = (DATA_ROOT / "file-metadata").resolve()
API_KEY = os.environ.get("CS3_STORAGE_API_KEY", "")
PASSPHRASE = os.environ.get("CS3_UI_PASSPHRASE", "")
if not PASSPHRASE:
    passphrase_file = SERVER_DIR / ".ui-passphrase"
    if passphrase_file.is_file():
        passphrase_lines = passphrase_file.read_text(encoding="utf-8").splitlines()
        if passphrase_lines:
            PASSPHRASE = passphrase_lines[0].strip()
MAX_OBJECT_BYTES = int(os.environ.get("CS3_MAX_OBJECT_SIZE_BYTES", str(1024**3)))

PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>CS3 Object Storage</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e8eef7;background:#101720}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top right,#1b3a50 0,transparent 42%),#101720}header{display:flex;align-items:center;justify-content:space-between;padding:24px max(24px,calc((100vw - 1440px)/2));border-bottom:1px solid #ffffff18;background:#101720b8;position:sticky;top:0;backdrop-filter:blur(14px);z-index:2}.brand{display:flex;gap:14px;align-items:center}.mark{width:42px;height:42px;border-radius:13px;background:#0f766e;display:grid;place-items:center;font-weight:800}.brand strong{font-size:16px}.brand small{display:block;color:#8da1b5;margin-top:3px}.status{color:#7de0b2;font-size:13px}.wrap{max-width:1440px;margin:auto;padding:36px 24px}.hero{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:26px}.hero h1{font-size:clamp(28px,4vw,42px);margin:0 0 9px;letter-spacing:-.04em}.hero p{margin:0;color:#93a7ba}.bucket{border:1px solid #ffffff20;background:#ffffff0a;border-radius:14px;padding:12px 16px;color:#b7c6d4;font-size:13px}.bucket b{color:#e8eef7}.toolbar{display:flex;gap:12px;align-items:center;margin:22px 0}.toolbar input{flex:1;min-width:180px;background:#18232e;border:1px solid #ffffff20;color:#f3f6fa;border-radius:11px;padding:13px 15px;font:inherit;outline:none}.toolbar input:focus{border-color:#2dd4bf}.toolbar button,.login button{background:#0f766e;color:white;border:0;border-radius:10px;padding:12px 16px;font-weight:700;cursor:pointer}.stats{display:flex;gap:18px;color:#91a4b8;font-size:13px;margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.card{min-width:0;border:1px solid #ffffff18;border-radius:15px;background:#18232e;overflow:hidden;transition:transform .15s,border-color .15s}.card:hover{transform:translateY(-2px);border-color:#2dd4bf88}.preview{height:160px;background:#0c1219;display:grid;place-items:center;color:#607489;overflow:hidden}.preview img,.preview video{width:100%;height:100%;object-fit:cover}.file-icon{font-size:38px}.meta{padding:13px}.key{font-size:12px;overflow-wrap:anywhere;color:#d9e3ec;line-height:1.45;min-height:34px}.sub{display:flex;justify-content:space-between;gap:8px;color:#8296a9;font-size:11px;margin:10px 0}.actions{display:flex;gap:8px}.actions button{flex:1;background:#223342;border:1px solid #ffffff15;color:#e5edf5;border-radius:8px;padding:8px;cursor:pointer}.actions button:hover{background:#285264}.empty,.error{padding:36px;text-align:center;color:#8ea2b5;border:1px dashed #ffffff25;border-radius:14px}.error{color:#ff9d9d}.login{position:fixed;inset:0;display:grid;place-items:center;background:#080d13e8;z-index:5;padding:20px}.login-box{width:min(440px,100%);background:#18232e;border:1px solid #ffffff25;border-radius:18px;padding:27px;box-shadow:0 24px 90px #0009}.login-box h2{margin:0 0 8px}.login-box p{color:#9aabbb;line-height:1.5}.login form{display:flex;gap:8px}.login input{flex:1;min-width:0;background:#0c1219;border:1px solid #ffffff25;color:white;padding:12px;border-radius:9px}.login .error-text{color:#ff9d9d;min-height:20px;font-size:13px}.viewer{display:none;position:fixed;inset:0;z-index:4;background:#05080deF;place-items:center;padding:24px}.viewer.open{display:grid}.viewbox{max-width:min(1100px,100%);max-height:90vh;position:relative}.viewbox img,.viewbox video{display:block;max-width:100%;max-height:82vh;margin:auto}.close{position:fixed;right:22px;top:18px;color:white;background:#ffffff20;border:0;border-radius:9px;padding:11px;cursor:pointer}.viewlabel{text-align:center;color:#c4d0da;font-size:13px;margin-top:10px;overflow-wrap:anywhere}@media(max-width:620px){header{padding:16px}.hero{align-items:start;flex-direction:column}.wrap{padding:24px 16px}.toolbar{flex-wrap:wrap}.toolbar input{flex-basis:100%}}
</style></head><body>
<header><div class="brand"><div class="mark">S3</div><div><div><strong>CS3 Object Storage</strong></div><small>Private media browser</small></div></div><div class="status">● Authenticated object storage</div></header>
<main class="wrap"><section class="hero"><div><h1>Stored objects</h1><p>Browse and preview media saved in the configured private bucket.</p></div><div class="bucket">Bucket<br><b id="bucket">Loading…</b></div></section>
<div class="toolbar"><input id="search" type="search" placeholder="Filter by object key…" autocomplete="off"><button id="refresh">Refresh</button></div>
<div class="stats"><span id="count">Loading objects…</span><span id="size"></span></div><div id="grid" class="grid"></div>
</main>
<section id="login" class="login"><div class="login-box"><h2>Storage browser</h2><p>Enter the CS3 data passphrase to view this server’s stored objects.</p><form id="login-form"><input id="token" type="password" placeholder="CS3 data passphrase" required autocomplete="current-password"><button>Open</button></form><div id="login-error" class="error-text"></div></div></section>
<section id="viewer" class="viewer" aria-modal="true" role="dialog"><button id="close" class="close">Close</button><div class="viewbox"><div id="view-content"></div><div id="view-label" class="viewlabel"></div></div></section>
<script>
const tokenKey="cs3-ui-token", tokenInput=document.getElementById("token"), login=document.getElementById("login"), grid=document.getElementById("grid");
let allObjects=[];
document.getElementById("bucket").textContent="";
function auth(){return {Authorization:"Bearer "+(sessionStorage.getItem(tokenKey)||"")}}
function bytes(n){if(n<1024)return n+" B";const units=["KB","MB","GB","TB"];let i=-1;do{n/=1024;i++}while(n>=1024&&i<units.length-1);return n.toFixed(1)+" "+units[i]}
function date(s){return new Date(s).toLocaleString()}
async function load(){grid.replaceChildren();document.getElementById("count").textContent="Loading objects…";try{const r=await fetch("/api/objects",{headers:auth(),cache:"no-store"});if(r.status===401){login.style.display="grid";return}if(!r.ok)throw Error("Storage server returned "+r.status);const data=await r.json();allObjects=data.objects;document.getElementById("bucket").textContent=data.bucket;login.style.display="none";draw();}catch(e){grid.innerHTML='<div class="error">'+String(e.message).replace(/[<>]/g,"")+"</div>"}}
function draw(){const q=document.getElementById("search").value.toLowerCase();const objects=allObjects.filter(o=>o.key.toLowerCase().includes(q));grid.replaceChildren();document.getElementById("count").textContent=objects.length+" object"+(objects.length===1?"":"s")+(q?" matching filter":"");document.getElementById("size").textContent=bytes(objects.reduce((n,o)=>n+o.size,0));if(!objects.length){grid.innerHTML='<div class="empty">'+(allObjects.length?"No objects match this filter.":"This bucket is empty. Objects appear here after uploads or backfill.")+"</div>";return}for(const obj of objects){const card=document.createElement("article");card.className="card";const preview=document.createElement("div");preview.className="preview";const icon=document.createElement("div");icon.className="file-icon";icon.textContent=obj.content_type?.startsWith("video/")?"▶":obj.content_type?.startsWith("image/")?"▧":"▤";preview.append(icon);const meta=document.createElement("div");meta.className="meta";const key=document.createElement("div");key.className="key";key.textContent=obj.key;const sub=document.createElement("div");sub.className="sub";sub.textContent=bytes(obj.size)+" · "+date(obj.modified);const actions=document.createElement("div");actions.className="actions";const view=document.createElement("button");view.textContent="View";view.onclick=()=>openObject(obj);const download=document.createElement("button");download.textContent="Download";download.onclick=()=>downloadObject(obj);actions.append(view,download);meta.append(key,sub,actions);card.append(preview,meta);grid.append(card)}}
async function objectBlob(obj){const r=await fetch("/api/object?key="+encodeURIComponent(obj.key),{headers:auth(),cache:"no-store"});if(!r.ok)throw Error("Could not load this object");return await r.blob()}
async function openObject(obj){try{const blob=await objectBlob(obj),url=URL.createObjectURL(blob),box=document.getElementById("view-content");box.replaceChildren();const media=document.createElement(blob.type.startsWith("video/")?"video":"img");media.src=url;media.controls=media.tagName==="VIDEO";media.alt=obj.key;box.append(media);document.getElementById("view-label").textContent=obj.key;document.getElementById("viewer").classList.add("open");document.getElementById("viewer").dataset.url=url}catch(e){alert(e.message)}}
async function downloadObject(obj){try{const blob=await objectBlob(obj),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=obj.key.split("/").pop()||"object";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){alert(e.message)}}
document.getElementById("login-form").onsubmit=async e=>{e.preventDefault();sessionStorage.setItem(tokenKey,tokenInput.value);document.getElementById("login-error").textContent="";await load();if(login.style.display!=="none"&&allObjects.length===0)document.getElementById("login-error").textContent="Token not accepted or storage service unavailable."};
document.getElementById("refresh").onclick=load;document.getElementById("search").oninput=draw;document.getElementById("close").onclick=()=>{const v=document.getElementById("viewer"),url=v.dataset.url;if(url)URL.revokeObjectURL(url);v.classList.remove("open")};document.getElementById("viewer").onclick=e=>{if(e.target.id==="viewer")document.getElementById("close").click()};
if(sessionStorage.getItem(tokenKey)){tokenInput.value=sessionStorage.getItem(tokenKey);login.style.display="none";load()}
</script></body></html>"""


def _key_id(key: str) -> str:
    if not key or len(key.encode("utf-8")) > 1024 or "\x00" in key:
        raise ValueError("Invalid object key")
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _object_path(key: str) -> Path:
    identifier = _key_id(key)
    return OBJECT_ROOT / identifier[:2] / identifier[2:]


def _metadata_path(key: str) -> Path:
    return METADATA_ROOT / f"{_key_id(key)}.json"


def _read_metadata(key: str) -> dict:
    metadata_path = _metadata_path(key)
    if not metadata_path.is_file():
        raise FileNotFoundError(key)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict) or metadata.get("key") != key:
        raise OSError("Stored object metadata does not match its key")
    return metadata


class Handler(BaseHTTPRequestHandler):
    server_version = "CS3Storage/2.0"
    protocol_version = "HTTP/1.1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(120)

    def log_message(self, fmt: str, *args) -> None:
        path = urlparse(self.path).path
        if path.startswith("/internal/objects/"):
            path = "/internal/objects/<key>"
        print(f"[CS3] {self.command} {path} - {args[1] if len(args) > 1 else ''}")

    def _headers(self, status: int, content_type: str, length: int, extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self' blob:; img-src 'self' blob:; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'")
        self.send_header("X-Frame-Options", "DENY")
        if self.close_connection:
            self.send_header("Connection", "close")
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()

    def _send(self, status: int, body: bytes, content_type: str, extra_headers: dict[str, str] | None = None) -> None:
        self._headers(status, content_type, len(body), extra_headers)
        self.wfile.write(body)

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data).encode(), "application/json; charset=utf-8")

    def _dashboard_authorized(self) -> bool:
        presented = self.headers.get("Authorization", "")
        token = presented.removeprefix("Bearer ")
        return bool(PASSPHRASE and token) and hmac.compare_digest(token, PASSPHRASE)

    def _storage_authorized(self) -> bool:
        presented = self.headers.get("Authorization", "")
        token = presented.removeprefix("Bearer ")
        return bool(API_KEY and token) and hmac.compare_digest(token, API_KEY)

    def _internal_key(self) -> str:
        prefix = "/internal/objects/"
        raw_key = urlparse(self.path).path[len(prefix):]
        try:
            return unquote_to_bytes(raw_key).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Object key must be UTF-8") from exc

    def _require_storage_auth(self) -> bool:
        if not self._storage_authorized():
            self._json(401, {"error": "Storage API token required"})
            return False
        return True

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/" and not parsed.query:
            self._send(200, PAGE.encode(), "text/html; charset=utf-8")
        elif parsed.path in {"/healthz", "/health"}:
            self._json(200, {"status": "ok"})
        elif parsed.path == "/api/objects":
            if self._dashboard_authorized():
                try:
                    self._list_objects()
                except (OSError, ValueError) as exc:
                    print(f"[CS3] Could not list objects ({type(exc).__name__})")
                    self._json(500, {"error": "Could not list objects"})
            else:
                self._json(401, {"error": "Dashboard token required"})
        elif parsed.path == "/api/object":
            if not self._dashboard_authorized():
                self._json(401, {"error": "Dashboard token required"})
                return
            key = parse_qs(parsed.query).get("key", [""])[0]
            self._stream_object(key)
        elif parsed.path.startswith("/internal/objects/"):
            if self._require_storage_auth():
                try:
                    self._stream_object(self._internal_key())
                except ValueError as exc:
                    self._json(400, {"error": str(exc)})
        else:
            self._json(404, {"error": "Not found"})

    def do_PUT(self) -> None:
        self.close_connection = True
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/internal/objects/"):
            self._json(404, {"error": "Not found"})
            return
        if not self._require_storage_auth():
            return
        try:
            key = self._internal_key()
            object_path = _object_path(key)
            metadata_path = _metadata_path(key)
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return

        if self.headers.get("Transfer-Encoding"):
            self._json(400, {"error": "Chunked uploads are not supported; send Content-Length"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._json(411, {"error": "Content-Length is required"})
            return
        if content_length < 0:
            self._json(400, {"error": "Invalid Content-Length"})
            return
        if content_length > MAX_OBJECT_BYTES:
            self._json(413, {"error": f"Object exceeds the {MAX_OBJECT_BYTES}-byte limit"})
            return

        temp_path = None
        digest = hashlib.sha256()
        try:
            object_path.parent.mkdir(parents=True, exist_ok=True)
            metadata_path.parent.mkdir(parents=True, exist_ok=True)
            file_descriptor, temp_name = tempfile.mkstemp(prefix=".upload-", dir=object_path.parent)
            temp_path = Path(temp_name)
            remaining = content_length
            with os.fdopen(file_descriptor, "wb") as output:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ConnectionError("Upload ended before Content-Length bytes were received")
                    output.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_path, object_path)
            temp_path = None

            content_type = self.headers.get("Content-Type", "application/octet-stream")
            if "\r" in content_type or "\n" in content_type or len(content_type) > 255:
                content_type = "application/octet-stream"
            metadata = {
                "key": key,
                "content_type": content_type,
                "sha256": digest.hexdigest(),
            }
            self._write_metadata(metadata_path, metadata)
        except (OSError, ConnectionError) as exc:
            self._json(500, {"error": f"Could not store object ({type(exc).__name__})"})
            return
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

        self._json(201, {
            "key": key,
            "size": content_length,
            "sha256": digest.hexdigest(),
        })

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/internal/objects/"):
            self._json(404, {"error": "Not found"})
            return
        if not self._require_storage_auth():
            return
        try:
            key = self._internal_key()
            object_path = _object_path(key)
            metadata_path = _metadata_path(key)
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return
        try:
            object_path.unlink(missing_ok=True)
            metadata_path.unlink(missing_ok=True)
        except OSError as exc:
            print(f"[CS3] Could not delete object ({type(exc).__name__})")
            self._json(500, {"error": "Could not delete object"})
            return
        self._headers(204, "application/json", 0)

    @staticmethod
    def _write_metadata(path: Path, metadata: dict) -> None:
        file_descriptor, temp_name = tempfile.mkstemp(prefix=".metadata-", dir=path.parent)
        temp_path = Path(temp_name)
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as output:
                json.dump(metadata, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_path, path)
        finally:
            temp_path.unlink(missing_ok=True)

    def _list_objects(self) -> None:
        objects = []
        for metadata_path in METADATA_ROOT.glob("*.json"):
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(metadata, dict):
                raise OSError("Stored object metadata is malformed")
            key = metadata.get("key")
            if not isinstance(key, str):
                raise OSError("Stored object metadata is malformed")
            object_path = _object_path(key)
            if not object_path.is_file():
                continue
            stat = object_path.stat()
            objects.append({
                "key": key,
                "size": stat.st_size,
                "modified": datetime_from_timestamp(stat.st_mtime),
                "content_type": metadata.get("content_type", "application/octet-stream"),
            })
        objects.sort(key=lambda item: item["modified"], reverse=True)
        self._json(200, {"bucket": "report-media", "objects": objects})

    def _stream_object(self, key: str) -> None:
        response_started = False
        try:
            _key_id(key)
            object_path = _object_path(key)
            metadata = _read_metadata(key)
            content_type = metadata.get("content_type", "application/octet-stream")
            if not isinstance(content_type, str) or "\r" in content_type or "\n" in content_type:
                content_type = "application/octet-stream"
            filename = quote(key.rsplit("/", 1)[-1])
            with object_path.open("rb") as payload:
                size = object_path.stat().st_size
                self._headers(200, content_type, size, {
                    "Content-Disposition": f'inline; filename="{filename}"',
                })
                response_started = True
                shutil.copyfileobj(payload, self.wfile, length=1024 * 1024)
        except json.JSONDecodeError as exc:
            print(f"[CS3] Stored object metadata is invalid ({type(exc).__name__})")
            if not response_started:
                self._json(500, {"error": "Stored object metadata is invalid"})
        except ValueError as exc:
            if not response_started:
                self._json(400, {"error": str(exc)})
        except FileNotFoundError:
            if not response_started:
                self._json(404, {"error": "Object not found"})
        except OSError as exc:
            print(f"[CS3] Could not read object ({type(exc).__name__})")
            if not response_started and not self.wfile.closed:
                self._json(500, {"error": "Could not read object"})


def datetime_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def main() -> None:
    if not API_KEY or len(API_KEY) < 32 or API_KEY.startswith("replace-"):
        raise SystemExit("Set CS3_STORAGE_API_KEY to a unique secret of at least 32 characters.")
    if not PASSPHRASE or len(PASSPHRASE) < 12 or PASSPHRASE.startswith("replace-"):
        raise SystemExit("Set CS3_UI_PASSPHRASE to a private passphrase of at least 12 characters.")
    if hmac.compare_digest(API_KEY, PASSPHRASE):
        raise SystemExit("CS3_STORAGE_API_KEY and CS3_UI_PASSPHRASE must be different secrets.")
    if MAX_OBJECT_BYTES < 1:
        raise SystemExit("CS3_MAX_OBJECT_SIZE_BYTES must be positive.")
    for directory in (DATA_ROOT, OBJECT_ROOT, METADATA_ROOT):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True

    def stop_server(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop_server)
    print(f"CS3 storage API and dashboard listening on {HOST}:{PORT}")
    print(f"Persistent object directory: {OBJECT_ROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("CS3 storage server stopped.")


if __name__ == "__main__":
    main()

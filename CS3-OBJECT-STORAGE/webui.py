#!/usr/bin/env python3
"""Loopback-only, read-only browser for objects in the configured S3 bucket."""

from __future__ import annotations

import hmac
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

import boto3
from botocore.config import Config

HOST = os.environ.get("CS3_UI_BIND_ADDRESS", "127.0.0.1")
PORT = int(os.environ.get("CS3_UI_PORT") or os.environ.get("PORT", "3904"))
PASSPHRASE = os.environ["CS3_UI_PASSPHRASE"]
BUCKET = os.environ["GARAGE_DEFAULT_BUCKET"]
S3 = boto3.client(
    "s3",
    endpoint_url=os.environ.get(
        "CS3_S3_ENDPOINT_URL",
        f"http://127.0.0.1:{os.environ.get('CS3_S3_PORT', '3900')}",
    ),
    region_name=os.environ.get("CS3_S3_REGION", "garage"),
    aws_access_key_id=os.environ["GARAGE_DEFAULT_ACCESS_KEY"],
    aws_secret_access_key=os.environ["GARAGE_DEFAULT_SECRET_KEY"],
    config=Config(s3={"addressing_style": "path"}),
)

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


class Handler(BaseHTTPRequestHandler):
    server_version = "CS3StorageUI/1.0"

    def log_message(self, fmt: str, *args) -> None:
        # Avoid logging bearer tokens or query strings that contain object keys.
        print(f"[CS3 UI] {self.command} {self.path.split('?')[0]} - {args[1] if len(args) > 1 else ''}")

    def _send(self, status: int, body: bytes, content_type: str, extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self' blob:; img-src 'self' blob:; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'")
        self.send_header("X-Frame-Options", "DENY")
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data).encode(), "application/json; charset=utf-8")

    def _authorized(self) -> bool:
        presented = self.headers.get("Authorization", "")
        token = presented.removeprefix("Bearer ")
        return bool(token) and hmac.compare_digest(token, PASSPHRASE)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self._send(200, PAGE.encode(), "text/html; charset=utf-8")
            return
        if parsed.path not in {"/api/objects", "/api/object"}:
            self._json(404, {"error": "Not found"})
            return
        if not self._authorized():
            self._json(401, {"error": "Dashboard token required"})
            return
        try:
            if parsed.path == "/api/objects":
                self._list_objects()
            else:
                self._get_object(parse_qs(parsed.query).get("key", [""])[0])
        except Exception as exc:
            print(f"[CS3 UI] S3 request failed: {type(exc).__name__}")
            self._json(502, {"error": "Could not communicate with the object storage service"})

    def _list_objects(self) -> None:
        paginator = S3.get_paginator("list_objects_v2")
        objects = []
        for page in paginator.paginate(Bucket=BUCKET):
            for item in page.get("Contents", []):
                objects.append({
                    "key": item["Key"],
                    "size": item["Size"],
                    "modified": item["LastModified"].astimezone(timezone.utc).isoformat(),
                    "content_type": "application/octet-stream",
                })
        def enrich(item: dict) -> dict:
            head = S3.head_object(Bucket=BUCKET, Key=item["key"])
            item["content_type"] = head.get("ContentType", "application/octet-stream")
            return item
        with ThreadPoolExecutor(max_workers=12) as pool:
            objects = list(pool.map(enrich, objects))
        objects.sort(key=lambda item: item["modified"], reverse=True)
        self._json(200, {"bucket": BUCKET, "objects": objects})

    def _get_object(self, key: str) -> None:
        if not key or ".." in key.split("/"):
            self._json(400, {"error": "Invalid object key"})
            return
        result = S3.get_object(Bucket=BUCKET, Key=key)
        body = result["Body"]
        try:
            payload = body.read()
        finally:
            body.close()
        content_type = result.get("ContentType", "application/octet-stream")
        disposition = f'inline; filename="{quote(key.rsplit("/", 1)[-1])}"'
        self._send(200, payload, content_type, {"Content-Disposition": disposition})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"CS3 read-only dashboard listening on {HOST}:{PORT}")
    server.serve_forever()

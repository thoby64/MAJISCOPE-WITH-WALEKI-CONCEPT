#!/usr/bin/env python3
"""
MajiScope Sensor Simulator

Standalone tool that acts like a physical LoRa water-level sensor in the field.
Sends simulated readings to a MajiScope ingest endpoint at regular intervals.

Shares NOTHING with the MajiScope backend — only knows one URL and one key,
exactly like a real sensor deployed in the field.

Usage:
    python3 sensor_simulator.py                # interactive CLI REPL
    python3 sensor_simulator.py --web          # browser-based UI
    python3 sensor_simulator.py --once         # send one round and exit
    python3 sensor_simulator.py --interval 10  # override interval
"""

import argparse
import json
import os
import random
import re
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ─── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
ENV_FILE = SCRIPT_DIR / ".env"
SENSORS_FILE = SCRIPT_DIR / "sensors.json"

# ─── Device ID naming convention ──────────────────────────────────────────────
# {UTILITY}_{DMA}_{SEQ}  e.g. AU_NAM_0001
DEVICE_ID_PATTERN = re.compile(r"^[A-Z]{2,3}_[A-Z]{2,3}_\d{2,4}$")

# ─── Colour helpers (ANSI) ────────────────────────────────────────────────────
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def c(text, colour):
    return f"{colour}{text}{RESET}"


# ─── .env reader/writer ──────────────────────────────────────────────────────
def load_env() -> dict:
    cfg = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                cfg[key.strip()] = val.strip()
    return cfg


def save_env(cfg: dict) -> None:
    lines = [
        "# MajiScope Sensor Simulator — Environment",
        "# Change these to match your MajiScope instance",
        "",
        f"MAJISCOPE_URL={cfg.get('MAJISCOPE_URL', 'http://localhost:8000/api/sensors/ingest')}",
        f"INGEST_KEY={cfg.get('INGEST_KEY', 'your-secret-key-here')}",
        f"INTERVAL={cfg.get('INTERVAL', '30')}",
    ]
    ENV_FILE.write_text("\n".join(lines) + "\n")


# ─── Sensors persistence ─────────────────────────────────────────────────────
def load_sensors() -> list[dict]:
    """Load persisted sensors. Plain-string entries are legacy water_level."""
    if SENSORS_FILE.exists():
        try:
            raw = json.loads(SENSORS_FILE.read_text())
        except json.JSONDecodeError:
            return []
    else:
        return []
    sensors = []
    for entry in raw:
        if isinstance(entry, dict):
            sensors.append({
                "device_id": entry.get("device_id", ""),
                "category": entry.get("category", "water_level"),
            })
        elif isinstance(entry, str):
            sensors.append({"device_id": entry, "category": "water_level"})
    return sensors


def save_sensors(sensors: list) -> None:
    SENSORS_FILE.write_text(json.dumps(sensors, indent=2) + "\n")


# ─── Depth generator (random walk) ──────────────────────────────────────────
class DepthGenerator:
    def __init__(self, start: float = 3.5):
        self.value = start

    def next(self) -> float:
        step = random.gauss(0, 0.2)
        if random.random() < 0.08:
            step *= 3
        self.value += step
        self.value = max(0.1, min(19.9, self.value))
        return round(self.value, 3)


# ─── Water-quality generator (random walk per parameter) ─────────────────────
class WaterQualityGenerator:
    """Simulates a multi-parameter sonde: Tier A core + optional Tier B/C probes."""

    def __init__(self, pressure_range=(0, 2000), pressure_unit="kPa"):
        self.pressure_range = pressure_range  # (min, max) in kPa
        self.pressure_unit = pressure_unit
        self.values = {
            # Tier A (core)
            "temperature_c": 21.5,
            "ph": 7.2,
            "ec_uscm": 480.0,
            "do_mgl": 6.5,
            "do_pct_sat": 78.0,
            "turbidity_ntu": 2.5,
            # Tier B/C (optional fitted probes)
            "orp_mv": 230.0,
            "free_chlorine_mgl": 0.85,
            "nitrate_mgl": 8.5,
            "ammonia_mgl": 0.18,
            "phosphate_mgl": 0.35,
            "chlorophyll_ugl": 2.8,
            "phycocyanin_ugl": 1.4,
            # Pressure (Tier B/C)
            "pressure": 101.325,  # standard atmospheric pressure ~101.325 kPa
        }
        self.steps = {
            "temperature_c": 0.15,
            "ph": 0.05,
            "ec_uscm": 15.0,
            "do_mgl": 0.2,
            "do_pct_sat": 1.5,
            "turbidity_ntu": 0.3,
            "orp_mv": 5.0,
            "free_chlorine_mgl": 0.05,
            "nitrate_mgl": 0.4,
            "ammonia_mgl": 0.03,
            "phosphate_mgl": 0.04,
            "chlorophyll_ugl": 0.25,
            "phycocyanin_ugl": 0.15,
            "pressure": 0.5,  # kPa steps (small gradual changes)
        }
        self.pressure_range = pressure_range
        self.pressure_unit = pressure_unit

    def next(self) -> dict:
        out = {}
        for field, value in self.values.items():
            step = random.gauss(0, self.steps[field])
            if random.random() < 0.06:
                step *= 3
            self.values[field] = value + step
            out[field] = round(self.values[field], 3)
        # keep values physically sane
        out["ph"] = max(0.5, min(13.5, out["ph"]))
        out["do_mgl"] = max(0.5, min(15.0, out["do_mgl"]))
        out["do_pct_sat"] = max(40.0, min(120.0, out["do_pct_sat"]))
        out["turbidity_ntu"] = max(0.1, min(50.0, out["turbidity_ntu"]))
        out["ec_uscm"] = max(50.0, out["ec_uscm"])
        out["temperature_c"] = max(5.0, min(40.0, out["temperature_c"]))
        out["free_chlorine_mgl"] = max(0.0, min(5.0, out["free_chlorine_mgl"]))
        out["nitrate_mgl"] = max(0.0, out["nitrate_mgl"])
        out["ammonia_mgl"] = max(0.0, out["ammonia_mgl"])
        out["phosphate_mgl"] = max(0.0, out["phosphate_mgl"])
        out["chlorophyll_ugl"] = max(0.0, out["chlorophyll_ugl"])
        out["phycocyanin_ugl"] = max(0.0, out["phycocyanin_ugl"])
        # Pressure: gradual change with occasional spikes
        if "pressure" in out:
            step = random.gauss(0, 0.5)
            if random.random() < 0.05:  # 5% chance of spike
                step *= random.uniform(3, 5)
            self.values["pressure"] += step
            out["pressure"] = round(
                max(self.pressure_range[0], min(self.pressure_range[1], self.values["pressure"])),
                2,
            )
        return out


# ─── HTTP sender ──────────────────────────────────────────────────────────────
def send_reading(url: str, key: str, device_id: str, depth_m: float,
                 occurred_at: str, wq_values: dict | None = None) -> dict | None:
    body = {
        "device_id": device_id,
        "occurred_at": occurred_at,
    }
    if wq_values is not None:
        body.update(wq_values)
    else:
        body["depth_m"] = depth_m
    payload = json.dumps(body).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Ingest-Key": key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        return {"error": True, "status": e.code, "detail": body}
    except Exception as e:
        return {"error": True, "status": 0, "detail": str(e)}


# ─── Per-sensor send loop (runs in its own thread) ───────────────────────────
class SensorLoop:
    def __init__(self, device_id: str, url: str, key: str, interval: int,
                 category: str = "water_level"):
        self.device_id = device_id
        self.category = category
        self.url = url
        self.key = key
        self.interval = interval
        self.depth = DepthGenerator()
        self.wq = WaterQualityGenerator()
        self.last_values: dict = {}
        self.send_count = 0
        self.last_status = "idle"
        self.last_response: dict | None = None
        self.last_send_time: str = ""
        self.consecutive_errors = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()

    @property
    def alive(self):
        return self._thread.is_alive()

    def _run(self):
        while not self._stop.is_set():
            self._tick()
            self._stop.wait(self.interval + random.uniform(-2, 2))

    def _tick(self):
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if self.category == "water_quality":
            wq = self.wq.next()
            self.last_values = wq
            resp = send_reading(self.url, self.key, self.device_id, 0.0, now, wq_values=wq)
        else:
            d = self.depth.next()
            self.last_values = {"depth_m": d}
            resp = send_reading(self.url, self.key, self.device_id, d, now)
        self.send_count += 1
        self.last_send_time = now
        self.last_response = resp

        if resp is None:
            self.last_status = "error"
            self.consecutive_errors += 1
            return

        if resp.get("error"):
            self.last_status = f"error({resp.get('status', '?')})"
            self.consecutive_errors += 1
        else:
            self.consecutive_errors = 0
            if resp.get("is_pending"):
                self.last_status = "pending"
            else:
                st = resp.get("status", "?")
                if self.category == "water_quality":
                    params = resp.get("parameters") or {}
                    head = ", ".join(
                        f"{k.replace('_mgl','').replace('_uscm','').replace('_ntu','').replace('_c','')}={v}"
                        for k, v in list(params.items())[:3]
                    )
                    self.last_status = f"ok({st}, {head})"
                else:
                    wl = resp.get("water_level_m", "?")
                    self.last_status = f"ok({st}, {wl}m)"


# ─── Simulator core ───────────────────────────────────────────────────────────
class Simulator:
    def __init__(self):
        self.cfg = load_env()
        self.sensors: list[str] = load_sensors()
        self.loops: dict[str, SensorLoop] = {}
        self._shutdown = False
        self._interval = int(self.cfg.get("INTERVAL", 30))

    def ensure_config(self):
        url = self.cfg.get("MAJISCOPE_URL", "")
        key = self.cfg.get("INGEST_KEY", "")
        if not url or key in ("", "your-secret-key-here"):
            return False
        return True

    def start_sensor(self, dev_id: str, category: str = "water_level") -> str:
        if dev_id in self.loops and self.loops[dev_id].alive:
            return "already_active"
        loop = SensorLoop(
            dev_id, self.cfg["MAJISCOPE_URL"], self.cfg["INGEST_KEY"], self._interval,
            category=category,
        )
        self.loops[dev_id] = loop
        loop.start()
        entry = {"device_id": dev_id, "category": category}
        if entry not in self.sensors:
            self.sensors.append(entry)
            save_sensors(self.sensors)
        return "started"

    def stop_sensor(self, dev_id: str) -> bool:
        if dev_id not in self.loops:
            return False
        self.loops[dev_id].stop()
        self.loops[dev_id]._thread.join(timeout=5)
        del self.loops[dev_id]
        self.sensors = [s for s in self.sensors if s.get("device_id") != dev_id]
        save_sensors(self.sensors)
        return True

    def sensor_status(self, dev_id: str) -> dict:
        loop = self.loops.get(dev_id)
        if not loop:
            return {"device_id": dev_id, "alive": False}
        return {
            "device_id": dev_id,
            "category": loop.category,
            "alive": loop.alive,
            "send_count": loop.send_count,
            "last_status": loop.last_status,
            "last_send_time": loop.last_send_time,
            "consecutive_errors": loop.consecutive_errors,
            "last_response": loop.last_response,
            "last_values": loop.last_values,
        }

    def all_sensors_status(self) -> list[dict]:
        return [
            self.sensor_status(entry["device_id"] if isinstance(entry, dict) else entry)
            for entry in self.sensors
        ]

    def stop_all(self):
        for loop in self.loops.values():
            loop.stop()
        for loop in self.loops.values():
            loop._thread.join(timeout=5)


# ─── Web server ───────────────────────────────────────────────────────────────
class SimHTTPHandler(BaseHTTPRequestHandler):
    sim: Simulator = None  # set before server starts

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "" or path == "/index.html":
            self._serve_html()
        elif path == "/api/sensors":
            self._json_response(self.sim.all_sensors_status())
        elif path == "/api/config":
            self._json_response({
                "url": self.sim.cfg.get("MAJISCOPE_URL", ""),
                "key_masked": self.sim.cfg.get("INGEST_KEY", "")[:8] + "..." if len(self.sim.cfg.get("INGEST_KEY", "")) > 8 else "***",
                "interval": self.sim._interval,
            })
        elif path.startswith("/api/sensors/") and path.count("/") == 3:
            dev_id = path.split("/")[-1]
            self._json_response(self.sim.sensor_status(dev_id))
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        body = self._read_body()

        if path == "/api/sensors/add":
            dev_id = (body or {}).get("device_id", "").strip()
            category = (body or {}).get("category", "water_level")
            if category not in ("water_level", "water_quality"):
                self._json_response({"error": "category must be water_level or water_quality"}, 400)
                return
            if not dev_id:
                self._json_response({"error": "device_id is required"}, 400)
                return
            result = self.sim.start_sensor(dev_id, category=category)
            self._json_response({"status": result, "device_id": dev_id, "category": category})

        elif path == "/api/sensors/remove":
            dev_id = (body or {}).get("device_id", "").strip()
            if not dev_id:
                self._json_response({"error": "device_id is required"}, 400)
                return
            ok = self.sim.stop_sensor(dev_id)
            self._json_response({"status": "removed" if ok else "not_found", "device_id": dev_id})

        elif path == "/api/send-test":
            dev_id = (body or {}).get("device_id", "").strip()
            category = (body or {}).get("category", "water_level")
            key = self.sim.cfg.get("INGEST_KEY", "")
            url = self.sim.cfg.get("MAJISCOPE_URL", "")
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if category == "water_quality":
                wq = WaterQualityGenerator().next()
                resp = send_reading(url, key, dev_id, 0.0, now, wq_values=wq)
                self._json_response({"category": "water_quality", "values": wq, "occurred_at": now, "response": resp})
            else:
                d = round(random.uniform(0.5, 15.0), 3)
                resp = send_reading(url, key, dev_id, d, now)
                self._json_response({"category": "water_level", "depth_m": d, "occurred_at": now, "response": resp})

        else:
            self.send_error(404)

    def _read_body(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return None

    def _json_response(self, data, status=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        pass  # suppress request logs

    def _serve_html(self):
        body = WEB_HTML.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


# ─── Embedded HTML/CSS/JS ────────────────────────────────────────────────────
WEB_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MajiScope Sensor Simulator</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0f172a;--surface:#1e293b;--surface2:#334155;--border:#475569;
  --text:#f1f5f9;--text2:#94a3b8;--accent:#06b6d4;--accent2:#22d3ee;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;
  --radius:12px;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.container{max-width:1100px;margin:0 auto;padding:24px 20px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
header h1{font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px}
header h1 .dot{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.config-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.config-bar .pill{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:5px 14px;font-size:.75rem;color:var(--text2)}
.config-bar .pill b{color:var(--accent2)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.card-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.card-header h2{font-size:1rem;font-weight:600}
.card-header .count{background:var(--accent);color:var(--bg);font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:10px}
.add-form{display:flex;gap:8px;flex-wrap:wrap}
.add-form input{flex:1;min-width:200px;padding:9px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem;outline:none;transition:border .2s}
.add-form input:focus{border-color:var(--accent)}
.add-form input::placeholder{color:var(--text2)}
.btn{padding:9px 20px;border-radius:8px;border:none;cursor:pointer;font-size:.85rem;font-weight:600;transition:all .2s}
.btn-primary{background:var(--accent);color:var(--bg)}
.btn-primary:hover{background:var(--accent2)}
.btn-danger{background:var(--red);color:#fff;font-size:.75rem;padding:5px 12px;border-radius:6px}
.btn-danger:hover{background:#dc2626}
.btn-ghost{background:transparent;color:var(--text2);border:1px solid var(--border);font-size:.75rem;padding:5px 12px;border-radius:6px}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.sensors-grid{padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.sensor-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 18px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;transition:border-color .3s}
.sensor-card.error{border-color:var(--red)}
.sensor-card.pending{border-color:var(--yellow)}
.sensor-card.ok{border-color:var(--green)}
.sensor-top{display:flex;align-items:center;gap:10px}
.sensor-id{font-family:'SF Mono',Monaco,Consolas,monospace;font-weight:700;font-size:.95rem;letter-spacing:.5px}
.sensor-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.sensor-dot.green{background:var(--green)}
.sensor-dot.yellow{background:var(--yellow)}
.sensor-dot.red{background:var(--red)}
.sensor-dot.gray{background:var(--text2)}
.sensor-meta{display:flex;gap:16px;flex-wrap:wrap;margin-top:6px}
.sensor-meta span{font-size:.75rem;color:var(--text2)}
.sensor-meta b{color:var(--text);font-weight:500}
.sensor-actions{display:flex;gap:6px;flex-wrap:wrap}
.status-badge{font-size:.7rem;padding:3px 10px;border-radius:8px;font-weight:600;white-space:nowrap}
.status-badge.pending{background:rgba(234,179,8,.15);color:var(--yellow)}
.status-badge.ok{background:rgba(34,197,94,.15);color:var(--green)}
.status-badge.error{background:rgba(239,68,68,.15);color:var(--red)}
.status-badge.idle{background:rgba(148,163,184,.1);color:var(--text2)}
.empty-state{padding:60px 20px;text-align:center;color:var(--text2)}
.empty-state .icon{font-size:2.5rem;margin-bottom:12px;opacity:.5}
.empty-state p{font-size:.9rem}
.toast{position:fixed;bottom:24px;right:24px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 20px;font-size:.85rem;color:var(--text);z-index:999;opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}
.toast.success{border-color:var(--green);color:var(--green)}
.toast.error{border-color:var(--red);color:var(--red)}
.conn-status{display:flex;align-items:center;gap:6px;font-size:.75rem;color:var(--text2)}
.conn-dot{width:6px;height:6px;border-radius:50%;background:var(--text2)}
.conn-dot.ok{background:var(--green)}
.conn-dot.err{background:var(--red)}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1><span class="dot"></span> Sensor Simulator</h1>
    <div class="config-bar">
      <div class="conn-status"><span class="conn-dot" id="connDot"></span> <span id="connText">connecting…</span></div>
      <div class="pill">Endpoint: <b id="cfgUrl">…</b></div>
      <div class="pill">Interval: <b id="cfgInterval">…</b>s</div>
      <div class="pill">Key: <b id="cfgKey">…</b></div>
    </div>
  </header>

  <div class="card" style="margin-bottom:20px">
    <div class="card-header">
      <h2>Active Sensors <span class="count" id="sensorCount">0</span></h2>
      <div class="add-form">
        <input type="text" id="addInput" placeholder="Device ID — e.g. AU_NAM_0001" spellcheck="false">
        <select id="categorySelect" style="padding:9px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.85rem;outline:none">
          <option value="water_level">🌊 Water Level</option>
          <option value="water_quality">🧪 Water Quality</option>
        </select>
        <button class="btn btn-primary" onclick="addSensor()">+ Add &amp; Start</button>
      </div>
    </div>
    <div class="sensors-grid" id="sensorsGrid">
      <div class="empty-state">
        <div class="icon">📡</div>
        <p>No sensors yet. Add a device ID above to start simulating.</p>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const API = '';
let sensors = [];

function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.className = 'toast', 2500);
}

async function api(method, path, body) {
  try {
    const opts = { method, headers: {'Content-Type':'application/json'} };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + path, opts);
    return await r.json();
  } catch(e) {
    return { error: e.message };
  }
}

async function loadConfig() {
  const cfg = await api('GET', '/api/config');
  if (cfg.error) {
    document.getElementById('connDot').className = 'conn-dot err';
    document.getElementById('connText').textContent = 'offline';
    return;
  }
  document.getElementById('connDot').className = 'conn-dot ok';
  document.getElementById('connText').textContent = 'connected';
  document.getElementById('cfgUrl').textContent = cfg.url || '—';
  document.getElementById('cfgInterval').textContent = cfg.interval || 30;
  document.getElementById('cfgKey').textContent = cfg.key_masked || '—';
}

async function refreshSensors() {
  const data = await api('GET', '/api/sensors');
  if (data.error) return;
  sensors = data;
  render();
}

function render() {
  const grid = document.getElementById('sensorsGrid');
  const count = document.getElementById('sensorCount');
  count.textContent = sensors.length;

  if (!sensors.length) {
    grid.innerHTML = '<div class="empty-state"><div class="icon">📡</div><p>No sensors yet. Add a device ID above to start simulating.</p></div>';
    return;
  }

  grid.innerHTML = sensors.map(s => {
    let statusClass = 'idle';
    let statusText = s.alive ? (s.last_status || 'starting…') : 'stopped';
    if (s.last_status === 'pending') statusClass = 'pending';
    else if (s.last_status && s.last_status.startsWith('ok')) statusClass = 'ok';
    else if (s.last_status && s.last_status.startsWith('error')) statusClass = 'error';

    let dotClass = 'gray';
    if (s.alive && s.consecutive_errors === 0) dotClass = 'green';
    else if (s.alive && s.consecutive_errors < 3) dotClass = 'yellow';
    else if (s.alive) dotClass = 'red';

    const nameMatch = /^[A-Z]{2,3}_[A-Z]{2,3}_\d{2,4}$/.test(s.device_id);
    const badge = nameMatch ? '' : '<span style="font-size:.65rem;color:var(--orange);margin-left:6px" title="Does not follow UTILITY_DMA_SEQ convention">⚠ non-standard</span>';
    const isWq = s.category === 'water_quality';
    const catTag = isWq
      ? '<span style="font-size:.65rem;padding:2px 8px;border-radius:8px;background:rgba(6,182,212,.15);color:var(--accent2);margin-left:6px;font-weight:600">🧪 WQ</span>'
      : '<span style="font-size:.65rem;padding:2px 8px;border-radius:8px;background:rgba(34,197,94,.15);color:var(--green);margin-left:6px;font-weight:600">🌊 WL</span>';

    let valuesHtml = '';
    if (s.last_values && Object.keys(s.last_values).length) {
      const parts = Object.entries(s.last_values).slice(0, 4).map(([k, v]) => `${esc(k)}: <b>${v}</b>`);
      valuesHtml = `<span style="font-size:.7rem;color:var(--text2)">${parts.join(' · ')}</span>`;
    }

    return `<div class="sensor-card ${statusClass}">
      <div>
        <div class="sensor-top">
          <span class="sensor-dot ${dotClass}"></span>
          <span class="sensor-id">${esc(s.device_id)}</span>
          ${catTag}
          ${badge}
          <span class="status-badge ${statusClass}">${esc(statusText)}</span>
        </div>
        <div class="sensor-meta">
          <span>Sends: <b>${s.send_count}</b></span>
          <span>Errors: <b>${s.consecutive_errors}</b></span>
          ${s.last_send_time ? `<span>Last: <b>${esc(s.last_send_time)}</b></span>` : ''}
        </div>
        ${valuesHtml ? `<div style="margin-top:4px">${valuesHtml}</div>` : ''}
      </div>
      <div class="sensor-actions">
        <button class="btn btn-ghost" onclick="testSend('${esc(s.device_id)}', '${s.category || 'water_level'}')">Test Send</button>
        <button class="btn btn-danger" onclick="removeSensor('${esc(s.device_id)}')">Remove</button>
      </div>
    </div>`;
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function addSensor() {
  const input = document.getElementById('addInput');
  const devId = input.value.trim();
  const category = document.getElementById('categorySelect').value;
  if (!devId) { toast('Enter a device ID', 'error'); return; }

  const r = await api('POST', '/api/sensors/add', { device_id: devId, category });
  if (r.error) { toast(r.error, 'error'); return; }

  input.value = '';
  toast(`${devId} (${category === 'water_quality' ? 'WQ' : 'WL'}) — started`);
  refreshSensors();
}

async function removeSensor(devId) {
  const r = await api('POST', '/api/sensors/remove', { device_id: devId });
  if (r.error) { toast(r.error, 'error'); return; }
  toast(`${devId} — removed`);
  refreshSensors();
}

async function testSend(devId, category) {
  const r = await api('POST', '/api/send-test', { device_id: devId, category });
  if (r.error) { toast(r.error, 'error'); return; }
  const resp = r.response || {};
  if (resp.error) toast(`Error ${resp.status}: ${resp.detail}`, 'error');
  else if (resp.is_pending) toast(`Sent — pending buffer (register to link)`);
  else if (category === 'water_quality') toast(`Sent — status: ${resp.status}, params: ${Object.keys(resp.parameters || {}).length}`);
  else toast(`Sent — water_level: ${resp.water_level_m}m, status: ${resp.status}`);
  refreshSensors();
}

document.getElementById('addInput').addEventListener('keydown', e => { if (e.key === 'Enter') addSensor(); });

loadConfig();
refreshSensors();
setInterval(refreshSensors, 3000);
</script>
</body>
</html>
"""


# ─── CLI REPL (same as before) ───────────────────────────────────────────────
def run_cli(sim: Simulator, once=False, interval_override=None):
    interval = interval_override or sim._interval

    print(f"\n{c(' MajiScope Sensor Simulator ', CYAN + BOLD)}")
    print(f"  Endpoint : {c(sim.cfg['MAJISCOPE_URL'], DIM)}")
    print(f"  Interval : {c(f'{interval}s', DIM)}\n")

    for entry in sim.sensors:
        dev_id = entry["device_id"] if isinstance(entry, dict) else entry
        category = entry.get("category", "water_level") if isinstance(entry, dict) else "water_level"
        sim.start_sensor(dev_id, category=category)

    if once:
        time.sleep(interval + 5)
        sim.stop_all()
        return

    while not sim._shutdown:
        active = sum(1 for l in sim.loops.values() if l.alive)
        print(f"\n{c('─' * 50, DIM)}")
        print(f"  {c('Menu', BOLD)}  |  {c(f'{active} active sensor(s)', CYAN)}")
        print(f"  {c('1', GREEN)}  Add sensor")
        print(f"  {c('2', GREEN)}  List sensors")
        print(f"  {c('3', GREEN)}  Remove sensor")
        print(f"  {c('4', GREEN)}  Quit")
        choice = input(f"  {c('> ', CYAN)}").strip()

        if choice == "1":
            print(f"\n  {c('Add sensor', BOLD)}")
            print(f"  Naming convention: {c('UTILITY_DMA_SEQ', CYAN)}  e.g. {c('AU_NAM_0001', CYAN)}")
            dev_id = input(f"  Device ID: ").strip()
            if not dev_id:
                print(f"  {c('Aborted.', YELLOW)}")
                continue
            print(f"  Category: {c('1', GREEN)} Water level   {c('2', GREEN)} Water quality")
            cat_choice = input(f"  Category [1/2, default 1]: ").strip()
            category = "water_quality" if cat_choice == "2" else "water_level"
            if DEVICE_ID_PATTERN.match(dev_id):
                print(f"  {c('Naming convention OK', GREEN)}")
            else:
                print(f"  {c('Note:', YELLOW)} does not match {{UTILITY}}_{{DMA}}_{{SEQ}} convention — still accepted.")
            result = sim.start_sensor(dev_id, category=category)
            if result == "already_active":
                print(f"  {c('Already active.', YELLOW)}")
            else:
                print(f"  {c(f'Sensor added ({category}) and started.', GREEN)} Sending every {interval}s.\n")

        elif choice == "2":
            print(f"\n  {c('Sensors', BOLD)}")
            if not sim.loops:
                print(f"  {c('No sensors registered.', DIM)}\n")
                continue
            for dev_id, loop in sim.loops.items():
                icon = c("●", GREEN) if loop.alive and loop.consecutive_errors == 0 else (
                    c("●", YELLOW) if loop.consecutive_errors < 3 else c("●", RED))
                last = loop.last_status if loop.last_status != "idle" else c("—", DIM)
                cat = "🧪 WQ" if loop.category == "water_quality" else "🌊 WL"
                print(f"  {icon} {c(dev_id, BOLD)}  [{cat}]")
                print(f"      Sends: {loop.send_count}  |  Last: {c(last, CYAN if loop.last_status == 'pending' else DIM)}  |  Errors: {loop.consecutive_errors}")
            print()

        elif choice == "3":
            if not sim.loops:
                print(f"  {c('No sensors to remove.', DIM)}\n")
                continue
            dev_id = input(f"  Device ID to remove: ").strip()
            if sim.stop_sensor(dev_id):
                print(f"  {c('Removed.', GREEN)}\n")
            else:
                print(f"  {c('Not found.', RED)}\n")

        elif choice == "4":
            sim.stop_all()
            print(f"\n  {c('Simulator stopped.', GREEN)}\n")
            break


# ─── Web server launcher ─────────────────────────────────────────────────────
def run_web(sim: Simulator, port: int = 8081):
    SimHTTPHandler.sim = sim
    server = HTTPServer(("0.0.0.0", port), SimHTTPHandler)

    print(f"\n{c(' MajiScope Sensor Simulator — Web UI ', CYAN + BOLD)}")
    print(f"  Endpoint : {c(sim.cfg['MAJISCOPE_URL'], DIM)}")
    print(f"  Interval : {c(f'{sim._interval}s', DIM)}")
    print(f"  Open     : {c(f'http://localhost:{port}', GREEN)}\n")

    for entry in sim.sensors:
        dev_id = entry["device_id"] if isinstance(entry, dict) else entry
        category = entry.get("category", "water_level") if isinstance(entry, dict) else "water_level"
        sim.start_sensor(dev_id, category=category)

    if sim.sensors:
        print(f"  {c(f'Resumed {len(sim.sensors)} saved sensor(s).', DIM)}\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        sim.stop_all()
        server.server_close()
        print(f"\n  {c('Simulator stopped.', GREEN)}\n")


# ─── Entry point ──────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="MajiScope Sensor Simulator")
    parser.add_argument("--web", action="store_true", help="Launch browser-based UI")
    parser.add_argument("--port", type=int, default=8081, help="Web UI port (default: 8081)")
    parser.add_argument("--once", action="store_true", help="Send one round and exit")
    parser.add_argument("--interval", type=int, default=None, help="Override send interval (seconds)")
    args = parser.parse_args()

    sim = Simulator()

    if args.interval:
        sim._interval = args.interval

    def handle_sigint(sig, frame):
        sim._shutdown = True
        sim.stop_all()
        print(f"\n\n  {c('Interrupted.', YELLOW)} Simulator stopped.\n")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sigint)

    if args.web:
        run_web(sim, port=args.port)
    else:
        run_cli(sim, once=args.once, interval_override=args.interval)


if __name__ == "__main__":
    main()

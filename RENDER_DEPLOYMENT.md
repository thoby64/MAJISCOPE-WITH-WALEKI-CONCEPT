# MajiScope — Fresh Render Deployment Guide

Deploys **three Render services** backed by **two Neon databases**:

```
[1] Backend  (FastAPI)  ──► Neon DB "majiscopedb"     (main data)
                          ──► Neon DB "sensrplatm"     (sensor telemetry)
[2] Frontend (Next.js)  ──► Backend URL
[3] Simulator (Python) ──► Backend ingest endpoint  (browser UI + sensor threads)
```

All three read their config from **Render environment variables** (the backend
ignores `.env` files when `ENVIRONMENT=production`).

Databases are already initialized and seeded:
- Main DB tables + sensor platform tables: created
- Test admin: `admin@majiscope.com` / `admin123` (change after first login)

---

## Step 0 — Commit and push

Everything must be on GitHub before Render can see it:

```bash
git add -A
git commit -m "Render deployment prep: fresh URLs, simulator web mode, env cleanup"
git push origin main
```

> `simulator/.env` is now git-ignored — its secret stays out of the repo.
> Render will inject `MAJISCOPE_URL` / `INGEST_KEY` as env vars instead.

---

## Step 1 — Deploy the Backend first

Render Dashboard → **New → Web Service**:

| Setting | Value |
|---|---|
| Source | Connect your GitHub repo `thoby64/MAJISCOPE-WITH-WALEKI-CONCEPT` |
| Name | `majiscope-backend` |
| Region | Frankfurt (closest to Neon eu-west) |
| Branch | `main` |
| **Root Directory** | **`Backend`** |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Instance Type | Free |

Click **Advanced → Add Environment Variable** and add ALL of these:

```env
ENVIRONMENT=production
DEBUG=false
RUN_STARTUP_MIGRATIONS=false
RUN_STARTUP_SCHEMA_SYNC=false

DATABASE_URL=postgresql://neondb_owner:npg_sxi1zh8bPEpa@ep-wild-scene-ahjvucxg-pooler.c-3.us-east-1.aws.neon.tech/majiscopedb?sslmode=require&channel_binding=require
SENSOR_DATABASE_URL=postgresql://neondb_owner:npg_oLUPBpD9hw6x@ep-polished-resonance-zazp2ngw-pooler.c-2.eu-west-2.aws.neon.tech/sensrplatm?sslmode=require&channel_binding=require

SECRET_KEY=<paste a NEW random secret, min 32 chars>
SENSOR_INGEST_KEY=sWFDbIuNd_QG45qWQb5TGtm6RH1LQnLcpNVQPoRRlu4

FRONTEND_URL=https://PLACEHOLDER.onrender.com
PUBLIC_BACKEND_URL=https://majiscope-backend.onrender.com
CORS_ORIGINS=https://PLACEHOLDER.onrender.com

HOST=0.0.0.0
PORT=8000
INVITE_TOKEN_EXPIRY_HOURS=72
PASSWORD_RESET_TOKEN_EXPIRY_HOURS=2
RUN_TANK_GPKG_SYNC_ON_STARTUP=true
```

Notes:
- `DATABASE_URL` / `SENSOR_DATABASE_URL`: copy the exact strings from `Backend/.env` (they are the live Neon credentials).
- `SECRET_KEY`: generate one locally with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `FRONTEND_URL` / `CORS_ORIGINS` use a placeholder now — you'll update them with the real frontend URL in Step 3 (backend CORS regex already allows **any** `*.onrender.com` origin, so this is safe meanwhile).
- Health check path (Render will ask): `/api/health`

Wait for deploy → open `https://majiscope-backend.onrender.com/api/health` → expect `{"status": "healthy", ...}`.
First boot may take ~1–2 minutes (Neon cold start + startup sync).

---

## Step 2 — Deploy the Simulator

**New → Web Service**:

| Setting | Value |
|---|---|
| Name | `majiscope-simulator` |
| **Root Directory** | **`simulator`** |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` (stdlib only, instant) |
| Start Command | `python sensor_simulator.py --web --port $PORT` |
| Instance Type | Free |
| Health check path | `/health` |

Environment variables:

```env
MAJISCOPE_URL=https://majiscope-backend.onrender.com/api/sensors/ingest
INGEST_KEY=sWFDbIuNd_QG45qWQb5TGtm6RH1LQnLcpNVQPoRRlu4
INTERVAL=30
```

Open `https://majiscope-simulator.onrender.com` → the browser UI loads.
Add a sensor (e.g. `AU_NAM_0001`, Water Level) → its status turns
`pending` (device not yet registered in MajiScope — expected) or `ok`
once linked.

To link a sensor in MajiScope: log in as a DMA manager → Sensors →
register the device with the same Device ID → subsequent readings
attach to it automatically.

---

## Step 3 — Deploy the Frontend

**New → Web Service**:

| Setting | Value |
|---|---|
| Name | `majiscope-frontend` |
| **Root Directory** | **`Frontend`** |
| Runtime | Node |
| Build Command | `npm install && npm run build` |
| Start Command | `npm run start` |
| Instance Type | Free |
| Health check path | `/` |

Environment variables:

```env
NEXT_PUBLIC_BACKEND_URL=https://majiscope-backend.onrender.com
```

> Origin only — **no `/api`** (the app appends it itself).

After it deploys, note its URL (e.g. `https://majiscope-frontend.onrender.com`)
and **go back to the backend service → Environment** and update:

```env
FRONTEND_URL=https://majiscope-frontend.onrender.com
CORS_ORIGINS=https://majiscope-frontend.onrender.com
```

(Render auto-redeploys the backend when env vars change.)

Then log in at the frontend with `admin@majiscope.com` / `admin123`.

---

## Step 4 — Keep free services awake (cron-job.org)

Render free services sleep after ~15 min without traffic; a sleeping
simulator stops sending readings. Prevent that with a free uptime pinger:

1. Go to **https://cron-job.org** → Create account (free)
2. Create **three cron jobs**, one per service:

| Job title | URL | Schedule |
|---|---|---|
| MajiScope Backend ping | `https://majiscope-backend.onrender.com/api/health` | Every 10 minutes |
| MajiScope Simulator ping | `https://majiscope-simulator.onrender.com/health` | Every 10 minutes |
| MajiScope Frontend ping | `https://majiscope-frontend.onrender.com/` | Every 10 minutes |

3. Save each job → status should turn green after the first execution.

> Every ping counts as traffic, so all three stay awake ~24/7.
> Each free Render service gets 750 hours/month — enough for 3 services.

---

## Step 5 — Verify the whole chain

1. **Backend**: `https://majiscope-backend.onrender.com/api/health` → healthy
2. **Simulator UI**: open its URL → add sensor `AU_NAM_9001` → wait 30s → status shows `pending` or `ok(...)` with `Sends: 1+`
3. **Frontend**: log in as admin → dashboards load
4. **End-to-end**: register the sensor's Device ID in MajiScope (DMA manager → Sensors) → back in the simulator UI the same sensor's next reading shows `ok(registered)` → the reading appears in MajiScope's sensor views.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend build fails | Check Root Directory is `Backend` and requirements.txt present |
| Backend boots but 502 | Look in Render Logs — usually a wrong DATABASE_URL string |
| Simulator 404 on `/` | Confirm start command has `--web --port $PORT` |
| Sensors show `error(401/403)` | `INGEST_KEY` on simulator ≠ `SENSOR_INGEST_KEY` on backend |
| Sensors show `error(0)` | Simulator can't reach backend — check `MAJISCOPE_URL` spelling |
| Frontend calls localhost | `NEXT_PUBLIC_BACKEND_URL` missing → set it and **redeploy** (it's baked at build time) |
| Frontend CORS errors | Backend `CORS_ORIGINS`/`FRONTEND_URL` must exactly match the frontend URL |
| Readings stuck `pending` | Normal — the Device ID isn't registered in MajiScope yet |
| Simulator lost sensors after redeploy | Expected on free tier (ephemeral disk) — re-add in the browser UI |

---

## Notes

- The simulator's `sensors.json` is wiped on every simulator redeploy (free tier has no persistent disk). Sensors are quick to re-add via the browser UI.
- Both Neon DBs are already created, tables initialized, and seeded — no DB setup needed on Render.
- Old `majiscope-2wzv` / `full-nfjr` Render URLs and their references have been removed from the codebase.

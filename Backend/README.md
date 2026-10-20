# Majiscope Backend

Majiscope Backend is the FastAPI service for the live Majiscope platform.

## Live hierarchy

The active operational model is:

`Admin -> Utility -> DMA -> Team -> Engineer`

Branch compatibility has been removed from the live backend surface. The startup
migration now upgrades older SQLite/Postgres schemas by removing legacy
`branch_id` columns from `team`, `engineer`, and `report`, then dropping the
legacy `branch` table.

## Main capabilities

- authentication for admin, utility manager, DMA manager, engineer, and team leader
- report intake and assignment
- team and engineer management
- DMA map/location support
- scoped notifications
- Expo push-token registration and delivery for mobile users

## Local setup

```bash
cd WEB-BASED/Backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Important environment variables

```env
ENVIRONMENT=development
DATABASE_URL=sqlite:///./majiscope.db
SENSOR_DATABASE_URL=sqlite:///./sensor_platform.db
FRONTEND_URL=http://localhost:3000
SECRET_KEY=change-me
HOST=0.0.0.0
PORT=8000
```

## Startup behavior

In local development, startup can:

1. run runtime schema migrations
2. remove old branch-linked columns if they still exist
3. add notification metadata columns if needed
4. create current tables such as `push_device_token`

For SQLite, the legacy branch-removal migration creates a timestamped backup
before rewriting the old schema. Production web startup does not run schema DDL;
use the controlled Alembic workflow in `migrations/README.md` for both stores.

## Key API groups

- `/api/auth`
- `/api/users`
- `/api/utilities`
- `/api/dmas`
- `/api/teams`
- `/api/engineers`
- `/api/reports`
- `/api/notifications`
- `/api/push-tokens`
- `/api/logs`
- `/api/uploads`
- `/api/water-sources`
- `/api/water-source-sensors`

## Water-source sensors

Water sources are materialized from uploaded `water_sources` GeoPackages and
mirrored into the sensor platform as reference rows. Their sensor devices,
pending readings, and water-level/water-quality readings use dedicated tables;
they are intentionally separate from the storage-facility sensor registry.

- Register and manage source assets at `/api/water-sources`.
- Register/list source sensors at `/api/water-source-sensors`.
- Send source readings to `/api/water-source-sensors/ingest`.
- Send storage-facility readings to `/api/storage-facility-sensors/ingest`.
- Main migration revision: `0004_water_sources`.
- Sensor-platform migration revision: `0003_water_source_sensors`.

Run both Alembic histories through the controlled migration procedure before
deploying code that uses these schemas. Re-uploaded GeoPackages preserve source
IDs by preferring explicit source identifier fields over mutable display names.

## Push notifications

The backend stores Expo device tokens in `push_device_token` and can deliver push
messages whenever notification records are created for mobile users.

Key flow:

- mobile app registers token at `/api/push-tokens/register`
- backend creates scoped `notification` records during assignment/review actions
- backend delivers Expo push payloads to active tokens

## Production notes

- set `DATABASE_URL`, `SENSOR_DATABASE_URL`, `FRONTEND_URL`, and `SECRET_KEY` explicitly
- do not rely on localhost fallbacks outside development
- use a real ASGI process manager for production
- verify and baseline existing schemas, then run reviewed Alembic upgrades from one controlled deployment job before routing traffic to code that requires the new schema
- do not run schema migrations from each horizontally scaled API replica

## Database schema changes

The main and sensor stores have separate Alembic histories. Follow
[`migrations/README.md`](migrations/README.md) for fresh-database bootstrap,
existing-database verification and baseline stamping, revision review, and
controlled deployment. The SQLite/PostgreSQL and sensor-transfer utilities
default to read-only preflight and must not run automatically at application
startup.

## Report media object storage

Report images and videos are stored as private objects. PostgreSQL retains the
upload metadata, report relationships, checksums, and object keys. Development
defaults to `.media_objects/`; production uses the single-port Python storage
service and requires `MEDIA_STORAGE_BACKEND=http`,
`MEDIA_STORAGE_API_URL`, and `MEDIA_STORAGE_API_KEY`. The API key is server to
server only and must never be sent to the frontend. `MEDIA_S3_*` settings are
retained temporarily to read the legacy Garage source during migration.

Before deploying the new backend code, back up the main database and run the
controlled migration once:

```bash
cd Backend
make db-main-upgrade
```

Configure the Python storage API before accepting uploads. New uploads use the
HTTP API; HTTP 429 responses on object writes are retried up to three times
with bounded backoff, honoring `Retry-After` when provided. Old database-backed
and S3-backed uploads remain readable during migration. First run the backfill
without purging database bytes:

```bash
python scripts/backfill_media_object_storage.py
python scripts/backfill_media_object_storage.py --apply
```

This idempotent migration verifies each object by SHA-256, updates media rows,
converts legacy inline report data URIs to upload records, and repoints queued
deletions. For Garage-backed objects, first copy the complete S3 bucket to the
new service using `CS3-OBJECT-STORAGE/copy_bucket.py`; keep the Garage service
and its disk untouched throughout the copy. Then configure the backend's new
HTTP API URL/key while retaining legacy `MEDIA_S3_*` source settings, and run
the backfill from a controlled environment against the production database.

After checking migration counts and reading representative report media
through the application, database binary payloads may be purged in a separate
operation:

```bash
python scripts/backfill_media_object_storage.py --apply --purge-binary
```

Keep `MEDIA_BACKFILL_ON_STARTUP=false`; use the controlled command for a
production cutover and retain the old Garage disk for rollback until the new
storage service has been verified.

The migration uses a PostgreSQL advisory lock to prevent multiple replicas from
copying media simultaneously. It is resumable and verifies each CS3 object
before updating its database reference and clearing the old database bytes.
Object deletions are recorded transactionally and retried by the backend
worker. For a local single-instance setup, the same flag runs the migration
synchronously after preparing the media schema.

The existing Alembic revision `0002_media_object_storage` adds nullable media
payloads, S3 object references, SHA-256 checksums, and the deletion retry queue.
Production startup keeps schema DDL disabled on web replicas. The Render
pre-deploy script applies both Alembic histories once before the backend
process starts; normal sensor and storage-facility reconciliation remain enabled at
application startup.

## Historical DUWASA import on deploy

The backend includes a deployment-safe importer for the committed backend-local
CSV file `Leakage_Reporting_Excel_Up_to_January_2026_DUWASA.csv`.

You can run it manually:

```bash
python import_legacy_duwasa_reports.py --database-url "$DATABASE_URL"
python import_legacy_duwasa_reports.py --database-url "$DATABASE_URL" --execute
```

Or let Render run it automatically on app startup:

```env
LEGACY_DUWASA_IMPORT_ON_STARTUP=true
# Optional override. Leave blank to use the CSV inside WEB-BASED/Backend.
LEGACY_DUWASA_IMPORT_CSV_PATH=
LEGACY_DUWASA_IMPORT_STRICT=false
```

Recommended deploy flow:

1. Commit and push the backend changes together with the CSV file in `WEB-BASED/Backend`.
2. In Render, set `LEGACY_DUWASA_IMPORT_ON_STARTUP=true`.
3. Redeploy the backend service once.
4. Check logs for the importer summary.
5. Set `LEGACY_DUWASA_IMPORT_ON_STARTUP=false` after the import is complete.

The importer is idempotent for the imported tracking IDs, so if startup runs it
again later it will skip rows that already exist instead of duplicating them.

## Verification

- Swagger: `/docs`
- ReDoc: `/redoc`
- OpenAPI schema: `/openapi.json`

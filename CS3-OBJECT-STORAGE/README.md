# CS3 Python Object Storage

This service is a dependency-free Python file store. One HTTP listener serves
the passphrase-protected browser and the authenticated file API; it does not
launch Garage, a reverse proxy, or any secondary listener.

## Run locally

Create `.env` from `.env.example`, or merge its settings into an existing
`.env`. If upgrading from Garage, keep that existing file and its credentials
until the legacy-object migration is complete. Replace both placeholder values
with different private secrets. For example, generate each with:

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Start the service with Python:

```sh
python3 webui.py
```

The browser and API are available at `http://127.0.0.1:8082` by default. Set
`PORT` (as Render does) or `CS3_UI_PORT` to choose a different single port.
An existing `.env` may still set `CS3_UI_PORT=3900`; change it to `8082` if you
want the example port.
Object bytes and metadata are stored under `data/files/` and
`data/file-metadata/`. Existing Garage data under `data/metadata/` and
`data/objects/` is not read, changed, or deleted by this server.

The dashboard asks for `CS3_UI_PASSPHRASE`. For local development it can also
read the first line of the ignored `.ui-passphrase` file. The backend uses a
separate `CS3_STORAGE_API_KEY`; never put that API key in browser code.

## File API

The backend authenticates with `Authorization: Bearer <CS3_STORAGE_API_KEY>`.
Object bytes are sent as the raw request body, with the object's MIME type in
`Content-Type`.

| Method | Path | Purpose |
| --- | --- | --- |
| `PUT` | `/internal/objects/{key}` | Store or replace an object |
| `GET` | `/internal/objects/{key}` | Fetch an object |
| `DELETE` | `/internal/objects/{key}` | Delete an object (idempotent) |
| `GET` | `/healthz` | Unauthenticated service health check |

The browser uses the same listener at `/` and its passphrase-protected
`/api/objects` and `/api/object` routes. API object keys are stored by a
SHA-256-derived filesystem name, so user-provided keys cannot escape the data
directory.

Configure the backend to use the service:

```env
MEDIA_STORAGE_BACKEND=http
MEDIA_STORAGE_API_URL=http://127.0.0.1:8082
MEDIA_STORAGE_API_KEY=<same-as-CS3_STORAGE_API_KEY>
```

The backend continues to authorize application users and validate media. The
storage API key is only for backend-to-storage traffic; dashboard access uses
its separate passphrase.

## Migrate existing Garage objects

Do not replace or delete the Garage service or its disk until migration and
readback verification are complete. Start the Python service alongside the
existing S3 service, using a new URL and a separate persistent disk. Keep both
services available during migration.

Install the one-time S3 migration tool dependency and set source and target
credentials in the local environment (do not commit them):

```sh
python3 -m venv .copy-venv
.copy-venv/bin/pip install -r requirements.txt

export CS3_SOURCE_S3_ENDPOINT_URL=https://<existing-garage-service>
export CS3_SOURCE_S3_REGION=garage
export CS3_SOURCE_BUCKET=<existing-bucket>
export CS3_SOURCE_S3_ACCESS_KEY_ID=<existing-access-key>
export CS3_SOURCE_S3_SECRET_ACCESS_KEY=<existing-secret-key>
export CS3_TARGET_STORAGE_API_URL=https://<new-python-service>
export CS3_TARGET_STORAGE_API_KEY=<new-CS3-storage-api-key>
```

Inventory first, then copy and verify every object by reading it back and
comparing SHA-256 checksums:

```sh
.copy-venv/bin/python copy_bucket.py
.copy-venv/bin/python copy_bucket.py --apply
```

The copy is repeatable and never deletes or modifies Garage source objects.
Pause uploads during the final copy pass so that no new objects are missed.
After the full-bucket copy succeeds, configure the backend with the new HTTP
storage settings while retaining the legacy `MEDIA_S3_*` settings temporarily.
Run `python scripts/backfill_media_object_storage.py --apply` from the backend
to verify and repoint database media references, including legacy inline
photos. Only after application reads are confirmed should binary payloads be
purged with the separately reviewed `--apply --purge-binary` run. Keep the old
Garage service and disk as a rollback copy until the new service has been
verified in production.

`requirements.txt` is only for this migration tool; the running file service
uses the Python standard library.

## Deploy to Render

The Blueprint in `render.yaml` runs `python3 webui.py` directly and listens on
Render's injected `PORT`. It attaches a persistent disk to `CS3_STORAGE_ROOT`.
For a safe migration, deploy it as a separate temporary service while the
existing Garage service remains online; do not detach or delete the Garage
disk before migration and verification finish. See
[RENDER_DEPLOYMENT_GUIDE.md](RENDER_DEPLOYMENT_GUIDE.md) for the cutover steps.

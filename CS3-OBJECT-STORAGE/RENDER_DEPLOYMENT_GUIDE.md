# Deploy the Python storage service to Render

The Python service serves its browser and authenticated file API through one
HTTP listener on Render's injected `PORT`. It uses no Garage process, proxy, or
startup shell script. A persistent disk stores the file objects.

## Safe migration overview

The existing Garage installation stores data in Garage's private on-disk
format. The Python service cannot read that format directly. Migrate through
Garage's S3 API while both services are online; do not point the Python service
at Garage's `data/objects` directory or delete the existing disk.

The safe order is:

1. Keep the current Garage service and disk online.
2. Deploy the Python service separately, with a separate persistent disk.
3. Copy the complete source bucket and verify every object by SHA-256 readback.
4. Point the backend at the Python service and repoint its database references.
5. Verify application media reads and only then retire Garage.

Do not sync a Blueprint change that would delete the Garage service/disk before
the migration and rollback copy have been verified. Render persistent disks
are attached to one service, so the replacement needs its own disk during the
parallel migration. Disable automatic deploys for the existing Garage service
or keep it pinned to its last working release while preparing the replacement;
this codebase no longer starts Garage.

## Deploy the replacement

Create a second Blueprint from the `render.yaml` in this directory (without
removing the existing Garage Blueprint), or create a separate web service
manually with:

- Root directory: `CS3-OBJECT-STORAGE`
- Build command: `python3 -m py_compile webui.py`
- Start command: `python3 webui.py`
- Health check path: `/healthz`
- A persistent disk mounted at
  `/opt/render/project/src/CS3-OBJECT-STORAGE/data`
- `CS3_STORAGE_ROOT=/opt/render/project/src/CS3-OBJECT-STORAGE/data`
- `CS3_UI_BIND_ADDRESS=0.0.0.0`
- `CS3_STORAGE_API_KEY`: a unique random secret of at least 32 characters
- `CS3_UI_PASSPHRASE`: a different private passphrase of at least 12 characters

Do not set `PORT`; Render injects it. The service logs exactly one application
listener, for example `CS3 storage API and dashboard listening on 0.0.0.0:10000`.
The API key is for backend traffic only and must not be included in browser
code. The dashboard uses the separate passphrase.

The default Blueprint creates a 20 GB disk and uses a paid Render plan. Adjust
the disk size and plan for the expected media volume.

## Copy all existing Garage objects

Run the migration tool from a trusted machine that can reach the old S3
endpoint and the new Python service. Its boto3 dependency is for this one-time
copy only; it is not installed or used by the running service.

```sh
cd CS3-OBJECT-STORAGE
python3 -m venv .copy-venv
.copy-venv/bin/pip install -r requirements.txt
```

Set these variables without committing them. The source endpoint is the
existing Garage S3 endpoint; the target is the new Python service's base URL:

```sh
export CS3_SOURCE_S3_ENDPOINT_URL=https://<existing-garage-service>
export CS3_SOURCE_S3_REGION=garage
export CS3_SOURCE_BUCKET=majiscope-report-media
export CS3_SOURCE_S3_ACCESS_KEY_ID=<existing-garage-access-key>
export CS3_SOURCE_S3_SECRET_ACCESS_KEY=<existing-garage-secret-key>
export CS3_TARGET_STORAGE_API_URL=https://<new-python-service>
export CS3_TARGET_STORAGE_API_KEY=<new-CS3-storage-api-key>
```

First inventory; then apply the migration:

```sh
.copy-venv/bin/python copy_bucket.py
.copy-venv/bin/python copy_bucket.py --apply
```

The tool copies object keys and content types, streams one object at a time,
verifies the service's upload checksum and then independently downloads each
copy to compare SHA-256. It is safe to rerun and never deletes or changes the
Garage source. Pause application writes for the final pass, or repeat the copy
after writes are paused so the destination includes every final object.

## Repoint backend media

Set these in the backend service environment:

```env
MEDIA_STORAGE_BACKEND=http
MEDIA_STORAGE_API_URL=https://<new-python-service>
MEDIA_STORAGE_API_KEY=<same-as-CS3_STORAGE_API_KEY>
MEDIA_S3_BUCKET=majiscope-report-media
MEDIA_S3_REGION=garage
MEDIA_S3_ENDPOINT_URL=https://<existing-garage-service>
MEDIA_S3_ACCESS_KEY_ID=<existing-garage-access-key>
MEDIA_S3_SECRET_ACCESS_KEY=<existing-garage-secret-key>
MEDIA_BACKFILL_ON_STARTUP=false
```

Keep the `MEDIA_S3_*` source values during the database backfill. The backend
uses them only to read legacy S3 records while writing and verifying their
replacement in the Python service. From the backend directory, review the
inventory, then repoint media rows:

```sh
python scripts/backfill_media_object_storage.py
python scripts/backfill_media_object_storage.py --apply
```

This verifies existing media rows, updates their storage backend to `http`,
converts legacy inline report photos, and repoints queued S3 deletions. It does
not purge database payloads in this pass. Verify representative report images
and videos through the authenticated backend. Only then, if desired, run the
separate payload cleanup:

```sh
python scripts/backfill_media_object_storage.py --apply --purge-binary
```

After backend reads, pending deletions, object counts, and checksums are
verified, take a final backup. Keep the old Garage disk for rollback until the
new service has been stable; remove Garage only as a separate, deliberate
cleanup step. The Python app writes to `data/files/` and `data/file-metadata/`
and leaves Garage's existing `data/metadata/` and `data/objects/` untouched.

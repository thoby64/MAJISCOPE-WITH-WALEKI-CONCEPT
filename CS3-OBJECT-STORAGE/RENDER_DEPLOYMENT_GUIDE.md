# CS3 deployment on Render

This guide deploys the standalone Garage object-storage server and its
passphrase-protected, read-only browser on Render. It does not use Docker.

## What Render will run

The Blueprint in [`render.yaml`](render.yaml) declares one service in
Frankfurt:

| Service | Purpose | Storage |
| --- | --- | --- |
| `cs3-object-storage` | Dashboard at `/` and SigV4-authenticated S3 API on other paths | 20 GB persistent disk at `CS3-OBJECT-STORAGE-SERVER/data` |

The dashboard/proxy uses Render's public `PORT`. Garage's S3, RPC, and admin
listeners bind to loopback inside the service, so browsers see the dashboard at
the root URL instead of Garage's XML response. S3 clients continue to use the
same URL with their bucket and object paths.

Garage is configured as a single node with replication factor 1. Render's disk
preserves its files across restarts, but this design does not provide storage
replication or high availability. Garage's own quick start warns that a
single-node setup has no data redundancy. Keep an independent backup and treat
this as a small deployment or pilot, not the final large-scale storage
architecture. Render persistent disks require a paid service, are attached to
one instance, and prevent horizontal scaling and zero-downtime disk deploys.
See [Render persistent disks](https://render.com/docs/disks) and the [Garage
single-node guide](https://garagehq.deuxfleurs.fr/documentation/quick-start/).

## 1. Push the files

Commit and push this directory, including `render.yaml`, `render-build.sh`,
`render-start.sh`, `webui.py`, and `copy_bucket.py`, to the Git repository that
Render can access. Do not commit `.env`, `.ui-passphrase`, `.runtime/`, or
`data/`.

## 2. Create the Render Blueprint

1. In Render, choose **New → Blueprint** and connect the repository.
2. Set **Blueprint Path** to `CS3-OBJECT-STORAGE-SERVER/render.yaml`.
3. Review the service and its 20 GB persistent disk, then deploy the Blueprint.
   The service uses a paid `1c-2g` plan so Render can attach the disk.
4. In the Blueprint prompts, set `GARAGE_DEFAULT_ACCESS_KEY` and
   `GARAGE_DEFAULT_SECRET_KEY` to new, random credentials. Do not reuse the
   local development credentials. Keep them in Render's secret environment
   fields.
5. Set `CS3_UI_PASSPHRASE` to a new, long random passphrase in the service's
   secret environment. Do not reuse the local `.ui-passphrase`.

If creating the storage web service manually instead of using the Blueprint,
attach a persistent disk in **Advanced → Disk** (or the service's **Disks**
page after creation). Set its mount path to
`/opt/render/project/src/CS3-OBJECT-STORAGE-SERVER/data` and choose a size such
as 20 GB. The service must use a paid plan. This places Garage's metadata and
object files inside the CS3 application's own `data/` directory, with the
Render disk mounted at that directory so files survive deploys and restarts.
Set `CS3_STORAGE_ROOT` to the same path. Without the disk, Render's app
filesystem is ephemeral and startup may fail with `Permission denied`.
Save the disk settings and let Render redeploy before retrying.

The bucket name is `majiscope-report-media` in the service configuration. If you
change it, make the same change in the backend configuration.
The Garage binary is pinned to v2.4.1 and fetched over HTTPS during the build.

Render's Blueprint supports a custom YAML path and internal service host/port
references; see [Blueprint setup](https://render.com/docs/infrastructure-as-code),
[Blueprint fields](https://render.com/docs/blueprint-spec), and [web service
ports](https://render.com/docs/web-services).

## 3. Confirm the service is ready

Copy the service's `onrender.com` URL from Render:

- Dashboard and S3 endpoint: `https://<cs3-object-storage-service>.onrender.com`

Opening the service URL in a browser displays the dashboard. Enter the
`CS3_UI_PASSPHRASE` and confirm the bucket contents load. Signed S3 requests
continue to use this same URL; the service routes bucket and object paths to
Garage. It is normal for the new bucket to be empty before the existing objects
are copied.

Use an S3 client with the Render credentials to confirm authenticated access.
For AWS CLI v2, set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
`AWS_DEFAULT_REGION=garage`, then run:

```sh
aws --endpoint-url https://<cs3-object-storage-service>.onrender.com \
  s3 ls s3://majiscope-report-media
```

## 4. Copy existing local CS3 objects to Render

Keep the local CS3 server and source bucket intact until the hosted backend has
been verified. The copy tool reads one object at a time, preserves its key and
content type, reads it back from Render, and compares SHA-256 checksums. It
never deletes the source objects.

Run from `CS3-OBJECT-STORAGE-SERVER/` on the computer that can reach the local
Garage server. Set these variables in the shell without committing them:

```sh
export CS3_SOURCE_S3_ENDPOINT_URL=http://127.0.0.1:3900
export CS3_SOURCE_S3_REGION=garage
export CS3_SOURCE_BUCKET=<current-local-bucket>
export CS3_SOURCE_S3_ACCESS_KEY_ID=<local-access-key>
export CS3_SOURCE_S3_SECRET_ACCESS_KEY=<local-secret-key>

export CS3_TARGET_S3_ENDPOINT_URL=https://<cs3-object-storage-service>.onrender.com
export CS3_TARGET_S3_REGION=garage
export CS3_TARGET_BUCKET=majiscope-report-media
export CS3_TARGET_S3_ACCESS_KEY_ID=<render-access-key>
export CS3_TARGET_S3_SECRET_ACCESS_KEY=<render-secret-key>
```

First inventory the source without copying:

```sh
python3 -m venv .copy-venv
.copy-venv/bin/pip install -r requirements.txt
.copy-venv/bin/python copy_bucket.py
```

Review the object count, then run the verified copy:

```sh
.copy-venv/bin/python copy_bucket.py --apply
```

The `.copy-venv/` directory is local-only; it is ignored by Git. Keep a
separate backup of the source bucket and the application database before
cutover.

## 5. Configure the backend

Set these values in the backend's Render environment. Keep both credentials in
Render's secret fields:

```env
MEDIA_STORAGE_BACKEND=s3
MEDIA_S3_BUCKET=majiscope-report-media
MEDIA_S3_REGION=garage
MEDIA_S3_ENDPOINT_URL=https://<cs3-object-storage-service>.onrender.com
MEDIA_S3_ACCESS_KEY_ID=<same-as-GARAGE_DEFAULT_ACCESS_KEY>
MEDIA_S3_SECRET_ACCESS_KEY=<same-as-GARAGE_DEFAULT_SECRET_KEY>
MEDIA_S3_ADDRESSING_STYLE=path
MEDIA_S3_SSE=
MEDIA_BACKFILL_ON_STARTUP=false
```

Garage does not implement S3 server-side encryption headers. Keep
`MEDIA_S3_SSE` empty; use encrypted storage or client-side encryption if that
is required. Garage supports the S3 operations this application uses, but it
does not implement every AWS S3 feature. In particular, Garage does not
currently support bucket versioning or server-side encryption; see its [S3
compatibility table](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/).

## 6. Apply the backend schema and media migration

The backend already contains Alembic revision
`0002_media_object_storage`. It adds the S3 reference columns and durable
deletion queue to the database. In the backend Render service settings, set
**Pre-Deploy Command** to:

```sh
bash scripts/render_predeploy.sh
```

This command verifies and records the current revision for an existing,
unstamped schema, then applies both main and sensor Alembic histories before
the new backend process starts. It stops if an unstamped database does not
match the current models. Resolve schema drift and take a restorable database
backup before deploying. Render pre-deploy commands run separately from the
web process; they require a paid plan and database connectivity.

After the backend has the new endpoint configured and the bucket copy has
finished, run the report media backfill once from the backend service
environment (or another controlled environment pointed at the same database
and Render S3 endpoint):

```sh
python scripts/backfill_media_object_storage.py
python scripts/backfill_media_object_storage.py --apply --purge-binary
```

The first command is a dry-run inventory. The second migrates database payloads
and inline report photos, verifies the target objects, updates references, and
then clears migrated database bytes. Existing S3-backed records are verified
against the objects copied in step 4. Keep the original source bucket until
reports and media have been checked through the frontend.

Do not set `MEDIA_BACKFILL_ON_STARTUP=true` in production. The backfill can
process a large database and must not run concurrently on every backend
replica. Normal backend startup migrations and sensor/tank reconciliation
remain enabled according to the backend's deployment settings; production
schema changes run once in Render's pre-deploy process.

## 7. Validate the cutover

1. Upload a synthetic image through the backend's public upload endpoint.
2. Confirm the upload record uses `storage_backend=s3`, has a storage key and
   SHA-256 value, and that the browser shows the new object.
3. Fetch the image through the backend content endpoint and frontend media
   proxy; compare the returned bytes and MIME type.
4. Open at least one existing report and confirm its original media still
   displays.
5. Keep the local source bucket and database backup until this validation is
   complete.

## Operational notes

- The S3 API is publicly reachable at its Render URL, but object operations
  require the configured access key and secret. Do not make the bucket public.
- The browser UI uses a separate passphrase. Give it only to trusted operators;
  do not expose Garage's admin or RPC listeners.
- Monitor disk use and increase the Render disk before it fills. Render can
  increase a disk, but cannot shrink it.
- Back up Garage metadata and object bytes outside Render on a schedule and
  practice restoring them. The attached disk is one copy on one service.
- Deployments of the disk-backed service briefly stop the old instance before
  starting the replacement. Schedule changes accordingly.

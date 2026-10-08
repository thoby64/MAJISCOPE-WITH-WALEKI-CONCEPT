# CS3 Object Storage Server

This folder runs a local, single-node [Garage](https://garagehq.deuxfleurs.fr/)
server. Garage implements the S3 API that the backend uses for report media.
The backend uploads and downloads objects from Garage; Garage does not push
files into the backend.

## Start it

From this directory:

```bash
./start.sh
```

The first run creates `.env` from `.env.example` and downloads the pinned Garage
v2.4.1 Linux binary from the official release site. Review the local development
credentials in `.env` before starting. Its dashboard gets a private virtual
environment under `.runtime/` and installs only this application's
`requirements.txt`; it does not use the backend's Python environment. The
service listens only on loopback by default:

- S3 API: `http://127.0.0.1:3900`
- Admin API: `http://127.0.0.1:3903` (loopback only)
- Local persistent data: `data/`
- Read-only browser dashboard: `http://127.0.0.1:3904`

The default bucket is private. The server keeps its metadata and object files
under this folder across restarts. Stop it with Ctrl+C. Its runtime binary,
secrets, local environment file, and data are ignored by Git.

The local dashboard is loopback-only and asks for the case-sensitive passphrase in
the local, Git-ignored `.ui-passphrase` file. Keep that file private. The page
lists every object in the configured bucket, supports key filtering, and fetches
previews/downloads through the server. The S3 secret never reaches the browser.
The dashboard is read-only; use the application or S3 tooling to upload and
delete objects. Do not expose port 3904 directly to the internet.

## Connect the backend

The matching development settings are in `Backend/.env`:

```env
MEDIA_STORAGE_BACKEND=s3
MEDIA_S3_BUCKET=majiscope-local-media
MEDIA_S3_REGION=garage
MEDIA_S3_ENDPOINT_URL=http://127.0.0.1:3900
MEDIA_S3_ADDRESSING_STYLE=path
MEDIA_S3_ACCESS_KEY_ID=local-test-access-key
MEDIA_S3_SECRET_ACCESS_KEY=local-test-secret-key-change-before-use
```

The backend can then use its normal upload API and backfill command. Ensure the
access key and secret match this server's `.env`. Keep this local server bound
to loopback; use a managed object store or a properly secured, replicated
deployment for production. This one-node development setup has no redundancy
and is not a production storage cluster.

## Deploy to Render

See [RENDER_DEPLOYMENT_GUIDE.md](RENDER_DEPLOYMENT_GUIDE.md). The Render
Blueprint deploys Garage's authenticated S3 API and the passphrase-protected
read-only browser as separate services. Garage metadata and object data are
written to the `data/` directory within this application, backed by its attached
persistent disk on Render. The admin and RPC ports remain private.

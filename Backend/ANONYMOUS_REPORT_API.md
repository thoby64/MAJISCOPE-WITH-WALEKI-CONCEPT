# Anonymous Report API (Render)

This guide describes how a public website or mobile app submits an anonymous
report, including optional photo/video media, to the live MajiScope backend.

## Production base URL

```text
https://latest-majiscope-backend.onrender.com
```

Both endpoints below are public and do not require an authorization token.
Do not send the CS3 storage API key or dashboard passphrase from a browser or
mobile client. The backend stores uploaded media in CS3 server-to-server.

## Submission flow

When a report has media, make two requests in order:

1. Upload each media file to `POST /api/uploads/public`.
2. Submit `POST /api/reports/anonymous`, setting `images` to the `downloadUrl`
   returned for each successful upload.

Without media, skip step 1 and send `images: []` in step 2.

## 1. Upload media

**Endpoint**

```http
POST https://latest-majiscope-backend.onrender.com/api/uploads/public
Content-Type: multipart/form-data
```

Multipart fields:

| Field | Type | Required | Details |
| --- | --- | --- | --- |
| `file` | file | Yes | Image or video bytes. Images: JPEG, PNG, or WebP; maximum 5 MiB and each dimension at most 4096 px. Videos: maximum 25 MiB. |
| `image_type` | string | No | Use `report`. Defaults to `report`. |

Example with `curl`:

```bash
curl --fail-with-body \
  -X POST \
  -F 'file=@./leak-photo.jpg;type=image/jpeg' \
  -F 'image_type=report' \
  'https://latest-majiscope-backend.onrender.com/api/uploads/public'
```

Do not manually set the multipart `Content-Type` header when using
`fetch`/`FormData`; the client must add the multipart boundary.

Example in browser JavaScript:

```js
const form = new FormData();
form.append("file", file); // A browser File object
form.append("image_type", "report");

const uploadResponse = await fetch(
  "https://latest-majiscope-backend.onrender.com/api/uploads/public",
  { method: "POST", body: form }
);

if (!uploadResponse.ok) {
  throw new Error(`Media upload failed (${uploadResponse.status})`);
}

const uploadedMedia = await uploadResponse.json();
```

For React Native, append a file descriptor with a local URI, filename, and
MIME type, for example:

```js
const form = new FormData();
form.append("file", {
  uri: photo.uri,
  name: photo.fileName ?? "report-photo.jpg",
  type: photo.mimeType ?? "image/jpeg",
});
form.append("image_type", "report");

const uploadResponse = await fetch(
  "https://latest-majiscope-backend.onrender.com/api/uploads/public",
  { method: "POST", body: form }
);
```

Do not add an `Authorization` header to this public upload request. Avoid
manually setting `Content-Type` in React Native too, unless the networking
library correctly supplies the generated boundary.

On success, the server returns **201 Created** and a JSON object resembling:

```json
{
  "id": "4a7ed284-fda3-445c-8d9d-32af13378b47",
  "fileName": "report-photo.jpg",
  "fileSize": 646,
  "width": 2,
  "height": 2,
  "storage_backend": "http",
  "storage_key": "reports/<generated-object-id>",
  "sha256": "<sha256-of-stored-bytes>",
  "mimeType": "image/png",
  "imageType": "report",
  "createdAt": "2026-10-19T08:14:30Z",
  "downloadUrl": "/api/uploads/4a7ed284-fda3-445c-8d9d-32af13378b47"
}
```

Save the returned `downloadUrl`. Send that exact relative path in the report's
`images` array; do not send the CS3 object key or a base64 data URI. The URL
belongs to the MajiScope backend, so it can be resolved against the production
base URL when a fully-qualified URL is needed.

## 2. Create the anonymous report

**Endpoint**

```http
POST https://latest-majiscope-backend.onrender.com/api/reports/anonymous
Content-Type: application/json
```

Request JSON:

| Field | Type | Required | Validation / behavior |
| --- | --- | --- | --- |
| `description` | string | Yes | Maximum 2000 characters. |
| `latitude` | number | Yes | Decimal degrees. Send a JSON number, not a quoted string. |
| `longitude` | number | Yes | Decimal degrees. Send a JSON number, not a quoted string. |
| `address` | string or `null` | No | Maximum 500 characters. |
| `region_name` | string or `null` | No | Maximum 100 characters. |
| `district_name` | string or `null` | No | Maximum 100 characters. |
| `priority` | string | No | Accepted values: `low`, `medium`, `moderate`, `high`, `critical`, `urgent`. `moderate` maps to `medium`, `urgent` maps to `high`; an unrecognized value defaults to `medium`. |
| `report_type` | string | No | `leakage` or `non_leakage`. Defaults to `leakage`. |
| `leakage_type` | string or `null` | No | `ground_leakage`, `pipe_burst`, `meter_leakage`, `valve_leakage`, `overflow`, or `unknown`. For `non_leakage`, the backend clears this field. For leakage, omitted/null becomes `unknown`. |
| `images` | array of strings | No | Use the `downloadUrl` for each uploaded media item. Defaults to an empty array. |
| `reported_by` | string or `null` | No | Display name; defaults to `Anonymous`. |
| `history_key` | string or `null` | No | Maximum 64 characters; optional key for grouping public report history. |

Example request:

```json
{
  "description": "Water is leaking from a pipe beside the road.",
  "latitude": -6.8,
  "longitude": 39.28,
  "address": "Example Road, near the market",
  "region_name": "Dar es Salaam",
  "district_name": "Example District",
  "priority": "high",
  "report_type": "leakage",
  "leakage_type": "pipe_burst",
  "images": [
    "/api/uploads/4a7ed284-fda3-445c-8d9d-32af13378b47"
  ],
  "reported_by": "Community reporter",
  "history_key": "optional-stable-client-history-key"
}
```

Example in browser JavaScript:

```js
const report = {
  description: form.description,
  latitude: Number(form.latitude),
  longitude: Number(form.longitude),
  address: form.address || null,
  region_name: form.regionName || null,
  district_name: form.districtName || null,
  priority: form.priority ?? "medium",
  report_type: "leakage",
  leakage_type: "unknown",
  images: uploadedMediaItems.map((item) => item.downloadUrl),
  reported_by: form.reportedBy || "Anonymous",
};

const response = await fetch(
  "https://latest-majiscope-backend.onrender.com/api/reports/anonymous",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  }
);

const result = await response.json();
if (!response.ok) {
  throw new Error(
    result.detail ?? result.message ?? `Report submission failed (${response.status})`
  );
}

console.log("Tracking ID:", result.tracking_id);
```

The backend assigns the utility/DMA from the supplied location and configured
boundaries when possible; clients do not send `utility_id` or `dma_id` to this
anonymous endpoint.

## Success response

A successful report request returns **201 Created** and a report object. The
client should save at least:

| Response field | Type | Purpose |
| --- | --- | --- |
| `id` | string | Backend report ID. |
| `tracking_id` | string | Public tracking reference, typically `ANON-XXXXXXXX`. |
| `status` | string | Initial status is `new`. |
| `report_photos` | array of strings | Report media references attached by the backend. |
| `created_at` | ISO 8601 string | Creation timestamp. |

Use the returned tracking ID for report tracking:

```http
GET https://latest-majiscope-backend.onrender.com/api/reports/public/tracking/{tracking_id}
```

## Errors and retry guidance

- **400 / 422**: invalid media or report payload. Display the response and let
  the user correct the input.
- **401 / 403**: the public upload/report endpoints should not require a user
  token. Check that the request is using these exact public routes and that a
  proxy is not applying authentication.
- **500**: a server-side failure. Preserve the response status/body and
  request time for backend log correlation; do not treat it as success.
- The database enforces this report classification pair:
  - `report_type: "leakage"` requires a non-null `leakage_type` (use a
    supported type, or `"unknown"` when the type cannot be identified).
  - `report_type: "non_leakage"` requires `leakage_type: null`.
- Upload and report creation are separate requests. If upload succeeds but
  report creation fails, the uploaded object may remain unattached. Reuse the
  upload's `downloadUrl` when retrying the report rather than uploading the
  same file again.
- Do not automatically retry the report `POST` without checking whether the
  first request committed. The endpoint does not accept an idempotency key;
  check a known tracking ID if one was returned, or contact the backend
  operator with the request timestamp if the server returned a generic 500.

## Production smoke-test status

The configured Render endpoints were tested on 2026-10-19:

- `POST /api/uploads/public` returned **201**, and the resulting image was
  readable again through the backend with a matching SHA-256 checksum.
- `POST /api/reports/anonymous` returned **500** for the deliberately
  synthetic test payload. The Render backend log at
  `2026-10-19T08:14:36.199Z` identified a PostgreSQL
  `CheckViolation` on `ck_report_type_leakage_type`. The failed row contained
  `report_type = "non_leakage"` together with `leakage_type = "unknown"`;
  that pair violates the database rule above. Although the request omitted
  `leakage_type`, the ORM's column-level `"unknown"` default replaced the
  intended null value for non-leakage reports.
- The failed row also contained the uploaded media URL in `photos`, confirming
  that the report request included the URL. The route flushes the report row
  before associating upload records, so this insert failure means the uploaded
  object remains stored but is not attached to a saved report.
- The backend ORM default was removed so an explicit null stays null; both
  report-creation routes normalize leakage reports to `"unknown"` when needed.
  The focused regression test now verifies that a non-leakage report can be
  inserted with a null leakage type. This source fix must be deployed before
  retrying non-leakage submissions on Render.
- The request was a synthetic non-leakage test; it does not by itself establish
  that a real leakage report with a valid classification pair fails. Successful
  production report creation remains to be verified after deployment.

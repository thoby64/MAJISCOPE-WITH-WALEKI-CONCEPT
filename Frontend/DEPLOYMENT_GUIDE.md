# HydraNet Frontend Deployment Guide

## Backend URL rule

The frontend reads its backend from:

`NEXT_PUBLIC_BACKEND_URL`

Set it to the backend origin only, for example:

```env
NEXT_PUBLIC_BACKEND_URL=http://192.168.1.5:8000
```

Do not append `/api`.

## Local development

```bash
cd WEB-BASED/Frontend
npm install
npm run dev
```

For LAN testing:

```bash
npm run dev:lan
```

Then open the site from another device using your machine IP, for example:

`http://192.168.1.5:3000`

## Environment examples

### Local

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### Shared LAN

```env
NEXT_PUBLIC_BACKEND_URL=http://192.168.1.5:8000
```

### Production

```env
NEXT_PUBLIC_BACKEND_URL=https://api.example.com
```

## Media proxy

Upload-backed images are resolved through the frontend proxy route:

`/api/upload-payload/[imageId]`

That route uses the same `NEXT_PUBLIC_BACKEND_URL`, so incorrect backend env
values will also break report image loading.

## Deployment checklist

1. Set `NEXT_PUBLIC_BACKEND_URL`
2. Rebuild the frontend after env changes
3. Ensure backend CORS allows the deployed frontend URL
4. Verify report details and uploaded media load correctly
5. Verify DMA and utility dashboards can fetch report maps

## Quick verification

After deployment:

1. open browser devtools
2. trigger any API request
3. confirm requests go to your real backend origin, not localhost

## Common mistakes

- setting `NEXT_PUBLIC_BACKEND_URL` to `/api`
- leaving `.env.local` on `localhost` while testing from another machine
- forgetting to restart/rebuild after env changes
- exposing the frontend on LAN while the backend is still bound to an inaccessible host

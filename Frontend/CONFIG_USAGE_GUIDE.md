# Frontend Config Usage Guide

## Primary setting

The live frontend depends on one main environment variable:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

This value is read by `lib/config.ts` and used by:

- API requests
- uploaded-image proxy routes
- dashboard/report data loading

## Rules

- set the backend origin only
- do not include `/api`
- restart or rebuild after changing env values

## Example values

### Local

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### LAN

```env
NEXT_PUBLIC_BACKEND_URL=http://192.168.1.5:8000
```

### Production

```env
NEXT_PUBLIC_BACKEND_URL=https://api.example.com
```

## Current product model

The live workflow is built around:

`Utility -> DMA -> Team -> Engineer`

Branch endpoints and branch-driven routing are no longer part of the live
frontend workflow.

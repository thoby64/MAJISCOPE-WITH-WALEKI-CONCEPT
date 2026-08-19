# Frontend Config Migration Summary

The frontend now uses one shared backend origin source:

- `WEB-BASED/Frontend/lib/config.ts`

All live dashboard/report/media flows should resolve backend URLs through that
config instead of hardcoding origins.

## Current expectations

- local dev may use `http://localhost:8000`
- LAN/shared-device testing should use your machine IP
- production must use a real deployed backend origin

## Current hierarchy

The live product hierarchy is:

`Utility -> DMA -> Team -> Engineer`

Branch-based config examples from earlier migration notes are no longer part of
the current product surface.

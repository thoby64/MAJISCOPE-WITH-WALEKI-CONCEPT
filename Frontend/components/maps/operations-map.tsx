"use client"

import dynamic from "next/dynamic"
import type { GeoJsonObject } from "geojson"
import type { LatLngBoundsExpression } from "leaflet"

const OperationsMapInner = dynamic(
  () => import("./operations-map-impl").then((module) => module.OperationsMapImpl),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[640px] items-center justify-center rounded-[28px] border border-slate-200 bg-slate-50 text-sm text-slate-500">
        Loading operations map...
      </div>
    ),
  }
)

export interface OperationsMapReport {
  id: string
  trackingId: string
  description: string
  latitude: number
  longitude: number
  status: string
  priority?: string | null
  dmaName?: string | null
  utilityName?: string | null
  regionName?: string | null
  districtName?: string | null
  address?: string | null
  reporterName?: string | null
}

export interface OperationsMapAggregateMarker {
  id: string
  label: string
  latitude: number
  longitude: number
  reported: number
  resolved: number
  level: "utility" | "dma"
}

export interface OperationsMapBoundaryOverlay {
  id: string
  label: string
  level: "utility" | "dma"
  geojson: GeoJsonObject
  reported?: number
  resolved?: number
  color?: string
}

export interface OperationsMapInfrastructureLayer {
  assetType: string
  label: string
  previewUrls: string[]
  color: string
}

export interface OperationsMapViewState {
  zoom: number
  center: [number, number]
}

export function OperationsMap(props: {
  reports: OperationsMapReport[]
  aggregateMarkers?: OperationsMapAggregateMarker[]
  boundaryOverlays?: OperationsMapBoundaryOverlay[]
  center?: [number, number] | null
  boundaryGeojson?: GeoJsonObject | null
  boundaryGeojsons?: GeoJsonObject[]
  networkPreviewUrl?: string | null
  networkPreviewUrls?: string[]
  infrastructureLayers?: OperationsMapInfrastructureLayer[]
  networkFileName?: string | null
  title?: string
  description?: string
  basemap?: "street" | "satellite"
  onBasemapChange?: (basemap: "street" | "satellite") => void
  onZoomChange?: (zoom: number) => void
  onViewChange?: (view: OperationsMapViewState) => void
  onReportSelect?: (reportId: string) => void
  chromeMode?: "standard" | "command-center"
  boundsFitKey?: string
  initialBounds?: LatLngBoundsExpression | null
  preferInitialBounds?: boolean
}) {
  return <OperationsMapInner {...props} />
}

"use client"

import { useEffect, useMemo } from "react"
import type { LeafletMouseEvent } from "leaflet"
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet"
import type { GeoJsonBoundary } from "@/lib/types"
import { PALETTE } from "@/lib/palette"

const DEFAULT_CENTER: [number, number] = [-6.7924, 39.2083]

const BOUNDARY_STROKE = PALETTE.map.boundary.color
const BOUNDARY_FILL = PALETTE.map.boundary.fillColor
const CENTER_COLOR = PALETTE.accent.strong
const CENTER_FILL = PALETTE.accent.base

type CoordinatePoint = { latitude: number; longitude: number }
type LatLngRing = [number, number][]

function ClickHandler({ onCenterChange }: { onCenterChange: (next: CoordinatePoint) => void }) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      onCenterChange({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      })
    },
  })

  return null
}

function polygonToLatLngs(polygon: number[][][]): LatLngRing[] {
  return polygon
    .map((ring) =>
      ring
        .filter((point) => Array.isArray(point) && point.length >= 2)
        .map((point) => [Number(point[1]), Number(point[0])] as [number, number])
        .filter(([latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude))
    )
    .filter((ring) => ring.length >= 3)
}

function boundaryToPolygons(boundaryGeojson?: GeoJsonBoundary | null): LatLngRing[][] {
  if (!boundaryGeojson) return []

  if (boundaryGeojson.type === "Polygon") {
    const polygon = polygonToLatLngs(boundaryGeojson.coordinates)
    return polygon.length ? [polygon] : []
  }

  if (boundaryGeojson.type === "MultiPolygon") {
    return boundaryGeojson.coordinates
      .map(polygonToLatLngs)
      .filter((polygon) => polygon.length > 0)
  }

  return []
}

function ViewportSync({
  center,
  boundaryPolygons,
}: {
  center: [number, number]
  boundaryPolygons: LatLngRing[][]
}) {
  const map = useMap()

  useEffect(() => {
    const points = boundaryPolygons.flat(2)
    if (points.length >= 2) {
      map.fitBounds(points, { padding: [28, 28] })
      return
    }

    map.setView(center)
  }, [boundaryPolygons, center, map])

  return null
}

export function UtilityLocationPickerImpl({
  centerValue,
  boundaryGeojson,
  onCenterChange,
}: {
  centerValue: { latitude: number | null; longitude: number | null }
  boundaryGeojson?: GeoJsonBoundary | null
  onCenterChange: (next: CoordinatePoint) => void
}) {
  const boundaryPolygons = useMemo(() => boundaryToPolygons(boundaryGeojson), [boundaryGeojson])

  const mapCenter = useMemo<[number, number]>(() => {
    if (centerValue.latitude !== null && centerValue.longitude !== null) {
      return [centerValue.latitude, centerValue.longitude]
    }

    const firstBoundaryPoint = boundaryPolygons[0]?.[0]?.[0]
    if (firstBoundaryPoint) return firstBoundaryPoint

    return DEFAULT_CENTER
  }, [boundaryPolygons, centerValue.latitude, centerValue.longitude])

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Utility Spatial Coordinates</p>
          <p className="mt-1 text-xs text-slate-500">
            Click the map to set the utility center. Uploaded service boundaries are shown for verification only.
          </p>
        </div>
      </div>

      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom className="h-[300px] w-full md:h-[360px]">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={18}
          maxZoom={19}
          keepBuffer={6}
          updateWhenIdle={false}
          detectRetina
        />
        <ViewportSync center={mapCenter} boundaryPolygons={boundaryPolygons} />
        <ClickHandler onCenterChange={onCenterChange} />

        {boundaryPolygons.map((polygon, index) => (
          <Polygon
            key={`utility-boundary-${index}`}
            positions={polygon}
            pathOptions={{
              color: BOUNDARY_STROKE,
              fillColor: BOUNDARY_FILL,
              fillOpacity: 0.16,
              weight: 3,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              Uploaded service boundary {boundaryPolygons.length > 1 ? index + 1 : ""}
            </Tooltip>
          </Polygon>
        ))}

        {centerValue.latitude !== null && centerValue.longitude !== null ? (
          <CircleMarker
            center={[centerValue.latitude, centerValue.longitude]}
            radius={11}
            pathOptions={{
              color: CENTER_COLOR,
              fillColor: CENTER_FILL,
              fillOpacity: 0.9,
              weight: 2,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              Utility center
            </Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>

      <div className="border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
        The utility center is required and acts as the primary operational city marker on the dashboard map.
      </div>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import type { LeafletMouseEvent } from "leaflet"
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PALETTE } from "@/lib/palette"

const DEFAULT_CENTER: [number, number] = [-6.7924, 39.2083]

const BOUNDARY_STROKE = PALETTE.map.boundary.color
const BOUNDARY_FILL = PALETTE.map.boundary.fillColor
const POINT_STROKE = PALETTE.semantic.neutral.text
const POINT_FILL = PALETTE.map.boundaryLighter.fillColor
const CENTER_COLOR = PALETTE.accent.strong
const CENTER_FILL = PALETTE.accent.base

type SelectionMode = "center" | "boundary"
type CoordinatePoint = { latitude: number; longitude: number }

function ClickHandler({
  mode,
  boundaryPoints,
  onCenterChange,
  onBoundaryChange,
}: {
  mode: SelectionMode
  boundaryPoints: CoordinatePoint[]
  onCenterChange: (next: CoordinatePoint) => void
  onBoundaryChange: (next: CoordinatePoint[]) => void
}) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      const nextPoint = {
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      }

      if (mode === "center") {
        onCenterChange(nextPoint)
        return
      }

      onBoundaryChange([...boundaryPoints, nextPoint])
    },
  })

  return null
}

function ViewportSync({
  center,
  boundaryPoints,
}: {
  center: [number, number]
  boundaryPoints: CoordinatePoint[]
}) {
  const map = useMap()

  useEffect(() => {
    if (boundaryPoints.length >= 2) {
      map.fitBounds(boundaryPoints.map((point) => [point.latitude, point.longitude] as [number, number]), {
        padding: [28, 28],
      })
      return
    }

    map.setView(center)
  }, [boundaryPoints, center, map])

  return null
}

export function DMALocationPickerImpl({
  centerValue,
  boundaryPoints,
  onCenterChange,
  onBoundaryChange,
}: {
  centerValue: { latitude: number | null; longitude: number | null }
  boundaryPoints: CoordinatePoint[]
  onCenterChange: (next: CoordinatePoint) => void
  onBoundaryChange: (next: CoordinatePoint[]) => void
}) {
  const [mode, setMode] = useState<SelectionMode>("center")

  const mapCenter = useMemo<[number, number]>(() => {
    if (centerValue.latitude !== null && centerValue.longitude !== null) {
      return [centerValue.latitude, centerValue.longitude]
    }

    if (boundaryPoints.length) {
      return [boundaryPoints[0].latitude, boundaryPoints[0].longitude]
    }

    return DEFAULT_CENTER
  }, [boundaryPoints, centerValue.latitude, centerValue.longitude])

  const boundaryLatLngs = useMemo(
    () => boundaryPoints.map((point) => [point.latitude, point.longitude] as [number, number]),
    [boundaryPoints]
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">DMA Spatial Coordinates</p>
            <p className="mt-1 text-xs text-slate-500">
              Use one mode to set the DMA center and the other to capture the DMA boundary polygon directly on the map.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={mode === "center" ? "default" : "outline"}
              className={cn(
                "rounded-xl",
                mode === "center" && "bg-emerald-600 text-white hover:bg-emerald-700"
              )}
              onClick={() => setMode("center")}
            >
              DMA Center
            </Button>
            <Button
              type="button"
              variant={mode === "boundary" ? "default" : "outline"}
              className={cn(
                "rounded-xl",
                mode === "boundary" && "bg-cyan-600 text-white hover:bg-cyan-700"
              )}
              onClick={() => setMode("boundary")}
            >
              DMA Boundaries
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={!boundaryPoints.length}
              onClick={() => onBoundaryChange(boundaryPoints.slice(0, -1))}
            >
              Undo last point
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={!boundaryPoints.length}
              onClick={() => onBoundaryChange([])}
            >
              Clear boundary
            </Button>
          </div>
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
        <ViewportSync center={mapCenter} boundaryPoints={boundaryPoints} />
        <ClickHandler
          mode={mode}
          boundaryPoints={boundaryPoints}
          onCenterChange={onCenterChange}
          onBoundaryChange={onBoundaryChange}
        />

        {boundaryLatLngs.length >= 3 ? (
          <Polygon
            positions={boundaryLatLngs}
            pathOptions={{
              color: BOUNDARY_STROKE,
              fillColor: BOUNDARY_FILL,
              fillOpacity: 0.18,
              weight: 3,
              dashArray: "6 6",
            }}
          />
        ) : boundaryLatLngs.length >= 2 ? (
          <Polyline
            positions={boundaryLatLngs}
            pathOptions={{
              color: BOUNDARY_STROKE,
              weight: 3,
              dashArray: "6 6",
            }}
          />
        ) : null}

        {boundaryPoints.map((point, index) => (
          <CircleMarker
            key={`${point.latitude}-${point.longitude}-${index}`}
            center={[point.latitude, point.longitude]}
            radius={7}
            pathOptions={{
              color: POINT_STROKE,
              fillColor: POINT_FILL,
              fillOpacity: 0.95,
              weight: 2,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              Boundary point {index + 1}
            </Tooltip>
          </CircleMarker>
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
              DMA center
            </Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>

      <div className="border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
        {mode === "center"
          ? "Center mode is active. Click once on the map to capture the DMA center coordinates."
          : "Boundary mode is active. Click around the DMA area to build the polygon point by point. The outline will grow as you add points."}
      </div>
    </div>
  )
}

"use client"

import { useEffect, useMemo } from "react"
import type { LeafletMouseEvent } from "leaflet"
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet"

const DEFAULT_CENTER: [number, number] = [-6.7924, 39.2083]
const TANZANIA_CENTER: [number, number] = [-6.3690, 34.8888]
const MARKER_COLOR = "#0891b2"
const MARKER_FILL = "#06b6d4"

type CoordinatePoint = { latitude: number; longitude: number }

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

function ViewportSync({
  center,
}: {
  center: [number, number]
}) {
  const map = useMap()

  useEffect(() => {
    map.setView(center)
  }, [center, map])

  return null
}

export function MapPicker({
  latitude,
  longitude,
  onChange,
  utilityCenter,
  dmaCenter,
  userRole,
}: {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
  utilityCenter?: { latitude: number | null; longitude: number | null } | null
  dmaCenter?: { latitude: number | null; longitude: number | null } | null
  userRole?: string
}) {
  const mapCenter = useMemo<[number, number]>(() => {
    // If user has already selected a location, use that
    if (latitude !== null && longitude !== null) {
      return [latitude, longitude]
    }

    // For utility_manager: use utility center
    if (userRole === "utility_manager" && utilityCenter?.latitude !== null && utilityCenter?.longitude !== null) {
      return [utilityCenter.latitude, utilityCenter.longitude]
    }

    // For dma_manager: use DMA center
    if (userRole === "dma_manager" && dmaCenter?.latitude !== null && dmaCenter?.longitude !== null) {
      return [dmaCenter.latitude, dmaCenter.longitude]
    }

    // For admin: use Tanzania center
    if (userRole === "admin") {
      return TANZANIA_CENTER
    }

    // Fallback to default
    return DEFAULT_CENTER
  }, [latitude, longitude, utilityCenter, dmaCenter, userRole])

  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Tank Location</p>
          <p className="mt-1 text-xs text-slate-500">
            Click the map to set the tank location. You can also enter coordinates manually in the fields above.
          </p>
        </div>
      </div>

      <MapContainer center={mapCenter} zoom={12} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={18}
          maxZoom={19}
          keepBuffer={6}
          updateWhenIdle={false}
          detectRetina
        />
        <ViewportSync center={mapCenter} />
        <ClickHandler onCenterChange={onChange} />

        {latitude !== null && longitude !== null ? (
          <CircleMarker
            center={[latitude, longitude]}
            radius={11}
            pathOptions={{
              color: MARKER_COLOR,
              fillColor: MARKER_FILL,
              fillOpacity: 0.9,
              weight: 2,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              Tank location
            </Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>

      <div className="border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
        Tank location is required for spatial mapping and hydraulic modeling.
      </div>
    </div>
  )
}
"use client"

import { Fragment, useEffect, useMemo } from "react"
import { CircleMarker, MapContainer, Pane, Popup, Polyline, TileLayer, useMap } from "react-leaflet"
import { useTheme } from "next-themes"
import type { LatLngExpression } from "leaflet"

import {
  type GeoJsonFeature,
  type GeoJsonFeatureCollection,
  type HydraulicHeatMode,
  HYDRAULIC_HEAT_MODE_LABELS,
  getGeoJsonFeatures,
} from "@/lib/hydraulic-heat"
import { PALETTE } from "@/lib/palette"

const HEAT_RED = PALETTE.chart.chart4
const HEAT_RED_DARK = PALETTE.semantic.danger.strong
const HEAT_AMBER = PALETTE.chart.chart3
const HEAT_CYAN = PALETTE.chart.chart1
const HEAT_CYAN_DARK = PALETTE.accent.strong

function isPointFeature(feature: GeoJsonFeature) {
  const coords = feature.geometry?.coordinates
  return feature.geometry?.type === "Point" && Array.isArray(coords) && coords.length >= 2
}

function isLineFeature(feature: GeoJsonFeature) {
  const coords = feature.geometry?.coordinates
  return feature.geometry?.type === "LineString" && Array.isArray(coords) && coords.length >= 2
}

function featureLatLng(feature: GeoJsonFeature): LatLngExpression | null {
  if (!isPointFeature(feature)) return null
  const [lng, lat] = feature.geometry!.coordinates as number[]
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return [lat, lng]
}

function featureLineLatLngs(feature: GeoJsonFeature): LatLngExpression[] {
  if (!isLineFeature(feature)) return []
  return ((feature.geometry!.coordinates as number[][]) || [])
    .map((coord) => {
      const [lng, lat] = coord
      return Number.isFinite(lat) && Number.isFinite(lng) ? ([lat, lng] as LatLngExpression) : null
    })
    .filter(Boolean) as LatLngExpression[]
}

function heatColor(mode: HydraulicHeatMode, feature: GeoJsonFeature) {
  const props = feature.properties || {}
  if (mode === "pipe_flow") {
    const flow = Math.abs(Number(props.flow_rate_max_abs ?? props.flow_rate_avg ?? props.flow_rate ?? 0))
    if (flow >= 50) return HEAT_RED_DARK
    if (flow >= 20) return HEAT_RED
    if (flow >= 5) return HEAT_AMBER
    if (flow > 0) return HEAT_CYAN
    return HEAT_CYAN
  }

  if (mode === "leakage_risk") {
    const score = typeof props.risk_score === "number" ? props.risk_score : 0
    if (score >= 0.8) return HEAT_RED
    if (score >= 0.55) return HEAT_AMBER
    return HEAT_CYAN
  }

  if (mode === "low_pressure") {
    const pressure = typeof props.pressure === "number" ? props.pressure : typeof props.pressure_min === "number" ? props.pressure_min : null
    if (pressure == null) return HEAT_RED
    if (pressure < 5) return HEAT_RED_DARK
    if (pressure < 10) return HEAT_RED
    return HEAT_AMBER
  }

  const pressure = typeof props.pressure === "number" ? props.pressure : typeof props.pressure_min === "number" ? props.pressure_min : null
  if (pressure == null) return HEAT_CYAN
  if (pressure < 10) return HEAT_RED
  if (pressure < 20) return HEAT_AMBER
  if (pressure < 30) return HEAT_CYAN
  if (pressure < 45) return HEAT_CYAN
  return HEAT_CYAN_DARK
}

function heatRadius(mode: HydraulicHeatMode, feature: GeoJsonFeature) {
  const props = feature.properties || {}
  if (mode === "leakage_risk") {
    const score = typeof props.risk_score === "number" ? props.risk_score : 0
    return 18 + Math.max(0, Math.min(20, score * 24))
  }

  if (mode === "low_pressure") {
    const pressure = typeof props.pressure === "number" ? props.pressure : typeof props.pressure_min === "number" ? props.pressure_min : 7
    const severity = Math.max(0, 15 - Number(pressure))
    return 18 + Math.min(18, severity * 1.3)
  }

  const pressure = typeof props.pressure === "number" ? props.pressure : typeof props.pressure_min === "number" ? props.pressure_min : 20
  if (pressure < 10) return 30
  if (pressure < 20) return 26
  if (pressure < 30) return 22
  if (pressure < 45) return 18
  return 15
}

const HEAT_LEGENDS: Record<HydraulicHeatMode, Array<{ color: string; label: string }>> = {
  pressure: [
    { color: HEAT_RED, label: "Critically low · below 10 m" },
    { color: HEAT_AMBER, label: "Low · 10-20 m" },
    { color: HEAT_CYAN, label: "Moderate · 20-45 m" },
    { color: HEAT_CYAN_DARK, label: "High · 45 m and above" },
  ],
  low_pressure: [
    { color: HEAT_RED_DARK, label: "Critical · below 5 m" },
    { color: HEAT_RED, label: "Low · 5-10 m" },
    { color: HEAT_AMBER, label: "10 m and above" },
  ],
  pipe_flow: [
    { color: HEAT_CYAN, label: "No or very low flow" },
    { color: HEAT_AMBER, label: "Moderate flow" },
    { color: HEAT_RED, label: "High flow" },
    { color: HEAT_RED_DARK, label: "Very high flow" },
  ],
  leakage_risk: [
    { color: HEAT_CYAN, label: "Elevated · below 55%" },
    { color: HEAT_AMBER, label: "High · 55-79%" },
    { color: HEAT_RED, label: "Critical · 80% and above" },
  ],
}

const HEAT_GRADIENTS: Record<HydraulicHeatMode, string> = {
  pressure: `linear-gradient(90deg, ${HEAT_RED}, ${HEAT_AMBER}, ${HEAT_CYAN}, ${HEAT_CYAN_DARK})`,
  low_pressure: `linear-gradient(90deg, ${HEAT_RED_DARK}, ${HEAT_RED}, ${HEAT_AMBER})`,
  pipe_flow: `linear-gradient(90deg, ${HEAT_CYAN}, ${HEAT_AMBER}, ${HEAT_RED}, ${HEAT_RED_DARK})`,
  leakage_risk: `linear-gradient(90deg, ${HEAT_CYAN}, ${HEAT_AMBER}, ${HEAT_RED})`,
}

function tooltipRows(mode: HydraulicHeatMode, feature: GeoJsonFeature) {
  const props = feature.properties || {}
  if (mode === "pipe_flow") {
    return [
      ["Pipe", String(props.element_id || "Unknown")],
      ["Mean flow", typeof props.flow_rate_avg === "number" ? `${props.flow_rate_avg.toFixed(3)} m³/h` : "Not available"],
      ["Peak flow", typeof props.flow_rate_max_abs === "number" ? `${props.flow_rate_max_abs.toFixed(3)} m³/h` : "Not available"],
    ]
  }

  if (mode === "leakage_risk") {
    return [
      ["Pipe", String(props.pipe_id || props.element_id || "Unknown")],
      ["Risk", String(props.risk_level || "Not specified").replaceAll("_", " ")],
      ["Score", typeof props.risk_score === "number" ? `${(props.risk_score * 100).toFixed(0)}%` : "Not available"],
    ]
  }

  if (mode === "low_pressure") {
    return [
      ["Node", String(props.element_id || "Unknown")],
      ["Pressure", typeof props.pressure === "number" ? `${props.pressure.toFixed(2)} m` : typeof props.pressure_min === "number" ? `${props.pressure_min.toFixed(2)} m` : "Not available"],
      ["Low-pressure hits", typeof props.low_pressure_hits === "number" ? String(props.low_pressure_hits) : props.is_low_pressure === true ? "1" : "0"],
    ]
  }

  return [
    ["Node", String(props.element_id || "Unknown")],
    ["Pressure", typeof props.pressure === "number" ? `${props.pressure.toFixed(2)} m` : typeof props.pressure_min === "number" ? `${props.pressure_min.toFixed(2)} m` : "Not available"],
    ["Average", typeof props.pressure_avg === "number" ? `${props.pressure_avg.toFixed(2)} m` : "Not available"],
  ]
}

function MapBounds({ features }: { features: GeoJsonFeature[] }) {
  const map = useMap()

  useEffect(() => {
    const points = features.flatMap((feature) => {
      const point = featureLatLng(feature)
      if (point) return [point]
      return featureLineLatLngs(feature)
    }).filter(Boolean) as [number, number][]
    if (!points.length) return
    map.fitBounds(points, { padding: [24, 24] })
  }, [features, map])

  return null
}

export function HydraulicHeatMap({
  mode,
  nodesGeojson,
  pipesGeojson,
  hotspotsGeojson,
}: {
  mode: HydraulicHeatMode
  nodesGeojson?: GeoJsonFeatureCollection
  pipesGeojson?: GeoJsonFeatureCollection
  hotspotsGeojson?: GeoJsonFeatureCollection
}) {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"

  const features = useMemo(() => {
    if (mode === "leakage_risk") {
      return getGeoJsonFeatures(hotspotsGeojson).filter(isPointFeature)
    }

    if (mode === "pipe_flow") {
      return getGeoJsonFeatures(pipesGeojson).filter((feature) => isPointFeature(feature) || isLineFeature(feature))
    }

    const nodeFeatures = getGeoJsonFeatures(nodesGeojson).filter(isPointFeature)
    if (mode === "low_pressure") {
      return nodeFeatures.filter((feature) => {
        const props = feature.properties || {}
        return props.is_low_pressure === true || (typeof props.low_pressure_hits === "number" && Number(props.low_pressure_hits) > 0)
      })
    }
    return nodeFeatures
  }, [hotspotsGeojson, mode, nodesGeojson, pipesGeojson])

  const mapCenter = useMemo<LatLngExpression>(() => {
    const firstPoint = features.map(featureLatLng).find(Boolean)
    return firstPoint || [-6.8, 39.28]
  }, [features])

  const tileUrl = theme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
      <MapContainer center={mapCenter} zoom={13} scrollWheelZoom className="h-[25rem] w-full bg-slate-100 dark:bg-slate-950">
        <TileLayer
          url={tileUrl}
          attribution={theme === "dark" ? "&copy; OSM &copy; CARTO" : "&copy; OpenStreetMap contributors"}
        />
        <Pane name="hydraulic-heat-hit" className="hydraulic-heat-hit-pane" />
        <MapBounds features={features} />

        {features.map((feature, index) => {
          const latLng = featureLatLng(feature)
          const color = heatColor(mode, feature)
          const radius = heatRadius(mode, feature)
          const rows = tooltipRows(mode, feature)

          if (mode === "pipe_flow" && isLineFeature(feature)) {
            const line = featureLineLatLngs(feature)
            if (!line.length) return null
            return (
              <Polyline
                key={`${mode}-${index}`}
                positions={line}
                pathOptions={{ color, weight: 4, opacity: 0.92 }}
              >
                <Popup>
                  <div className="min-w-40 text-sm">
                    <p className="mb-2 font-semibold">{HYDRAULIC_HEAT_MODE_LABELS[mode]}</p>
                    <div className="space-y-1">
                      {rows.map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3">
                          <span className="text-slate-500">{label}</span>
                          <span className="font-medium text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Popup>
              </Polyline>
            )
          }

          if (!latLng) return null

          return (
            <Fragment key={`${mode}-${index}`}>
              <CircleMarker
                center={latLng}
                pane="hydraulic-heat-hit"
                radius={mode === "pipe_flow" ? 6 : Math.max(5, Math.min(8, radius / 3.5))}
                pathOptions={{
                  color: HEAT_CYAN_DARK,
                  weight: 1.2,
                  fillColor: color,
                  fillOpacity: 0.92,
                }}
              >
                <Popup>
                  <div className="min-w-40 text-sm">
                    <p className="mb-2 font-semibold">{HYDRAULIC_HEAT_MODE_LABELS[mode]}</p>
                    <div className="space-y-1">
                      {rows.map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-3">
                          <span className="text-slate-500">{label}</span>
                          <span className="font-medium text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            </Fragment>
          )
        })}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-4 left-4 z-[900] min-w-52 rounded-md border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/95">
        <p className="mb-2 text-xs font-semibold text-slate-950 dark:text-white">
          {HYDRAULIC_HEAT_MODE_LABELS[mode]}
        </p>
        <div className="mb-2 h-2 w-full rounded-full ring-1 ring-slate-900/10" style={{ background: HEAT_GRADIENTS[mode] }} />
        <div className="space-y-1.5">
          {HEAT_LEGENDS[mode].map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <span className="h-3 w-3 shrink-0 rounded-full border border-white/70 shadow-sm" style={{ backgroundColor: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

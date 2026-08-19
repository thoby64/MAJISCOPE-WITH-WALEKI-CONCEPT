export type HydraulicHeatMode = "pressure" | "low_pressure" | "pipe_flow" | "leakage_risk"

export type GeoJsonFeature = {
  type: "Feature"
  geometry?: {
    type?: string
    coordinates?: number[] | number[][]
  } | null
  properties?: Record<string, unknown> | null
}

export type GeoJsonFeatureCollection = unknown

export const HYDRAULIC_HEAT_MODE_LABELS: Record<HydraulicHeatMode, string> = {
  pressure: "Pressure",
  low_pressure: "Low Pressure",
  pipe_flow: "Mean Flow",
  leakage_risk: "Leakage Risk",
}

export function getGeoJsonFeatures(collection: GeoJsonFeatureCollection): GeoJsonFeature[] {
  if (!collection || typeof collection !== "object") {
    return []
  }

  const candidate = collection as { type?: unknown; features?: unknown }
  if (candidate.type !== "FeatureCollection" || !Array.isArray(candidate.features)) {
    return []
  }

  return candidate.features.filter(
    (feature): feature is GeoJsonFeature => Boolean(feature) && typeof feature === "object" && (feature as { type?: unknown }).type === "Feature"
  )
}

function hasPointCoordinates(feature: GeoJsonFeature) {
  const coords = feature.geometry?.coordinates
  return feature.geometry?.type === "Point" && Array.isArray(coords) && coords.length >= 2
}

export function getAvailableHydraulicHeatModes({
  nodesGeojson,
  pipesGeojson,
  hotspotsGeojson,
}: {
  nodesGeojson?: GeoJsonFeatureCollection
  pipesGeojson?: GeoJsonFeatureCollection
  hotspotsGeojson?: GeoJsonFeatureCollection
}): HydraulicHeatMode[] {
  const modes: HydraulicHeatMode[] = []
  const nodeFeatures = getGeoJsonFeatures(nodesGeojson).filter(hasPointCoordinates)
  const pipeFeatures = getGeoJsonFeatures(pipesGeojson)
  const hotspotFeatures = getGeoJsonFeatures(hotspotsGeojson).filter(hasPointCoordinates)

  if (nodeFeatures.some((feature) => typeof feature.properties?.pressure === "number")) {
    modes.push("pressure")
  }

  if (
    nodeFeatures.some((feature) => {
      const lowPressure = feature.properties?.is_low_pressure
      return lowPressure === true || (typeof feature.properties?.low_pressure_hits === "number" && Number(feature.properties.low_pressure_hits) > 0)
    })
  ) {
    modes.push("low_pressure")
  }

  if (
    pipeFeatures.some((feature) => {
      const props = feature.properties || {}
      const value = props.flow_rate_max_abs ?? props.flow_rate_avg ?? props.flow_rate
      return typeof value === "number" && Number.isFinite(value)
    })
  ) {
    modes.push("pipe_flow")
  }

  if (
    hotspotFeatures.some((feature) => {
      const score = feature.properties?.risk_score
      return typeof score === "number" && Number.isFinite(score) && score > 0
    })
  ) {
    modes.push("leakage_risk")
  }

  return modes
}

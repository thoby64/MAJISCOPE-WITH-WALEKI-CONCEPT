"use client"

import { useEffect, useMemo, useState } from "react"
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet"
import type { Feature, FeatureCollection, GeoJsonObject, Geometry } from "geojson"
import type { LatLngBoundsExpression } from "leaflet"
import * as L from "leaflet"
import { AlertTriangle } from "lucide-react"
import { InfrastructureIcon } from "@/components/icons/infrastructure-icon"
import { getInfrastructureIconDef, infrastructureIconPathsHtml } from "@/lib/infrastructure-assets"
import CONFIG from "@/lib/config"
import { PALETTE } from "@/lib/palette"

const INFRA_COLOR = PALETTE.map.infrastructure.color
const INFRA_BORDER = PALETTE.semantic.neutral.bg
const INFRA_MUTED = PALETTE.semantic.neutral.base
const INFRA_TEXT = PALETTE.semantic.neutral.text

const DEFAULT_CENTER: [number, number] = [-6.7924, 39.2083]

function describePreviewIssue(error: string | null, fileName?: string | null) {
  if (!error) {
    return {
      title: "Pipe network preview ready when uploaded",
      detail: "Upload a supported utility pipe network file to preview it on the map.",
    }
  }

  const normalized = error.toLowerCase()
  const fileLabel = fileName ? `Saved file: ${fileName}. ` : ""

  if (normalized.includes("decoded")) {
    return {
      title: "Saved file could not be read",
      detail: `${fileLabel}Re-export it as UTF-8 GeoJSON, KML, CSV, or TXT, then upload it again.`,
    }
  }

  if (normalized.includes("parsed")) {
    return {
      title: "Saved file structure is invalid",
      detail: `${fileLabel}The uploaded network file could not be parsed. Re-export the map file from the source GIS tool and replace it here.`,
    }
  }

  if (normalized.includes("did not contain previewable geometry")) {
    return {
      title: "No map geometry was found",
      detail: `${fileLabel}The file is saved, but it does not contain previewable pipe lines or points. Confirm the export includes actual network geometry before uploading again.`,
    }
  }

  if (normalized.includes("converted into previewable map features")) {
    return {
      title: "Saved file is not map-ready yet",
      detail: `${fileLabel}The file format was accepted for storage, but its contents could not be turned into map features. Download it to inspect the export or replace it with a cleaner GIS file.`,
    }
  }

  return {
    title: "Uploaded pipe network could not be previewed",
    detail: `${fileLabel}${error} Download the saved file to inspect it or replace it with a cleaner GIS export.`,
  }
}

type GeometryCoordinates =
  | [number, number]
  | number[]
  | GeometryCoordinates[]

const ASSET_META: Record<string, { label: string; color: string }> = {
  pipe_network: { label: "pipe network", color: INFRA_COLOR },
  valves: { label: "valves", color: INFRA_COLOR },
  water_sources: { label: "water sources", color: INFRA_COLOR },
  storage_facilities: { label: "storage facilities", color: INFRA_COLOR },
  bulk_meters: { label: "bulk meters", color: INFRA_COLOR },
}

function getAssetColor(assetType?: string | null) {
  return PALETTE.map.infrastructure.color
}

function getAssetMeta(assetType?: string | null) {
  return ASSET_META[assetType || ""] || ASSET_META.pipe_network
}

function createAssetDivIcon(assetType?: string | null) {
  const def = getInfrastructureIconDef(assetType)
  return L.divIcon({
    className: "majiscope-asset-div-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `<span style="--asset-color:${PALETTE.map.infrastructure.color}" class="majiscope-asset-marker"><svg viewBox="${def.viewBox}" aria-hidden="true">${infrastructureIconPathsHtml(assetType)}</svg></span>`,
  })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function formatPropertyLabel(key: string) {
  const aliases: Record<string, string> = {
    assetid: "Asset ID",
    asset_id: "Asset ID",
    source_file: "Source file",
    source_table: "Layer",
    asset_type: "Asset type",
    asset_label: "Asset",
  }
  return aliases[key.toLowerCase()] || key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function buildFeaturePopupHtml(feature: Feature, title: string) {
  const rawProperties = feature.properties
  const entries = Object.entries(
    rawProperties && typeof rawProperties === "object" ? rawProperties : {}
  ).filter(([, value]) => value !== null && value !== "")

  const rows = entries.slice(0, 18).map(([key, value]) => (
    `<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border-bottom:1px solid ${INFRA_BORDER};padding:5px 0;">
      <span style="font-size:11px;color:${INFRA_MUTED};">${escapeHtml(formatPropertyLabel(key))}</span>
      <span style="font-size:11px;color:${INFRA_TEXT};font-weight:700;text-align:right;max-width:220px;word-break:break-word;">${escapeHtml(String(value))}</span>
    </div>`
  ))

  return `<div style="width:300px;max-height:260px;overflow:auto;font-family:Inter,ui-sans-serif,system-ui;">
    <div style="position:sticky;top:0;background:${INFRA_BORDER};border-bottom:1px solid ${INFRA_BORDER};padding:9px 10px;margin:-4px -4px 8px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${INFRA_TEXT};">${escapeHtml(title)}</div>
      <div style="font-size:11px;color:${INFRA_MUTED};margin-top:2px;">Attributes from uploaded GIS file</div>
    </div>
    ${rows.length ? `<div style="display:grid;gap:2px;">${rows.join("")}</div>` : `<div style="font-size:12px;color:${INFRA_MUTED};">No attribute data was included for this feature.</div>`}
  </div>`
}

function flattenCoordinates(input: GeometryCoordinates | undefined, target: Array<[number, number]>) {
  if (!input) return
  if (
    Array.isArray(input) &&
    input.length >= 2 &&
    typeof input[0] === "number" &&
    typeof input[1] === "number"
  ) {
    target.push([Number(input[1]), Number(input[0])])
    return
  }

  if (Array.isArray(input)) {
    input.forEach((item) => flattenCoordinates(item as GeometryCoordinates, target))
  }
}

function collectGeoJsonCoordinates(geojson: GeoJsonObject | null): Array<[number, number]> {
  const points: Array<[number, number]> = []
  if (!geojson) return points

  const visitGeometry = (geometry: Geometry | null | undefined) => {
    if (!geometry) return
    if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
      geometry.geometries.forEach(visitGeometry)
      return
    }
    if ("coordinates" in geometry) {
      flattenCoordinates(geometry.coordinates as GeometryCoordinates, points)
    }
  }

  if (geojson.type === "FeatureCollection") {
    ;(geojson as FeatureCollection).features.forEach((feature) => visitGeometry(feature?.geometry))
  } else if (geojson.type === "Feature") {
    visitGeometry((geojson as Feature).geometry)
  } else {
    visitGeometry(geojson as Geometry)
  }

  return points
}

function FitPreviewToData({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap()

  useEffect(() => {
    if (!bounds) return
    map.fitBounds(bounds, {
      padding: [34, 34],
      maxZoom: 15,
      animate: false,
    })
  }, [bounds, map])

  return null
}

export function UtilityPipeNetworkMapImpl({
  utilityId,
  previewUrl,
  fallbackCenter,
  fileName,
  assetType = "pipe_network",
  mapHeightClassName = "h-[320px]",
  title = "Utility Pipe Network",
  emptyMessage = "Upload a supported utility pipe network file to preview it on the map.",
}: {
  utilityId: string
  previewUrl?: string | null
  fallbackCenter?: [number, number] | null
  fileName?: string | null
  assetType?: string
  mapHeightClassName?: string
  title?: string
  emptyMessage?: string
}) {
  const [geojson, setGeojson] = useState<GeoJsonObject | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPreview() {
      if (!utilityId || !previewUrl) {
        setGeojson(null)
        setError(null)
        return
      }

      const token = localStorage.getItem(CONFIG.storage.tokenKey)
      if (!token) {
        setError("Authentication is required to preview the utility pipe network.")
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${CONFIG.backend.baseUrl}${previewUrl}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          if (!cancelled) {
            setGeojson(null)
            setError(payload.detail || payload.error || "Unable to load the utility pipe network preview.")
          }
          return
        }

        if (!cancelled) {
          setGeojson(payload as GeoJsonObject)
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Error loading utility pipe network preview:", err)
          setGeojson(null)
          setError("Unable to load the utility pipe network preview.")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadPreview()
    return () => {
      cancelled = true
    }
  }, [utilityId, previewUrl])

  const assetMeta = useMemo(() => getAssetMeta(assetType), [assetType])

  const previewCoordinates = useMemo(() => collectGeoJsonCoordinates(geojson), [geojson])

  const mapCenter = useMemo<[number, number]>(() => {
    if (previewCoordinates.length > 0) {
      const latitudeAverage =
        previewCoordinates.reduce((sum, point) => sum + point[0], 0) / previewCoordinates.length
      const longitudeAverage =
        previewCoordinates.reduce((sum, point) => sum + point[1], 0) / previewCoordinates.length
      return [latitudeAverage, longitudeAverage]
    }
    if (fallbackCenter && Number.isFinite(fallbackCenter[0]) && Number.isFinite(fallbackCenter[1])) {
      return fallbackCenter
    }
    return DEFAULT_CENTER
  }, [fallbackCenter, previewCoordinates])

  const previewMessage = useMemo(() => {
    if (error) {
      return describePreviewIssue(error, fileName)
    }

    return {
      title: `${title} ready when uploaded`,
      detail: emptyMessage,
    }
  }, [emptyMessage, error, fileName, title])

  const fitBounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!previewCoordinates.length) return null
    if (previewCoordinates.length === 1) {
      const [lat, lng] = previewCoordinates[0]
      return [
        [lat - 0.01, lng - 0.01],
        [lat + 0.01, lng + 0.01],
      ]
    }
    return previewCoordinates
  }, [previewCoordinates])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <InfrastructureIcon assetType={assetType} className="h-5 w-5 shrink-0" style={{ color: assetMeta.color }} />
          <div>
            <p className="text-sm font-semibold text-slate-800">{title}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Preview uploaded utility {assetMeta.label} against the live dashboard map.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={`flex ${mapHeightClassName} items-center justify-center bg-slate-50 text-sm text-slate-500`}>
          Loading utility {assetMeta.label}...
        </div>
      ) : previewUrl && geojson ? (
        <MapContainer center={mapCenter} zoom={13} scrollWheelZoom className={`${mapHeightClassName} w-full`}>
          <FitPreviewToData bounds={fitBounds} />
          <style jsx global>{`
            .majiscope-asset-div-icon {
              background: transparent;
              border: 0;
            }

            .majiscope-asset-marker {
              display: flex;
              height: 28px;
              width: 28px;
              align-items: center;
              justify-content: center;
              border-radius: 9999px;
              background: color-mix(in srgb, var(--asset-color) 92%, white);
              color: white;
              border: 2px solid rgba(255, 255, 255, 0.96);
              box-shadow: 0 10px 22px -12px rgba(15, 23, 42, 0.82);
            }

            .majiscope-asset-marker svg {
              height: 19px;
              width: 19px;
              filter: drop-shadow(0 1px 0 rgba(15, 23, 42, 0.18));
            }
          `}</style>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxNativeZoom={18}
            maxZoom={19}
            keepBuffer={6}
            updateWhenIdle={false}
            detectRetina
          />
          <GeoJSON
            data={geojson}
            pointToLayer={(_, latlng) =>
              assetType === "pipe_network"
                ? L.circleMarker(latlng, {
                    radius: 3,
                    fillColor: INFRA_COLOR,
                    color: "#ffffff",
                    weight: 1.5,
                    fillOpacity: 0.9,
                  })
                : L.marker(latlng, { icon: createAssetDivIcon(assetType) })
            }
            style={() => ({
              color: getAssetColor(assetType),
              weight: assetType === "pipe_network" ? 3 : 2,
              opacity: 0.9,
              fillColor: getAssetColor(assetType),
              fillOpacity: assetType === "pipe_network" ? 0.08 : 0.16,
            })}
            onEachFeature={(feature, layer) => {
              if (!feature) return
              if ("bindPopup" in layer && typeof layer.bindPopup === "function") {
                layer.bindPopup(buildFeaturePopupHtml(feature as Feature, title))
              }
            }}
          />
        </MapContainer>
      ) : (
        <div className={`flex ${mapHeightClassName} flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">
              {previewMessage.title}
            </p>
            <p className="mt-1 text-sm text-slate-500">{previewMessage.detail}</p>
          </div>
        </div>
      )}
    </div>
  )
}

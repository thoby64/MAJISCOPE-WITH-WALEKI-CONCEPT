"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Activity, AlertTriangle, ArrowLeft, BarChart3, Calendar, ChevronLeft, ChevronRight, Database, Download, Droplets, FlaskConical, GlassWater, Gauge, Info, Leaf, MapPin, Radio, Ruler, Search, ShieldCheck, Thermometer, TrendingDown, TrendingUp, Waves, X } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { SensorIcon } from "@/components/icons/sensor-icon"
import { useDataStore, type SensorCategory, type SensorSnap, type StorageFacilityReading, type WaterSourceReading } from "@/store/data-store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { cn } from "@/lib/utils"
import {
  READING_FETCH_LIMIT,
  WATER_LEVEL_POLL_INTERVAL_MS,
  readStoredStorageFacilityLength,
  storageFacilityLengthFor,
} from "@/lib/water-level"

const WQ_PARAM_LABELS: Record<string, string> = {
  temperature_c: "Temperature",
  ph: "pH",
  ec_uscm: "Conductivity (EC)",
  do_mgl: "Dissolved O₂",
  do_pct_sat: "DO Saturation",
  turbidity_ntu: "Turbidity",
  orp_mv: "ORP",
  free_chlorine_mgl: "Free Chlorine",
  nitrate_mgl: "Nitrate",
  ammonia_mgl: "Ammonia",
  phosphate_mgl: "Phosphate",
  chlorophyll_ugl: "Chlorophyll-a",
  phycocyanin_ugl: "Phycocyanin",
}

const WQ_PARAM_UNITS: Record<string, string> = {
  temperature_c: "°C",
  ph: "",
  ec_uscm: "µS/cm",
  do_mgl: "mg/L",
  do_pct_sat: "%",
  turbidity_ntu: "NTU",
  orp_mv: "mV",
  free_chlorine_mgl: "mg/L",
  nitrate_mgl: "mg/L",
  ammonia_mgl: "mg/L",
  phosphate_mgl: "mg/L",
  chlorophyll_ugl: "µg/L",
  phycocyanin_ugl: "µg/L",
}

// The API client camelCases response keys (temperature_c -> temperatureC),
// so parameter lookups must normalise keys back to the canonical snake_case.
function wqKey(rawKey: string): string {
  if (WQ_PARAM_LABELS[rawKey]) return rawKey
  // temperatureC -> temperature_c ; doMgl -> do_mgl ; ph stays ph
  const snake = rawKey.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  return WQ_PARAM_LABELS[snake] ? snake : rawKey
}

// Water-source and storage-facility readings differ only in their parent-id
// field, so the shared detail views below accept either shape.
type SensorReadingRow = StorageFacilityReading | WaterSourceReading

type ParamTile = { text: string; tint: string }

// Per-parameter presentation. Where a real-world symbol/notation exists it
// is the tile (chemists read pH, O2, Cl, NO3 instantly); the few icons that
// genuinely match the measurement stay as icons.
const WQ_PARAM_META: Record<
  string,
  { label: string; unit: string; icon?: LucideIcon; tile?: ParamTile; tint: string; chip: string }
> = {
  temperature_c: { label: "Temperature", unit: "°C", icon: Thermometer, tint: "text-orange-500 bg-orange-50", chip: "text-orange-600" },
  ph: { label: "pH", unit: "", tile: { text: "pH", tint: "text-violet-600 bg-violet-50" }, tint: "text-violet-500 bg-violet-50", chip: "text-violet-600" },
  ec_uscm: { label: "Conductivity (EC)", unit: "µS/cm", tile: { text: "EC", tint: "text-amber-600 bg-amber-50" }, tint: "text-amber-500 bg-amber-50", chip: "text-amber-600" },
  do_mgl: { label: "Dissolved O₂", unit: "mg/L", tile: { text: "O₂", tint: "text-sky-600 bg-sky-50" }, tint: "text-sky-500 bg-sky-50", chip: "text-sky-600" },
  do_pct_sat: { label: "DO Saturation", unit: "%", tile: { text: "O₂%", tint: "text-sky-600 bg-sky-50" }, tint: "text-sky-500 bg-sky-50", chip: "text-sky-600" },
  turbidity_ntu: { label: "Turbidity", unit: "NTU", icon: GlassWater, tint: "text-teal-500 bg-teal-50", chip: "text-teal-600" },
  orp_mv: { label: "ORP (Redox)", unit: "mV", tile: { text: "ORP", tint: "text-lime-700 bg-lime-50" }, tint: "text-lime-600 bg-lime-50", chip: "text-lime-700" },
  free_chlorine_mgl: { label: "Free Chlorine", unit: "mg/L", tile: { text: "Cl", tint: "text-emerald-600 bg-emerald-50" }, tint: "text-emerald-500 bg-emerald-50", chip: "text-emerald-600" },
  nitrate_mgl: { label: "Nitrate", unit: "mg/L", tile: { text: "NO₃", tint: "text-green-700 bg-green-50" }, tint: "text-green-600 bg-green-50", chip: "text-green-700" },
  ammonia_mgl: { label: "Ammonia", unit: "mg/L", tile: { text: "NH₃", tint: "text-rose-600 bg-rose-50" }, tint: "text-rose-500 bg-rose-50", chip: "text-rose-600" },
  phosphate_mgl: { label: "Phosphate", unit: "mg/L", tile: { text: "PO₄", tint: "text-indigo-600 bg-indigo-50" }, tint: "text-indigo-500 bg-indigo-50", chip: "text-indigo-600" },
  chlorophyll_ugl: { label: "Chlorophyll-a", unit: "µg/L", icon: Leaf, tint: "text-green-500 bg-green-50", chip: "text-green-600" },
  phycocyanin_ugl: { label: "Phycocyanin", unit: "µg/L", tile: { text: "PC", tint: "text-cyan-700 bg-cyan-50" }, tint: "text-cyan-500 bg-cyan-50", chip: "text-cyan-700" },
  pressure: { label: "Pressure", unit: "kPa", icon: Gauge, tint: "text-purple-600 bg-purple-50", chip: "text-purple-600" },
}

function wqLabel(key: string): string {
  const k = wqKey(key)
  return WQ_PARAM_META[k]?.label ?? WQ_PARAM_LABELS[k] ?? k
}

function wqUnit(key: string): string {
  const k = wqKey(key)
  return WQ_PARAM_META[k]?.unit ?? WQ_PARAM_UNITS[k] ?? ""
}

// Client-side pagination for the history tables: the full reading set is
// fetched once and paged here, defaulting to 20 rows per page.
const TABLE_PAGE_SIZE_DEFAULT = 20
const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// Compact page-number list: first, last, and a window around the current
// page, with "…" gaps so long histories stay navigable.
function tablePageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set<number>([1, total, current - 1, current, current + 1])
  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b)
  const output: (number | "…")[] = []
  let previous = 0
  for (const page of sorted) {
    if (page - previous > 1) output.push("…")
    output.push(page)
    previous = page
  }
  return output
}

// Canonical column order for the history table (matches the reference layout).
const WQ_PARAM_ORDER: string[] = [
  "temperature_c",
  "ph",
  "ec_uscm",
  "do_mgl",
  "do_pct_sat",
  "turbidity_ntu",
  "orp_mv",
  "free_chlorine_mgl",
  "nitrate_mgl",
  "ammonia_mgl",
  "phosphate_mgl",
  "chlorophyll_ugl",
  "phycocyanin_ugl",
  "pressure",
]

// Logical grouping of the parameters into themed panels. Keys not covered by
// any group fall back to an "Other readings" panel so nothing is dropped.
const WQ_PARAM_GROUPS: { label: string; icon: LucideIcon; keys: string[] }[] = [
  { label: "Physical Properties", icon: Gauge, keys: ["temperature_c", "turbidity_ntu", "pressure"] },
  { label: "Core Water Chemistry", icon: FlaskConical, keys: ["ph", "ec_uscm", "do_mgl", "do_pct_sat"] },
  { label: "Disinfection & Nutrients", icon: ShieldCheck, keys: ["free_chlorine_mgl", "nitrate_mgl", "ammonia_mgl", "phosphate_mgl"] },
  { label: "Redox & Biological", icon: Leaf, keys: ["orp_mv", "chlorophyll_ugl", "phycocyanin_ugl"] },
]

// The API client camelCases response keys (temperature_c -> temperatureC),
// so value lookups normalise back to the canonical snake_case key.
function paramValue(source: Record<string, number> | null | undefined, key: string): number | undefined {
  if (!source) return undefined
  if (source[key] != null) return source[key]
  const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  return source[camel] ?? undefined
}

function categoryIcon(category: SensorCategory) {
  return category === "water_quality" ? (
    <FlaskConical className="h-4 w-4 text-cyan-700" />
  ) : (
    <Waves className="h-4 w-4 text-cyan-700" />
  )
}

function categoryLabel(category: SensorCategory) {
  return category === "water_quality" ? "Water Quality" : "Water Level"
}

export default function WaterLevelStorageFacilityDetailPage() {
  const router = useRouter()
  // The same detail view serves both asset types: the route param decides
  // which one we are rendering (storage facility vs water source).
  const params = useParams<{ storageFacilityId?: string; waterSourceId?: string }>()
  const rawAssetId = params?.storageFacilityId ?? params?.waterSourceId
  const assetId = Array.isArray(rawAssetId) ? rawAssetId[0] : rawAssetId
  const isWaterSourceRoute = Boolean(params?.waterSourceId)
  const assetNoun = isWaterSourceRoute ? "water source" : "storage facility"
  const assetBasePath = isWaterSourceRoute
    ? `/dashboard/sensor-data/water-sources/${assetId}`
    : `/dashboard/sensor-data/${assetId}`
  const searchParams = useSearchParams()
  const selectedSensorId = searchParams.get("sensor")

  const {
    sensors,
    storageFacilities,
    waterSources,
    storageFacilityReadingsByStorageFacility,
    waterSourceReadingsByWaterSource,
    fetchSensors,
    fetchStorageFacilities,
    fetchWaterSources,
    fetchStorageFacilityReadings,
    fetchWaterSourceReadings,
  } = useDataStore()

  const lengthOverride = assetId && !isWaterSourceRoute ? readStoredStorageFacilityLength(assetId) : null

  const assetSensors = useMemo(
    () =>
      sensors.filter((s) =>
        isWaterSourceRoute ? s.waterSourceId === assetId : s.storageFacilityId === assetId
      ),
    [sensors, assetId, isWaterSourceRoute]
  )

  const selected: SensorSnap | undefined = useMemo(
    () => assetSensors.find((s) => s.id === selectedSensorId),
    [assetSensors, selectedSensorId]
  )

  const selectedCategory: SensorCategory = selected?.category ?? "water_level"

  useEffect(() => {
    if (!assetId) return
    void fetchSensors()
    if (isWaterSourceRoute) void fetchWaterSources()
    else void fetchStorageFacilities()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSensors()
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [assetId, isWaterSourceRoute, fetchSensors, fetchStorageFacilities, fetchWaterSources])

  useEffect(() => {
    if (!assetId || !selectedSensorId || !selected) return
    // Both categories paginate their history table client-side, so the detail
    // page pulls the full reading set instead of a short live window.
    const pull = () =>
      isWaterSourceRoute
        ? fetchWaterSourceReadings(assetId, READING_FETCH_LIMIT, selectedCategory)
        : fetchStorageFacilityReadings(assetId, READING_FETCH_LIMIT, selectedCategory)
    void pull()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void pull()
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [assetId, selectedSensorId, selectedCategory, selected, isWaterSourceRoute, fetchWaterSourceReadings, fetchStorageFacilityReadings])

  const asset = useMemo(
    () =>
      isWaterSourceRoute
        ? waterSources.find((w) => w.id === assetId)
        : storageFacilities.find((t) => t.id === assetId),
    [waterSources, storageFacilities, assetId, isWaterSourceRoute]
  )
  const assetName =
    asset?.name ||
    selected?.storageFacilityName ||
    selected?.waterSourceName ||
    assetId ||
    (isWaterSourceRoute ? "Water source" : "Storage facility")

  const readings: SensorReadingRow[] = useMemo(() => {
    if (!assetId) return []
    return isWaterSourceRoute
      ? waterSourceReadingsByWaterSource[`${assetId}:${selectedCategory}`] ?? []
      : storageFacilityReadingsByStorageFacility[`${assetId}:${selectedCategory}`] ?? []
  }, [waterSourceReadingsByWaterSource, storageFacilityReadingsByStorageFacility, assetId, selectedCategory, isWaterSourceRoute])

  // ═══════════════════════════════════════════════════════════════════════
  // Sensor list view (first load) — card grid, one card per sensor
  // ═══════════════════════════════════════════════════════════════════════
  if (!selectedSensorId) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              router.push(
                isWaterSourceRoute ? "/dashboard/sensor-data/water-sources" : "/dashboard/sensor-data"
              )
            }
            className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to monitoring
          </Button>
          <div className="storage-facility-detail-heading">
            <span className="storage-facility-detail-heading__icon"><Droplets aria-hidden="true" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-800">{assetName}</h1>
                {asset && <WaterStatusPill status={asset.status} />}
              </div>
              <p className="text-sm text-slate-500">
                Sensors linked to this {assetNoun}. Select a sensor to view its readings.
              </p>
            </div>
          </div>
        </div>

        {assetSensors.length === 0 ? (
          <Card className="border-slate-200/70 bg-white shadow-sm">
            <CardContent className="py-16 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                  <Droplets className="h-8 w-8 text-slate-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-800">No sensors linked</p>
                  <p className="mt-1 text-sm text-slate-500">
                    No sensor is currently linked to this {assetNoun}.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="storage-facility-detail-grid">
            {assetSensors.map((sensor) => {
              const lr = sensor.lastReading
              const metrics = sensor.category === "water_quality"
                ? Object.entries(lr?.parameters ?? {}).slice(0, 2).map(([key, value]) => ({
                    label: wqLabel(key),
                    value: `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })}${wqUnit(key) ? ` ${wqUnit(key)}` : ""}`,
                    icon: WQ_PARAM_META[wqKey(key)]?.icon,
                    symbol: WQ_PARAM_META[wqKey(key)]?.tile?.text,
                  }))
                : [
                    ...(lr?.waterLevelM != null ? [{ label: "Water level", value: `${Number(lr.waterLevelM).toLocaleString(undefined, { maximumFractionDigits: 2 })} m`, icon: Waves, symbol: undefined }] : []),
                    ...(lr?.status ? [{ label: "Reading status", value: lr.status.replace(/[_-]/g, " "), icon: Activity, symbol: undefined }] : []),
                  ]
              return (
                <button
                  key={sensor.id}
                  onClick={() => router.push(`${assetBasePath}?sensor=${sensor.id}`)}
                  className="storage-facility-detail-card group text-left"
                >
                  <Card className="storage-facility-detail-card__surface">
                    <CardContent className="storage-facility-detail-card__content">
                      <div className="storage-facility-detail-card__header">
                        <div className="storage-facility-detail-card__identity">
                          <span className="storage-facility-detail-card__icon">{categoryIcon(sensor.category)}</span>
                          <div className="min-w-0">
                            <span className="storage-facility-detail-card__title">{categoryLabel(sensor.category)}</span>
                            <span className="storage-facility-detail-card__device">{sensor.deviceId}</span>
                          </div>
                        </div>
                        <WaterStatusPill status={sensor.status || (sensor.activated ? "active" : "inactive")} />
                      </div>

                      {metrics.length > 0 ? (
                        <div className="storage-facility-detail-card__readings">
                          {metrics.map((metric, index) => {
                            const MetricIcon = metric.icon
                            return (
                              <div className={`storage-facility-detail-card__reading${index === 0 ? " storage-facility-detail-card__reading--lead" : ""}`} key={metric.label}>
                                <span className="storage-facility-detail-card__reading-copy">
                                  <span className="storage-facility-detail-card__reading-label">
                                    <span className="storage-facility-detail-card__reading-icon">
                                      {metric.symbol ? <span>{metric.symbol}</span> : MetricIcon ? <MetricIcon aria-hidden="true" /> : <Droplets aria-hidden="true" />}
                                    </span>
                                    {metric.label}
                                  </span>
                                  <strong className="storage-facility-detail-card__reading-value">{metric.value}</strong>
                                </span>
                                {index === 0 && metrics.length > 1 && <span className="storage-facility-detail-card__primary-tag">Latest</span>}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="storage-facility-detail-card__empty">
                          <Activity aria-hidden="true" />
                          <span><strong>No reading data</strong><small>No measurement has been reported by this sensor yet.</small></span>
                        </div>
                      )}

                      <div className="storage-facility-detail-card__meta">
                        <span className="storage-facility-detail-card__freshness"><Calendar aria-hidden="true" /><span>{lr ? `Last reported ${formatTanzaniaDateTime(lr.occurredAt)}` : "Awaiting first reading"}</span></span>
                        <span className="storage-facility-detail-card__device-state"><i aria-hidden="true" />{sensor.activated ? "Device active" : "Device inactive"}</span>
                      </div>

                      <span className="storage-facility-detail-card__action"><span>Open sensor readings</span><ArrowLeft aria-hidden="true" className="rotate-180" /></span>
                    </CardContent>
                  </Card>
                </button>
              )
            })}
          </div>
        )}

        {asset?.latitude != null && asset?.longitude != null && (
          <Card className="border-slate-200/70 bg-white shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm text-slate-600 font-mono">
                <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
                <span>{asset.latitude.toFixed(6)}°, {asset.longitude.toFixed(6)}°</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // No such sensor on this {assetNoun} — fall back to the list
  // ═══════════════════════════════════════════════════════════════════════
  if (!selected) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <Button
          variant="ghost"
          onClick={() => router.push(assetBasePath)}
          className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to sensors
        </Button>
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="py-16 text-center text-sm text-slate-500">
            Sensor not found on this {assetNoun}.
          </CardContent>
        </Card>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Water-level readings view (existing visual + metrics + table)
  // ═══════════════════════════════════════════════════════════════════════
  if (selectedCategory === "water_level") {
    return (
      <>
        <WaterLevelReadingsView
          assetName={assetName}
          assetNoun={assetNoun}
          sensor={selected}
          readings={readings}
          asset={asset ?? null}
          lengthOverride={lengthOverride}
          onAnalytics={() => router.push(`${assetBasePath}/analytics?sensor=${selected.id}`)}
          onBack={() => router.push(assetBasePath)}
        />
      </>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Water-quality readings view (parameter cards + history)
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <>
      <WaterQualityReadingsView
        assetName={assetName}
        assetNoun={assetNoun}
        sensor={selected}
        readings={readings}
        asset={asset ?? null}
        onAnalytics={() => router.push(`${assetBasePath}/water-quality-analytics?sensor=${selected.id}`)}
        onBack={() => router.push(assetBasePath)}
      />
    </>
  )
}

// ─── Water level view ────────────────────────────────────────────────────────

function WaterLevelReadingsView({
  assetName,
  assetNoun,
  sensor,
  readings,
  asset,
  lengthOverride,
  onAnalytics,
  onBack,
}: {
  assetName: string
  assetNoun: string
  sensor: SensorSnap
  readings: SensorReadingRow[]
  asset: { latitude: number | null; longitude: number | null } | null
  lengthOverride: number | null
  onAnalytics: () => void
  onBack: () => void
}) {
  const [readingQuery, setReadingQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const latest = sensor.lastReading ?? null
  const status = latest?.status ?? sensor.status ?? "inactive"
  const storageFacilityLength = storageFacilityLengthFor(sensor, lengthOverride)
  const h1 = Number(sensor.config?.h1M ?? sensor.config?.h1_m) || 0
  const depthDefault = Number(sensor.config?.depthM ?? sensor.config?.depth_m) || 0
  const currentHeight = latest?.waterLevelM ?? null
  const currentDepth = latest?.depthM ?? (depthDefault || null)
  const capacity = storageFacilityLength > 0 ? storageFacilityLength : null
  const fillPercent = capacity && currentHeight != null ? Math.max(0, Math.min(100, (currentHeight / capacity) * 100)) : null
  const lastReadingLabel = latest ? formatTanzaniaDateTime(latest.occurredAt) : "No readings yet"
  const coordsLabel =
    asset?.latitude != null && asset?.longitude != null
      ? `${asset.latitude.toFixed(6)}°, ${asset.longitude.toFixed(6)}°`
      : null

  const summary = useMemo(() => {
    const heights = readings.map((r) => r.waterLevelM).filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    return {
      avg: heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : null,
      max: heights.length ? Math.max(...heights) : null,
      min: heights.length ? Math.min(...heights) : null,
    }
  }, [readings])

  // Filters operate over the full loaded history.
  const statusChoices = useMemo(() => {
    const choices = new Set<string>()
    for (const reading of readings) if (reading.status) choices.add(String(reading.status))
    return Array.from(choices)
  }, [readings])

  const hasFilters =
    readingQuery.trim() !== "" || statusFilter !== "all" || Boolean(dateFrom || dateTo)

  const filtered = useMemo(() => {
    const query = readingQuery.trim().toLowerCase()
    const hasDateFilter = Boolean(dateFrom || dateTo)
    // Dates are interpreted in Tanzania time (UTC+3, no DST) so the range
    // matches the timestamps as displayed by formatTanzaniaDateTime.
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00+03:00`).getTime() : Number.NEGATIVE_INFINITY
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999+03:00`).getTime() : Number.POSITIVE_INFINITY
    return readings.filter((reading) => {
      if (statusFilter !== "all" && String(reading.status ?? "") !== statusFilter) return false
      if (hasDateFilter) {
        const at = new Date(reading.occurredAt).getTime()
        if (Number.isNaN(at) || at < fromMs || at > toMs) return false
      }
      if (!query) return true
      return [
        formatTanzaniaDateTime(reading.occurredAt),
        String(reading.status ?? ""),
        reading.waterLevelM?.toFixed(2),
        reading.h1M?.toFixed(2),
        reading.depthM?.toFixed(2),
      ].some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [readings, statusFilter, dateFrom, dateTo, readingQuery])

  // Pagination over the filtered set: clamp the current page whenever the
  // filters or page size change so the table never shows an empty page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageStart + pageSize),
    [filtered, pageStart, pageSize],
  )

  useEffect(() => {
    setPage(1)
  }, [readingQuery, statusFilter, dateFrom, dateTo, pageSize])

  const clearFilters = () => {
    setReadingQuery("")
    setStatusFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  const exportReadings = () => {
    const headers = ["Time", "Water height", "Height (ft)", "h1", "h2", "Status"]
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`
    const lines = filtered.map((reading) => [
      formatTanzaniaDateTime(reading.occurredAt),
      reading.waterLevelM == null ? "" : reading.waterLevelM.toFixed(2),
      reading.waterLevelM == null ? "" : (reading.waterLevelM * 3.28084).toFixed(2),
      reading.h1M == null ? "" : reading.h1M.toFixed(2),
      reading.depthM == null ? "" : reading.depthM.toFixed(2),
      reading.status ?? "",
    ])
    const csv = [headers, ...lines].map((row) => row.map(escape).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${sensor.deviceId}-water-level-readings.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="sensor-level-page flex min-w-0 flex-col gap-5">
      {/* Page heading: title block left, actions right */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="sensor-level-title-mark"><Waves className="h-6 w-6" /></span>
          <div className="min-w-0">
            <h1 className="sensor-level-title">Water Level Monitoring</h1>
            <p className="sensor-level-subtitle">Real-time water height and sensor readings for the selected {assetNoun}.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack} className="rounded-xl">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Sensors
          </Button>
          <Button variant="default" onClick={onAnalytics} className="rounded-xl shadow-sm shadow-primary/20">
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Analytics
          </Button>
        </div>
      </div>

      {/* Facility identity banner */}
      <Card className="border-slate-200/70 bg-white shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
              <Droplets className="h-5 w-5" />
            </span>
            <strong className="min-w-0 truncate text-slate-900" title={assetName}>
              {assetName}
            </strong>
            <WaterStatusPill status={status} />
          </div>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <SensorIcon className="h-4 w-4 shrink-0 text-cyan-600" />
            <span>Sensor ID:</span>
            <strong className="font-mono font-semibold text-slate-800">{sensor.deviceId}</strong>
          </div>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
            <span className="font-mono">{coordsLabel ?? "Coordinates unavailable"}</span>
          </div>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Calendar className="h-4 w-4 shrink-0 text-cyan-600" />
            <span>Last reading:</span>
            <strong className="font-semibold text-slate-800">{lastReadingLabel}</strong>
          </div>
        </CardContent>
      </Card>

      <section className="sensor-level-overview">
        <Card className="sensor-level-gauge-card">
          <CardContent className="sensor-level-gauge-content p-0">
            {/* Headline reading + identifying facts */}
            <div className="sensor-level-current">
              <p className="sensor-level-label">Current Height</p>
              <p className="sensor-level-current-value">
                {currentHeight == null ? "—" : currentHeight.toFixed(2)}
                <span>m</span>
              </p>
              <span className="sensor-level-fill-chip">
                {fillPercent == null
                  ? "No level data"
                  : `${fillPercent.toFixed(1)}% of ${capacity?.toFixed(2)} m`}
              </span>
              <div className="sensor-level-current-foot">
                <span>
                  <Ruler />
                  <span>Facility height:</span>
                  <b>{capacity == null ? "—" : `${capacity.toFixed(2)} m`}</b>
                </span>
                <span>
                  <Radio />
                  <span>Sensor:</span>
                  <b>{sensor.deviceId}</b>
                </span>
              </div>
            </div>

            {/* Horizontal fill gauge with floating value bubble */}
            <div className="sensor-level-scale-wrap">
              <p className="sensor-level-scale-heading">Water Level (Height)</p>
              <div className="sensor-level-ruler-labels">
                {[0, 25, 50, 75, 100].map((tick) => (
                  <span key={tick}>
                    {capacity == null
                      ? `${tick}%`
                      : `${((capacity * tick) / 100).toFixed(2)} m`}
                  </span>
                ))}
              </div>
              <div
                className={cn(
                  "sensor-level-ruler-zone",
                  fillPercent == null && "sensor-level-ruler-zone--empty",
                )}
              >
                <div
                  className="sensor-level-ruler"
                  role="img"
                  aria-label={
                    fillPercent == null
                      ? "Water level unavailable"
                      : assetNoun === "water source"
                        ? `Water level is ${fillPercent.toFixed(1)} percent full`
                        : `Tank is ${fillPercent.toFixed(1)} percent full`
                  }
                >
                  <div className="sensor-level-ruler-fill" style={{ width: `${fillPercent ?? 0}%` }} />
                  {[25, 50, 75].map((tick) => (
                    <i key={tick} className="sensor-level-ruler-tick" style={{ left: `${tick}%` }} />
                  ))}
                  {fillPercent != null && (
                    <div className="sensor-level-ruler-marker" style={{ left: `${fillPercent}%` }}>
                      <span className="sensor-level-ruler-bubble">{currentHeight?.toFixed(2)} m</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="sensor-level-ruler-percent">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
              <div className="sensor-level-scale-note">
                <Info aria-hidden="true" />
                <span>
                  Height filled:{" "}
                  <strong>{fillPercent == null ? "—" : `${fillPercent.toFixed(1)}%`}</strong>
                </span>
                <i className="sensor-level-scale-note-separator" aria-hidden="true" />
                <span>
                  Remaining height:{" "}
                  <strong>
                    {capacity != null && currentHeight != null
                      ? `${Math.max(0, capacity - currentHeight).toFixed(2)} m`
                      : "—"}
                  </strong>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="sensor-level-metrics">
          <MetricTile icon={Ruler} label="Facility height" value={capacity == null ? "—" : `${capacity.toFixed(2)} m`} />
          <MetricTile icon={Radio} label="Sensor h1" value={h1 ? `${h1.toFixed(2)} m` : "—"} />
          <MetricTile icon={Radio} label="Sensor h2" value={currentDepth == null ? "—" : `${currentDepth.toFixed(2)} m`} />
          <MetricTile icon={Activity} label="Average height" value={summary.avg == null ? "—" : `${summary.avg.toFixed(2)} m`} />
          <MetricTile icon={TrendingUp} label="Maximum height" value={summary.max == null ? "—" : `${summary.max.toFixed(2)} m`} />
          <MetricTile icon={TrendingDown} label="Minimum height" value={summary.min == null ? "—" : `${summary.min.toFixed(2)} m`} />
          <MetricTile icon={Database} label="Total readings" value={String(readings.length)} wide />
        </div>
      </section>

      <Card className="sensor-level-history-card">
        <CardContent className="sensor-level-history-content p-0">
          <div className="sensor-level-history-heading">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                <Database className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-800">Historical Readings</h2>
                <p className="text-xs text-slate-500">Water level readings and sensor measurements over time.</p>
              </div>
            </div>
            <Button
              variant="default"
              onClick={exportReadings}
              disabled={filtered.length === 0}
              className="rounded-xl shadow-sm shadow-primary/20"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export CSV
            </Button>
          </div>

          <div className="sensor-level-table-tools">
            <label className="sensor-level-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                aria-label="Search readings"
                placeholder="Search readings..."
                value={readingQuery}
                onChange={(event) => setReadingQuery(event.target.value)}
              />
            </label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter by status" className="sensor-level-filter-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusChoices.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {choice.charAt(0).toUpperCase() + choice.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              aria-label="From date"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <input
              aria-label="To date"
              type="date"
              min={dateFrom || undefined}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5">
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            )}
          </div>

          {readings.length === 0 ? (
            <div className="sensor-level-empty">
              <Droplets className="mx-auto mb-3 h-6 w-6" />
              <strong>No readings yet</strong>
              <p className="mt-1 text-xs">New measurements will appear here when this sensor reports.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="sensor-level-empty">
              <Search className="mx-auto mb-3 h-6 w-6" />
              <strong>No matching readings</strong>
              <p className="mt-1 text-xs">Try another timestamp, height, or status.</p>
            </div>
          ) : (
            <div className="sensor-level-table-scroll">
              <table className="sensor-level-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Water height</th>
                    <th>Height (ft)</th>
                    <th>h1</th>
                    <th>h2</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((reading) => {
                    const feet = reading.waterLevelM != null ? reading.waterLevelM * 3.28084 : null
                    return (
                      <tr key={reading.readingId}>
                        <td className="whitespace-nowrap">{formatTanzaniaDateTime(reading.occurredAt)}</td>
                        <td className="sensor-level-table-value">
                          {reading.waterLevelM == null ? "—" : `${reading.waterLevelM.toFixed(2)}m`}
                        </td>
                        <td>{feet == null ? "—" : `${feet.toFixed(2)}ft`}</td>
                        <td>{reading.h1M == null ? "—" : `${reading.h1M.toFixed(2)}m`}</td>
                        <td>{reading.depthM == null ? "—" : `${reading.depthM.toFixed(2)}m`}</td>
                        <td><WaterStatusPill status={reading.status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="sensor-level-history-footer">
            <span>
              {filtered.length === 0
                ? "Showing 0 readings"
                : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length} readings`}
            </span>
            <div className="flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                Rows
                <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                  <SelectTrigger aria-label="Rows per page" className="sensor-level-filter-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
              <button
                type="button"
                aria-label="Previous page"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {tablePageNumbers(currentPage, pageCount).map((entry, index) =>
                entry === "…" ? (
                  <span key={`gap-${index}`} className="px-1 text-slate-400" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    aria-label={`Page ${entry}`}
                    aria-current={entry === currentPage ? "page" : undefined}
                    onClick={() => setPage(entry)}
                    data-active={entry === currentPage ? "" : undefined}
                  >
                    {entry}
                  </button>
                ),
              )}
              <button
                type="button"
                aria-label="Next page"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MetricTile({ icon: Icon, label, value, wide = false }: { icon: LucideIcon; label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("sensor-level-metric", wide && "sensor-level-metric-wide")}>
      <span className="sensor-level-metric-icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="min-w-0">
        <span className="sensor-level-metric-label">{label}</span>
        <strong className="sensor-level-metric-value">{value}</strong>
      </div>
    </div>
  )
}

// ─── Water quality view ──────────────────────────────────────────────────────

function WaterQualityReadingsView({
  assetName,
  assetNoun,
  sensor,
  readings,
  asset,
  onAnalytics,
  onBack,
}: {
  assetName: string
  assetNoun: string
  sensor: SensorSnap
  readings: SensorReadingRow[]
  asset: { latitude: number | null; longitude: number | null } | null
  onAnalytics: () => void
  onBack: () => void
}) {
  const [readingQuery, setReadingQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)

  const latest = sensor.lastReading ?? null
  const status = latest?.status ?? sensor.status ?? "inactive"
  const latestParams = latest?.parameters ?? {}
  const lastReadingLabel = latest ? formatTanzaniaDateTime(latest.occurredAt) : "No readings yet"

  // Normalise every key once: readings + latest may arrive camelCased
  // (temperatureC) while our maps are keyed snake_case (temperature_c).
  // Columns render in the canonical reference order; unknown keys trail last.
  const paramKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of readings)
      for (const k of Object.keys(r.parameters ?? {})) keys.add(wqKey(k))
    for (const k of Object.keys(latestParams)) keys.add(wqKey(k))
    const rank = (k: string) => {
      const index = WQ_PARAM_ORDER.indexOf(k)
      return index === -1 ? WQ_PARAM_ORDER.length : index
    }
    return Array.from(keys).sort((a, b) => rank(a) - rank(b))
  }, [readings, latestParams])

  // Filters operate over the full loaded history.
  const statusChoices = useMemo(() => {
    const choices = new Set<string>()
    for (const reading of readings) if (reading.status) choices.add(String(reading.status))
    return Array.from(choices)
  }, [readings])

  const hasFilters =
    readingQuery.trim() !== "" || statusFilter !== "all" || Boolean(dateFrom || dateTo)

  const filtered = useMemo(() => {
    const query = readingQuery.trim().toLowerCase()
    const hasDateFilter = Boolean(dateFrom || dateTo)
    // Dates are interpreted in Tanzania time (UTC+3, no DST) so the range
    // matches the timestamps as displayed by formatTanzaniaDateTime.
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00+03:00`).getTime() : Number.NEGATIVE_INFINITY
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999+03:00`).getTime() : Number.POSITIVE_INFINITY
    return readings.filter((reading) => {
      if (statusFilter !== "all" && String(reading.status ?? "") !== statusFilter) return false
      if (hasDateFilter) {
        const at = new Date(reading.occurredAt).getTime()
        if (Number.isNaN(at) || at < fromMs || at > toMs) return false
      }
      if (!query) return true
      const haystack = [
        formatTanzaniaDateTime(reading.occurredAt),
        String(reading.status ?? ""),
        ...paramKeys.map((key) => String(paramValue(reading.parameters, key) ?? "")),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [readings, statusFilter, dateFrom, dateTo, readingQuery, paramKeys])

  // Pagination over the filtered set: clamp the current page whenever the
  // filters or page size change so the table never shows an empty page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageStart + pageSize),
    [filtered, pageStart, pageSize],
  )

  useEffect(() => {
    setPage(1)
  }, [readingQuery, statusFilter, dateFrom, dateTo, pageSize])

  const paramGroups = useMemo(() => {
    const assigned = new Set<string>()
    const groups = WQ_PARAM_GROUPS.map((group) => ({
      ...group,
      keys: group.keys.filter((key) => paramKeys.includes(key)),
    })).filter((group) => group.keys.length > 0)
    for (const group of groups) for (const key of group.keys) assigned.add(key)
    const unassigned = paramKeys.filter((key) => !assigned.has(key))
    if (unassigned.length > 0) groups.push({ label: "Other readings", icon: Activity, keys: unassigned })
    return groups
  }, [paramKeys])

  const showAlert = ["warning", "critical"].includes(String(status).toLowerCase())
  const statusRaw = String(status).replace(/[_-]/g, " ")
  const statusLabel = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1)
  const coordsLabel =
    asset?.latitude != null && asset?.longitude != null
      ? `${asset.latitude.toFixed(6)}°, ${asset.longitude.toFixed(6)}°`
      : null

  const clearFilters = () => {
    setReadingQuery("")
    setStatusFilter("all")
    setDateFrom("")
    setDateTo("")
  }

  const exportReadings = () => {
    const header = [
      "Time",
      ...paramKeys.map((key) => (wqUnit(key) ? `${wqLabel(key)} (${wqUnit(key)})` : wqLabel(key))),
      "Status",
    ]
    const rows = filtered.map((reading) => [
      formatTanzaniaDateTime(reading.occurredAt),
      ...paramKeys.map((key) => paramValue(reading.parameters, key) ?? ""),
      reading.status ?? "",
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${sensor.deviceId}-water-quality-readings.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* Page heading: title block left, actions right */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="sensor-level-title-mark">
            <FlaskConical className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="sensor-level-title">Water Quality Monitoring</h1>
            <p className="sensor-level-subtitle">Real-time water quality readings for the selected {assetNoun}.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack} className="rounded-xl">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Sensors
          </Button>
          <Button variant="default" onClick={onAnalytics} className="rounded-xl shadow-sm shadow-primary/20">
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Analytics
          </Button>
        </div>
      </div>

      {/* Facility identity banner */}
      <Card className="border-slate-200/70 bg-white shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
              <Droplets className="h-5 w-5" />
            </span>
            <strong className="min-w-0 truncate text-slate-900" title={assetName}>
              {assetName}
            </strong>
            <WaterStatusPill status={status} />
          </div>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <SensorIcon className="h-4 w-4 shrink-0 text-cyan-600" />
            <span>Sensor ID:</span>
            <strong className="font-mono font-semibold text-slate-800">{sensor.deviceId}</strong>
          </div>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
            <span className="font-mono">{coordsLabel ?? "Coordinates unavailable"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Status alert — rendered only for warning/critical readings */}
      {showAlert && (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 sm:px-5"
          aria-label="Water quality alert"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900">Water quality requires attention</h2>
              <p className="text-xs text-slate-600">
                The latest reading is flagged as {statusLabel}. Review the measurements below.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-amber-700" />
              Last reading: <b className="font-semibold text-slate-800">{lastReadingLabel}</b>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Database className="h-4 w-4 text-amber-700" />
              Total readings: <b className="font-semibold text-slate-800">{readings.length}</b>
            </span>
          </div>
        </section>
      )}

      {/* Latest readings grouped by parameter family */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4" aria-label="Latest parameter readings">
        {paramGroups.length === 0 && (
          <Card className="col-span-full border-slate-200/70 bg-white shadow-sm">
            <CardContent className="py-10 text-center text-sm text-slate-500">
              No water-quality readings recorded for this sensor yet.
            </CardContent>
          </Card>
        )}
        {paramGroups.map((group) => (
          <Card key={group.label} className="min-w-0 p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700">
                  <group.icon className="h-4 w-4" />
                </span>
                <h2 className="truncate text-sm font-bold text-slate-800">{group.label}</h2>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {group.keys.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {group.keys.map((key) => {
                const meta = WQ_PARAM_META[key]
                const Icon = meta?.icon
                const value = paramValue(latestParams, key)
                const unit = wqUnit(key)
                return (
                  <article key={key} className="sensor-quality-metric-card">
                    <span
                      className={cn("sensor-quality-metric-icon", meta?.tile?.tint ?? meta?.tint ?? "text-cyan-600 bg-cyan-50")}
                      aria-hidden="true"
                    >
                      {meta?.tile ? (
                        <span className="font-bold leading-none">{meta.tile.text}</span>
                      ) : Icon ? (
                        <Icon className="h-4 w-4" strokeWidth={1.9} />
                      ) : (
                        <Droplets className="h-4 w-4" strokeWidth={1.9} />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="sensor-quality-metric-label">{meta?.label ?? wqLabel(key)}</p>
                      <p className={cn("sensor-quality-metric-value", meta?.chip ?? "text-cyan-700")}>
                        {value == null ? "—" : `${value}${unit ? ` ${unit}` : ""}`}
                      </p>
                    </div>
                  </article>
                )
              })}
            </div>
          </Card>
        ))}
      </section>

      {/* Historical readings — full history, client-side pagination */}
      <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="sensor-level-history-heading">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                <Database className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-800">Historical Readings</h2>
                <p className="text-xs text-slate-500">Recorded water quality measurements from this sensor.</p>
              </div>
            </div>
            <Button
              variant="default"
              onClick={exportReadings}
              disabled={filtered.length === 0}
              className="rounded-xl shadow-sm shadow-primary/20"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export CSV
            </Button>
          </div>

          <div className="sensor-level-table-tools">
            <label className="sensor-level-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                aria-label="Search readings"
                placeholder="Search readings..."
                value={readingQuery}
                onChange={(event) => setReadingQuery(event.target.value)}
              />
            </label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter by status" className="sensor-level-filter-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusChoices.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {choice.charAt(0).toUpperCase() + choice.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              aria-label="From date"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <input
              aria-label="To date"
              type="date"
              min={dateFrom || undefined}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5">
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            )}
          </div>

          {readings.length === 0 ? (
            <div className="sensor-level-empty">No readings found for this sensor yet.</div>
          ) : filtered.length === 0 ? (
            <div className="sensor-level-empty">No readings match the current filters.</div>
          ) : (
            <div className="relative px-5">
              <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-100 [scrollbar-width:thin]">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="sticky left-0 z-10 bg-white pb-3 pl-4 pr-4 font-medium whitespace-nowrap">
                        Time
                      </th>
                      {paramKeys.map((key) => {
                        const unit = wqUnit(key)
                        return (
                          <th key={key} className="pb-3 pr-4 font-medium whitespace-nowrap">
                            {wqLabel(key)}
                            {unit ? <span className="ml-1 font-normal text-slate-400">({unit})</span> : null}
                          </th>
                        )
                      })}
                      <th className="sticky right-0 z-10 bg-white pb-3 pl-4 pr-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((reading) => (
                      <tr key={reading.readingId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                        <td className="sticky left-0 z-10 bg-white py-3 pl-4 pr-4 whitespace-nowrap text-slate-600">
                          {formatTanzaniaDateTime(reading.occurredAt)}
                        </td>
                        {paramKeys.map((key) => (
                          <td key={key} className="py-3 pr-4 whitespace-nowrap text-slate-700">
                            {paramValue(reading.parameters, key) ?? "—"}
                          </td>
                        ))}
                        <td className="sticky right-0 z-10 bg-white py-3 pl-4 pr-4">
                          <WaterStatusPill status={reading.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Fade hint that the table scrolls sideways on small screens */}
              <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
            </div>
          )}

          <div className="sensor-level-history-footer">
            <span>
              {filtered.length === 0
                ? "Showing 0 readings"
                : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length} readings`}
            </span>
            <div className="flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                Rows
                <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                  <SelectTrigger aria-label="Rows per page" className="sensor-level-filter-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
              <button
                type="button"
                aria-label="Previous page"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {tablePageNumbers(currentPage, pageCount).map((entry, index) =>
                entry === "…" ? (
                  <span key={`gap-${index}`} className="px-1 text-slate-400" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    aria-label={`Page ${entry}`}
                    aria-current={entry === currentPage ? "page" : undefined}
                    onClick={() => setPage(entry)}
                    data-active={entry === currentPage ? "" : undefined}
                  >
                    {entry}
                  </button>
                ),
              )}
              <button
                type="button"
                aria-label="Next page"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

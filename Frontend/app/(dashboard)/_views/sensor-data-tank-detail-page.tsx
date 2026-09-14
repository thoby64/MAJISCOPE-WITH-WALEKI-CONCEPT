"use client"

import type { ChangeEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Activity, ArrowLeft, Calendar, Clock, Droplets, FlaskConical, GlassWater, Gauge, Leaf, MapPin, Pencil, Plus, RefreshCw, Ruler, Thermometer, TrendingUp, Waves } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { SensorIcon } from "@/components/icons/sensor-icon"
import { useDataStore, type SensorCategory, type SensorSnap, type TankReading } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WaterLevelTank } from "@/components/water-level/water-level-tank"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import {
  READING_HISTORY_LIMIT,
  WATER_LEVEL_POLL_INTERVAL_MS,
  readStoredTankLength,
  stashTankLength,
  tankLengthFor,
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

function sensorSummary(sensor: SensorSnap): string {
  const lr = sensor.lastReading
  if (!lr) return "No readings yet"
  if (lr.category === "water_quality" && lr.parameters) {
    const entries = Object.entries(lr.parameters).slice(0, 2)
    return entries.map(([k, v]) => `${wqLabel(k)}: ${v}`).join(" · ")
  }
  if (lr.waterLevelM != null) return `Level ${lr.waterLevelM.toFixed(2)} m`
  return "No readings yet"
}

export default function WaterLevelTankDetailPage() {
  const router = useRouter()
  const params = useParams<{ tankId: string }>()
  const tankId = Array.isArray(params?.tankId) ? params.tankId[0] : params?.tankId
  const searchParams = useSearchParams()
  const selectedSensorId = searchParams.get("sensor")

  const { sensors, tanks, tankReadingsByTank, fetchSensors, fetchTanks, fetchTankReadings } = useDataStore()

  const [lengthOverride, setLengthOverride] = useState<number | null>(() =>
    tankId ? readStoredTankLength(tankId) : null
  )

  const { currentUser } = useAuthStore()
  const [registerOpen, setRegisterOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const canRegister = currentUser?.role === "admin" || currentUser?.role === "utility_manager"

  const tankSensors = useMemo(
    () => sensors.filter((s) => s.tankId === tankId),
    [sensors, tankId]
  )

  const selected: SensorSnap | undefined = useMemo(
    () => tankSensors.find((s) => s.id === selectedSensorId) ?? undefined,
    [tankSensors, selectedSensorId]
  )

  const selectedCategory: SensorCategory = selected?.category ?? "water_level"

  useEffect(() => {
    if (!tankId) return
    void fetchSensors()
    void fetchTanks()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSensors()
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [tankId, fetchSensors, fetchTanks])

  useEffect(() => {
    if (!tankId || !selectedSensorId || !selected) return
    void fetchTankReadings(tankId, READING_HISTORY_LIMIT, selectedCategory)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchTankReadings(tankId, READING_HISTORY_LIMIT, selectedCategory)
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [tankId, selectedSensorId, selectedCategory, selected, fetchTankReadings])

  const tank = useMemo(() => tanks.find((t) => t.id === tankId), [tanks, tankId])
  const tankName = tank?.name || selected?.tankName || tankId || "Tank"

  const readings: TankReading[] = useMemo(
    () => (tankId ? tankReadingsByTank[`${tankId}:${selectedCategory}`] ?? [] : []),
    [tankReadingsByTank, tankId, selectedCategory]
  )

  // ═══════════════════════════════════════════════════════════════════════
  // Sensor list view (first load) — card grid, one card per sensor
  // ═══════════════════════════════════════════════════════════════════════
  if (!selectedSensorId) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            onClick={() => router.push("/dashboard/sensor-data")}
            className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to monitoring
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800">{tankName}</h1>
            {tank && <WaterStatusPill status={tank.status} />}
          </div>
          <p className="text-sm text-slate-500">
            Sensors linked to this storage facility. Select a sensor to view its readings.
          </p>
          {canRegister && (
            <Button size="sm" onClick={() => setRegisterOpen(true)} className="w-fit rounded-xl">
              <Plus className="mr-1.5 h-4 w-4" />
              Register sensor
            </Button>
          )}
        </div>

        {tankSensors.length === 0 ? (
          <Card className="border-slate-200/70 bg-white shadow-sm">
            <CardContent className="py-16 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                  <Droplets className="h-8 w-8 text-slate-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-800">No sensors registered</p>
                  <p className="mt-1 text-sm text-slate-500">
                    This tank does not have any sensor registered yet.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tankSensors.map((sensor) => {
              const lr = sensor.lastReading
              return (
                <button
                  key={sensor.id}
                  onClick={() =>
                    router.push(`/dashboard/sensor-data/${tankId}?sensor=${sensor.id}`)
                  }
                  className="group text-left"
                >
                  <Card className="h-full border-slate-200/70 bg-white shadow-sm transition-all group-hover:border-cyan-300 group-hover:shadow-md">
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-center gap-2">
                        {categoryIcon(sensor.category)}
                        <span className="text-sm font-semibold text-slate-800">
                          {categoryLabel(sensor.category)}
                        </span>
{categoryIcon(sensor.category)}
                        <span className="text-sm font-semibold text-slate-800">
                          {categoryLabel(sensor.category)}
                        </span>
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${
                            sensor.activated
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {sensor.activated ? "active" : "inactive"}
                        </span>
                      </div>
                      <div className="font-mono text-sm text-slate-600">{sensor.deviceId}</div>
                      <div className="text-sm font-medium text-slate-800">{sensorSummary(sensor)}</div>
                      <div className="mt-auto flex items-center justify-between text-xs text-slate-500">
                        <span>
                          {lr ? `Updated ${formatTanzaniaDateTime(lr.occurredAt)}` : "Awaiting data"}
                        </span>
                        <WaterStatusPill status={sensor.status} />
                      </div>
                    </CardContent>
                  </Card>
                </button>
              )
            })}
          </div>
        )}

        {tank?.latitude != null && tank?.longitude != null && (
          <Card className="border-slate-200/70 bg-white shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm text-slate-600 font-mono">
                <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
                <span>{tank.latitude.toFixed(6)}°, {tank.longitude.toFixed(6)}°</span>
              </div>
            </CardContent>
          </Card>
        )}
        <RegisterSensorModal open={registerOpen} onOpenChange={setRegisterOpen} defaultTankId={tankId} />
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // No such sensor on this tank — fall back to the list
  // ═══════════════════════════════════════════════════════════════════════
  if (!selected) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <Button
          variant="ghost"
          onClick={() => router.push(`/dashboard/sensor-data/${tankId}`)}
          className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to sensors
        </Button>
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="py-16 text-center text-sm text-slate-500">
            Sensor not found on this tank.
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
          tankId={tankId ?? ""}
          tankName={tankName}
          sensor={selected}
          readings={readings}
          tank={tank ?? null}
          lengthOverride={lengthOverride}
          canEdit={canRegister}
          onEdit={() => setEditOpen(true)}
          onLengthChange={(v) => {
            setLengthOverride(v)
            if (tankId) stashTankLength(tankId, v)
          }}
          onBack={() => router.push(`/dashboard/sensor-data/${tankId}`)}
        />
        <RegisterSensorModal open={editOpen} onOpenChange={setEditOpen} sensor={selected} />
      </>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Water-quality readings view (parameter cards + history)
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <>
      <WaterQualityReadingsView
        tankName={tankName}
        sensor={selected}
        readings={readings}
        tank={tank ?? null}
        canEdit={canRegister}
        onEdit={() => setEditOpen(true)}
        onBack={() => router.push(`/dashboard/sensor-data/${tankId}`)}
      />
      <RegisterSensorModal open={editOpen} onOpenChange={setEditOpen} sensor={selected} />
    </>
  )
}

// ─── Water level view ────────────────────────────────────────────────────────

function WaterLevelReadingsView({
  tankId,
  tankName,
  sensor,
  readings,
  tank,
  lengthOverride,
  canEdit,
  onEdit,
  onLengthChange,
  onBack,
}: {
  tankId: string
  tankName: string
  sensor: SensorSnap
  readings: TankReading[]
  tank: { latitude: number | null; longitude: number | null } | null
  lengthOverride: number | null
  canEdit: boolean
  onEdit: () => void
  onLengthChange: (value: number) => void
  onBack: () => void
}) {
  const latest = sensor.lastReading ?? null
  const status = latest?.status ?? sensor.status ?? "inactive"
  const tankLength = tankLengthFor(sensor, lengthOverride)
  const h1 = (sensor.config?.h1M ?? sensor.config?.h1_m) as number | undefined ?? 0
  const depthDefault = (sensor.config?.depthM ?? sensor.config?.depth_m) as number | undefined ?? 0

  const summary = useMemo(() => {
    const heights = readings.map((r) => r.waterLevelM ?? 0)
    return {
      avg: heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0,
      max: heights.length ? Math.max(...heights) : 0,
    }
  }, [readings])

  function handleLengthChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Number.parseFloat(event.target.value)
    if (!Number.isFinite(next) || next <= 0) return
    onLengthChange(Number.parseFloat(next.toFixed(2)))
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" onClick={onBack} className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to sensors
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">{tankName}</h1>
          <WaterStatusPill status={status} />
        </div>
        <p className="text-sm text-slate-500">
          Water level readings from <span className="font-mono">{sensor.deviceId}</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <WaterLevelTank
          tankName={tankName}
          waterHeightM={latest?.waterLevelM ?? 0}
          tankDepthM={tankLength}
          sensorHangingM={h1}
          sensorDepthM={latest?.depthM ?? depthDefault}
          status={status}
          readingCount={readings.length}
          lastReadingLabel={latest ? formatTanzaniaDateTime(latest.occurredAt) : "No readings yet"}
        />

        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-800">Sensor details</h2>
              {canEdit && (
                <Button size="sm" variant="outline" className="rounded-xl" onClick={onEdit}>
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit sensor
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Current height</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(latest?.waterLevelM ?? 0).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Ruler className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Tank length</span>
                <label className="ml-auto flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={tankLength}
                    onChange={handleLengthChange}
                    className="h-8 w-20 rounded-lg px-2 text-right text-sm"
                  />
                  <strong className="text-sm font-semibold text-slate-800">m</strong>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Ruler className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor h1</span>
                <strong className="ml-auto font-semibold text-slate-800">{h1.toFixed(2)}m</strong>
              </div>
              <div className="flex items-center gap-3">
                <Gauge className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor h2</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(latest?.depthM ?? depthDefault).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Activity className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Average height</span>
                <strong className="ml-auto font-semibold text-slate-800">{summary.avg.toFixed(2)}m</strong>
              </div>
              <div className="flex items-center gap-3">
                <TrendingUp className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Maximum height</span>
                <strong className="ml-auto font-semibold text-slate-800">{summary.max.toFixed(2)}m</strong>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Total readings</span>
                <strong className="ml-auto font-semibold text-slate-800">{readings.length}</strong>
              </div>
              <div className="flex items-center gap-3">
                <SensorIcon className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor ID</span>
                <strong className="ml-auto font-mono font-semibold text-slate-800">{sensor.deviceId}</strong>
              </div>
              {tank?.latitude != null && tank?.longitude != null && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
                  <span className="text-sm text-slate-500">Coordinates</span>
                  <strong className="ml-auto font-mono font-semibold text-slate-800">
                    {tank.latitude.toFixed(6)}°, {tank.longitude.toFixed(6)}°
                  </strong>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-slate-800">Recent readings</h2>
          </div>
          {readings.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No readings found for this sensor yet.</p>
          ) : (
            <div className="relative mt-4 max-w-full">
              <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-100 [scrollbar-width:thin]">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="sticky left-0 z-10 bg-white pb-3 pl-4 pr-4 font-medium whitespace-nowrap">Time</th>
                      <th className="pb-3 pr-4 font-medium whitespace-nowrap">Water height</th>
                      <th className="pb-3 pr-4 font-medium whitespace-nowrap">Height (ft)</th>
                      <th className="pb-3 pr-4 font-medium whitespace-nowrap">h1</th>
                      <th className="pb-3 pr-4 font-medium whitespace-nowrap">h2</th>
                      <th className="sticky right-0 z-10 bg-white pb-3 pl-4 pr-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.slice(0, 30).map((reading) => (
                      <tr key={reading.readingId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                        <td className="sticky left-0 z-10 bg-white py-3 pl-4 pr-4 whitespace-nowrap text-slate-600">
                          {formatTanzaniaDateTime(reading.occurredAt)}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap font-medium text-slate-800">{(reading.waterLevelM ?? 0).toFixed(2)}m</td>
                        <td className="py-3 pr-4 whitespace-nowrap text-slate-500">{((reading.waterLevelM ?? 0) * 3.28084).toFixed(2)}ft</td>
                        <td className="py-3 pr-4 whitespace-nowrap text-slate-500">{(reading.h1M ?? 0).toFixed(2)}m</td>
                        <td className="py-3 pr-4 whitespace-nowrap text-slate-500">{(reading.depthM ?? 0).toFixed(2)}m</td>
                        <td className="sticky right-0 z-10 bg-white py-3 pl-4 pr-4">
                          <WaterStatusPill status={reading.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Water quality view ──────────────────────────────────────────────────────

function WaterQualityReadingsView({
  tankName,
  sensor,
  readings,
  tank,
  canEdit,
  onEdit,
  onBack,
}: {
  tankName: string
  sensor: SensorSnap
  readings: TankReading[]
  tank: { latitude: number | null; longitude: number | null } | null
  canEdit: boolean
  onEdit: () => void
  onBack: () => void
}) {
  const latest = sensor.lastReading ?? null
  const status = latest?.status ?? sensor.status ?? "inactive"
  const latestParams = latest?.parameters ?? {}
  // Normalise every key once: readings + latest may arrive camelCased
  // (temperatureC) while our maps are keyed snake_case (temperature_c).
  const paramKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of readings)
      for (const k of Object.keys(r.parameters ?? {})) keys.add(wqKey(k))
    for (const k of Object.keys(latestParams)) keys.add(wqKey(k))
    return Array.from(keys)
  }, [readings, latestParams])

  const paramValue = (source: Record<string, number> | null | undefined, key: string): number | undefined => {
    if (!source) return undefined
    if (source[key] != null) return source[key]
    const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
    return source[camel] ?? undefined
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" onClick={onBack} className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to sensors
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">{tankName}</h1>
          <WaterStatusPill status={status} />
        </div>
        <p className="text-sm text-slate-500">
          Water quality readings from <span className="font-mono">{sensor.deviceId}</span>.
        </p>
      </div>

      <Card className="border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">Sensor details</h2>
            {canEdit && (
              <Button size="sm" variant="outline" className="rounded-xl" onClick={onEdit}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Edit sensor
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <SensorIcon className="h-4 w-4 shrink-0 text-cyan-600" />
              <span className="text-sm text-slate-500">Sensor ID</span>
              <strong className="ml-auto font-mono font-semibold text-slate-800">{sensor.deviceId}</strong>
            </div>
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
              <span className="text-sm text-slate-500">Coordinates</span>
              <strong className="ml-auto font-mono font-semibold text-slate-800">
                {tank?.latitude != null && tank?.longitude != null
                  ? `${tank.latitude.toFixed(6)}°, ${tank.longitude.toFixed(6)}°`
                  : "Not available"}
              </strong>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Parameter cards (latest values) — 3 per row on md+ screens */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paramKeys.length === 0 && (
          <Card className="col-span-full border-slate-200/70 bg-white shadow-sm">
            <CardContent className="py-10 text-center text-sm text-slate-500">
              No water-quality readings recorded for this sensor yet.
            </CardContent>
          </Card>
        )}
        {paramKeys.map((key) => {
          const meta = WQ_PARAM_META[key]
          const Icon = meta?.icon
          const value = paramValue(latestParams, key)
          const unit = wqUnit(key)
          return (
            <Card
              key={key}
              className="group overflow-hidden rounded-2xl border-slate-200/70 bg-gradient-to-b from-white to-slate-50/60 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:shadow-slate-200/70"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-slate-500">{meta?.label ?? wqLabel(key)}</p>
                  <span
                    className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg px-1 ${meta?.tint ?? "text-cyan-700 bg-cyan-50"}`}
                  >
                    {Icon ? (
                      <Icon className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-[10px] font-extrabold tracking-tight">{meta?.tile?.text ?? key.slice(0, 2).toUpperCase()}</span>
                    )}
                  </span>
                </div>
                <p className="mt-2.5 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tracking-tight text-slate-800">
                    {value != null ? value : "—"}
                  </span>
                  {unit ? (
                    <span className={`rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold ${meta?.chip ?? "text-slate-500"}`}>
                      {unit}
                    </span>
                  ) : null}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* History table — horizontally scrollable with sticky Time/Status columns */}
      <Card className="border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-slate-800">Recent readings</h2>
          </div>
          {readings.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No readings found for this sensor yet.</p>
          ) : (
            <div className="relative mt-4 max-w-full">
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
                    {readings.slice(0, 30).map((reading) => (
                      <tr key={reading.readingId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                        <td className="sticky left-0 z-10 bg-white py-3 pl-4 pr-4 whitespace-nowrap text-slate-600 group-hover:bg-slate-50/70">
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
        </CardContent>
      </Card>
    </div>
  )
}

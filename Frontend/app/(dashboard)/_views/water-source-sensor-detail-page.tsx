"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, BarChart3, Droplets, FlaskConical, MapPin, Plus, RefreshCw, Waves } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { RegisterWaterSourceSensorModal } from "@/components/water-level/register-water-source-sensor-modal"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { WATER_LEVEL_POLL_INTERVAL_MS, WATER_SOURCE_READING_HISTORY_LIMIT } from "@/lib/water-level"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorCategory } from "@/store/data-store"

const PARAMETER_LABELS: Record<string, string> = {
  temperatureC: "Temperature (°C)",
  ph: "pH",
  ecUscm: "Conductivity (µS/cm)",
  doMgl: "Dissolved oxygen (mg/L)",
  turbidityNtu: "Turbidity (NTU)",
  freeChlorineMgl: "Free chlorine (mg/L)",
  nitrateMgl: "Nitrate (mg/L)",
  ammoniaMgl: "Ammonia (mg/L)",
  pressure: "Pressure (kPa)",
}

export default function WaterSourceSensorDetailPage() {
  const router = useRouter()
  const params = useParams<{ waterSourceId: string }>()
  const waterSourceId = Array.isArray(params?.waterSourceId) ? params.waterSourceId[0] : params?.waterSourceId
  const { currentUser } = useAuthStore()
  const {
    sensors,
    waterSources,
    waterSourceReadingsByWaterSource,
    fetchSensors,
    fetchWaterSources,
    fetchWaterSourceReadings,
  } = useDataStore()
  const [category, setCategory] = useState<SensorCategory>("water_level")
  const [registerOpen, setRegisterOpen] = useState(false)

  const source = waterSources.find((item) => item.id === waterSourceId)
  const sourceSensors = useMemo(
    () => sensors.filter((sensor) => sensor.assetType === "water_source" && sensor.waterSourceId === waterSourceId),
    [sensors, waterSourceId]
  )
  const categories = Array.from(new Set(sourceSensors.map((sensor) => sensor.category)))
  const activeSensor = sourceSensors.find((sensor) => sensor.category === category && sensor.activated)
  const readings = waterSourceReadingsByWaterSource[`${waterSourceId}:${category}`] ?? []
  const latestReading = readings[0] ?? activeSensor?.lastReading
  const canManage = currentUser?.role === "admin" || currentUser?.role === "utility_manager"

  useEffect(() => {
    if (!waterSourceId) return
    void fetchSensors()
    void fetchWaterSources()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchSensors()
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchSensors, fetchWaterSources, waterSourceId])

  useEffect(() => {
    if (!waterSourceId || !activeSensor) return
    const load = () => {
      void fetchWaterSourceReadings(waterSourceId, WATER_SOURCE_READING_HISTORY_LIMIT, category).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Failed to load water-source readings.")
      })
    }
    load()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load()
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [activeSensor, category, fetchWaterSourceReadings, waterSourceId])

  useEffect(() => {
    if (categories.length && !categories.includes(category)) setCategory(categories[0])
  }, [categories, category])

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={source?.name || source?.sourceKey || "Water Source"}
        description={`${source?.sourceType?.replaceAll("_", " ") || "Water source"} sensor monitoring`}
        actionLabel="Back to water sources"
        actionIcon={ArrowLeft}
        onAction={() => router.push("/dashboard/sensor-data/water-sources")}
      />

      {!source ? (
        <Card><CardContent className="py-14 text-center text-sm text-slate-500">Water source not found.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <Card>
              <CardContent className="flex items-start gap-4 p-5">
                <span className="rounded-2xl bg-sky-50 p-3 text-sky-700"><Waves className="h-6 w-6" /></span>
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">{source.name || source.sourceKey}</h2>
                  <p className="mt-1 capitalize text-sm text-slate-500">{source.sourceType?.replaceAll("_", " ") || "Water source"}</p>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5" />
                    {source.latitude != null && source.longitude != null
                      ? `${source.latitude.toFixed(5)}, ${source.longitude.toFixed(5)}`
                      : "Location unavailable"}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Installed sensors</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {source.activeSensorCount} active · {sourceSensors.length} registered
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <WaterStatusPill status={activeSensor?.status ?? "inactive"} />
                  {canManage && (
                    <Button size="sm" onClick={() => setRegisterOpen(true)}>
                      <Plus className="mr-1.5 h-4 w-4" /> Register sensor
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["water_level", "water_quality"] as SensorCategory[]).map((value) => {
              const installed = sourceSensors.some((sensor) => sensor.category === value)
              return (
                <Button
                  key={value}
                  variant={category === value ? "default" : "outline"}
                  onClick={() => setCategory(value)}
                  disabled={!installed}
                >
                  {value === "water_level" ? <Waves className="mr-1.5 h-4 w-4" /> : <FlaskConical className="mr-1.5 h-4 w-4" />}
                  {value === "water_level" ? "Water level" : "Water quality"}
                </Button>
              )
            })}
            <div className="ml-auto flex items-center gap-2">
              {activeSensor && (
                <Button
                  size="sm"
                  className="bg-cyan-700 font-semibold text-white shadow-sm hover:bg-cyan-800"
                  onClick={() => router.push(
                    `/dashboard/sensor-data/water-sources/${waterSourceId}/${category === "water_quality" ? "water-quality-analytics" : "analytics"}?sensor=${activeSensor.id}`
                  )}
                >
                  <BarChart3 className="mr-1.5 h-4 w-4" /> Analytics
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={!activeSensor}
                onClick={() => activeSensor && void fetchWaterSourceReadings(waterSourceId, WATER_SOURCE_READING_HISTORY_LIMIT, category)}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-cyan-600" />
                <h2 className="font-semibold text-slate-900">
                  {category === "water_level" ? "Measured source water level" : "Water quality measurements"}
                </h2>
              </div>
              {!activeSensor ? (
                <p className="mt-4 text-sm text-slate-500">
                  {sourceSensors.some((sensor) => sensor.category === category)
                    ? "The registered sensor is inactive."
                    : `No ${category === "water_level" ? "water-level" : "water-quality"} sensor is registered for this source.`}
                </p>
              ) : !latestReading ? (
                <p className="mt-4 text-sm text-slate-500">Waiting for the first reading from {activeSensor.deviceId}.</p>
              ) : category === "water_level" ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <Metric label="Measured depth" value={latestReading.depthM} unit="m" />
                  <Metric label="Derived level" value={latestReading.waterLevelM} unit="m" />
                  <div>
                    <p className="text-xs text-slate-500">Reading status</p>
                    <div className="mt-2"><WaterStatusPill status={latestReading.status} /></div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(latestReading.parameters ?? {}).map(([key, value]) => (
                    <Metric key={key} label={PARAMETER_LABELS[key] || key} value={value} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h2 className="font-semibold text-slate-900">Reading history</h2>
                  <p className="mt-1 text-xs text-slate-500">Showing the latest {WATER_SOURCE_READING_HISTORY_LIMIT} readings. Values use their measurement units; no storage-capacity percentage is inferred.</p>
                </div>
              </div>
              {readings.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-500">No readings available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Received at</th>
                        <th className="px-5 py-3">Sensor</th>
                        <th className="px-5 py-3">Measurement</th>
                        <th className="px-5 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readings.map((reading) => (
                        <tr key={reading.readingId} className="border-t">
                          <td className="px-5 py-3 text-slate-600">{formatTanzaniaDateTime(reading.occurredAt)}</td>
                          <td className="px-5 py-3 font-mono text-xs">{sourceSensors.find((sensor) => sensor.id === reading.sensorId)?.deviceId || "—"}</td>
                          <td className="px-5 py-3 text-slate-700">
                            {category === "water_level"
                              ? `Depth ${(reading.depthM ?? 0).toFixed(2)} m · level ${(reading.waterLevelM ?? 0).toFixed(2)} m`
                              : Object.entries(reading.parameters ?? {}).slice(0, 3).map(([key, value]) => `${PARAMETER_LABELS[key] || key}: ${value}`).join(" · ")}
                          </td>
                          <td className="px-5 py-3"><WaterStatusPill status={reading.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <RegisterWaterSourceSensorModal
            open={registerOpen}
            onOpenChange={setRegisterOpen}
            defaultWaterSourceId={waterSourceId}
          />
        </>
      )}
    </div>
  )
}

function Metric({ label, value, unit = "" }: { label: string; value?: number | null; unit?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">
        {value == null ? "—" : `${value.toFixed(2)}${unit ? ` ${unit}` : ""}`}
      </p>
    </div>
  )
}

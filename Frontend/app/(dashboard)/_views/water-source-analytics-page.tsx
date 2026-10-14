"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Activity, ArrowLeft, Calendar, Download, FlaskConical, RefreshCw, Waves } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { formatTanzaniaDateTime, formatTanzaniaTime } from "@/lib/date-time"
import { useDataStore, type SensorCategory, type WaterSourceReading } from "@/store/data-store"

type Period = "24h" | "7d" | "30d" | "90d" | "all"

const PERIODS: { key: Period; label: string; ms?: number }[] = [
  { key: "24h", label: "24 hours", ms: 86_400_000 },
  { key: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 days", ms: 30 * 86_400_000 },
  { key: "90d", label: "90 days", ms: 90 * 86_400_000 },
  { key: "all", label: "All available" },
]

const PARAMETER_LABELS: Record<string, string> = {
  temperatureC: "Temperature (°C)",
  ph: "pH",
  ecUscm: "Conductivity (µS/cm)",
  doMgl: "Dissolved oxygen (mg/L)",
  doPctSat: "Dissolved oxygen saturation (%)",
  turbidityNtu: "Turbidity (NTU)",
  freeChlorineMgl: "Free chlorine (mg/L)",
  nitrateMgl: "Nitrate (mg/L)",
  ammoniaMgl: "Ammonia (mg/L)",
  phosphateMgl: "Phosphate (mg/L)",
  orpMv: "ORP (mV)",
  pressure: "Pressure (kPa)",
}

const PARAMETER_UNITS: Record<string, string> = {
  temperatureC: "°C",
  ecUscm: "µS/cm",
  doMgl: "mg/L",
  doPctSat: "%",
  turbidityNtu: "NTU",
  freeChlorineMgl: "mg/L",
  nitrateMgl: "mg/L",
  ammoniaMgl: "mg/L",
  phosphateMgl: "mg/L",
  orpMv: "mV",
  pressure: "kPa",
}

function readingParameter(reading: WaterSourceReading, key: string): number | null {
  const value = reading.parameters?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export default function WaterSourceAnalyticsPage({ category }: { category: SensorCategory }) {
  const router = useRouter()
  const params = useParams<{ waterSourceId: string }>()
  const waterSourceId = Array.isArray(params?.waterSourceId) ? params.waterSourceId[0] : params?.waterSourceId
  const sensorId = useSearchParams().get("sensor")
  const { sensors, waterSources, fetchSensors, fetchWaterSources, fetchWaterSourceReadings } = useDataStore()
  const [period, setPeriod] = useState<Period>("7d")
  const [parameter, setParameter] = useState("ph")
  const [levelMeasure, setLevelMeasure] = useState<"water_level" | "depth">("water_level")
  const [readings, setReadings] = useState<WaterSourceReading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    void fetchSensors()
    void fetchWaterSources()
  }, [fetchSensors, fetchWaterSources])

  const sensor = sensors.find((item) =>
    item.id === sensorId &&
    item.waterSourceId === waterSourceId &&
    item.assetType === "water_source" &&
    item.category === category
  )
  const source = waterSources.find((item) => item.id === waterSourceId)
  const sourceName = source?.name || source?.sourceKey || sensor?.waterSourceName || "Water source"

  const load = useCallback(async () => {
    if (!waterSourceId || !sensorId) return
    setLoading(true)
    setError("")
    try {
      const periodSpec = PERIODS.find((item) => item.key === period)
      const startAt = periodSpec?.ms
        ? new Date(Date.now() - periodSpec.ms).toISOString().replace(/Z$/, "")
        : undefined
      await fetchWaterSourceReadings(waterSourceId, 5000, category, { sensorId, startAt })
      const fresh = useDataStore.getState().waterSourceReadingsByWaterSource[`${waterSourceId}:${category}`] ?? []
      setReadings(fresh
        .filter((reading) => reading.sensorId === sensorId)
        .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sensor analytics.")
      setReadings([])
    } finally {
      setLoading(false)
    }
  }, [category, fetchWaterSourceReadings, period, sensorId, waterSourceId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (category === "water_level" && readings.length && !readings.some((reading) => (reading.h1M ?? 0) > 0)) {
      setLevelMeasure("depth")
    }
  }, [category, readings])

  const parameterKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const reading of readings) {
      for (const key of Object.keys(reading.parameters ?? {})) keys.add(key)
    }
    return [...keys].sort((a, b) => (PARAMETER_LABELS[a] ?? a).localeCompare(PARAMETER_LABELS[b] ?? b))
  }, [readings])

  useEffect(() => {
    if (category === "water_quality" && parameterKeys.length && !parameterKeys.includes(parameter)) {
      setParameter(parameterKeys.includes("ph") ? "ph" : parameterKeys[0])
    }
  }, [category, parameter, parameterKeys])

  const latest = readings.at(-1)
  const values = useMemo(
    () => readings.map((reading) => category === "water_level"
      ? levelMeasure === "depth" ? reading.depthM : reading.waterLevelM
      : readingParameter(reading, parameter)
    ).filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    [category, levelMeasure, parameter, readings]
  )
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const minimum = values.length ? Math.min(...values) : null
  const maximum = values.length ? Math.max(...values) : null
  const unit = category === "water_level" ? "m" : ""
  const metricName = category === "water_level"
    ? levelMeasure === "depth" ? "Sensor depth" : "Estimated water level"
    : PARAMETER_LABELS[parameter] ?? parameter

  const points = useMemo(() => readings.flatMap((reading) => {
    const value = category === "water_level"
      ? levelMeasure === "depth" ? reading.depthM : reading.waterLevelM
      : readingParameter(reading, parameter)
    return value == null ? [] : [{ time: reading.occurredAt, value }]
  }), [category, levelMeasure, parameter, readings])

  function exportCsv() {
    const rows = category === "water_level"
      ? [["Timestamp", "Water level (m)", "Sensor depth (m)", "Status"], ...readings.map((reading) => [
          reading.occurredAt,
          reading.waterLevelM ?? "",
          reading.depthM ?? "",
          reading.status,
        ])]
      : [["Timestamp", metricName, "Status"], ...readings.flatMap((reading) => {
          const value = readingParameter(reading, parameter)
          return value == null ? [] : [[reading.occurredAt, value, reading.status]]
        })]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${category === "water_level" ? "water-level" : "water-quality"}-${sensor?.deviceId ?? sensorId}-${period}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!sensorId) {
    return <Card><CardContent className="p-8 text-sm text-slate-600">Select a sensor to view analytics.</CardContent></Card>
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            onClick={() => router.push(`/dashboard/sensor-data/water-sources/${waterSourceId}`)}
            className="mb-2 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to source details
          </Button>
          <div className="flex items-center gap-2 text-cyan-700">
            {category === "water_level" ? <Waves className="h-5 w-5" /> : <FlaskConical className="h-5 w-5" />}
            <span className="text-sm font-semibold">{category === "water_level" ? "Water level analytics" : "Water quality analytics"}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">{sourceName}</h1>
          <p className="mt-1 text-sm text-slate-500">Sensor {sensor?.deviceId ?? sensorId} · {readings.length.toLocaleString()} readings in period</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map(({ key, label }) => (
            <Button key={key} size="sm" variant={period === key ? "default" : "outline"} onClick={() => setPeriod(key)}>
              {label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && <Card className="border-rose-200 bg-rose-50"><CardContent className="p-4 text-sm text-rose-700">{error}</CardContent></Card>}
      {!sensor && !loading && <Card><CardContent className="p-6 text-sm text-slate-600">This sensor is not registered as an active sensor of the selected category on this source.</CardContent></Card>}
      {loading ? (
        <Card><CardContent className="p-12 text-center text-sm text-slate-500">Loading sensor history…</CardContent></Card>
      ) : sensor && (
        <>
          {category === "water_level" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm font-medium text-slate-600">Chart measurement:</span>
                <Button size="sm" variant={levelMeasure === "water_level" ? "default" : "outline"} onClick={() => setLevelMeasure("water_level")}>
                  Estimated water level
                </Button>
                <Button size="sm" variant={levelMeasure === "depth" ? "default" : "outline"} onClick={() => setLevelMeasure("depth")}>
                  Sensor depth
                </Button>
              </div>
            </>
          )}
          {category === "water_quality" && (
            <Card><CardContent className="p-5">
              <div className="mb-3 flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-700" /><h2 className="text-sm font-semibold text-slate-800">Choose a parameter</h2></div>
              {parameterKeys.length ? (
                <div className="flex flex-wrap gap-2">
                  {parameterKeys.map((key) => (
                    <Button key={key} size="sm" variant={parameter === key ? "default" : "outline"} onClick={() => setParameter(key)}>
                      {PARAMETER_LABELS[key] ?? key}
                    </Button>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">No quality parameters were recorded in this period.</p>}
            </CardContent></Card>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Summary title={`Latest ${metricName}`} value={values.length ? `${values.at(-1)!.toFixed(2)}${unit ? ` ${unit}` : ""}` : "—"} detail={latest ? formatTanzaniaDateTime(latest.occurredAt) : "No readings"} />
            <Summary title="Period average" value={average == null ? "—" : `${average.toFixed(2)}${unit ? ` ${unit}` : ""}`} detail={`${values.length} readings`} />
            <Summary title="Minimum" value={minimum == null ? "—" : `${minimum.toFixed(2)}${unit ? ` ${unit}` : ""}`} detail="Lowest observed value" />
            <Summary title="Maximum" value={maximum == null ? "—" : `${maximum.toFixed(2)}${unit ? ` ${unit}` : ""}`} detail="Highest observed value" />
          </div>
          <Card>
            <CardContent className="p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="font-semibold text-slate-800">{metricName} over time</h2><p className="text-xs text-slate-500">Readings from this water-source sensor</p></div>
                <span className="flex items-center gap-1.5 text-xs text-slate-500"><Calendar className="h-3.5 w-3.5" />{points.length} readings</span>
              </div>
              {points.length < 2 ? (
                <div className="flex h-72 items-center justify-center text-sm text-slate-500">At least two readings are needed to draw a trend.</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={points}>
                    <defs><linearGradient id="sourceAnalyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0891b2" stopOpacity={0.28} /><stop offset="100%" stopColor="#0891b2" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tickFormatter={(value) => formatTanzaniaTime(value)} minTickGap={36} />
                    <YAxis domain={["auto", "auto"]} unit={unit ? ` ${unit}` : ""} />
                    <Tooltip labelFormatter={(label) => formatTanzaniaDateTime(String(label))} formatter={(value) => [`${Number(value).toFixed(2)}${unit ? ` ${unit}` : ""}`, metricName]} />
                    <Area type="monotone" dataKey="value" name={metricName} stroke="#0891b2" strokeWidth={2.5} fill="url(#sourceAnalyticsFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          {category === "water_quality" && (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">All parameter trends</h2>
                <p className="text-xs text-slate-500">Separate charts keep each measurement on its own scale. Select a chart to inspect its full history above.</p>
              </div>
              {parameterKeys.length ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {parameterKeys.map((key, index) => {
                    const label = PARAMETER_LABELS[key] ?? key
                    const unit = PARAMETER_UNITS[key] ?? ""
                    const keyPoints = readings.flatMap((reading) => {
                      const value = readingParameter(reading, key)
                      return value == null ? [] : [{ time: reading.occurredAt, value }]
                    })
                    const latestValue = keyPoints.at(-1)?.value
                    const chartColor = ["#0891b2", "#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777"][index % 6]
                    return (
                      <Card key={key} className={`border-slate-200/70 bg-white shadow-sm ${parameter === key ? "ring-1 ring-cyan-600/40" : ""}`}>
                        <CardContent className="p-4">
                          <button type="button" onClick={() => setParameter(key)} className="mb-2 flex w-full items-start justify-between gap-3 text-left">
                            <span>
                              <span className="block text-sm font-semibold text-slate-800">{label}</span>
                              <span className="text-xs text-slate-500">{keyPoints.length} readings{unit ? ` · ${unit}` : ""}</span>
                            </span>
                            <span className="whitespace-nowrap text-sm font-bold text-slate-800">
                              {latestValue == null ? "—" : `${latestValue.toFixed(2)}${unit ? ` ${unit}` : ""}`}
                            </span>
                          </button>
                          {keyPoints.length < 2 ? (
                            <div className="flex h-36 items-center justify-center text-xs text-slate-400">Not enough readings to show a trend</div>
                          ) : (
                            <ResponsiveContainer width="100%" height={150}>
                              <AreaChart data={keyPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={() => setParameter(key)}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="time" tickFormatter={(value) => formatTanzaniaTime(value)} minTickGap={42} tick={{ fontSize: 9, fill: "#64748b" }} />
                                <YAxis domain={["auto", "auto"]} width={52} tick={{ fontSize: 9, fill: "#64748b" }} />
                                <Tooltip labelFormatter={(value) => formatTanzaniaDateTime(String(value))} formatter={(value) => [`${Number(value).toFixed(2)}${unit ? ` ${unit}` : ""}`, label]} />
                                <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} fill={chartColor} fillOpacity={0.12} />
                              </AreaChart>
                            </ResponsiveContainer>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <Card><CardContent className="py-8 text-center text-sm text-slate-500">Parameter charts will appear when readings are available.</CardContent></Card>
              )}
            </section>
          )}
          <Card>
            <CardContent className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-semibold text-slate-800">Readings</h2><p className="text-xs text-slate-500">Newest readings first · up to 5,000 fetched per period</p></div>
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!readings.length}><Download className="mr-1.5 h-4 w-4" />Export CSV</Button>
              </div>
              {!readings.length ? <p className="py-8 text-center text-sm text-slate-500">No readings are available for this period.</p> : (
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Time</th><th className="px-4 py-3">Measurement</th><th className="px-4 py-3">Status</th></tr></thead>
                    <tbody>{[...readings].reverse().slice(0, 100).map((reading) => (
                      <tr key={reading.readingId} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatTanzaniaDateTime(reading.occurredAt)}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {category === "water_level"
                            ? `Sensor depth ${(reading.depthM ?? 0).toFixed(2)} m · estimated level ${(reading.waterLevelM ?? 0).toFixed(2)} m`
                            : `${metricName}: ${readingParameter(reading, parameter)?.toFixed(2) ?? "—"}`}
                        </td>
                        <td className="px-4 py-3"><WaterStatusPill status={reading.status} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Summary({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <Card><CardContent className="p-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-3 text-2xl font-bold text-slate-800">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></CardContent></Card>
}

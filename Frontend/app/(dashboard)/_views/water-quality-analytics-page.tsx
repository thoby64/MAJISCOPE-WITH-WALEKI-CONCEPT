"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, BarChart3, Calendar, Download, FlaskConical, RefreshCw } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatTanzaniaDateTime, formatTanzaniaTime } from "@/lib/date-time"
import { useDataStore, type SensorSnap, type TankReading } from "@/store/data-store"

type Period = "24h" | "7d" | "30d" | "90d" | "all"
type Bounds = { warning_below?: number; warning_above?: number; critical_below?: number; critical_above?: number }
const PERIODS: { key: Period; label: string; ms?: number }[] = [
  { key: "24h", label: "24 hours", ms: 86_400_000 },
  { key: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 days", ms: 30 * 86_400_000 },
  { key: "90d", label: "90 days", ms: 90 * 86_400_000 },
  { key: "all", label: "All available" },
]
const PARAMS: Record<string, { label: string; unit: string }> = {
  temperature_c: { label: "Temperature", unit: "°C" }, ph: { label: "pH", unit: "" },
  ec_uscm: { label: "Conductivity (EC)", unit: "µS/cm" }, do_mgl: { label: "Dissolved oxygen", unit: "mg/L" },
  do_pct_sat: { label: "DO saturation", unit: "%" }, turbidity_ntu: { label: "Turbidity", unit: "NTU" },
  orp_mv: { label: "ORP", unit: "mV" }, free_chlorine_mgl: { label: "Free chlorine", unit: "mg/L" },
  nitrate_mgl: { label: "Nitrate", unit: "mg/L" }, ammonia_mgl: { label: "Ammonia", unit: "mg/L" },
  phosphate_mgl: { label: "Phosphate", unit: "mg/L" }, chlorophyll_ugl: { label: "Chlorophyll-a", unit: "µg/L" },
  phycocyanin_ugl: { label: "Phycocyanin", unit: "µg/L" }, pressure: { label: "Pressure", unit: "kPa" },
}
// These match the defaults used by the sensor status evaluator. Configured sensor
// thresholds override these; parameters without a default remain unclassified.
const DEFAULT_BOUNDS: Record<string, Bounds> = {
  ph: { warning_below: 6.5, warning_above: 8.5, critical_below: 5.5, critical_above: 9.5 },
  turbidity_ntu: { warning_above: 5, critical_above: 10 },
  free_chlorine_mgl: { warning_below: 0.2, warning_above: 2, critical_below: 0.05, critical_above: 5 },
  temperature_c: { warning_below: 5, warning_above: 35, critical_below: 0, critical_above: 45 },
  do_mgl: { warning_below: 4, critical_below: 2 },
  ec_uscm: { warning_above: 2500, critical_above: 5000 },
}

function canonicalKey(key: string) {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  return PARAMS[snake] ? snake : key
}
function valueFor(params: Record<string, number> | null | undefined, key: string): number | null {
  if (!params) return null
  const direct = params[key]
  if (typeof direct === "number" && Number.isFinite(direct)) return direct
  const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  const value = params[camel]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function boundsFor(sensor: SensorSnap | undefined, key: string): Bounds | undefined {
  const configured = sensor?.config?.parameters as Record<string, Record<string, number>> | undefined
  const raw = configured?.[key]
  if (raw) return {
    warning_below: raw.warning_below ?? raw.warningBelow,
    warning_above: raw.warning_above ?? raw.warningAbove,
    critical_below: raw.critical_below ?? raw.criticalBelow,
    critical_above: raw.critical_above ?? raw.criticalAbove,
  }
  return DEFAULT_BOUNDS[key]
}
function excursion(value: number, bounds?: Bounds): "Critical" | "Warning" | "Within configured range" | "No threshold" {
  if (!bounds || !Object.keys(bounds).length) return "No threshold"
  if ((bounds.critical_below != null && value <= bounds.critical_below) || (bounds.critical_above != null && value >= bounds.critical_above)) return "Critical"
  if ((bounds.warning_below != null && value <= bounds.warning_below) || (bounds.warning_above != null && value >= bounds.warning_above)) return "Warning"
  return "Within configured range"
}

export default function WaterQualityAnalyticsPage() {
  const router = useRouter()
  const routeParams = useParams<{ tankId: string }>()
  const tankId = Array.isArray(routeParams?.tankId) ? routeParams.tankId[0] : routeParams?.tankId
  const sensorId = useSearchParams().get("sensor")
  const { sensors, tanks, fetchSensors, fetchTanks, fetchSensorReadings } = useDataStore()
  const [period, setPeriod] = useState<Period>("7d")
  const [parameter, setParameter] = useState("ph")
  const [readings, setReadings] = useState<TankReading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => { void fetchSensors(); void fetchTanks() }, [fetchSensors, fetchTanks])
  const sensor = sensors.find((item) => item.id === sensorId && item.tankId === tankId && item.category === "water_quality")
  const tankName = tanks.find((item) => item.id === tankId)?.name || sensor?.tankName || "Water storage facility"

  const load = useCallback(async () => {
    if (!tankId || !sensorId) return
    setLoading(true)
    setError("")
    try {
      const selectedPeriod = PERIODS.find((item) => item.key === period)
      const startAt = selectedPeriod?.ms ? new Date(Date.now() - selectedPeriod.ms).toISOString().replace(/Z$/, "") : undefined
      const rows = await fetchSensorReadings(tankId, sensorId, { category: "water_quality", limit: 5000, startAt })
      setReadings(rows.filter((item) => item.sensorId === sensorId).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load water quality history")
      setReadings([])
    } finally { setLoading(false) }
  }, [fetchSensorReadings, period, sensorId, tankId])
  useEffect(() => { void load() }, [load])

  const parameterKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const reading of readings) for (const key of Object.keys(reading.parameters ?? {})) keys.add(canonicalKey(key))
    const ordered = Object.keys(PARAMS).filter((key) => keys.has(key))
    return [...ordered, ...[...keys].filter((key) => !PARAMS[key]).sort()]
  }, [readings])
  useEffect(() => {
    if (parameterKeys.length && !parameterKeys.includes(parameter)) setParameter(parameterKeys.includes("ph") ? "ph" : parameterKeys[0])
  }, [parameter, parameterKeys])

  const points = useMemo(() => readings.flatMap((reading) => {
    const value = valueFor(reading.parameters, parameter)
    return value == null ? [] : [{ time: reading.occurredAt, value, status: reading.status }]
  }), [readings, parameter])
  const numbers = points.map((point) => point.value)
  const latestValue = numbers.at(-1)
  const firstValue = numbers[0]
  const average = numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
  const minimum = numbers.length ? Math.min(...numbers) : null
  const maximum = numbers.length ? Math.max(...numbers) : null
  const change = latestValue != null && firstValue != null ? latestValue - firstValue : null
  const bounds = boundsFor(sensor, parameter)
  const latestFlag = latestValue == null ? "No reading" : excursion(latestValue, bounds)
  const flaggedReadings = readings.filter((reading) => ["warning", "critical"].includes(reading.status.toLowerCase())).length
  const parameterLabel = PARAMS[parameter]?.label ?? parameter
  const unit = PARAMS[parameter]?.unit ?? ""
  const thresholds = bounds ? [
    ["critical_below", "Critical low", "#e11d48"], ["warning_below", "Warning low", "#f59e0b"],
    ["warning_above", "Warning high", "#f59e0b"], ["critical_above", "Critical high", "#e11d48"],
  ] as const : []

  function exportCsv() {
    const rows = [["Timestamp", `${parameterLabel}${unit ? ` (${unit})` : ""}`, "Sensor status"], ...readings.flatMap((reading) => {
      const value = valueFor(reading.parameters, parameter)
      return value == null ? [] : [[reading.occurredAt, value, reading.status]]
    })]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `water-quality-${sensor?.deviceId ?? sensorId}-${parameter}-${period}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!sensorId) return <Card><CardContent className="p-8 text-sm text-slate-600">Select a sensor to view analytics.</CardContent></Card>

  return <div className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Button variant="ghost" onClick={() => router.push(`/dashboard/sensor-data/${tankId}?sensor=${sensorId}`)} className="mb-2 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500"><ArrowLeft className="mr-1.5 h-4 w-4" />Back to sensor details</Button>
        <div className="flex items-center gap-2 text-cyan-700"><FlaskConical className="h-5 w-5" /><span className="text-sm font-semibold">Water quality analytics</span></div>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">{tankName}</h1>
        <p className="mt-1 text-sm text-slate-500">Sensor {sensor?.deviceId ?? sensorId} · {readings.length.toLocaleString()} readings in period</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{PERIODS.map(({ key, label }) => <Button key={key} size="sm" variant={period === key ? "default" : "outline"} onClick={() => setPeriod(key)} className="rounded-lg">{label}</Button>)}<Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} className="rounded-lg"><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>
    </div>

    {error && <Card className="border-rose-200 bg-rose-50"><CardContent className="p-4 text-sm text-rose-700">{error}</CardContent></Card>}
    {loading ? <Card><CardContent className="p-12 text-center text-sm text-slate-500">Loading water quality history…</CardContent></Card> : <>
      <Card className="border-slate-200/70 shadow-sm"><CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-700" /><h2 className="text-sm font-semibold text-slate-800">Choose a parameter</h2></div>
        {parameterKeys.length ? <div className="flex flex-wrap gap-2">{parameterKeys.map((key) => <Button key={key} size="sm" variant={key === parameter ? "default" : "outline"} onClick={() => setParameter(key)} className="rounded-lg">{PARAMS[key]?.label ?? key}{PARAMS[key]?.unit ? ` · ${PARAMS[key].unit}` : ""}</Button>)}</div> : <p className="text-sm text-slate-500">No water quality parameters have readings in this period.</p>}
      </CardContent></Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={FlaskConical} title={`Latest ${parameterLabel}`} value={latestValue == null ? "—" : `${latestValue.toFixed(2)}${unit ? ` ${unit}` : ""}`} detail={readings.at(-1) ? formatTanzaniaDateTime(readings.at(-1)!.occurredAt) : "No readings"} />
        <Metric icon={Activity} title="Period average" value={average == null ? "—" : `${average.toFixed(2)}${unit ? ` ${unit}` : ""}`} detail={`${points.length} readings with this parameter`} />
        <Metric icon={Activity} title="Period range" value={minimum == null || maximum == null ? "—" : `${minimum.toFixed(2)}–${maximum.toFixed(2)}${unit ? ` ${unit}` : ""}`} detail="Minimum to maximum observed" />
        <Metric icon={change != null && change < 0 ? ArrowDown : ArrowUp} title="Change in period" value={change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}${unit ? ` ${unit}` : ""}`} detail="Latest value minus first value" trend={change ?? undefined} />
        <Metric icon={AlertTriangle} title="Quality alerts" value={String(flaggedReadings)} detail={`${latestFlag}${bounds ? " for selected parameter" : " · no configured limit"}`} alert={flaggedReadings > 0} />
      </div>

      <Card className="border-slate-200/70 shadow-sm"><CardContent className="p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-800">{parameterLabel} over time</h2><p className="text-xs text-slate-500">Each parameter is charted separately using its own unit and scale.</p></div><span className="flex items-center gap-1.5 text-xs text-slate-500"><Calendar className="h-3.5 w-3.5" />{points.length} data points</span></div>
        {points.length < 2 ? <div className="flex h-72 items-center justify-center text-sm text-slate-500">At least two {parameterLabel.toLowerCase()} readings are needed to draw a trend.</div> : <ResponsiveContainer width="100%" height={320}><AreaChart data={points} margin={{ top: 8, right: 18, left: 4, bottom: 0 }}><defs><linearGradient id="qualityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0891b2" stopOpacity={0.28} /><stop offset="100%" stopColor="#0891b2" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="time" tickFormatter={formatTanzaniaTime} minTickGap={36} tick={{ fontSize: 11, fill: "#64748b" }} /><YAxis domain={["auto", "auto"]} width={64} unit={unit ? ` ${unit}` : ""} tick={{ fontSize: 11, fill: "#64748b" }} /><Tooltip labelFormatter={(label) => formatTanzaniaDateTime(String(label))} formatter={(value) => [`${Number(value).toFixed(2)}${unit ? ` ${unit}` : ""}`, parameterLabel]} />{thresholds.map(([key, label, color]) => bounds?.[key] != null && <ReferenceLine key={key} y={bounds[key]} stroke={color} strokeDasharray="5 4" label={{ value: label, fill: color, fontSize: 10 }} />)}<Area type="monotone" dataKey="value" name={parameterLabel} stroke="#0891b2" strokeWidth={2.5} fill="url(#qualityFill)" /></AreaChart></ResponsiveContainer>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"><span className={`font-medium ${latestFlag === "Critical" ? "text-rose-700" : latestFlag === "Warning" ? "text-amber-700" : "text-emerald-700"}`}>Latest: {latestFlag}</span>{bounds ? <span>Threshold guides use configured sensor limits or the app’s operational defaults.</span> : <span>No default threshold is defined for this parameter; readings are shown without a quality classification.</span>}</div>
      </CardContent></Card>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">All parameter trends</h2>
          <p className="text-xs text-slate-500">Separate charts keep each measurement on its own scale. Select a chart to inspect its full history above.</p>
        </div>
        {parameterKeys.length ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {parameterKeys.map((key, index) => {
            const meta = PARAMS[key]
            const keyPoints = readings.flatMap((reading) => {
              const value = valueFor(reading.parameters, key)
              return value == null ? [] : [{ time: reading.occurredAt, value }]
            })
            const latest = keyPoints.at(-1)?.value
            const chartColor = ["#0891b2", "#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777"][index % 6]
            return <Card key={key} className={`border-slate-200/70 bg-white shadow-sm ${parameter === key ? "ring-1 ring-cyan-600/40" : ""}`}>
              <CardContent className="p-4">
                <button type="button" onClick={() => setParameter(key)} className="mb-2 flex w-full items-start justify-between gap-3 text-left">
                  <span><span className="block text-sm font-semibold text-slate-800">{meta?.label ?? key}</span><span className="text-xs text-slate-500">{keyPoints.length} readings{meta?.unit ? ` · ${meta.unit}` : ""}</span></span>
                  <span className="whitespace-nowrap text-sm font-bold text-slate-800">{latest == null ? "—" : `${latest.toFixed(2)}${meta?.unit ? ` ${meta.unit}` : ""}`}</span>
                </button>
                {keyPoints.length < 2 ? <div className="flex h-36 items-center justify-center text-xs text-slate-400">Not enough readings to show a trend</div> : <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={keyPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={() => setParameter(key)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tickFormatter={formatTanzaniaTime} minTickGap={42} tick={{ fontSize: 9, fill: "#64748b" }} />
                    <YAxis domain={["auto", "auto"]} width={52} tick={{ fontSize: 9, fill: "#64748b" }} />
                    <Tooltip labelFormatter={(label) => formatTanzaniaDateTime(String(label))} formatter={(value) => [`${Number(value).toFixed(2)}${meta?.unit ? ` ${meta.unit}` : ""}`, meta?.label ?? key]} />
                    <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} fill={chartColor} fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>}
              </CardContent>
            </Card>
          })}
        </div> : <Card><CardContent className="py-8 text-center text-sm text-slate-500">Parameter charts will appear when readings are available.</CardContent></Card>}
      </section>

      <Card className="border-cyan-100 bg-cyan-50/60 shadow-sm"><CardContent className="flex items-start gap-3 p-5"><div className="rounded-xl bg-white p-2 text-cyan-700"><AlertTriangle className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-slate-800">Sensor status summary</p><p className="mt-1 text-sm text-slate-600">{flaggedReadings ? `${flaggedReadings} readings were marked warning or critical by the sensor status evaluator during this period.` : "No readings in this period were marked warning or critical by the sensor status evaluator."} This is monitoring context and does not certify water as safe or unsafe to drink.</p></div></CardContent></Card>

      <Card className="border-slate-200/70 shadow-sm"><CardContent className="p-5 sm:p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-800">{parameterLabel} readings</h2><p className="text-xs text-slate-500">Newest first · up to 5,000 fetched for the selected period</p></div><Button variant="outline" size="sm" onClick={exportCsv} disabled={!points.length} className="rounded-lg"><Download className="mr-1.5 h-4 w-4" />Export CSV</Button></div>{points.length ? <div className="overflow-x-auto rounded-xl border border-slate-100"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">{parameterLabel}{unit ? ` (${unit})` : ""}</th><th className="px-4 py-3 font-medium">Sensor status</th><th className="px-4 py-3 font-medium">Threshold status</th></tr></thead><tbody>{[...points].reverse().slice(0, 100).map((point, index) => <tr key={`${point.time}-${index}`} className="border-b last:border-0 hover:bg-slate-50/70"><td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatTanzaniaDateTime(point.time)}</td><td className="px-4 py-3 font-medium text-slate-800">{point.value.toFixed(2)}{unit ? ` ${unit}` : ""}</td><td className="px-4 py-3 capitalize text-slate-600">{point.status}</td><td className="px-4 py-3 text-slate-600">{excursion(point.value, bounds)}</td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-slate-500">No {parameterLabel.toLowerCase()} readings for this period.</p>}</CardContent></Card>
    </>}
  </div>
}

function Metric({ icon: Icon, title, value, detail, trend, alert }: { icon: LucideIcon; title: string; value: string; detail: string; trend?: number; alert?: boolean }) {
  return <Card className="border-slate-200/70 bg-white shadow-sm"><CardContent className="p-5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span><span className={`rounded-xl p-2 ${alert ? "bg-amber-50 text-amber-700" : "bg-cyan-50 text-cyan-700"}`}><Icon className="h-4 w-4" /></span></div><div className="mt-3 flex items-center gap-1.5 text-2xl font-bold text-slate-800">{trend != null && trend !== 0 && (trend > 0 ? <ArrowUp className="h-4 w-4 text-emerald-600" /> : <ArrowDown className="h-4 w-4 text-rose-600" />)}{value}</div><p className="mt-1 line-clamp-2 text-xs text-slate-500">{detail}</p></CardContent></Card>
}

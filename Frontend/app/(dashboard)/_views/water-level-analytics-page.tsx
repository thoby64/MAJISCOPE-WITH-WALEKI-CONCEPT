"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Activity, ArrowDown, ArrowLeft, ArrowUp, BarChart3, Calendar, Download, Droplets, Gauge, RefreshCw, Waves } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatTanzaniaDateTime, formatTanzaniaTime } from "@/lib/date-time"
import { fillPercent, readStoredTankLength } from "@/lib/water-level"
import { useDataStore, type TankReading } from "@/store/data-store"

type Period = "24h" | "7d" | "30d" | "90d" | "all"
const PERIODS: { key: Period; label: string; ms?: number }[] = [
  { key: "24h", label: "24 hours", ms: 86_400_000 },
  { key: "7d", label: "7 days", ms: 7 * 86_400_000 },
  { key: "30d", label: "30 days", ms: 30 * 86_400_000 },
  { key: "90d", label: "90 days", ms: 90 * 86_400_000 },
  { key: "all", label: "All available" },
]

function validLevel(reading: TankReading) {
  return Number.isFinite(reading.waterLevelM) ? Number(reading.waterLevelM) : null
}

export default function WaterLevelAnalyticsPage() {
  const router = useRouter()
  const params = useParams<{ tankId: string }>()
  const tankId = Array.isArray(params?.tankId) ? params.tankId[0] : params?.tankId
  const sensorId = useSearchParams().get("sensor")
  const { sensors, tanks, fetchSensors, fetchTanks, fetchSensorReadings } = useDataStore()
  const [period, setPeriod] = useState<Period>("7d")
  const [readings, setReadings] = useState<TankReading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [lengthOverride, setLengthOverride] = useState<number | null>(null)

  useEffect(() => {
    void fetchSensors()
    void fetchTanks()
    if (tankId) setLengthOverride(readStoredTankLength(tankId))
  }, [fetchSensors, fetchTanks, tankId])

  const sensor = sensors.find((item) => item.id === sensorId && item.tankId === tankId)
  const tank = tanks.find((item) => item.id === tankId)
  const tankName = tank?.name || sensor?.tankName || "Water storage facility"
  const configuredLengthValue = sensor?.config?.h1M ?? sensor?.config?.h1_m
  const configuredTankLength = lengthOverride ?? (typeof configuredLengthValue === "number" && configuredLengthValue > 0 ? configuredLengthValue : null)
  const load = useCallback(async () => {
    if (!tankId || !sensorId) return
    setLoading(true)
    setError("")
    try {
      const selectedPeriod = PERIODS.find((item) => item.key === period)
      // Sensor timestamps are stored as naive UTC; send the same form for range bounds.
      const startAt = selectedPeriod?.ms ? new Date(Date.now() - selectedPeriod.ms).toISOString().replace(/Z$/, "") : undefined
      const rows = await fetchSensorReadings(tankId, sensorId, { limit: 5000, startAt })
      setReadings(rows.filter((item) => item.sensorId === sensorId).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics readings")
      setReadings([])
    } finally {
      setLoading(false)
    }
  }, [fetchSensorReadings, period, sensorId, tankId])

  useEffect(() => { void load() }, [load])

  const values = useMemo(() => readings.map(validLevel).filter((value): value is number => value !== null), [readings])
  const latest = readings.at(-1)
  const first = readings[0]
  const stats = useMemo(() => ({
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    minimum: values.length ? Math.min(...values) : 0,
    maximum: values.length ? Math.max(...values) : 0,
    change: first && latest ? (latest.waterLevelM ?? 0) - (first.waterLevelM ?? 0) : 0,
  }), [values, first, latest])

  const chartData = useMemo(() => readings.map((reading) => ({
    time: reading.occurredAt,
    label: formatTanzaniaDateTime(reading.occurredAt),
    level: validLevel(reading),
  })).filter((item) => item.level !== null), [readings])

  const insight = useMemo(() => {
    if (readings.length < 2) return "More readings are needed to identify a level trend."
    const delta = stats.change
    if (Math.abs(delta) < 0.05) return "Water level has remained broadly steady over this period."
    return `Water level ${delta > 0 ? "rose" : "fell"} by ${Math.abs(delta).toFixed(2)} m across the selected period.`
  }, [readings.length, stats.change])

  function exportCsv() {
    const rows = [["Timestamp", "Water level (m)", "Water level (ft)", "Sensor depth (m)", "Status"], ...readings.map((reading) => [reading.occurredAt, reading.waterLevelM ?? "", ((reading.waterLevelM ?? 0) * 3.28084).toFixed(2), reading.depthM ?? "", reading.status])]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `water-level-${sensor?.deviceId ?? sensorId}-${period}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!sensorId) return <Card><CardContent className="p-8 text-sm text-slate-600">Select a sensor to view analytics.</CardContent></Card>

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Button variant="ghost" onClick={() => router.push(`/dashboard/sensor-data/${tankId}?sensor=${sensorId}`)} className="mb-2 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to sensor details
          </Button>
          <div className="flex items-center gap-2 text-cyan-700"><BarChart3 className="h-5 w-5" /><span className="text-sm font-semibold">Water level analytics</span></div>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">{tankName}</h1>
          <p className="mt-1 text-sm text-slate-500">Sensor {sensor?.deviceId ?? sensorId} · Water level sensor</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map(({ key, label }) => <Button key={key} size="sm" variant={period === key ? "default" : "outline"} onClick={() => setPeriod(key)} className="rounded-lg">{label}</Button>)}
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} className="rounded-lg"><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
      </div>

      {error && <Card className="border-rose-200 bg-rose-50"><CardContent className="p-4 text-sm text-rose-700">{error}</CardContent></Card>}
      {loading ? <Card><CardContent className="p-12 text-center text-sm text-slate-500">Loading sensor history…</CardContent></Card> : <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Droplets} title="Current water level" value={latest?.waterLevelM != null ? `${latest.waterLevelM.toFixed(2)} m` : "—"} detail={latest ? formatTanzaniaDateTime(latest.occurredAt) : "No readings yet"} />
          <Metric icon={Activity} title="Change in period" value={`${stats.change > 0 ? "+" : ""}${stats.change.toFixed(2)} m`} detail={insight} trend={stats.change} />
          <Metric icon={Waves} title="Average level" value={`${stats.average.toFixed(2)} m`} detail={`${readings.length.toLocaleString()} readings`} />
          <Metric icon={Gauge} title="Range" value={`${stats.minimum.toFixed(2)}–${stats.maximum.toFixed(2)} m`} detail={configuredTankLength && latest?.waterLevelM != null ? `${fillPercent(latest.waterLevelM, configuredTankLength).toFixed(0)}% of configured tank length` : "Tank length not configured"} />
        </div>

        <Card className="border-slate-200/70 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-semibold text-slate-800">Water level over time</h2><p className="text-xs text-slate-500">Measured water height in metres</p></div>
              <span className="flex items-center gap-1.5 text-xs text-slate-500"><Calendar className="h-3.5 w-3.5" />{readings.length} readings</span>
            </div>
            {chartData.length < 2 ? <div className="flex h-72 items-center justify-center text-sm text-slate-500">At least two readings are needed to draw a trend.</div> : <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs><linearGradient id="levelFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0891b2" stopOpacity={0.28} /><stop offset="100%" stopColor="#0891b2" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" tickFormatter={formatTanzaniaTime} minTickGap={36} tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis domain={["auto", "auto"]} unit=" m" width={62} tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip labelFormatter={(label) => formatTanzaniaDateTime(String(label))} formatter={(value) => [`${Number(value).toFixed(2)} m`, "Water level"]} />
                {configuredTankLength && <ReferenceLine y={configuredTankLength} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Tank length", fill: "#b45309", fontSize: 11 }} />}
                <Area type="monotone" dataKey="level" name="Water level" stroke="#0891b2" strokeWidth={2.5} fill="url(#levelFill)" connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>}
          </CardContent>
        </Card>

        <Card className="border-cyan-100 bg-cyan-50/60 shadow-sm"><CardContent className="flex items-start gap-3 p-5"><div className="rounded-xl bg-white p-2 text-cyan-700"><Activity className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-slate-800">Period insight</p><p className="mt-1 text-sm text-slate-600">{insight}</p></div></CardContent></Card>

        <Card className="border-slate-200/70 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-800">Readings</h2><p className="text-xs text-slate-500">Newest readings first · up to 5,000 fetched per period</p></div><Button variant="outline" size="sm" onClick={exportCsv} disabled={!readings.length} className="rounded-lg"><Download className="mr-1.5 h-4 w-4" />Export CSV</Button></div>
            {readings.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No readings are available for this period.</p> : <div className="overflow-x-auto rounded-xl border border-slate-100"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Water level</th><th className="px-4 py-3 font-medium">Level (ft)</th><th className="px-4 py-3 font-medium">Sensor depth</th><th className="px-4 py-3 font-medium">Status</th></tr></thead><tbody>{[...readings].reverse().slice(0, 100).map((reading) => <tr key={reading.readingId} className="border-b last:border-0 hover:bg-slate-50/70"><td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatTanzaniaDateTime(reading.occurredAt)}</td><td className="px-4 py-3 font-medium text-slate-800">{(reading.waterLevelM ?? 0).toFixed(2)} m</td><td className="px-4 py-3 text-slate-500">{((reading.waterLevelM ?? 0) * 3.28084).toFixed(2)} ft</td><td className="px-4 py-3 text-slate-500">{(reading.depthM ?? 0).toFixed(2)} m</td><td className="px-4 py-3 capitalize text-slate-600">{reading.status}</td></tr>)}</tbody></table></div>}
          </CardContent>
        </Card>
      </>}
    </div>
  )
}

function Metric({ icon: Icon, title, value, detail, trend }: { icon: typeof Droplets; title: string; value: string; detail: string; trend?: number }) {
  return <Card className="border-slate-200/70 bg-white shadow-sm"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span><span className="rounded-xl bg-cyan-50 p-2 text-cyan-700"><Icon className="h-4 w-4" /></span></div><div className="mt-3 flex items-center gap-1.5 text-2xl font-bold text-slate-800">{trend != null && (trend >= 0 ? <ArrowUp className="h-4 w-4 text-emerald-600" /> : <ArrowDown className="h-4 w-4 text-rose-600" />)}{value}</div><p className="mt-1 line-clamp-2 text-xs text-slate-500">{detail}</p></CardContent></Card>
}

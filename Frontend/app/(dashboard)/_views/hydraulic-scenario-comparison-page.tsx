"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  GitCompareArrows,
  LoaderCircle,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { apiClient } from "@/lib/api-client"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { PALETTE } from "@/lib/palette"
import { usePageAccess } from "@/hooks/use-page-access"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"

type ScenarioListItem = {
  id: string
  report_reference?: string | null
  scenario_name?: string | null
  utility_id?: string | null
  utility_name?: string | null
  dma_id?: string | null
  dma_name?: string | null
  created_by_name?: string | null
  completed_at?: string | null
  pressure_min_m?: number | null
  pressure_avg_m?: number | null
  nrw_pct?: number | null
}

type ScenarioPage = { total: number; items: ScenarioListItem[] }
type NumberMap = Record<string, number | null | undefined>
type PressurePoint = {
  hour: number
  pressure_min_m?: number | null
  pressure_avg_m?: number | null
  pressure_max_m?: number | null
  low_pressure_nodes?: number | null
  critical_pressure_nodes?: number | null
}
type ComparisonScenario = {
  id: string
  report_reference?: string | null
  scenario_name?: string | null
  utility_name?: string | null
  dma_name?: string | null
  created_by_name?: string | null
  completed_at?: string | null
  snapshot_version: number
  inputs: Record<string, unknown>
  pressure: NumberMap
  pressure_zones: Array<{ zone?: string; count?: number; pct?: number }>
  pressure_time_series: PressurePoint[]
  water_balance: NumberMap
  risk_distribution: Record<string, number>
}
type ComparisonResponse = {
  baseline_snapshot_id: string
  utility_name?: string | null
  dma_name?: string | null
  scenarios: ComparisonScenario[]
}

const COLORS = PALETTE.chartSeries
const pressureMetricLabels = {
  pressure_min_m: "Minimum pressure",
  pressure_avg_m: "Average pressure",
  pressure_max_m: "Maximum pressure",
} as const
type PressureSeriesMetric = keyof typeof pressureMetricLabels

const number = (value: unknown, digits = 1) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A"

const chartNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const scenarioLabel = (scenario: Pick<ComparisonScenario, "report_reference" | "scenario_name">) =>
  scenario.scenario_name || scenario.report_reference || "Hydraulic scenario"

function ChartSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <h2 className="font-semibold text-slate-950 dark:text-white">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function HydraulicScenarioComparisonPage() {
  usePageAccess()
  const { currentUser } = useAuthStore()
  const { utilities, dmas } = useDataStore()
  const [utilityId, setUtilityId] = useState(currentUser?.utilityId || "")
  const [dmaId, setDmaId] = useState(currentUser?.role === "dma_manager" ? currentUser.dmaId || "" : "")
  const [available, setAvailable] = useState<ScenarioListItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [baselineId, setBaselineId] = useState("")
  const [loadingScenarios, setLoadingScenarios] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ComparisonResponse | null>(null)
  const [pressureSeriesMetric, setPressureSeriesMetric] = useState<PressureSeriesMetric>("pressure_avg_m")

  const visibleUtilities = useMemo(
    () => currentUser?.role === "admin" ? utilities : utilities.filter((utility) => utility.id === currentUser?.utilityId),
    [currentUser, utilities]
  )
  const visibleDmas = useMemo(() => {
    if (currentUser?.role === "dma_manager") return dmas.filter((dma) => dma.id === currentUser.dmaId)
    return dmas.filter((dma) => !utilityId || dma.utilityId === utilityId)
  }, [currentUser, dmas, utilityId])

  useEffect(() => {
    if (!currentUser) return
    if (currentUser.role !== "admin" && currentUser.utilityId) setUtilityId(currentUser.utilityId)
    if (currentUser.role === "dma_manager" && currentUser.dmaId) setDmaId(currentUser.dmaId)
  }, [currentUser])

  useEffect(() => {
    setSelectedIds([])
    setBaselineId("")
    setResult(null)
    setAvailable([])
    if (!dmaId) return

    let cancelled = false
    setLoadingScenarios(true)
    setError(null)
    const params = new URLSearchParams({ page: "1", page_size: "100", scenario_status: "DONE", dma_id: dmaId })
    if (utilityId) params.set("utility_id", utilityId)
    apiClient.get<ScenarioPage>(`/hydraulic-model/snapshots?${params}`, { timeout: 20_000, retries: 0 }).then((response) => {
      if (cancelled) return
      if (response.success && response.data) setAvailable(response.data.items)
      else setError(response.error || "Completed scenarios could not be loaded.")
      setLoadingScenarios(false)
    })
    return () => { cancelled = true }
  }, [dmaId, utilityId])

  const toggleScenario = (id: string) => {
    setResult(null)
    setError(null)
    setSelectedIds((current) => {
      if (current.includes(id)) {
        const next = current.filter((value) => value !== id)
        if (baselineId === id) setBaselineId(next[0] || "")
        return next
      }
      if (current.length >= 5) {
        setError("A comparison can include at most five scenarios.")
        return current
      }
      const next = [...current, id]
      if (!baselineId) setBaselineId(id)
      return next
    })
  }

  const compare = async () => {
    if (selectedIds.length < 2 || selectedIds.length > 5 || !baselineId) return
    setComparing(true)
    setError(null)
    const response = await apiClient.post<ComparisonResponse>("/hydraulic-model/snapshots/compare", {
      snapshot_ids: selectedIds,
      baseline_snapshot_id: baselineId,
    }, { timeout: 25_000, retries: 0 })
    if (response.success && response.data) setResult(response.data)
    else setError(response.error || "The selected scenarios could not be compared.")
    setComparing(false)
  }

  const chartNames = useMemo(() => {
    const names: Record<string, string> = {}
    result?.scenarios.forEach((scenario, index) => {
      const reference = scenario.report_reference?.slice(-6)
      names[scenario.id] = `${index + 1}. ${scenarioLabel(scenario)}${reference ? ` · ${reference}` : ""}`
    })
    return names
  }, [result])

  const pressureSummary = useMemo(() => {
    if (!result) return []
    return (["minimum_m", "average_m", "maximum_m"] as const).map((metric) => {
      const row: Record<string, string | number | null> = { metric: metric.replace("_m", "").replace(/^./, (letter) => letter.toUpperCase()) }
      result.scenarios.forEach((scenario) => { row[scenario.id] = chartNumber(scenario.pressure[metric]) })
      return row
    })
  }, [result])

  const pressureTimeline = useMemo(() => {
    if (!result) return []
    const rows = new Map<number, Record<string, number>>()
    result.scenarios.forEach((scenario) => {
      scenario.pressure_time_series.forEach((point) => {
        const row = rows.get(point.hour) || { hour: point.hour }
        const value = point[pressureSeriesMetric]
        if (typeof value === "number") row[scenario.id] = value
        rows.set(point.hour, row)
      })
    })
    return [...rows.values()].sort((a, b) => a.hour - b.hour)
  }, [pressureSeriesMetric, result])

  const pressureZones = useMemo(() => result?.scenarios.map((scenario) => {
    const row: Record<string, string | number> = { scenario: chartNames[scenario.id] }
    scenario.pressure_zones.forEach((zone) => { row[String(zone.zone || "unknown").toLowerCase()] = Number(zone.pct ?? zone.count ?? 0) })
    return row
  }) || [], [chartNames, result])

  const riskData = useMemo(() => result?.scenarios.map((scenario) => ({
    scenario: chartNames[scenario.id],
    elevated: scenario.risk_distribution.elevated || 0,
    high: scenario.risk_distribution.high || 0,
    critical: scenario.risk_distribution.critical || 0,
  })) || [], [chartNames, result])

  const nrwData = useMemo(() => result?.scenarios.map((scenario) => ({
    scenario: chartNames[scenario.id],
    nrw: chartNumber(scenario.water_balance.nrw_pct),
  })) || [], [chartNames, result])

  const flowData = useMemo(() => result?.scenarios.map((scenario) => ({
    scenario: chartNames[scenario.id],
    inflow: chartNumber(scenario.water_balance.total_inflow_m3h ?? scenario.water_balance.system_input_m3h),
    demand: chartNumber(scenario.water_balance.consumer_demand_m3h ?? scenario.water_balance.authorised_m3h),
    losses: chartNumber(scenario.water_balance.real_loss_m3h),
  })) || [], [chartNames, result])

  const baseline = result?.scenarios.find((scenario) => scenario.id === result.baseline_snapshot_id)
  const scenariosWithoutTimeline = result?.scenarios.filter((scenario) => scenario.pressure_time_series.length === 0) || []

  return (
    <div className="flex flex-col gap-5">
      <div><Button variant="outline" asChild><Link href="/dashboard/hydraulic-reports"><ArrowLeft className="h-4 w-4" />Back to scenarios</Link></Button></div>
      <PageHeader title="Compare Hydraulic Scenarios" description="Compare two to five completed model runs from the same DMA against one baseline." />

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 lg:grid-cols-2">
        <div>
          <label className="text-sm font-semibold">Utility</label>
          {currentUser?.role === "admin" ? (
            <select value={utilityId} onChange={(event) => { setUtilityId(event.target.value); setDmaId("") }} className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3">
              <option value="">Select utility</option>{visibleUtilities.map((utility) => <option key={utility.id} value={utility.id}>{utility.name}</option>)}
            </select>
          ) : <div className="mt-2 flex h-11 items-center rounded-md border border-input px-3">{currentUser?.utilityName || "Assigned utility"}</div>}
        </div>
        <div>
          <label className="text-sm font-semibold">DMA</label>
          <select value={dmaId} onChange={(event) => setDmaId(event.target.value)} disabled={!utilityId || currentUser?.role === "dma_manager"} className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 disabled:opacity-60">
            <option value="">Select DMA</option>{visibleDmas.map((dma) => <option key={dma.id} value={dma.id}>{dma.name}</option>)}
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div><h2 className="font-semibold">Select scenarios</h2><p className="text-sm text-slate-500">{selectedIds.length} of 5 selected · choose one selected scenario as baseline</p></div>
          <Button disabled={selectedIds.length < 2 || !baselineId || comparing} onClick={compare}>
            {comparing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
            Compare selected
          </Button>
        </div>
        {error ? <div className="flex gap-2 border-b border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div> : null}
        {!dmaId ? <div className="p-12 text-center text-slate-500">Select a utility and DMA to load completed scenarios.</div> : loadingScenarios ? <div className="p-12 text-center text-slate-500"><LoaderCircle className="mx-auto mb-2 h-6 w-6 animate-spin" />Loading completed scenarios...</div> : available.length === 0 ? <div className="p-12 text-center text-slate-500">No completed scenarios are available for this DMA.</div> : (
          <div className="max-h-[24rem] overflow-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-800 text-white dark:bg-black"><tr><th className="px-4 py-3">Select</th><th>Scenario</th><th>Run by</th><th>Pressure</th><th>NRW</th><th>Completed</th><th className="px-4">Baseline</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{available.map((scenario) => {
            const selected = selectedIds.includes(scenario.id)
            return <tr key={scenario.id} className={selected ? "bg-sky-50 dark:bg-sky-950/20" : ""}><td className="px-4 py-3"><button type="button" onClick={() => toggleScenario(scenario.id)} className={`flex h-6 w-6 items-center justify-center rounded border ${selected ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300"}`} aria-label={`${selected ? "Remove" : "Select"} scenario`}>{selected ? <Check className="h-4 w-4" /> : null}</button></td><td><p className="font-semibold">{scenario.scenario_name || scenario.report_reference}</p><p className="text-xs text-slate-500">{scenario.report_reference}</p></td><td>{scenario.created_by_name || "System"}</td><td>{number(scenario.pressure_min_m)} / {number(scenario.pressure_avg_m)} m</td><td>{scenario.nrw_pct == null ? "N/A" : `${number(scenario.nrw_pct)}%`}</td><td>{scenario.completed_at ? new Date(scenario.completed_at).toLocaleString() : "N/A"}</td><td className="px-4"><input type="radio" name="baseline" checked={baselineId === scenario.id} disabled={!selected} onChange={() => setBaselineId(scenario.id)} aria-label="Use as baseline" /></td></tr>
          })}</tbody></table></div>
        )}
      </section>

      {result ? (
        <>
          <section className="rounded-lg border border-sky-200 bg-sky-50 p-5 dark:border-sky-900 dark:bg-sky-950/20">
            <p className="text-sm font-semibold uppercase text-sky-700 dark:text-sky-300">Comparison scope</p>
            <h2 className="mt-1 text-xl font-bold">{result.utility_name} · {result.dma_name}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Baseline: <strong>{baseline ? scenarioLabel(baseline) : "Selected scenario"}</strong></p>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <ChartSection title="Pressure summary" description="Minimum, average and maximum pressure in metres."><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={pressureSummary}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="metric" /><YAxis unit=" m" /><Tooltip /><Legend />{result.scenarios.map((scenario, index) => <Bar key={scenario.id} dataKey={scenario.id} name={chartNames[scenario.id]} fill={COLORS[index]} />)}</BarChart></ResponsiveContainer></div></ChartSection>
            <ChartSection title="Pressure zones" description="Percentage of model nodes in each pressure condition."><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={pressureZones} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" unit="%" /><YAxis type="category" dataKey="scenario" width={130} /><Tooltip /><Legend /><Bar dataKey="low" stackId="zones" fill={PALETTE.chart.chart4} name="Low" /><Bar dataKey="normal" stackId="zones" fill={PALETTE.chart.chart2} name="Normal" /><Bar dataKey="high" stackId="zones" fill={PALETTE.chart.chart1} name="High" /></BarChart></ResponsiveContainer></div></ChartSection>
          </div>

          {pressureTimeline.length ? <ChartSection title="Pressure over time" description="Reduced timestep series saved by version 3 hydraulic snapshots."><div className="mb-4 flex flex-wrap gap-2">{Object.entries(pressureMetricLabels).map(([key, label]) => <Button key={key} size="sm" variant={pressureSeriesMetric === key ? "default" : "outline"} onClick={() => setPressureSeriesMetric(key as PressureSeriesMetric)}>{label}</Button>)}</div>{scenariosWithoutTimeline.length ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">Time-series data is unavailable for: {scenariosWithoutTimeline.map((scenario) => scenario.report_reference || scenarioLabel(scenario)).join(", ")}. Their summary values remain included elsewhere.</div> : null}<div className="h-96"><ResponsiveContainer width="100%" height="100%"><LineChart data={pressureTimeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" unit="h" /><YAxis unit=" m" /><Tooltip /><Legend />{result.scenarios.map((scenario, index) => <Line key={scenario.id} type="monotone" dataKey={scenario.id} name={chartNames[scenario.id]} stroke={COLORS[index]} strokeWidth={2.5} connectNulls dot={false} />)}</LineChart></ResponsiveContainer></div></ChartSection> : null}

          <div className="grid gap-5 xl:grid-cols-2">
            <ChartSection title="Leakage risk" description="Recorded elevated, high and critical risk locations."><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={riskData} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="scenario" width={130} /><Tooltip /><Legend /><Bar dataKey="elevated" stackId="risk" fill={PALETTE.chart.chart1} name="Elevated" /><Bar dataKey="high" stackId="risk" fill={PALETTE.chart.chart3} name="High" /><Bar dataKey="critical" stackId="risk" fill={PALETTE.chart.chart4} name="Critical" /></BarChart></ResponsiveContainer></div></ChartSection>
            <ChartSection title="Non-revenue water" description="NRW percentage for each scenario."><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={nrwData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="scenario" /><YAxis unit="%" /><Tooltip /><Bar dataKey="nrw" name="NRW" fill={PALETTE.chart.chart4} /></BarChart></ResponsiveContainer></div></ChartSection>
          </div>

          <ChartSection title="Water balance" description="Hourly flow quantities in cubic metres per hour."><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={flowData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="scenario" /><YAxis unit=" m³/h" /><Tooltip /><Legend /><Bar dataKey="inflow" fill={PALETTE.chart.chart1} name="Inflow" /><Bar dataKey="demand" fill={PALETTE.chart.chart2} name="Demand" /><Bar dataKey="losses" fill={PALETTE.chart.chart4} name="Real losses" /></BarChart></ResponsiveContainer></div></ChartSection>

          <ChartSection title="Exact values and baseline differences" description="Positive and negative changes are calculated against the selected baseline."><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="border-b text-left"><th className="py-3">Scenario</th><th>Min pressure</th><th>Average pressure</th><th>Low-pressure nodes</th><th>NRW</th><th>Change from baseline</th></tr></thead><tbody>{result.scenarios.map((scenario) => {
            const avg = scenario.pressure.average_m
            const baseAvg = baseline?.pressure.average_m
            const nrw = scenario.water_balance.nrw_pct
            const baseNrw = baseline?.water_balance.nrw_pct
            return <tr key={scenario.id} className="border-b border-slate-200 dark:border-slate-700"><td className="py-3"><p className="font-semibold">{scenarioLabel(scenario)}</p>{scenario.id === result.baseline_snapshot_id ? <span className="text-xs text-sky-600">Baseline</span> : null}</td><td>{number(scenario.pressure.minimum_m)} m</td><td>{number(avg)} m</td><td>{number(scenario.pressure.low_pressure_nodes, 0)}</td><td>{number(nrw)}%</td><td>{scenario.id === result.baseline_snapshot_id ? "Baseline" : `Avg pressure ${typeof avg === "number" && typeof baseAvg === "number" ? `${avg - baseAvg >= 0 ? "+" : ""}${(avg - baseAvg).toFixed(1)} m` : "N/A"}; NRW ${typeof nrw === "number" && typeof baseNrw === "number" ? `${nrw - baseNrw >= 0 ? "+" : ""}${(nrw - baseNrw).toFixed(1)}%` : "N/A"}`}</td></tr>
          })}</tbody></table></div></ChartSection>

          <ChartSection title="Simulation inputs" description="Parameters used to reproduce each selected model run."><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead><tr className="border-b text-left"><th className="py-3">Scenario</th><th>Base demand</th><th>Leakage fraction</th><th>Duration</th><th>Timestep</th></tr></thead><tbody>{result.scenarios.map((scenario) => <tr key={scenario.id} className="border-b border-slate-200 dark:border-slate-700"><td className="py-3 font-semibold">{scenarioLabel(scenario)}</td><td>{number(scenario.inputs.base_demand, 3)} m³/h</td><td>{number(scenario.inputs.leakage_frac, 2)}</td><td>{number(scenario.inputs.duration_hrs, 0)} hours</td><td>{number(scenario.inputs.time_step_min, 0)} min</td></tr>)}</tbody></table></div></ChartSection>
        </>
      ) : null}
    </div>
  )
}

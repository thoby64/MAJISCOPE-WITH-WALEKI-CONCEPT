"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CalendarClock, ChevronDown, Droplets, FileChartColumn, Gauge, Network, ShieldAlert, UserRound } from "lucide-react"
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { apiClient } from "@/lib/api-client"
import { PALETTE } from "@/lib/palette"
import { usePageAccess } from "@/hooks/use-page-access"
import { Button } from "@/components/ui/button"
import { HydraulicHeatMap } from "@/components/maps/hydraulic-heat-map"
import { getAvailableHydraulicHeatModes, HYDRAULIC_HEAT_MODE_LABELS, type HydraulicHeatMode } from "@/lib/hydraulic-heat"

type Json = Record<string, any>
type FlowBalanceView = "all" | "inflow" | "demand" | "nrw"
type Snapshot = {
  id: string; report_reference?: string | null; scenario_name?: string | null; scenario_status?: string | null
  utility_name?: string | null; dma_name?: string | null; created_by_name?: string | null; created_by_email?: string | null
  created_by_role?: string | null; completed_at?: string | null; created_at: string; execution_duration_seconds?: number | null
  result_quality?: string | null; snapshot_version: number; error_message?: string | null
  input_parameters_json?: Json | null; summary_json?: Json | null; nrw_json?: Json | null; leakage_json?: Json | null
  alerts_json?: Json | null; hotspots_geojson?: Json | null; nodes_geojson?: Json | null; pipes_geojson?: Json | null
}

const number = (value: unknown, unit = "", digits = 2) => typeof value === "number" ? `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit}` : "Not available"
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not recorded"
const label = (value?: string | null) => (value || "Not specified").replaceAll("_", " ")
const snapshotLabel = (value: string) => value.replaceAll("_", " ").replace(/epanet/gi, "hydraulic")
const extractIliFromWarnings = (warnings: string[]) => {
  for (const warning of warnings) {
    const match = warning.match(/\bILI\s*=\s*([0-9]+(?:\.[0-9]+)?)/i)
    if (!match) continue
    const parsed = Number(match[1])
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function Metric({ title, value, note, icon: Icon }: { title: string; value: string; note?: string; icon: typeof Gauge }) {
  return <div className="border-l-2 border-sky-500 px-4 py-2"><div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Icon className="h-4 w-4" />{title}</div><p className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">{value}</p>{note ? <p className="text-xs text-slate-500">{note}</p> : null}</div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><h2 className="border-b border-slate-200 px-5 py-3 text-lg font-semibold dark:border-slate-700">{title}</h2><div className="p-5">{children}</div></section>
}

function SnapshotPrimitive({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-400 dark:text-slate-500">Not recorded</span>
  }

  if (typeof value === "boolean") {
    return (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${value ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
        {value ? "true" : "false"}
      </span>
    )
  }

  const displayedValue = typeof value === "string"
    ? value.replace(/epanet_rpt/gi, "hydraulic rpt").replace(/epanet/gi, "hydraulic")
    : String(value)

  return <span className="break-words font-medium text-slate-900 dark:text-slate-100">{displayedValue}</span>
}

function SnapshotEntry({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const isArray = Array.isArray(value)
  const isObject = value !== null && typeof value === "object" && !isArray

  if (!isArray && !isObject) {
    return (
      <div className="grid gap-1 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800 sm:grid-cols-[minmax(180px,0.4fr)_minmax(0,1fr)] sm:gap-5">
        <span className="break-words text-sm text-slate-500 dark:text-slate-400">{snapshotLabel(name)}</span>
        <SnapshotPrimitive value={value} />
      </div>
    )
  }

  const entries: Array<[string, unknown]> = isArray
    ? value.map((item, index) => [`Item ${index + 1}`, item])
    : Object.entries(value as Record<string, unknown>)
  const countLabel = `${entries.length} ${isArray ? (entries.length === 1 ? "item" : "items") : (entries.length === 1 ? "attribute" : "attributes")}`

  return (
    <details open={depth === 0} className="group/snapshot-entry border-b border-slate-200 last:border-b-0 dark:border-slate-700">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/50 [&::-webkit-details-marker]:hidden">
        <span className="break-words">{snapshotLabel(name)}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{countLabel}</span>
          <ChevronDown className="h-5 w-5 text-slate-700 transition-transform duration-200 group-open/snapshot-entry:rotate-180 dark:text-slate-200" strokeWidth={2.75} aria-hidden="true" />
        </span>
      </summary>
      <div className={depth === 0 ? "border-t border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/20" : "ml-4 border-l border-slate-200 dark:border-slate-700"}>
        {entries.length ? entries.map(([entryName, entryValue]) => (
          <SnapshotEntry key={`${name}-${entryName}`} name={entryName} value={entryValue} depth={depth + 1} />
        )) : <p className="px-4 py-3 text-sm text-slate-400">No values recorded</p>}
      </div>
    </details>
  )
}

export default function HydraulicReportDetailsPage({ snapshotId }: { snapshotId: string }) {
  usePageAccess()
  const [report, setReport] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedHeatMode, setSelectedHeatMode] = useState<HydraulicHeatMode | null>(null)
  const [flowBalanceView, setFlowBalanceView] = useState<FlowBalanceView>("all")

  useEffect(() => {
    let active = true
    apiClient.get<Snapshot>(`/hydraulic-model/snapshots/${encodeURIComponent(snapshotId)}`, { timeout: 20_000, retries: 0 }).then((response) => {
      if (!active) return
      if (response.success && response.data) setReport(response.data)
      else setError(response.error || "Hydraulic report could not be loaded.")
      setLoading(false)
    })
    return () => { active = false }
  }, [snapshotId])

  const summary = report?.summary_json || {}
  const leakage = report?.leakage_json || {}
  const nrw = report?.nrw_json || leakage.nrw || {}
  const hydraulicArtifacts = summary.hydraulic_report_artifacts || {}
  const artifactBalance = hydraulicArtifacts.hydraulic_balance || hydraulicArtifacts.flow_balance || {}
  const artifactStatusEvents: Json[] = hydraulicArtifacts.status_events || []
  const artifactWarnings: string[] = hydraulicArtifacts.warnings || []
  const warnings: string[] = useMemo(() => [...new Set([...(report?.alerts_json?.warnings || []), ...(leakage.warnings || []), ...(report?.error_message ? [report.error_message] : [])])], [leakage, report])
  const iliValue = useMemo(() => {
    if (typeof nrw.ili === "number") return nrw.ili
    return extractIliFromWarnings(warnings)
  }, [nrw.ili, warnings])
  const zones: Json[] = leakage.pressure_zones || []
  const risks: Json[] = leakage.pipe_risks_top20 || []
  const balance: Json[] = leakage.timestep_balance || []
  const heatModes = useMemo(
    () => getAvailableHydraulicHeatModes({ nodesGeojson: report?.nodes_geojson, pipesGeojson: report?.pipes_geojson, hotspotsGeojson: report?.hotspots_geojson }),
    [report?.hotspots_geojson, report?.nodes_geojson, report?.pipes_geojson]
  )

  useEffect(() => {
    if (!heatModes.length) {
      setSelectedHeatMode(null)
      return
    }
    setSelectedHeatMode((current) => current && heatModes.includes(current) ? current : heatModes[0])
  }, [heatModes])

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-slate-500">Loading hydraulic scenario...</div>
  if (error || !report) return <div className="mx-auto max-w-xl py-20 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-red-500" /><h1 className="mt-3 text-xl font-bold">Scenario unavailable</h1><p className="mt-2 text-slate-500">{error}</p><Button asChild className="mt-5"><Link href="/dashboard/hydraulic-reports">Back to scenarios</Link></Button></div>

  const failed = report.scenario_status?.toUpperCase() === "FAILED"
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><Button variant="outline" asChild className="mb-4"><Link href="/dashboard/hydraulic-reports"><ArrowLeft className="h-4 w-4" />Back to Hydraulic Scenarios</Link></Button><div className="flex items-start gap-3"><FileChartColumn className="mt-1 h-7 w-7 text-sky-600" /><div><p className="text-xs font-semibold uppercase text-sky-700 dark:text-sky-300">Hydraulic model scenario</p><h1 className="text-3xl font-bold text-slate-950 dark:text-white">{report.report_reference || report.id}</h1><p className="mt-1 text-slate-600 dark:text-slate-300">{report.scenario_name || "DMA hydraulic scenario"}</p></div></div></div><span className={`rounded-full border px-3 py-1 text-sm font-semibold ${failed ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"}`}>{label(report.scenario_status).toUpperCase()}</span></header>

      <Section title="Run context"><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4"><div><p className="text-sm text-slate-500">Utility</p><p className="font-semibold">{report.utility_name || "Historical utility"}</p></div><div><p className="text-sm text-slate-500">DMA</p><p className="font-semibold">{report.dma_name || "Historical DMA"}</p></div><div><p className="flex items-center gap-2 text-sm text-slate-500"><UserRound className="h-4 w-4" />Run by</p><p className="font-semibold">{report.created_by_name || "System"}</p><p className="text-xs text-slate-500">{report.created_by_email || label(report.created_by_role)}</p></div><div><p className="flex items-center gap-2 text-sm text-slate-500"><CalendarClock className="h-4 w-4" />Completed</p><p className="font-semibold">{date(report.completed_at || report.created_at)}</p><p className="text-xs text-slate-500">Duration: {number(report.execution_duration_seconds, " seconds", 0)}</p></div></div></Section>

      {failed ? <Section title="Simulation failure"><div className="flex gap-3 text-red-800 dark:text-red-200"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="font-semibold">The hydraulic run did not complete successfully.</p><p className="mt-1 text-sm">{report.error_message || "The model did not provide further diagnostic information."}</p></div></div></Section> : null}

      <Section title="Hydraulic performance"><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Gauge} title="Minimum pressure" value={number(summary.pressure_min_m, " m")} /><Metric icon={Gauge} title="Average pressure" value={number(summary.pressure_avg_m, " m")} /><Metric icon={Gauge} title="Maximum pressure" value={number(summary.pressure_max_m, " m")} /><Metric icon={Droplets} title="Maximum flow" value={number(summary.flow_max_m3s, " m³/s", 4)} /></div><div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Network} title="Network nodes" value={number(summary.total_nodes, "", 0)} /><Metric icon={Network} title="Network pipes" value={number(summary.total_pipes, "", 0)} /><Metric icon={AlertTriangle} title="Low-pressure nodes" value={number(summary.low_pressure_nodes, "", 0)} /><Metric icon={CalendarClock} title="Simulation duration" value={number(summary.duration_hrs, " hours", 0)} /></div></Section>

      <Section title="Water balance and non-revenue water"><div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={Droplets} title="System inflow" value={number(nrw.total_inflow_m3h ?? nrw.system_input_m3h, " m³/h")} /><Metric icon={Droplets} title="Consumer demand" value={number(nrw.consumer_demand_m3h ?? nrw.authorised_m3h, " m³/h")} /><Metric icon={ShieldAlert} title="Non-revenue water" value={number(nrw.nrw_pct, "%", 1)} note={number(nrw.nrw_m3h, " m³/h")} /><Metric icon={Gauge} title="Infrastructure leakage index" value={number(iliValue, "", 1)} /></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><Metric icon={Droplets} title="Estimated real losses" value={number(nrw.real_loss_m3h, " m³/h")} /><Metric icon={Droplets} title="Estimated apparent losses" value={number(nrw.apparent_loss_m3h, " m³/h")} /></div></Section>

      {warnings.length ? <Section title="Model warnings"><ul className="space-y-2">{warnings.map((warning, index) => <li key={`${warning}-${index}`} className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" />{warning}</li>)}</ul></Section> : null}

      {Object.keys(hydraulicArtifacts).length ? (
        <Section title="Hydraulic run artifacts">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Droplets} title="Recorded inflow" value={number(artifactBalance.total_inflow_m3h, " m³/h")} />
            <Metric icon={Droplets} title="Recorded demand" value={number(artifactBalance.consumer_demand_m3h, " m³/h")} />
            <Metric icon={ShieldAlert} title="Recorded NRW" value={number(artifactBalance.nrw_pct, "%", 1)} note={number(artifactBalance.nrw_m3h, " m³/h")} />
            <Metric icon={Network} title="Status events" value={number(hydraulicArtifacts.status_event_count, "", 0)} />
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                <p className="font-semibold text-slate-950 dark:text-white">Balance details</p>
              </div>
              <div className="max-h-72 overflow-auto">
                {Object.keys(artifactBalance).length ? (
                  <SnapshotEntry name="hydraulic balance" value={artifactBalance} />
                ) : (
                  <p className="px-4 py-3 text-sm text-slate-500">No balance attributes were recorded.</p>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                <p className="font-semibold text-slate-950 dark:text-white">Status and warnings</p>
              </div>
              <div className="max-h-72 overflow-auto">
                {artifactWarnings.length ? <SnapshotEntry name="warnings" value={artifactWarnings} /> : null}
                {artifactStatusEvents.length ? <SnapshotEntry name="status events" value={artifactStatusEvents} /> : null}
                {!artifactWarnings.length && !artifactStatusEvents.length ? (
                  <p className="px-4 py-3 text-sm text-slate-500">No status events or warnings were recorded.</p>
                ) : null}
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      {balance.length ? <Section title="Hourly flow balance"><div className="mb-4 flex flex-wrap justify-end gap-2">{([['all', 'All'], ['inflow', 'Inflow'], ['demand', 'Demand'], ['nrw', 'NRW']] as Array<[FlowBalanceView, string]>).map(([view, viewLabel]) => <Button key={view} type="button" size="sm" variant={flowBalanceView === view ? "default" : "outline"} onClick={() => setFlowBalanceView(view)} aria-pressed={flowBalanceView === view}>{viewLabel}</Button>)}</div><div className="h-80"><ResponsiveContainer width="100%" height="100%"><LineChart data={balance}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" /><YAxis /><Tooltip /><Legend />{flowBalanceView === "all" || flowBalanceView === "inflow" ? <Line type="monotone" dataKey="inflow_m3h" name="Inflow m³/h" stroke={PALETTE.chart.chart1} strokeWidth={2} dot={false} /> : null}{flowBalanceView === "all" || flowBalanceView === "demand" ? <Line type="monotone" dataKey="demand_m3h" name="Demand m³/h" stroke={PALETTE.chart.chart2} strokeWidth={2} dot={false} /> : null}{flowBalanceView === "all" || flowBalanceView === "nrw" ? <Line type="monotone" dataKey="nrw_m3h" name="NRW m³/h" stroke={PALETTE.chart.chart4} strokeWidth={2} dot={false} /> : null}</LineChart></ResponsiveContainer></div></Section> : null}

      {selectedHeatMode ? (
        <Section title="Hydraulic heat map">
          <div className="flex flex-wrap gap-2">
            {heatModes.map((mode) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={selectedHeatMode === mode ? "default" : "outline"}
                onClick={() => setSelectedHeatMode(mode)}
              >
                {HYDRAULIC_HEAT_MODE_LABELS[mode]}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Saved scenario intensity view for {HYDRAULIC_HEAT_MODE_LABELS[selectedHeatMode].toLowerCase()}.
          </p>
          <div className="mt-4">
            <HydraulicHeatMap
              mode={selectedHeatMode}
              nodesGeojson={report.nodes_geojson}
              pipesGeojson={report.pipes_geojson}
              hotspotsGeojson={report.hotspots_geojson}
            />
          </div>
        </Section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">{zones.length ? <Section title="Pressure zones"><div className="space-y-3">{zones.map((zone) => <div key={zone.zone} className="flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-700"><span className="font-medium capitalize">{label(zone.zone)}</span><span>{zone.count} nodes · {number(zone.pct, "%", 1)}</span></div>)}</div></Section> : null}{risks.length ? <Section title="Highest-risk pipes"><div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Pipe</th><th>Risk</th><th>Score</th><th>Pressure</th></tr></thead><tbody>{risks.map((risk) => <tr key={risk.pipe_id} className="border-b border-slate-100 dark:border-slate-800"><td className="py-2 font-medium">{risk.pipe_id}</td><td className="capitalize">{label(risk.risk_level)}</td><td>{number(risk.risk_score)}</td><td>{number(risk.min_pressure_adjacent, " m")}</td></tr>)}</tbody></table></div></Section> : null}</div>

      <Section title="Simulation inputs"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(report.input_parameters_json || {}).filter(([key]) => !key.startsWith("_") && key !== "extra_demands" && key !== "gpkg_filename").map(([key, value]) => <div key={key}><p className="text-sm capitalize text-slate-500">{label(key)}</p><p className="break-words font-medium">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "Not set")}</p></div>)}</div></Section>

      <details className="group/snapshot-panel rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 [&::-webkit-details-marker]:hidden">
          <div>
            <p className="font-semibold text-slate-950 dark:text-white">Complete snapshot data</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">View all recorded simulation attributes and values.</p>
          </div>
          <ChevronDown className="h-6 w-6 shrink-0 text-slate-800 transition-transform duration-200 group-open/snapshot-panel:rotate-180 dark:text-slate-100" strokeWidth={3} aria-hidden="true" />
        </summary>
        <div className="border-t border-slate-200 p-5 dark:border-slate-700">
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
            <span>Snapshot schema version <strong className="text-slate-800 dark:text-slate-200">{report.snapshot_version}</strong></span>
            <span>Result quality <strong className="text-slate-800 dark:text-slate-200">{label(report.result_quality)}</strong></span>
          </div>
          <div className="max-h-[36rem] overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
            {Object.entries({ summary: report.summary_json, nrw: report.nrw_json, leakage: report.leakage_json, alerts: report.alerts_json }).map(([name, value]) => (
              <SnapshotEntry key={name} name={name} value={value} />
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}

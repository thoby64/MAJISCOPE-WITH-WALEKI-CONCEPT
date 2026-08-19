"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, FileChartColumn, GitCompareArrows, Search, SlidersHorizontal } from "lucide-react"
import { apiClient } from "@/lib/api-client"
import { useDataStore } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { usePageAccess } from "@/hooks/use-page-access"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/shared/page-header"
import { cn } from "@/lib/utils"

type Snapshot = {
  id: string
  report_reference?: string | null
  scenario_name?: string | null
  scenario_status?: string | null
  utility_id?: string | null
  utility_name?: string | null
  dma_id?: string | null
  dma_name?: string | null
  created_by_name?: string | null
  created_by_role?: string | null
  completed_at?: string | null
  created_at: string
  pressure_min_m?: number | null
  pressure_avg_m?: number | null
  nrw_pct?: number | null
  alert_count: number
}

type SnapshotPage = { total: number; page: number; page_size: number; pages: number; items: Snapshot[] }

const statusClass = (status?: string | null) => {
  const normalized = (status || "unknown").toUpperCase()
  if (normalized === "DONE" || normalized === "COMPLETED") return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
  if (normalized === "FAILED") return "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
}

const formatNumber = (value?: number | null, digits = 1) => value == null ? "Not available" : value.toLocaleString(undefined, { maximumFractionDigits: digits })
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "Not recorded"

export default function HydraulicReportsPage() {
  usePageAccess()
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { utilities, dmas } = useDataStore()
  const [data, setData] = useState<SnapshotPage>({ total: 0, page: 1, page_size: 25, pages: 1, items: [] })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [utilityId, setUtilityId] = useState(currentUser?.utilityId || "")
  const [dmaId, setDmaId] = useState(currentUser?.role === "dma_manager" ? currentUser.dmaId || "" : "")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasLoaded = useRef(false)

  const visibleUtilities = useMemo(() => currentUser?.role === "admin" ? utilities : utilities.filter((item) => item.id === currentUser?.utilityId), [currentUser, utilities])
  const visibleDmas = useMemo(() => {
    if (currentUser?.role === "dma_manager") return dmas.filter((item) => item.id === currentUser.dmaId)
    return dmas.filter((item) => !utilityId || item.utilityId === utilityId)
  }, [currentUser, dmas, utilityId])

  const load = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    if (search.trim()) params.set("search", search.trim())
    if (status) params.set("scenario_status", status)
    if (utilityId) params.set("utility_id", utilityId)
    if (dmaId) params.set("dma_id", dmaId)
    const response = await apiClient.get<SnapshotPage>(`/hydraulic-model/snapshots?${params}`, { timeout: 20_000, retries: 0 })
    if (response.success && response.data) setData(response.data)
    else setError(response.error || "Hydraulic scenarios could not be loaded.")
    hasLoaded.current = true
    setLoading(false)
  }, [dmaId, page, pageSize, search, status, utilityId])

  useEffect(() => { const timer = window.setTimeout(load, 100); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => { setPage(1) }, [dmaId, pageSize, search, status, utilityId])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Hydraulic Model Scenarios"
        description="Completed and failed DMA hydraulic scenarios available within your operational scope."
        actionLabel="Compare Scenarios"
        actionIcon={GitCompareArrows}
        onAction={() => router.push("/dashboard/hydraulic-reports/compare")}
      />

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 lg:grid-cols-[minmax(15rem,1fr)_repeat(3,minmax(10rem,0.45fr))]">
        <label className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reference, scenario, DMA or runner" className="pl-9" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">All statuses</option><option value="DONE">Completed</option><option value="FAILED">Failed</option>
        </select>
        {currentUser?.role === "admin" ? <select value={utilityId} onChange={(event) => { setUtilityId(event.target.value); setDmaId("") }} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="">All utilities</option>{visibleUtilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <div className="flex h-10 items-center rounded-md border border-input px-3 text-sm">{currentUser?.utilityName || "Assigned utility"}</div>}
        <select value={dmaId} onChange={(event) => setDmaId(event.target.value)} disabled={currentUser?.role === "dma_manager"} className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-70"><option value="">All DMAs</option>{visibleDmas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div><h2 className="font-semibold">Scenario archive</h2><p className="text-sm text-slate-500 dark:text-slate-400">{data.total.toLocaleString()} scenarios{hasLoaded.current && loading ? " · Refreshing" : ""}</p></div>
          <div className="flex items-center gap-2 text-sm"><SlidersHorizontal className="h-4 w-4" /><span>Rows</span><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-md border border-input bg-background px-2 py-1"><option>25</option><option>50</option><option>100</option></select></div>
        </div>
        {error ? <div className="p-10 text-center"><p className="font-semibold text-red-700 dark:text-red-300">{error}</p><Button className="mt-4" onClick={load}>Try again</Button></div> : loading ? <div className="p-14 text-center text-slate-500">Loading hydraulic scenarios...</div> : data.items.length === 0 ? <div className="p-14 text-center"><FileChartColumn className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-semibold">No hydraulic scenarios found</p><p className="text-sm text-slate-500">Completed model runs will appear here automatically.</p></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-800 text-white dark:bg-black"><tr>{["Scenario", "Scope", "Run by", "Status", "Min / Avg pressure", "NRW", "Alerts", "Completed", ""].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{data.items.map((item) => <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/70"><td className="px-4 py-3"><p className="font-semibold text-slate-950 dark:text-white">{item.report_reference || item.id.slice(0, 12)}</p><p className="text-xs text-slate-500">{item.scenario_name || "Hydraulic scenario"}</p></td><td className="px-4 py-3"><p className="font-medium">{item.utility_name || "Historical utility"}</p><p className="text-xs text-slate-500">{item.dma_name || "Historical DMA"}</p></td><td className="px-4 py-3"><p>{item.created_by_name || "System"}</p><p className="text-xs capitalize text-slate-500">{(item.created_by_role || "automated").replaceAll("_", " ")}</p></td><td className="px-4 py-3"><span className={cn("rounded-full border px-2 py-1 text-xs font-semibold", statusClass(item.scenario_status))}>{(item.scenario_status || "Unknown").toUpperCase()}</span></td><td className="px-4 py-3">{formatNumber(item.pressure_min_m)} / {formatNumber(item.pressure_avg_m)} m</td><td className="px-4 py-3 font-semibold">{item.nrw_pct == null ? "N/A" : `${formatNumber(item.nrw_pct)}%`}</td><td className="px-4 py-3">{item.alert_count}</td><td className="px-4 py-3">{formatDate(item.completed_at || item.created_at)}</td><td className="px-4 py-3 text-right"><Button asChild size="sm"><Link href={`/dashboard/hydraulic-reports/${item.report_reference || item.id}`}>View scenario</Link></Button></td></tr>)}</tbody></table></div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700"><p className="text-sm text-slate-500">Page {data.page} of {data.pages}</p><div className="flex gap-2"><Button variant="outline" size="icon" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" disabled={page >= data.pages || loading} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button></div></div>
      </section>
    </div>
  )
}

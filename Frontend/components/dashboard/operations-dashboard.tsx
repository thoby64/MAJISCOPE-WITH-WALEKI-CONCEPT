"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2,
} from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { getUtilityInfrastructureAsset } from "@/store/data-store"
import { OperationsMap } from "@/components/maps/operations-map"
import type {
  OperationsMapAggregateMarker,
  OperationsMapBoundaryOverlay,
  OperationsMapViewState,
} from "@/components/maps/operations-map"
import { useTopbarTitle } from "@/components/layout/topbar-title-context"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { PALETTE } from "@/lib/palette"
import {
  computeLeakKpis,
  computeLeakageTypeDistribution,
  hasUsableCoordinates,
  type LeakageTypeDistributionRow,
} from "@/lib/report-metrics"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "slate" | "green" | "red" | "amber"
}) {
  const toneClasses = {
    slate: "border-slate-300/80 bg-slate-100/85 text-slate-950",
    green: "border-slate-300/80 bg-slate-100/85 text-emerald-600",
    red: "border-slate-300/80 bg-slate-100/85 text-rose-600",
    amber: "border-slate-300/80 bg-slate-100/85 text-amber-600",
  } as const

  return (
    <div className={cn("flex h-full min-h-[92px] items-center rounded-[18px] border px-4 py-3 shadow-sm shadow-slate-900/[0.03]", toneClasses[tone])}>
      <div className="w-full">
        <p className="max-w-[9rem] text-[0.72rem] font-bold uppercase leading-snug tracking-[0.14em] text-slate-600">{label}</p>
        <p className="mt-3 text-[2.15rem] font-bold leading-none tracking-tight">{value.toLocaleString()}</p>
      </div>
    </div>
  )
}

type ComparisonBarRow = {
  label: string
  reported: number
  resolved: number
}

type DashboardHierarchyLevel = "national" | "utility" | "dma" | "detail"

const CHART_AXIS_TICK = { fill: "var(--chart-axis-text)", fontSize: 10 }
const CHART_GRID = PALETTE.semantic.neutral.bg
const CHART_AXIS_LINE = PALETTE.semantic.neutral.base
const CHART_TOOLTIP_BG = PALETTE.semantic.neutral.bg
const CHART_TOOLTIP_BORDER = PALETTE.semantic.neutral.base
const CHART_TEXT = PALETTE.semantic.neutral.text
const CHART_LEGEND_TEXT = PALETTE.semantic.neutral.strong
const TANZANIA_BOUNDS: [[number, number], [number, number]] = [
  [-11.9, 28.8],
  [-0.95, 41.25],
]
const BOUNDARY_COLOR = PALETTE.map.boundary.color

function isOperationsMapBoundaryOverlay(
  overlay: OperationsMapBoundaryOverlay | null
): overlay is OperationsMapBoundaryOverlay {
  return Boolean(overlay)
}

function isOperationsMapAggregateMarker(
  marker: OperationsMapAggregateMarker | null
): marker is OperationsMapAggregateMarker {
  return Boolean(marker)
}

function isResolvedStatus(status: string) {
  return status === "approved" || status === "closed"
}

function isPointInRing(point: [number, number], ring: number[][]) {
  const [latitude, longitude] = point
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i]
    const previous = ring[j]
    if (!current || !previous || current.length < 2 || previous.length < 2) continue

    const currentLng = Number(current[0])
    const currentLat = Number(current[1])
    const previousLng = Number(previous[0])
    const previousLat = Number(previous[1])

    const intersects =
      currentLat > latitude !== previousLat > latitude &&
      longitude < ((previousLng - currentLng) * (latitude - currentLat)) / (previousLat - currentLat || Number.EPSILON) + currentLng

    if (intersects) inside = !inside
  }

  return inside
}

function isPointInPolygon(point: [number, number], polygon: number[][][]) {
  if (!polygon.length || !isPointInRing(point, polygon[0])) return false
  return !polygon.slice(1).some((hole) => isPointInRing(point, hole))
}

function isPointInBoundary(point: [number, number], boundary: unknown) {
  if (!boundary || typeof boundary !== "object") return false
  const geometry = boundary as { type?: string; coordinates?: unknown }

  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return isPointInPolygon(point, geometry.coordinates as number[][][])
  }

  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as number[][][][]).some((polygon) => isPointInPolygon(point, polygon))
  }

  return false
}

function ComparisonBarChartView({
  rows,
  height,
  leftMargin = -10,
}: {
  rows: ComparisonBarRow[]
  height: number | string
  leftMargin?: number
}) {
  const maxValue = Math.max(...rows.flatMap((row) => [row.reported, row.resolved]), 1)
  const formatAxisLabel = (value: string) => (value.length > 18 ? `${value.slice(0, 17)}...` : value)
  const chartData = rows.map((row) => ({
    name: row.label,
    reported: row.reported,
    resolved: row.resolved,
  }))

  return (
    <div className="min-h-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 8, right: 8, left: leftMargin, bottom: 8 }}
          barCategoryGap={12}
          barGap={2}
        >
          <CartesianGrid stroke={CHART_GRID} horizontal vertical />
          <XAxis
            type="number"
            domain={[0, Math.ceil(maxValue * 1.05)]}
            tick={CHART_AXIS_TICK}
            axisLine={{ stroke: CHART_AXIS_LINE }}
            tickLine={{ stroke: CHART_AXIS_LINE }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={108}
            tick={CHART_AXIS_TICK}
            tickFormatter={formatAxisLabel}
            axisLine={{ stroke: CHART_AXIS_LINE }}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
            contentStyle={{
              background: CHART_TOOLTIP_BG,
              border: `1px solid ${CHART_TOOLTIP_BORDER}`,
              borderRadius: 10,
              color: CHART_TEXT,
            }}
            formatter={(value: number, name: string) => [
              value.toLocaleString(),
              name === "reported" ? "Reported" : "Resolved",
            ]}
            labelStyle={{ color: CHART_TEXT, fontWeight: 600 }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: CHART_LEGEND_TEXT, paddingTop: 8 }}
            formatter={(value) => (value === "reported" ? "Reported" : "Resolved")}
          />
          <Bar dataKey="reported" fill={PALETTE.chart.chart1} radius={0} barSize={8} />
          <Bar dataKey="resolved" fill={PALETTE.chart.chart2} radius={0} barSize={8} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ComparisonBarChartCard({
  title,
  subtitle,
  rows,
}: {
  title: string
  subtitle: string
  rows: ComparisonBarRow[]
}) {
  const [allOpen, setAllOpen] = useState(false)
  const dashboardRowLimit = 3
  const visibleRows = useMemo(() => {
    const limit = dashboardRowLimit
    if (rows.length <= limit) return rows

    const primaryRows = rows.slice(0, limit)
    const remainingRows = rows.slice(limit)
    const otherRow = remainingRows.reduce<ComparisonBarRow>(
      (total, row) => ({
        label: "Other",
        reported: total.reported + row.reported,
        resolved: total.resolved + row.resolved,
      }),
      { label: "Other", reported: 0, resolved: 0 }
    )

    return otherRow.reported || otherRow.resolved ? [...primaryRows, otherRow] : primaryRows
  }, [rows, dashboardRowLimit])
  const hasAggregatedRows = rows.length > dashboardRowLimit
  const chartHeight = "100%"
  const fullChartHeight = Math.max(360, Math.min(960, rows.length * 42 + 120))

  return (
    <>
      <div className="flex h-full min-h-[220px] flex-col overflow-hidden rounded-[18px] border border-slate-300/80 bg-slate-100/85 shadow-sm shadow-slate-900/[0.025]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900">{title}</p>
            <p className="mt-1 truncate text-[11px] text-slate-500">{subtitle}</p>
          </div>
          {hasAggregatedRows ? (
            <Button
              type="button"
              size="sm"
              className="h-7 shrink-0 rounded-lg bg-gradient-to-r from-sky-700 to-cyan-700 px-3 text-xs font-semibold text-white shadow-sm shadow-slate-900/15 hover:from-sky-800 hover:to-cyan-800"
              onClick={() => setAllOpen(true)}
            >
              View all
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
          {visibleRows.length ? (
            <ComparisonBarChartView rows={visibleRows} height={chartHeight} />
          ) : (
            <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              No reports available for this scope yet.
            </div>
          )}
        </div>
      </div>

      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-hidden rounded-2xl p-0">
          <DialogHeader className="border-b border-slate-200 px-5 py-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(88vh-6rem)] overflow-y-auto px-5 py-4">
            {rows.length ? (
              <ComparisonBarChartView rows={rows} height={fullChartHeight} leftMargin={16} />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No reports available for this scope yet.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LeakageTypeDonutCard({ rows }: { rows: LeakageTypeDistributionRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <div className="flex h-full min-h-[210px] flex-col overflow-hidden rounded-[18px] border border-slate-300/80 bg-slate-100/85 shadow-sm shadow-slate-900/[0.025]">
      <div className="border-b border-slate-200 px-3 py-2">
        <p className="text-xs font-semibold text-slate-900">Leakage by type</p>
        <p className="mt-0.5 text-[11px] text-slate-500">Reported leakage type</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-between gap-2 px-2 py-2.5">
        {total ? (
          <>
            <div className="h-[108px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={rows}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={30}
                    outerRadius={48}
                    paddingAngle={2}
                    stroke="transparent"
                  >
                    {rows.map((row) => (
                      <Cell key={row.type} fill={row.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, _name, props) => [
                      `${value.toLocaleString()} (${props.payload.percentage}%)`,
                      props.payload.name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid shrink-0 gap-1.5 px-1 pb-0.5 text-[11px]">
              {rows.slice(0, 3).map((row) => (
                <div key={row.type} className="flex items-center justify-between gap-2 text-slate-600">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.fill }} />
                    <span className="truncate text-slate-700 dark:text-white">{row.name}</span>
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-white">{row.percentage}%</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
            No leakage type data available yet.
          </div>
        )}
      </div>
    </div>
  )
}

export function OperationsDashboard() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { setTitle: setTopbarTitle } = useTopbarTitle()
  const {
    utilities,
    dmas,
    reports,
    reportsListTotal,
    initialized,
    fetchUtilities,
    fetchDMAs,
    fetchReportsForMap,
  } = useDataStore()

  const [loading, setLoading] = useState(true)
  const [selectedUtilityId, setSelectedUtilityId] = useState("all")
  const [selectedDMAId, setSelectedDMAId] = useState("all")
  const [basemap, setBasemap] = useState<"street" | "satellite">("street")
  const [mapZoom, setMapZoom] = useState(6)
  const [mapViewCenter, setMapViewCenter] = useState<[number, number] | null>(null)

  const isAdmin = currentUser?.role === "admin"
  const isUtility = currentUser?.role === "utility_manager"
  const isDMA = currentUser?.role === "dma_manager"

  useEffect(() => {
    async function loadData() {
      if (!currentUser) return

      setLoading(true)
      try {
        await fetchUtilities()
        await Promise.all([
          fetchDMAs(isUtility ? currentUser.utilityId ?? undefined : undefined),
          fetchReportsForMap(
            isDMA
              ? { dmaId: currentUser.dmaId ?? "" }
              : isUtility
                ? { utilityId: currentUser.utilityId ?? "" }
                : undefined
          ),
        ])
      } finally {
        setLoading(false)
      }
    }

    void loadData()
  }, [currentUser, fetchDMAs, fetchReportsForMap, fetchUtilities, isDMA, isUtility])

  const currentDMA = useMemo(
    () => dmas.find((dma) => dma.id === currentUser?.dmaId) ?? null,
    [currentUser?.dmaId, dmas]
  )

  useEffect(() => {
    if (isUtility && currentUser?.utilityId) {
      setSelectedUtilityId(currentUser.utilityId)
    }
  }, [currentUser?.utilityId, isUtility])

  useEffect(() => {
    if (isDMA && currentUser?.dmaId) {
      setSelectedDMAId(currentUser.dmaId)
      if (currentDMA?.utilityId) {
        setSelectedUtilityId(currentDMA.utilityId)
      }
    }
  }, [currentDMA?.utilityId, currentUser?.dmaId, isDMA])

  const visibleUtilities = useMemo(() => {
    if (isUtility && currentUser?.utilityId) {
      return utilities.filter((utility) => utility.id === currentUser.utilityId)
    }
    if (isDMA && currentDMA?.utilityId) {
      return utilities.filter((utility) => utility.id === currentDMA.utilityId)
    }
    return utilities
  }, [currentDMA?.utilityId, currentUser?.utilityId, isDMA, isUtility, utilities])

  const dashboardLevel = useMemo<DashboardHierarchyLevel>(() => {
    if (isDMA) {
      return mapZoom <= 11 ? "dma" : "detail"
    }

    if (selectedDMAId !== "all") {
      return mapZoom <= 11 ? "dma" : "detail"
    }

    if (isUtility || selectedUtilityId !== "all") {
      if (mapZoom <= 9) return "utility"
      if (mapZoom <= 12) return "dma"
      return "detail"
    }

    if (mapZoom <= 7) return "national"
    if (mapZoom <= 10) return "utility"
    if (mapZoom <= 12) return "dma"
    return "detail"
  }, [isDMA, isUtility, mapZoom, selectedDMAId, selectedUtilityId])

  const mapFocusedUtilityId = useMemo(() => {
    if (!isAdmin || selectedUtilityId !== "all" || selectedDMAId !== "all") return null
    if (dashboardLevel !== "utility" && dashboardLevel !== "dma" && dashboardLevel !== "detail") return null
    if (!mapViewCenter) return null

    return (
      visibleUtilities.find((utility) =>
        isPointInBoundary(mapViewCenter, utility.boundaryGeojson)
      )?.id ?? null
    )
  }, [dashboardLevel, isAdmin, mapViewCenter, selectedDMAId, selectedUtilityId, visibleUtilities])

  const effectiveUtilityId = useMemo(() => {
    if (selectedUtilityId !== "all") return selectedUtilityId
    if (isUtility) return currentUser?.utilityId ?? null
    if (isDMA) return currentDMA?.utilityId ?? null
    return mapFocusedUtilityId
  }, [
    currentDMA?.utilityId,
    currentUser?.utilityId,
    isDMA,
    isUtility,
    mapFocusedUtilityId,
    selectedUtilityId,
  ])

  const visibleDMAs = useMemo(() => {
    const base =
      isDMA && currentUser?.dmaId
        ? dmas.filter((dma) => dma.id === currentUser.dmaId)
        : dmas

    if (!effectiveUtilityId) return base
    return base.filter((dma) => dma.utilityId === effectiveUtilityId)
  }, [currentUser?.dmaId, dmas, effectiveUtilityId, isDMA])

  useEffect(() => {
    if (selectedDMAId !== "all" && !visibleDMAs.some((dma) => dma.id === selectedDMAId)) {
      setSelectedDMAId("all")
    }
  }, [selectedDMAId, visibleDMAs])

  useEffect(() => {
    if (isAdmin && selectedUtilityId === "all" && selectedDMAId !== "all") {
      setSelectedDMAId("all")
    }
  }, [isAdmin, selectedDMAId, selectedUtilityId])

  const scopedReports = useMemo(() => {
    if (!currentUser) return []
    if (isAdmin) return reports
    if (isUtility && currentUser.utilityId) {
      return reports.filter((report) => report.utilityId === currentUser.utilityId)
    }
    if (isDMA && currentUser.dmaId) {
      return reports.filter((report) => report.dmaId === currentUser.dmaId)
    }
    return []
  }, [currentUser, isAdmin, isDMA, isUtility, reports])

  const filteredReports = useMemo(() => {
    return scopedReports.filter((report) => {
      const matchesUtility = effectiveUtilityId ? report.utilityId === effectiveUtilityId : true
      const matchesDMA = selectedDMAId === "all" ? true : report.dmaId === selectedDMAId
      return matchesUtility && matchesDMA
    })
  }, [effectiveUtilityId, scopedReports, selectedDMAId])

  const mapReports = useMemo(
    () => filteredReports.filter(hasUsableCoordinates),
    [filteredReports]
  )

  const kpis = useMemo(() => computeLeakKpis(filteredReports), [filteredReports])
  const leakageTypeRows = useMemo(() => computeLeakageTypeDistribution(filteredReports), [filteredReports])

  const comparisonRows = useMemo<ComparisonBarRow[]>(() => {
    if (isAdmin && dashboardLevel !== "dma" && dashboardLevel !== "detail") {
      const rows = new Map<string, ComparisonBarRow>()

      visibleUtilities.forEach((utility) => {
        rows.set(utility.id, {
          label: utility.name,
          reported: 0,
          resolved: 0,
        })
      })

      filteredReports.forEach((report) => {
        const key = report.utilityId || `utility:${report.utilityName || "Unassigned utility"}`
        const current =
          rows.get(key) ??
          {
            label: report.utilityName || "Unassigned utility",
            reported: 0,
            resolved: 0,
          }

        current.reported += 1
        if (isResolvedStatus(report.status)) current.resolved += 1
        rows.set(key, current)
      })

      return Array.from(rows.values()).sort((left, right) => right.reported - left.reported)
    }

    if ((isUtility || (isAdmin && selectedUtilityId !== "all")) && dashboardLevel === "utility") {
      const utilityLabel =
        visibleUtilities.find((utility) => utility.id === selectedUtilityId)?.name ||
        visibleUtilities[0]?.name ||
        "Current utility"

      return [
        {
          label: utilityLabel,
          reported: filteredReports.length,
          resolved: filteredReports.filter((report) => isResolvedStatus(report.status)).length,
        },
      ]
    }

    if (isAdmin || isUtility) {
      const rows = new Map<string, ComparisonBarRow>()
      const visibleDMAIds = new Set(visibleDMAs.map((dma) => dma.id))

      visibleDMAs.forEach((dma) => {
        rows.set(dma.id, {
          label: dma.name,
          reported: 0,
          resolved: 0,
        })
      })

      filteredReports.forEach((report) => {
        if (!report.dmaId || !visibleDMAIds.has(report.dmaId)) return
        const key = report.dmaId || `dma:${report.dmaName || "Unassigned DMA"}`
        const current =
          rows.get(key) ??
          {
            label: report.dmaName || "Unassigned DMA",
            reported: 0,
            resolved: 0,
          }

        current.reported += 1
        if (isResolvedStatus(report.status)) current.resolved += 1
        rows.set(key, current)
      })

      return Array.from(rows.values()).sort((left, right) => right.reported - left.reported)
    }

    if (isDMA) {
      return [
        {
          label: currentDMA?.name || "Current DMA",
          reported: filteredReports.length,
          resolved: filteredReports.filter((report) => isResolvedStatus(report.status)).length,
        },
      ]
    }

    return []
  }, [currentDMA?.name, dashboardLevel, filteredReports, isAdmin, isDMA, isUtility, selectedUtilityId, visibleDMAs, visibleUtilities])

  const comparisonSubtitle =
    dashboardLevel === "national"
      ? "Reported vs resolved per utility"
      : dashboardLevel === "utility"
        ? "Reported vs resolved for the active utility scope"
        : dashboardLevel === "dma"
          ? "Reported vs resolved per DMA"
          : "Reported vs resolved in detail scope"

  const activeDMA = useMemo(
    () => dmas.find((dma) => dma.id === selectedDMAId) ?? null,
    [dmas, selectedDMAId]
  )

  const activeUtilityId = useMemo(() => {
    if (effectiveUtilityId) return effectiveUtilityId
    if (activeDMA?.utilityId) return activeDMA.utilityId
    return visibleUtilities.length === 1 ? visibleUtilities[0].id : null
  }, [
    activeDMA?.utilityId,
    effectiveUtilityId,
    visibleUtilities,
  ])

  const activeUtility = useMemo(
    () => utilities.find((utility) => utility.id === activeUtilityId) ?? null,
    [activeUtilityId, utilities]
  )

  const boundaryOverlays = useMemo<OperationsMapBoundaryOverlay[]>(() => {
    const buildUtilityOverlay = (
      utility: (typeof visibleUtilities)[number],
      index: number
    ): OperationsMapBoundaryOverlay | null => {
      if (!utility.boundaryGeojson) return null
      const utilityReports = filteredReports.filter((report) => report.utilityId === utility.id)

      return {
        id: utility.id,
        label: utility.name,
        level: "utility" as const,
        geojson: utility.boundaryGeojson,
        reported: utilityReports.length,
        resolved: utilityReports.filter((report) => isResolvedStatus(report.status)).length,
        color: BOUNDARY_COLOR,
      }
    }

    const buildDMAOverlay = (
      dma: (typeof visibleDMAs)[number],
      index: number
    ): OperationsMapBoundaryOverlay | null => {
      if (!dma.boundaryGeojson) return null
      const dmaReports = filteredReports.filter((report) => report.dmaId === dma.id)

      return {
        id: dma.id,
        label: dma.name,
        level: "dma" as const,
        geojson: dma.boundaryGeojson,
        reported: dmaReports.length,
        resolved: dmaReports.filter((report) => isResolvedStatus(report.status)).length,
        color: BOUNDARY_COLOR,
      }
    }

    if (dashboardLevel === "national") {
      return []
    }

    if (dashboardLevel === "utility") {
      const utilitiesForBoundary = activeUtility?.boundaryGeojson ? [activeUtility] : []
      return utilitiesForBoundary
        .map(buildUtilityOverlay)
        .filter(isOperationsMapBoundaryOverlay)
    }

    if (selectedDMAId !== "all") {
      const selectedOverlay = activeDMA ? buildDMAOverlay(activeDMA, 0) : null
      return selectedOverlay ? [selectedOverlay] : []
    }

    return visibleDMAs
      .map(buildDMAOverlay)
      .filter(isOperationsMapBoundaryOverlay)
  }, [activeDMA, activeUtility, dashboardLevel, filteredReports, selectedDMAId, visibleDMAs, visibleUtilities])

  const activeNetworkPreviewUrl = useMemo(() => {
    const pipeNetwork = getUtilityInfrastructureAsset(activeUtility, "pipe_network")
    if (!pipeNetwork?.previewUrl) return null
    if (isDMA || !activeDMA?.id || !activeDMA.boundaryGeojson) return pipeNetwork.previewUrl

    const separator = pipeNetwork.previewUrl.includes("?") ? "&" : "?"
    return `${pipeNetwork.previewUrl}${separator}dma_id=${encodeURIComponent(activeDMA.id)}`
  }, [activeDMA?.boundaryGeojson, activeDMA?.id, activeUtility, isDMA])

  const networkPreviewUrls = useMemo(() => {
    if (activeNetworkPreviewUrl) return [activeNetworkPreviewUrl]
    if (!isAdmin || selectedUtilityId !== "all" || selectedDMAId !== "all" || effectiveUtilityId) return []

    return visibleUtilities
      .map((utility) => getUtilityInfrastructureAsset(utility, "pipe_network")?.previewUrl)
      .filter((url): url is string => Boolean(url))
  }, [activeNetworkPreviewUrl, effectiveUtilityId, isAdmin, selectedDMAId, selectedUtilityId, visibleUtilities])

  const infrastructureLayers = useMemo(() => {
    const assetDefinitions = [
      { assetType: "valves", label: "Valves", color: PALETTE.infraDotColors.valves },
      { assetType: "water_sources", label: "Water sources", color: PALETTE.infraDotColors.water_sources },
      { assetType: "storage_facilities", label: "Storage facilities", color: PALETTE.infraDotColors.storage_facilities },
      { assetType: "bulk_meters", label: "Bulk meters", color: PALETTE.infraDotColors.bulk_meters },
    ]
    const layersByType = new Map(
      assetDefinitions.map((asset) => [
        asset.assetType,
        { ...asset, previewUrls: [] as string[] },
      ])
    )
    const utilitiesForInfrastructure = activeUtility ? [activeUtility] : visibleUtilities

    utilitiesForInfrastructure.forEach((utility) => {
      utility.infrastructureLayers?.forEach((layer) => {
        if (layer.assetType === "pipe_network" || !layer.previewUrl) return
        const existing = layersByType.get(layer.assetType)
        if (!existing) return
        existing.previewUrls.push(layer.previewUrl)
      })
    })

    return Array.from(layersByType.values())
  }, [activeUtility, visibleUtilities])

  const utilityAggregateMarkers = useMemo<OperationsMapAggregateMarker[]>(() => {
    const utilitiesForMarkers =
      selectedUtilityId !== "all" || isUtility || isDMA
        ? visibleUtilities.filter((utility) => !effectiveUtilityId || utility.id === effectiveUtilityId)
        : visibleUtilities

    return utilitiesForMarkers
      .map((utility): OperationsMapAggregateMarker | null => {
        const utilityReports = scopedReports.filter((report) => report.utilityId === utility.id)
        const utilityMapReports = utilityReports.filter(hasUsableCoordinates)
        const latitude =
          utility.centerLatitude ??
          (utilityMapReports.length
            ? utilityMapReports.reduce((sum, report) => sum + report.latitude, 0) / utilityMapReports.length
            : null)
        const longitude =
          utility.centerLongitude ??
          (utilityMapReports.length
            ? utilityMapReports.reduce((sum, report) => sum + report.longitude, 0) / utilityMapReports.length
            : null)

        if (latitude == null || longitude == null) return null

        return {
          id: utility.id,
          label: utility.name,
          latitude,
          longitude,
          reported: utilityReports.length,
          resolved: utilityReports.filter((report) => isResolvedStatus(report.status)).length,
          level: "utility" as const,
        }
      })
      .filter(isOperationsMapAggregateMarker)
  }, [effectiveUtilityId, isDMA, isUtility, scopedReports, selectedUtilityId, visibleUtilities])

  const dmaAggregateMarkers = useMemo<OperationsMapAggregateMarker[]>(() => {
    return visibleDMAs
      .map((dma): OperationsMapAggregateMarker | null => {
        const dmaReports = filteredReports.filter((report) => report.dmaId === dma.id)
        const dmaMapReports = dmaReports.filter(hasUsableCoordinates)
        const latitude =
          dma.centerLatitude ??
          (dmaMapReports.length
            ? dmaMapReports.reduce((sum, report) => sum + report.latitude, 0) / dmaMapReports.length
            : null)
        const longitude =
          dma.centerLongitude ??
          (dmaMapReports.length
            ? dmaMapReports.reduce((sum, report) => sum + report.longitude, 0) / dmaMapReports.length
            : null)

        if (latitude == null || longitude == null) return null

        return {
          id: dma.id,
          label: dma.name,
          latitude,
          longitude,
          reported: dmaReports.length,
          resolved: dmaReports.filter((report) => isResolvedStatus(report.status)).length,
          level: "dma" as const,
        }
      })
      .filter(isOperationsMapAggregateMarker)
  }, [filteredReports, visibleDMAs])

  const aggregateMarkers = useMemo(() => {
    if (dashboardLevel === "national" || dashboardLevel === "utility") return utilityAggregateMarkers
    if (dashboardLevel === "dma") return dmaAggregateMarkers
    return []
  }, [dashboardLevel, dmaAggregateMarkers, utilityAggregateMarkers])

  const displayedMapReports = useMemo(
    () => (dashboardLevel === "detail" ? mapReports : []),
    [dashboardLevel, mapReports]
  )

  const mapCenter = useMemo<[number, number] | null>(() => {
    if (activeDMA?.centerLatitude != null && activeDMA?.centerLongitude != null) {
      return [activeDMA.centerLatitude, activeDMA.centerLongitude]
    }
    if (activeUtility?.centerLatitude != null && activeUtility?.centerLongitude != null) {
      return [activeUtility.centerLatitude, activeUtility.centerLongitude]
    }
    if (aggregateMarkers.length) {
      const lat = aggregateMarkers.reduce((sum, marker) => sum + marker.latitude, 0) / aggregateMarkers.length
      const lng = aggregateMarkers.reduce((sum, marker) => sum + marker.longitude, 0) / aggregateMarkers.length
      return [lat, lng]
    }
    if (displayedMapReports.length) {
      const lat = displayedMapReports.reduce((sum, report) => sum + report.latitude, 0) / displayedMapReports.length
      const lng = displayedMapReports.reduce((sum, report) => sum + report.longitude, 0) / displayedMapReports.length
      return [lat, lng]
    }
    return null
  }, [activeDMA, activeUtility, aggregateMarkers, displayedMapReports])

  // Refetch reports when admin changes filters. Keep refreshes quiet once data is already on screen.
  useEffect(() => {
    if (!isAdmin) return

    const filters = {
      utilityId: selectedUtilityId === "all" ? undefined : selectedUtilityId,
      dmaId: selectedDMAId === "all" ? undefined : selectedDMAId,
    }

    void fetchReportsForMap(
      Object.values(filters).some((v) => v !== undefined) ? (filters as any) : undefined
    )
  }, [fetchReportsForMap, initialized, isAdmin, selectedDMAId, selectedUtilityId])

  const scopeTitle = activeDMA?.name || activeUtility?.name || "Water Leakage Monitoring"
  const orgLabel =
    activeUtility?.name ||
    (isAdmin ? "All utilities and DMAs" : currentUser?.name || "Operations view")

  const allMapReportsLoaded = reportsListTotal === null || reports.length >= reportsListTotal

  const mapFitKey = useMemo(
    () =>
      [
        selectedUtilityId,
        selectedDMAId,
        activeDMA?.id ?? "none",
      ].join("|"),
    [activeDMA?.id, selectedDMAId, selectedUtilityId]
  )

  const preferTanzaniaMapView =
    isAdmin && selectedUtilityId === "all" && selectedDMAId === "all" && dashboardLevel === "national"

  const hierarchyLabel =
    dashboardLevel === "national"
      ? "National summary"
      : dashboardLevel === "utility"
        ? "Utility summary"
        : dashboardLevel === "dma"
          ? "DMA summary"
          : "Report detail"

  const handleMapViewChange = useCallback((view: OperationsMapViewState) => {
    setMapZoom(view.zoom)
    setMapViewCenter(view.center)
  }, [])

  useEffect(() => {
    setTopbarTitle({
      title: "Water Leakage Monitoring",
    })

    return () => setTopbarTitle(null)
  }, [setTopbarTitle])

  if (loading && !reports.length) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-card px-5 py-3 text-sm font-medium text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading operations dashboard...
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100dvh-5.5rem)] min-h-[560px] overflow-hidden">
      <div className="grid h-full grid-cols-1 gap-3 xl:grid-cols-[168px_minmax(0,1fr)_280px]">
        <aside className="grid h-full min-h-0 gap-3 sm:grid-cols-2 xl:w-[168px] xl:grid-cols-1 xl:grid-rows-[repeat(4,minmax(0,1fr))_auto]">
          <KpiCard label="Total Reports" value={kpis.total} tone="slate" />
          <KpiCard label="Resolved Reports" value={kpis.repaired} tone="green" />
          <KpiCard label="Urgent Reports" value={kpis.urgent} tone="amber" />
          <KpiCard label="Unattended Reports" value={kpis.unattended} tone="red" />

          <div className="min-h-0 rounded-[18px] border border-slate-300/80 bg-slate-100/85 px-3 py-2.5 shadow-sm shadow-slate-900/[0.025] sm:col-span-2 xl:col-span-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Map legend</p>
            <div className="mt-2.5 max-h-[150px] space-y-1.5 overflow-y-auto pr-1 text-xs text-slate-700">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
                Open / rejected
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-600" />
                Pending approval
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                Resolved (approved / closed)
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-600" />
                Pipe network
              </div>
            </div>
          </div>
        </aside>

        <section className="min-h-0">
          <OperationsMap
            reports={displayedMapReports.map((report) => ({
              id: report.id,
              trackingId: report.trackingId,
              description: report.description,
              latitude: report.latitude,
              longitude: report.longitude,
              status: report.status,
              priority: report.priority,
              dmaName: report.dmaName,
              utilityName: report.utilityName,
              regionName: report.regionName,
              districtName: report.districtName,
              address: report.address,
              reporterName: report.reporterName,
            }))}
            aggregateMarkers={aggregateMarkers}
            boundaryOverlays={boundaryOverlays}
            center={mapCenter}
            boundaryGeojson={null}
            boundaryGeojsons={[]}
            networkPreviewUrl={activeNetworkPreviewUrl}
            networkPreviewUrls={networkPreviewUrls}
            infrastructureLayers={infrastructureLayers}
            networkFileName={getUtilityInfrastructureAsset(activeUtility, "pipe_network")?.fileName}
            title={scopeTitle}
            description={`${dashboardLevel} view · ${kpis.total.toLocaleString()} reports in current scope`}
            basemap={basemap}
            onBasemapChange={setBasemap}
            onZoomChange={setMapZoom}
            onViewChange={handleMapViewChange}
            chromeMode="command-center"
            boundsFitKey={mapFitKey}
            initialBounds={TANZANIA_BOUNDS}
            preferInitialBounds={preferTanzaniaMapView}
            onReportSelect={(reportId) => router.push(`/dashboard/reports/${reportId}`)}
          />
        </section>

        <aside className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_minmax(210px,0.72fr)] gap-3">
          <section className="rounded-[18px] border border-slate-300/80 bg-slate-100/85 px-3 py-2.5 shadow-sm shadow-slate-900/[0.025] backdrop-blur">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-300/70 bg-white/45 px-3 py-2 text-xs dark:border-slate-600/70 dark:bg-slate-950/45">
                <span className="font-semibold text-slate-700 dark:text-white">{hierarchyLabel}</span>
              </div>
              <Select
                value={selectedUtilityId}
                onValueChange={setSelectedUtilityId}
                disabled={!isAdmin || !visibleUtilities.length}
              >
                <SelectTrigger className="h-9 rounded-2xl border-slate-300 bg-slate-100 px-3 text-sm">
                  <SelectValue placeholder="Utility / Region" />
                </SelectTrigger>
                <SelectContent className="z-[5000]">
                  {isAdmin ? <SelectItem value="all">All utilities</SelectItem> : null}
                  {visibleUtilities.map((utility) => (
                    <SelectItem key={utility.id} value={utility.id}>
                      {utility.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedDMAId}
                onValueChange={setSelectedDMAId}
                disabled={isDMA || (isAdmin && selectedUtilityId === "all") || !visibleDMAs.length}
              >
                <SelectTrigger className="h-9 rounded-2xl border-slate-300 bg-slate-100 px-3 text-sm">
                  <SelectValue placeholder="DMA / District" />
                </SelectTrigger>
                <SelectContent className="z-[5000]">
                  {!isDMA ? <SelectItem value="all">All DMAs</SelectItem> : null}
                  {visibleDMAs.map((dma) => (
                    <SelectItem key={dma.id} value={dma.id}>
                      {dma.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <ComparisonBarChartCard
            title="Reported vs resolved"
            subtitle={comparisonSubtitle}
            rows={comparisonRows}
          />
          <LeakageTypeDonutCard rows={leakageTypeRows} />
        </aside>
      </div>
    </div>
  )
}

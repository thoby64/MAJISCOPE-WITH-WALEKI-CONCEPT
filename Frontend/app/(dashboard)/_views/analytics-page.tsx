"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { PageHeader } from "@/components/shared/page-header"
import { formatTanzaniaMonthLabel } from "@/lib/date-time"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, Loader2 } from "lucide-react"
import { PRIORITY_CONFIG, REPORT_STATUS_CONFIG } from "@/lib/constants"
import { PALETTE } from "@/lib/palette"
import {
  computeLeakageTypeDistribution,
  computeReportTypeDistribution,
} from "@/lib/report-metrics"
import type { ReportPriority, ReportStatus } from "@/lib/types"
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
} from "recharts"

type DateFilter = "all" | "today" | "7d" | "30d" | "90d"

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
]

const CHART_AXIS_TICK = { fill: "var(--chart-axis-text)", fontSize: 11 }

function passesDateFilter(dateValue: string | undefined, filter: DateFilter) {
  if (filter === "all") return true
  if (!dateValue) return false

  const created = new Date(dateValue)
  if (Number.isNaN(created.getTime())) return false

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffMs = now.getTime() - created.getTime()
  const diffDays = diffMs / 86_400_000

  switch (filter) {
    case "today":
      return created >= startOfToday
    case "7d":
      return diffDays <= 7
    case "30d":
      return diffDays <= 30
    case "90d":
      return diffDays <= 90
    default:
      return true
  }
}

export default function AnalyticsPage() {
  const { currentUser } = useAuthStore()
  const { utilities, dmas, reports, fetchReportsForMap } = useDataStore()

  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState<DateFilter>("all")
  const [selectedUtilityId, setSelectedUtilityId] = useState("all")
  const [selectedDMAId, setSelectedDMAId] = useState("all")

  const isAdmin = currentUser?.role === "admin"
  const isUtility = currentUser?.role === "utility_manager"

  useEffect(() => {
    async function loadReports() {
      if (!currentUser) return
      setLoading(true)
      try {
        await fetchReportsForMap(
          isUtility ? { utilityId: currentUser.utilityId ?? "" } : undefined
        )
      } finally {
        setLoading(false)
      }
    }

    void loadReports()
  }, [currentUser, fetchReportsForMap, isUtility])

  useEffect(() => {
    if (isUtility && currentUser?.utilityId) {
      setSelectedUtilityId(currentUser.utilityId)
    }
  }, [currentUser?.utilityId, isUtility])

  const visibleUtilities = useMemo(() => {
    if (isAdmin) return utilities
    return utilities.filter((utility) => utility.id === currentUser?.utilityId)
  }, [currentUser?.utilityId, isAdmin, utilities])

  const visibleDMAs = useMemo(() => {
    const base = isAdmin ? dmas : dmas.filter((dma) => dma.utilityId === currentUser?.utilityId)
    if (selectedUtilityId === "all") return base
    return base.filter((dma) => dma.utilityId === selectedUtilityId)
  }, [currentUser?.utilityId, dmas, isAdmin, selectedUtilityId])

  const scopedReports = useMemo(() => {
    if (isAdmin) return reports
    if (isUtility && currentUser?.utilityId) {
      return reports.filter((report) => report.utilityId === currentUser.utilityId)
    }
    return []
  }, [currentUser?.utilityId, isAdmin, isUtility, reports])

  const filteredReports = useMemo(() => {
    return scopedReports.filter((report) => {
      const matchesDate = passesDateFilter(report.createdAt, dateFilter)
      const matchesUtility = selectedUtilityId === "all" ? true : report.utilityId === selectedUtilityId
      const matchesDMA = selectedDMAId === "all" ? true : report.dmaId === selectedDMAId
      return matchesDate && matchesUtility && matchesDMA
    })
  }, [dateFilter, scopedReports, selectedDMAId, selectedUtilityId])

  const statusChartData = useMemo(() => {
    const counts = new Map<string, number>()
    filteredReports.forEach((report) => {
      counts.set(report.status, (counts.get(report.status) ?? 0) + 1)
    })

    return (Object.keys(REPORT_STATUS_CONFIG) as ReportStatus[])
      .map((status) => ({
        name: REPORT_STATUS_CONFIG[status].label,
        count: counts.get(status) ?? 0,
      }))
      .filter((item) => item.count > 0)
  }, [filteredReports])

  const priorityChartData = useMemo(() => {
    const counts = new Map<string, number>()
    filteredReports.forEach((report) => {
      counts.set(report.priority, (counts.get(report.priority) ?? 0) + 1)
    })

    return (Object.keys(PRIORITY_CONFIG) as ReportPriority[])
      .map((priority) => ({
        name: PRIORITY_CONFIG[priority].label,
        count: counts.get(priority) ?? 0,
      }))
      .filter((item) => item.count > 0)
  }, [filteredReports])

  const leakageTypeChartData = useMemo(() => computeLeakageTypeDistribution(filteredReports), [filteredReports])
  const reportTypeChartData = useMemo(() => computeReportTypeDistribution(filteredReports), [filteredReports])

  const utilityChartData = useMemo(() => {
    if (!isAdmin) return []
    return visibleUtilities
      .map((utility) => ({
        name: utility.name.length > 18 ? `${utility.name.slice(0, 18)}…` : utility.name,
        count: filteredReports.filter((report) => report.utilityId === utility.id).length,
      }))
      .filter((item) => item.count > 0)
      .sort((left, right) => right.count - left.count)
  }, [filteredReports, isAdmin, visibleUtilities])

  const dmaChartData = useMemo(() => {
    return visibleDMAs
      .map((dma) => ({
        name: dma.name.length > 20 ? `${dma.name.slice(0, 20)}…` : dma.name,
        count: filteredReports.filter((report) => report.dmaId === dma.id).length,
      }))
      .filter((item) => item.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 12)
  }, [filteredReports, visibleDMAs])

  const monthlyTrendData = useMemo(() => {
    const now = new Date()
    const buckets = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1)
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: formatTanzaniaMonthLabel(date),
        count: 0,
      }
    })

    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]))

    filteredReports.forEach((report) => {
      const reportDate = new Date(report.createdAt)
      if (Number.isNaN(reportDate.getTime())) return
      const key = `${reportDate.getFullYear()}-${reportDate.getMonth()}`
      const bucket = bucketMap.get(key)
      if (bucket) bucket.count += 1
    })

    return buckets
  }, [filteredReports])

  const exportOperationalCsv = () => {
    const rows = [
      ["tracking_id", "description", "utility", "dma", "priority", "report_type", "leakage_type", "status", "created_at"],
      ...filteredReports.map((report) => [
        report.trackingId,
        report.description,
        report.utilityName,
        report.dmaName,
        report.priority,
        report.reportType || "leakage",
        (report.reportType || "leakage") === "leakage" ? report.leakageType || "unknown" : "",
        report.status,
        report.createdAt,
      ]),
    ]

    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "majiscope-analytics-export.csv"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  if (loading && !reports.length) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading analytics...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Workflow analytics for utility reports by status, priority, utility, DMA, and time."
      />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid gap-2 md:grid-cols-3 xl:max-w-2xl">
          <Select value={dateFilter} onValueChange={(value) => setDateFilter(value as DateFilter)}>
            <SelectTrigger className="h-10 rounded-2xl">
              <SelectValue placeholder="Date filter" />
            </SelectTrigger>
            <SelectContent>
              {DATE_FILTERS.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>
                  {filter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isAdmin ? (
            <Select value={selectedUtilityId} onValueChange={setSelectedUtilityId}>
              <SelectTrigger className="h-10 rounded-2xl">
                <SelectValue placeholder="Utility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All utilities</SelectItem>
                {visibleUtilities.map((utility) => (
                  <SelectItem key={utility.id} value={utility.id}>
                    {utility.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Select value={selectedDMAId} onValueChange={setSelectedDMAId}>
            <SelectTrigger className="h-10 rounded-2xl">
              <SelectValue placeholder="DMA" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All DMAs</SelectItem>
              {visibleDMAs.map((dma) => (
                <SelectItem key={dma.id} value={dma.id}>
                  {dma.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={exportOperationalCsv} className="gap-2 self-start xl:self-auto">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reports by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={statusChartData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={CHART_AXIS_TICK} />
                <YAxis type="category" dataKey="name" width={120} tick={CHART_AXIS_TICK} />
                <Tooltip />
                <Bar dataKey="count" fill={PALETTE.chart.chart1} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reports by Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={priorityChartData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={CHART_AXIS_TICK} />
                <YAxis type="category" dataKey="name" width={90} tick={CHART_AXIS_TICK} />
                <Tooltip />
                <Bar dataKey="count" fill={PALETTE.chart.chart3} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leakage by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {leakageTypeChartData.length ? (
              <div className="grid gap-4">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={leakageTypeChartData}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="transparent"
                    >
                      {leakageTypeChartData.map((row) => (
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
                <div className="grid gap-2 text-sm">
                  {leakageTypeChartData.map((row) => (
                    <div key={row.type} className="flex items-center justify-between gap-3 text-slate-600 dark:text-slate-300">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.fill }} />
                        <span className="truncate text-slate-700 dark:text-white">{row.name}</span>
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">{row.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                No leakage type data available yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report Type</CardTitle>
          </CardHeader>
          <CardContent>
            {reportTypeChartData.length ? (
              <div className="grid gap-4">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={reportTypeChartData}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="transparent"
                    >
                      {reportTypeChartData.map((row) => (
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
                <div className="grid gap-2 text-sm">
                  {reportTypeChartData.map((row) => (
                    <div key={row.type} className="flex items-center justify-between gap-3 text-slate-600 dark:text-slate-300">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.fill }} />
                        <span className="truncate text-slate-700 dark:text-white">{row.name}</span>
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">{row.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                No report type data available yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reports by Utility</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={utilityChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={CHART_AXIS_TICK} />
                <YAxis tick={CHART_AXIS_TICK} />
                <Tooltip />
                <Bar dataKey="count" fill={PALETTE.chart.chart1} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reports by DMA</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={dmaChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={CHART_AXIS_TICK} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis tick={CHART_AXIS_TICK} />
              <Tooltip />
              <Bar dataKey="count" fill={PALETTE.chart.chart5} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reports Over Time (Last 12 Months)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthlyTrendData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" tick={CHART_AXIS_TICK} />
              <YAxis tick={CHART_AXIS_TICK} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke={PALETTE.chart.chart2} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

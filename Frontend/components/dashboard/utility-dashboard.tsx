"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { getUtilityInfrastructureAsset, useDataStore } from "@/store/data-store"
import { PALETTE } from "@/lib/palette"
import { StatCard } from "@/components/shared/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ReportStatusMap } from "@/components/maps/report-status-map"
import { UtilityPipeNetworkMap } from "@/components/maps/utility-pipe-network-map"
import { EntityStatusBadge, PriorityBadge, ReportStatusBadge } from "@/components/shared/status-badge"
import { formatTanzaniaMonthLabel } from "@/lib/date-time"
import {
  MapPin,
  FileText,
  Users,
  CheckCircle2,
  AlertTriangle,
  Flame,
} from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts"

const HOTSPOT_CELL_SIZE = 0.0045
const RESOLVED_STATUSES = new Set(["approved", "closed"])

export function UtilityDashboard() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { getDMAsByUtility, getReportsByUtility, teams, engineers, utilities } =
    useDataStore()

  const utilityId = currentUser?.utilityId ?? ""
  const utility = utilities.find((u) => u.id === utilityId)
  const pipeNetworkAsset = getUtilityInfrastructureAsset(utility, "pipe_network")
  const myDMAs = getDMAsByUtility(utilityId)
  const myReports = getReportsByUtility(utilityId)
  const activeTeams = teams.filter(
    (t) =>
      myDMAs.some((d) => d.id === t.dmaId) && t.status === "active"
  ).length
  const resolvedReports = myReports.filter(
    (r) => r.status === "approved" || r.status === "closed"
  ).length
  const slaCompliance =
    myReports.length > 0
      ? Math.round((resolvedReports / myReports.length) * 100)
      : 0

  // DMA performance comparison
  const dmaPerformance = myDMAs.map((d) => {
    const dReports = myReports.filter((r) => r.dmaId === d.id)
    const dResolved = dReports.filter(
      (r) => r.status === "approved" || r.status === "closed"
    ).length
    return {
      name: d.name.replace("Johannesburg ", "JHB "),
      reports: dReports.length,
      resolved: dResolved,
    }
  })

  const slaTrend = useMemo(() => {
    const now = new Date()
    const buckets = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
      month: formatTanzaniaMonthLabel(date),
        total: 0,
        resolved: 0,
      }
    })

    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]))

    myReports.forEach((report) => {
      const reportDate = new Date(report.createdAt)
      if (Number.isNaN(reportDate.getTime())) return

      const key = `${reportDate.getFullYear()}-${reportDate.getMonth()}`
      const bucket = bucketMap.get(key)
      if (!bucket) return

      bucket.total += 1
      if (report.status === "approved" || report.status === "closed") {
        bucket.resolved += 1
      }
    })

    return buckets.map((bucket) => ({
      month: bucket.month,
      compliance: bucket.total > 0 ? Math.round((bucket.resolved / bucket.total) * 100) : 0,
      reports: bucket.total,
    }))
  }, [myReports])

  // Recent reports
  const recentReports = [...myReports]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  const utilityMapCenter = useMemo<[number, number] | null>(() => {
    const dmaWithCenter = myDMAs.find((dma) => dma.centerLatitude != null && dma.centerLongitude != null)
    if (dmaWithCenter?.centerLatitude != null && dmaWithCenter.centerLongitude != null) {
      return [dmaWithCenter.centerLatitude, dmaWithCenter.centerLongitude]
    }
    return null
  }, [myDMAs])

  const now = Date.now()
  const isOpenReport = (status: string) => !RESOLVED_STATUSES.has(status) && status !== "rejected"
  const isOverdue = (deadline?: string) => Boolean(deadline && new Date(deadline).getTime() < now)

  const dmaWatchlist = useMemo(() => {
    return myDMAs
      .map((dma) => {
        const reports = myReports.filter((report) => report.dmaId === dma.id)
        const openReports = reports.filter((report) => isOpenReport(report.status))
        const overdueReports = openReports.filter((report) => isOverdue(report.slaDeadline))
        const pendingApprovals = reports.filter((report) => report.status === "pending_approval").length
        const teamsInDMA = teams.filter((team) => team.dmaId === dma.id && team.status === "active").length
        const engineersInDMA = engineers.filter(
          (engineer) => engineer.dmaId === dma.id && engineer.status === "active"
        ).length
        const resolvedReportsCount = reports.filter((report) => RESOLVED_STATUSES.has(report.status)).length
        const completionRate = reports.length > 0 ? Math.round((resolvedReportsCount / reports.length) * 100) : 0

        return {
          id: dma.id,
          name: dma.name,
          openReports: openReports.length,
          overdueReports: overdueReports.length,
          pendingApprovals,
          teamsInDMA,
          engineersInDMA,
          completionRate,
        }
      })
      .sort((left, right) => {
        if (right.overdueReports !== left.overdueReports) {
          return right.overdueReports - left.overdueReports
        }
        if (right.openReports !== left.openReports) {
          return right.openReports - left.openReports
        }
        return left.completionRate - right.completionRate
      })
      .slice(0, 5)
  }, [myDMAs, myReports, teams, engineers])

  const hotspotWatch = useMemo(() => {
    const buckets = new Map<
      string,
      {
        count: number
        openCount: number
        dmaName: string
        address: string
        latitude: number
        longitude: number
      }
    >()

    myReports
      .filter((report) => Number.isFinite(report.latitude) && Number.isFinite(report.longitude))
      .forEach((report) => {
        const latBucket = Math.round(report.latitude / HOTSPOT_CELL_SIZE)
        const lngBucket = Math.round(report.longitude / HOTSPOT_CELL_SIZE)
        const key = `${latBucket}:${lngBucket}`
        const current = buckets.get(key) ?? {
          count: 0,
          openCount: 0,
          dmaName: report.dmaName,
          address: report.address || report.description,
          latitude: report.latitude,
          longitude: report.longitude,
        }
        current.count += 1
        current.openCount += isOpenReport(report.status) ? 1 : 0
        if (new Date(report.updatedAt).getTime() >= 0) {
          current.dmaName = report.dmaName
          current.address = report.address || report.description
        }
        buckets.set(key, current)
      })

    return Array.from(buckets.values())
      .filter((bucket) => bucket.count > 1)
      .sort((left, right) => {
        if (right.openCount !== left.openCount) {
          return right.openCount - left.openCount
        }
        return right.count - left.count
      })
      .slice(0, 6)
  }, [myReports])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {utility?.name ?? "Utility"} Overview
        </h2>
        <p className="text-sm text-muted-foreground">
          Utility water leakage management dashboard
        </p>
      </div>

      {/* Stat cards */}
      <div className="stagger-children grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total DMAs"
          value={myDMAs.length}
          icon={MapPin}
          gradient="blue"
          trend={{ value: 10, isPositive: true }}
        />
        <StatCard
          title="Utility Reports"
          value={myReports.length}
          icon={FileText}
          gradient="amber"
          trend={{ value: 18, isPositive: true }}
        />
        <StatCard
          title="Active Teams"
          value={activeTeams}
          icon={Users}
          gradient="emerald"
          trend={{ value: 5, isPositive: true }}
        />
        <StatCard
          title="Resolution Rate"
          value={slaCompliance}
          suffix="%"
          icon={CheckCircle2}
          gradient="cyan"
          trend={{ value: 3, isPositive: true }}
        />
      </div>

      <ReportStatusMap
        title="Utility Report Map"
        description="View report distribution across all DMAs in this utility. Red marks unassigned reports, yellow marks assigned work, and green marks completed reports."
        reports={myReports.map((report) => ({
          id: report.id,
          trackingId: report.trackingId,
          description: report.description,
          latitude: report.latitude,
          longitude: report.longitude,
          status: report.status,
          priority: report.priority,
          dmaName: report.dmaName,
          teamName: report.teamName,
        }))}
        center={utilityMapCenter}
        onReportSelect={(reportId) => router.push(`/dashboard/reports/${reportId}`)}
        emptyMessage="No geolocated reports are available for this utility yet."
      />

      {utility && pipeNetworkAsset ? (
        <UtilityPipeNetworkMap
          utilityId={utility.id}
          previewUrl={pipeNetworkAsset.previewUrl}
          fileName={pipeNetworkAsset.fileName}
          fallbackCenter={utilityMapCenter}
          title="Utility Pipe Network Map"
          emptyMessage="Upload a supported utility pipe network file to overlay it here."
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Operational Watchlist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dmaWatchlist.map((dma) => (
              <button
                key={dma.id}
                type="button"
                onClick={() => router.push(`/dashboard/reports?dma=${dma.id}`)}
                className="w-full rounded-2xl border border-border/70 bg-card p-4 text-left transition-all hover:border-primary/30 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{dma.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dma.teamsInDMA} active teams · {dma.engineersInDMA} active engineers
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                    {dma.pendingApprovals} awaiting DMA
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Open</p>
                    <p className="mt-1 font-semibold text-foreground">{dma.openReports}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Overdue</p>
                    <p className="mt-1 font-semibold text-rose-600">{dma.overdueReports}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Resolved</p>
                    <p className="mt-1 font-semibold text-emerald-600">{dma.completionRate}%</p>
                  </div>
                </div>
              </button>
            ))}
            {dmaWatchlist.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                DMA watchlist signals will appear here as report activity grows.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-rose-500" />
              Recurring Hotspots
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hotspotWatch.map((hotspot, index) => (
              <div key={`${hotspot.latitude}-${hotspot.longitude}-${index}`} className="rounded-2xl border border-border/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{hotspot.address || "Leakage cluster"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{hotspot.dmaName}</p>
                  </div>
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                    {hotspot.count} reports
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                    Open: {hotspot.openCount}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                    {hotspot.latitude.toFixed(4)}, {hotspot.longitude.toFixed(4)}
                  </span>
                </div>
              </div>
            ))}
            {hotspotWatch.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No repeated leakage corridors are standing out across the utility right now.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* DMA performance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">DMA Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dmaPerformance}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="reports" name="Total" fill={PALETTE.chart.chart1} radius={[4, 4, 0, 0]} />
                <Bar dataKey="resolved" name="Resolved" fill={PALETTE.chart.chart2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Resolution trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resolution Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={slaTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis domain={[60, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="compliance"
                  name="Resolved %"
                  stroke={PALETTE.chart.chart1}
                  strokeWidth={2}
                  dot={{ fill: PALETTE.chart.chart1, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent reports */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <WaterUtilityIcon className="h-4 w-4 text-primary" />
            Recent Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {recentReports.length > 0 ? (
              recentReports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => router.push(`/dashboard/reports/${report.trackingId || report.id}`)}
                  className="w-full rounded-2xl border border-border/70 bg-card p-4 text-left transition-all hover:border-primary/30 hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-sans text-xs font-extrabold tracking-[0.045em] text-foreground">{report.trackingId}</p>
                      <p className="mt-2 text-sm font-medium text-foreground">{report.description}</p>
                    </div>
                    <PriorityBadge priority={report.priority} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div>
                      <p className="uppercase tracking-wide">DMA</p>
                      <p className="mt-1 text-sm text-foreground">{report.dmaName}</p>
                    </div>
                    <div>
                      <p className="uppercase tracking-wide">Status</p>
                      <div className="mt-1">
                        <ReportStatusBadge status={report.status} />
                      </div>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No recent reports are available for this utility yet.
              </div>
            )}
          </div>
          <div className="hidden md:block">
            <table className="modern-table table-fixed">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Tracking ID</th>
                  <th className="pb-3 pr-4 font-medium">Description</th>
                  <th className="pb-3 pr-4 font-medium">DMA</th>
                  <th className="pb-3 pr-4 font-medium">Priority</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentReports.map((report) => (
                  <tr key={report.id} className="hover:bg-muted/50">
                    <td className="py-3 pr-4 font-sans text-xs font-extrabold tracking-[0.045em]">
                      {report.trackingId}
                    </td>
                    <td className="max-w-xs break-words py-3 pr-4 text-muted-foreground">
                      {report.description}
                    </td>
                    <td className="py-3 pr-4">{report.dmaName}</td>
                    <td className="py-3 pr-4">
                      <PriorityBadge priority={report.priority} />
                    </td>
                    <td className="py-3">
                      <ReportStatusBadge status={report.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

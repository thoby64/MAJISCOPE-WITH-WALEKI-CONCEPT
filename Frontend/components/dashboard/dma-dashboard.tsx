"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { PALETTE } from "@/lib/palette"
import { StatCard } from "@/components/shared/stat-card"
import { formatTanzaniaDate } from "@/lib/date-time"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ReportStatusMap } from "@/components/maps/report-status-map"
import {
  EntityStatusBadge,
  PriorityBadge,
  ReportStatusBadge,
} from "@/components/shared/status-badge"
import {
  FileText,
  Users,
  ClipboardCheck,
  UserCog,
  AlertTriangle,
  Flame,
  ShieldAlert,
  Clock3,
  Gauge,
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"

const PIE_COLORS = PALETTE.chartSeries
const HOTSPOT_CELL_SIZE = 0.0035
const RESOLVED_STATUSES = new Set(["approved", "closed"])

export function DMADashboard() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const {
    getReportsByDMA,
    getTeamsByDMA,
    getEngineersByDMA,
    dmas,
  } = useDataStore()

  const dmaId = currentUser?.dmaId ?? ""
  const dma = dmas.find((d) => d.id === dmaId)
  const myReports = getReportsByDMA(dmaId)
  const myTeams = getTeamsByDMA(dmaId)
  const myEngineers = getEngineersByDMA(dmaId)

  const dmaMapCenter = useMemo<[number, number] | null>(() => {
    if (dma?.centerLatitude != null && dma?.centerLongitude != null) {
      return [dma.centerLatitude, dma.centerLongitude]
    }
    return null
  }, [dma?.centerLatitude, dma?.centerLongitude])

  const activeReports = myReports.filter(
    (r) => r.status !== "closed" && r.status !== "approved" && r.status !== "rejected"
  ).length
  const assignedReports = myReports.filter((r) => r.status === "assigned").length
  const pendingApprovals = myReports.filter(
    (r) => r.status === "pending_approval"
  ).length
  const activeEngineers = myEngineers.filter((e) => e.status === "active").length
  const now = Date.now()

  const isOpenReport = (status: string) => !RESOLVED_STATUSES.has(status) && status !== "rejected"
  const isOverdue = (deadline?: string) =>
    Boolean(deadline && new Date(deadline).getTime() < now)

  // Engineer role distribution for pie chart
  const engineerRoles = [
    {
      name: "Engineers",
      value: myEngineers.filter((e) => e.role === "engineer" && e.status === "active").length,
    },
    {
      name: "Team Leaders",
      value: myEngineers.filter((e) => e.role === "team_leader" && e.status === "active").length,
    },
    {
      name: "Inactive",
      value: myEngineers.filter((e) => e.status === "inactive").length,
    },
  ].filter((r) => r.value > 0)

  const teamData = myTeams.map((team) => ({
    name: team.name,
    engineers: myEngineers.filter((engineer) => engineer.teamId === team.id).length,
    reports: myReports.filter((report) => report.teamId === team.id).length,
  }))

  const teamInsights = useMemo(() => {
    return myTeams
      .map((team) => {
        const teamReports = myReports.filter((report) => report.teamId === team.id)
        const openReports = teamReports.filter((report) => isOpenReport(report.status))
        const overdueReports = openReports.filter((report) => isOverdue(report.slaDeadline))
        const awaitingReview = teamReports.filter((report) => report.status === "pending_approval")
        const criticalReports = openReports.filter(
          (report) => report.priority === "critical" || report.priority === "high"
        )
        const activeMembers = myEngineers.filter(
          (engineer) => engineer.teamId === team.id && engineer.status === "active"
        ).length
        const loadPerMember = activeMembers > 0 ? openReports.length / activeMembers : openReports.length

        let healthLabel = "Balanced"
        let healthTone = "text-emerald-700 bg-emerald-50 border-emerald-200"
        if (overdueReports.length > 0 || loadPerMember >= 3) {
          healthLabel = "Needs attention"
          healthTone = "text-rose-700 bg-rose-50 border-rose-200"
        } else if (awaitingReview.length > 0 || loadPerMember >= 2) {
          healthLabel = "Watch closely"
          healthTone = "text-amber-700 bg-amber-50 border-amber-200"
        }

        return {
          id: team.id,
          name: team.name,
          leaderName: team.leaderName,
          activeMembers,
          openReports: openReports.length,
          overdueReports: overdueReports.length,
          awaitingReview: awaitingReview.length,
          criticalReports: criticalReports.length,
          loadPerMember,
          healthLabel,
          healthTone,
        }
      })
      .sort((left, right) => {
        if (right.overdueReports !== left.overdueReports) {
          return right.overdueReports - left.overdueReports
        }
        if (right.openReports !== left.openReports) {
          return right.openReports - left.openReports
        }
        return right.criticalReports - left.criticalReports
      })
  }, [myTeams, myReports, myEngineers])

  const hotspotWatch = useMemo(() => {
    const buckets = new Map<
      string,
      {
        count: number
        openCount: number
        highPriority: number
        latestUpdate: string
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
        const existing = buckets.get(key)
        const isHighPriority = report.priority === "critical" || report.priority === "high"
        const next = existing ?? {
          count: 0,
          openCount: 0,
          highPriority: 0,
          latestUpdate: report.updatedAt,
          address: report.address || report.description,
          latitude: report.latitude,
          longitude: report.longitude,
        }

        next.count += 1
        next.openCount += isOpenReport(report.status) ? 1 : 0
        next.highPriority += isHighPriority ? 1 : 0
        if (new Date(report.updatedAt).getTime() > new Date(next.latestUpdate).getTime()) {
          next.latestUpdate = report.updatedAt
          next.address = report.address || report.description
        }
        buckets.set(key, next)
      })

    return Array.from(buckets.values())
      .filter((bucket) => bucket.count > 1 || bucket.highPriority > 0)
      .sort((left, right) => {
        if (right.highPriority !== left.highPriority) {
          return right.highPriority - left.highPriority
        }
        if (right.openCount !== left.openCount) {
          return right.openCount - left.openCount
        }
        return right.count - left.count
      })
      .slice(0, 5)
  }, [myReports])

  // Recent reports
  const recentReports = [...myReports]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-balance">
          {dma?.name ?? "DMA"} Operations
        </h2>
        <p className="text-sm text-muted-foreground">
          Operational control dashboard for your DMA
        </p>
      </div>

      {/* Stat cards */}
      <div className="stagger-children grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Active Reports"
          value={activeReports}
          icon={FileText}
          gradient="amber"
          trend={{ value: 12, isPositive: false }}
        />
        <StatCard
          title="Pending Approvals"
          value={pendingApprovals}
          icon={ClipboardCheck}
          gradient="red"
          trend={{ value: 2, isPositive: false }}
        />
        <StatCard
          title="Active Engineers"
          value={activeEngineers}
          icon={Users}
          gradient="emerald"
          trend={{ value: 8, isPositive: true }}
        />
        <StatCard
          title="Total Teams"
          value={myTeams.length}
          icon={WaterUtilityIcon}
          gradient="blue"
          trend={{ value: 5, isPositive: true }}
        />
      </div>

      <ReportStatusMap
        title="DMA Report Map"
        description="Red dots are new and unassigned reports, yellow dots are assigned or in progress, and green dots are completed reports inside this DMA."
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
        center={dmaMapCenter}
        onReportSelect={(reportId) => router.push(`/dashboard/reports/${reportId}`)}
        emptyMessage="No geolocated reports are available in this DMA yet."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-primary" />
              Team Workload Balance
            </CardTitle>
            <CardDescription className="text-xs">
              Spot overloaded crews, overdue field work, and review bottlenecks before they slow the DMA down.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {teamInsights.map((team) => (
              <div
                key={team.id}
                className="rounded-2xl border border-border/70 bg-muted/20 p-4 transition-all hover:border-primary/30 hover:bg-muted/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{team.name}</p>
                    <p className="text-xs text-muted-foreground">Leader: {team.leaderName || "Unassigned"}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${team.healthTone}`}>
                    {team.healthLabel}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Open work</p>
                    <p className="mt-1 font-semibold text-foreground">{team.openReports}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Overdue</p>
                    <p className="mt-1 font-semibold text-rose-600">{team.overdueReports}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Awaiting review</p>
                    <p className="mt-1 font-semibold text-amber-600">{team.awaitingReview}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Load / member</p>
                    <p className="mt-1 font-semibold text-foreground">{team.loadPerMember.toFixed(1)}</p>
                  </div>
                </div>
              </div>
            ))}
            {teamInsights.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Team workload insights will appear here once this DMA has active teams.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-rose-500" />
              Hotspot Watch
            </CardTitle>
            <CardDescription className="text-xs">
              Repeated leakage points and priority-heavy pockets that deserve faster field attention.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {hotspotWatch.map((hotspot, index) => (
              <div key={`${hotspot.latitude}-${hotspot.longitude}-${index}`} className="rounded-2xl border border-border/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{hotspot.address || "Repeated leakage area"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hotspot.latitude.toFixed(4)}, {hotspot.longitude.toFixed(4)}
                    </p>
                  </div>
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                    {hotspot.count} reports
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                    Open: {hotspot.openCount}
                  </span>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                    High priority: {hotspot.highPriority}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                    Updated: {formatTanzaniaDate(hotspot.latestUpdate)}
                  </span>
                </div>
              </div>
            ))}
            {hotspotWatch.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No repeated leakage hotspots are standing out in this DMA right now.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Team overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Team Overview</CardTitle>
            <CardDescription className="text-xs">
              Engineers and report load per team
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={teamData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                />
                <XAxis
                  dataKey="name"
                  tick={{
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                  }}
                />
                <YAxis
                  tick={{
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Bar
                  dataKey="engineers"
                  name="Engineers"
                  fill={PALETTE.chart.chart1}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="reports"
                  name="Reports"
                  fill={PALETTE.chart.chart2}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Engineer distribution pie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Engineer Status</CardTitle>
            <CardDescription className="text-xs">
              Active role distribution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={engineerRoles}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {engineerRoles.map((_, index) => (
                    <Cell
                      key={index}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Teams summary cards */}
      <div>
        <h3 className="mb-3 text-base font-semibold">Teams Summary</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {myTeams.map((team) => (
            <Card
              key={team.id}
              className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <UserCog className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{team.name}</p>
                      <p className="text-[11px] text-muted-foreground">{dma?.name ?? "DMA Team"}</p>
                    </div>
                  </div>
                  <EntityStatusBadge status={team.status} />
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    <span>{team.memberCount} members</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span>{team.activeReports} active</span>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Leader: {team.leaderName}
                </p>
              </CardContent>
            </Card>
          ))}
          {myTeams.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-8">
                <UserCog className="h-8 w-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">
                  No teams found in this DMA
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recent reports */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="h-4 w-4 text-primary" />
            Recent Reports
          </CardTitle>
          <CardDescription className="text-xs">
            Latest report activity in your DMA
          </CardDescription>
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
                      <p className="uppercase tracking-wide">Team</p>
                      <p className="mt-1 text-sm text-foreground">{report.teamName ?? "Unassigned"}</p>
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
                No reports found in this DMA yet.
              </div>
            )}
          </div>
          <div className="hidden md:block">
            <table className="modern-table table-fixed">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Tracking ID</th>
                  <th className="pb-3 pr-4 font-medium">Description</th>
                  <th className="pb-3 pr-4 font-medium">Team</th>
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
                    <td className="py-3 pr-4 text-muted-foreground">
                      {report.teamName ?? "Unassigned"}
                    </td>
                    <td className="py-3 pr-4">
                      <PriorityBadge priority={report.priority} />
                    </td>
                    <td className="py-3">
                      <ReportStatusBadge status={report.status} />
                    </td>
                  </tr>
                ))}
                {recentReports.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No reports found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

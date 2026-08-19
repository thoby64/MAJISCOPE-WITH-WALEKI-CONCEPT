"use client"

import { useDataStore } from "@/store/data-store"
import { PALETTE } from "@/lib/palette"
import { StatCard } from "@/components/shared/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EntityStatusBadge, ReportStatusBadge } from "@/components/shared/status-badge"
import {
  Globe,
  MapPin,
  FileText,
  AlertTriangle,
  Users,
  CheckCircle2,
  ShieldAlert,
  UserX,
  ClipboardList,
} from "lucide-react"
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

export function AdminDashboard() {
  const { utilities, dmas, reports, engineers } = useDataStore()

  const totalReports = reports.length
  const pendingReports = reports.filter(
    (r) => r.status === "new" || r.status === "pending_approval"
  ).length
  const activeEngineers = engineers.filter((e) => e.status === "active").length
  const resolvedReports = reports.filter(
    (r) => r.status === "approved" || r.status === "closed"
  ).length
  const slaCompliance = totalReports > 0 ? Math.round((resolvedReports / totalReports) * 100) : 0
  const inactiveEngineers = engineers.filter((e) => e.status !== "active").length
  const dmasWithoutManager = dmas.filter((dma) => !dma.managerId).length
  const reportsWithoutUtility = reports.filter((report) => !report.utilityId).length
  const reportsWithoutDMA = reports.filter((report) => report.utilityId && !report.dmaId).length
  const unassignedReports = reports.filter((report) => !report.teamId).length
  const utilitiesWithoutManager = utilities.filter((utility) => !utility.managerId).length
  const governanceAlerts = [
    {
      label: "Utilities without managers",
      value: utilitiesWithoutManager,
      tone: "text-rose-700 bg-rose-50",
      icon: ShieldAlert,
    },
    {
      label: "DMAs without managers",
      value: dmasWithoutManager,
      tone: "text-amber-700 bg-amber-50",
      icon: ClipboardList,
    },
    {
      label: "Inactive engineers",
      value: inactiveEngineers,
      tone: "text-blue-700 bg-blue-50",
      icon: UserX,
    },
    {
      label: "Reports without utility",
      value: reportsWithoutUtility,
      tone: "text-sky-700 bg-sky-50",
      icon: Globe,
    },
    {
      label: "Reports without DMA",
      value: reportsWithoutDMA,
      tone: "text-orange-700 bg-orange-50",
      icon: MapPin,
    },
    {
      label: "Unassigned reports",
      value: unassignedReports,
      tone: "text-emerald-700 bg-emerald-50",
      icon: AlertTriangle,
    },
  ]

  // Reports by utility for bar chart
  const reportsByUtility = utilities.map((utility) => ({
    name: utility.name,
    reports: reports.filter((r) => r.utilityId === utility.id).length,
    resolved: reports.filter(
      (r) =>
        r.utilityId === utility.id &&
        (r.status === "approved" || r.status === "closed")
    ).length,
  }))

  // Reports by status for pie chart
  const statusCounts = [
    { name: "New", value: reports.filter((r) => r.status === "new").length },
    { name: "Assigned", value: reports.filter((r) => r.status === "assigned").length },
    { name: "In Progress", value: reports.filter((r) => r.status === "in_progress").length },
    { name: "Pending Approval", value: reports.filter((r) => r.status === "pending_approval").length },
    { name: "Approved", value: reports.filter((r) => r.status === "approved").length },
    { name: "Rejected", value: reports.filter((r) => r.status === "rejected").length },
    { name: "Closed", value: reports.filter((r) => r.status === "closed").length },
  ].filter((s) => s.value > 0)

  const operationsWatchlist = dmas
    .map((dma) => {
      const dmaReports = reports.filter((report) => report.dmaId === dma.id)
      const open = dmaReports.filter((report) => !["approved", "closed", "rejected"].includes(report.status)).length
      const pending = dmaReports.filter((report) => report.status === "pending_approval").length
      const resolved = dmaReports.filter((report) => ["approved", "closed"].includes(report.status)).length
      const resolvedRate = dmaReports.length > 0 ? Math.round((resolved / dmaReports.length) * 100) : 0
      return {
        id: dma.id,
        name: dma.name,
        utilityName: dma.utilityName,
        open,
        pending,
        resolvedRate,
      }
    })
    .sort((left, right) => {
      if (right.pending !== left.pending) return right.pending - left.pending
      if (right.open !== left.open) return right.open - left.open
      return left.resolvedRate - right.resolvedRate
    })
    .slice(0, 6)

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">System Overview</h2>
        <p className="text-sm text-muted-foreground">
          National water leakage management dashboard
        </p>
      </div>

      {/* Stat cards */}
      <div className="stagger-children grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Total Utilities"
          value={utilities.length}
          icon={Globe}
          gradient="blue"
          trend={{ value: 12, isPositive: true }}
        />
        <StatCard
          title="Total DMAs"
          value={dmas.length}
          icon={MapPin}
          gradient="cyan"
          trend={{ value: 8, isPositive: true }}
        />
        <StatCard
          title="Total Reports"
          value={totalReports}
          icon={FileText}
          gradient="amber"
          trend={{ value: 24, isPositive: true }}
        />
        <StatCard
          title="Pending Reports"
          value={pendingReports}
          icon={AlertTriangle}
          gradient="red"
          trend={{ value: 5, isPositive: false }}
        />
        <StatCard
          title="Active Engineers"
          value={activeEngineers}
          icon={Users}
          gradient="emerald"
          trend={{ value: 15, isPositive: true }}
        />
        <StatCard
          title="Resolution Rate"
          value={slaCompliance}
          suffix="%"
          icon={CheckCircle2}
          gradient="blue"
          trend={{ value: 3, isPositive: true }}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Bar chart - reports by utility */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Reports by Utility</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={reportsByUtility}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="reports" name="Total Reports" fill={PALETTE.chart.chart1} radius={[4, 4, 0, 0]} />
                <Bar dataKey="resolved" name="Resolved" fill={PALETTE.chart.chart2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pie chart - report status distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusCounts}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusCounts.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
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
                <Legend
                  wrapperStyle={{ fontSize: "11px" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Utility performance table */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Governance Watch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {governanceAlerts.map((alert) => {
              const Icon = alert.icon
              return (
                <div key={alert.label} className="flex items-center justify-between rounded-2xl border border-border/70 p-4">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2 ${alert.tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{alert.label}</p>
                      <p className="text-xs text-muted-foreground">Accounts and ownership gaps that should be corrected soon.</p>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-foreground">{alert.value}</span>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">National Operations Watchlist</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 md:hidden">
              {operationsWatchlist.map((dma) => (
                <div key={dma.id} className="rounded-2xl border border-border/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{dma.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{dma.utilityName}</p>
                    </div>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                      {dma.pending} pending
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Open</p>
                      <p className="mt-1 font-semibold text-foreground">{dma.open}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pending</p>
                      <p className="mt-1 font-semibold text-amber-700">{dma.pending}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Resolved</p>
                      <p className="mt-1 font-semibold text-emerald-600">{dma.resolvedRate}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <table className="modern-table table-fixed">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">DMA</th>
                    <th className="pb-3 pr-4 font-medium">Utility</th>
                    <th className="pb-3 pr-4 font-medium text-center">Open</th>
                    <th className="pb-3 pr-4 font-medium text-center">Pending Approval</th>
                    <th className="pb-3 font-medium text-center">Resolved %</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {operationsWatchlist.map((dma) => (
                    <tr key={dma.id} className="hover:bg-muted/50">
                      <td className="py-3 pr-4 font-medium">{dma.name}</td>
                      <td className="break-words py-3 pr-4 text-muted-foreground">{dma.utilityName}</td>
                      <td className="py-3 pr-4 text-center">{dma.open}</td>
                      <td className="py-3 pr-4 text-center">{dma.pending}</td>
                      <td className="py-3 text-center">{dma.resolvedRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utility Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {utilities.map((utility) => {
              const utilityReports = reports.filter((report) => report.utilityId === utility.id)
              const utilityResolved = utilityReports.filter((report) => report.status === "approved" || report.status === "closed").length
              return (
                <div key={utility.id} className="rounded-2xl border border-border/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{utility.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{utility.managerName || "No manager assigned"}</p>
                    </div>
                    <EntityStatusBadge status={utility.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">DMAs</p>
                      <p className="mt-1 font-semibold text-foreground">{utility.dmasCount}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Reports</p>
                      <p className="mt-1 font-semibold text-foreground">{utilityReports.length}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Resolved</p>
                      <p className="mt-1 font-semibold text-emerald-600">{utilityResolved}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="hidden md:block">
            <table className="modern-table table-fixed">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-3 pr-4 font-medium">Utility</th>
                  <th className="pb-3 pr-4 font-medium">Manager</th>
                  <th className="pb-3 pr-4 font-medium text-center">DMAs</th>
                  <th className="pb-3 pr-4 font-medium text-center">Reports</th>
                  <th className="pb-3 pr-4 font-medium text-center">Resolved</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {utilities.map((utility) => {
                  const utilityReports = reports.filter((r) => r.utilityId === utility.id)
                  const utilityResolved = utilityReports.filter(
                    (r) => r.status === "approved" || r.status === "closed"
                  ).length
                  return (
                    <tr key={utility.id} className="hover:bg-muted/50">
                      <td className="py-3 pr-4 font-medium">{utility.name}</td>
                      <td className="break-words py-3 pr-4 text-muted-foreground">{utility.managerName}</td>
                      <td className="py-3 pr-4 text-center">{utility.dmasCount}</td>
                      <td className="py-3 pr-4 text-center">{utilityReports.length}</td>
                      <td className="py-3 pr-4 text-center">{utilityResolved}</td>
                      <td className="py-3">
                        <EntityStatusBadge status={utility.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

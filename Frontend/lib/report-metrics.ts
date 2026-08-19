import type { Report } from "@/store/data-store"
import { LEAKAGE_TYPE_CONFIG } from "@/lib/constants"
import type { LeakageType, ReportType } from "@/lib/types"
import { PALETTE } from "@/lib/palette"

const LEAKAGE_TYPE_KEYS = Object.keys(LEAKAGE_TYPE_CONFIG) as LeakageType[]

export type LeakageTypeDistributionRow = {
  type: LeakageType
  name: string
  count: number
  percentage: number
  fill: string
}

export type ReportTypeDistributionRow = {
  type: ReportType
  name: string
  count: number
  percentage: number
  fill: string
}

export function hasUsableCoordinates(report: Pick<Report, "latitude" | "longitude">) {
  return (
    Number.isFinite(report.latitude) &&
    Number.isFinite(report.longitude) &&
    !(report.latitude === 0 && report.longitude === 0)
  )
}

export function isResolvedReport(status: string) {
  return status === "approved" || status === "closed"
}

export function isUnattendedReport(status: string) {
  return status === "new" || status === "assigned" || status === "in_progress"
}

export function isUrgentReport(priority: string) {
  return priority === "critical" || priority === "high"
}

export function getSimpleMapStatusMeta(status: string) {
  if (status === "pending_approval") {
    return {
      label: "Awaiting approval",
      fill: PALETTE.map.status.pendingApproval.fill,
      stroke: PALETTE.map.status.pendingApproval.stroke,
    }
  }

  if (isResolvedReport(status)) {
    return {
      label: status === "closed" ? "Closed" : "Repaired",
      fill: PALETTE.map.status.resolved.fill,
      stroke: PALETTE.map.status.resolved.stroke,
    }
  }

  return {
    label: "Open",
    fill: PALETTE.map.status.open.fill,
    stroke: PALETTE.map.status.open.stroke,
  }
}

export function computeLeakKpis(reports: Report[]) {
  return {
    total: reports.length,
    repaired: reports.filter((report) => isResolvedReport(report.status)).length,
    urgent: reports.filter((report) => isUrgentReport(report.priority)).length,
    unattended: reports.filter((report) => isUnattendedReport(report.status)).length,
    withCoordinates: reports.filter(hasUsableCoordinates).length,
  }
}

export function normalizeLeakageType(value: string | null | undefined): LeakageType {
  const normalized = String(value || "").trim().toLowerCase() as LeakageType
  return LEAKAGE_TYPE_KEYS.includes(normalized) ? normalized : "unknown"
}

export function computeLeakageTypeDistribution(reports: Report[]): LeakageTypeDistributionRow[] {
  const counts = new Map<LeakageType, number>(LEAKAGE_TYPE_KEYS.map((type) => [type, 0]))
  const leakageReports = reports.filter((report) => (report.reportType || "leakage") === "leakage")

  leakageReports.forEach((report) => {
    const type = normalizeLeakageType(report.leakageType)
    counts.set(type, (counts.get(type) || 0) + 1)
  })

  const total = Math.max(leakageReports.length, 1)

  return LEAKAGE_TYPE_KEYS
    .map((type) => {
      const count = counts.get(type) || 0
      const config = LEAKAGE_TYPE_CONFIG[type]
      return {
        type,
        name: config.label,
        count,
        percentage: Math.round((count / total) * 1000) / 10,
        fill: config.color,
      }
    })
    .filter((row) => row.count > 0)
}

export function computeReportTypeDistribution(reports: Report[]): ReportTypeDistributionRow[] {
  const reportTypes: Array<{
    type: ReportType
    name: string
    fill: string
  }> = [
    { type: "leakage", name: "Leakage", fill: PALETTE.chart.chart1 },
    { type: "non_leakage", name: "Non-leakage", fill: PALETTE.semantic.neutral.base },
  ]
  const counts = new Map<ReportType, number>(reportTypes.map(({ type }) => [type, 0]))

  reports.forEach((report) => {
    const type: ReportType = report.reportType === "non_leakage" ? "non_leakage" : "leakage"
    counts.set(type, (counts.get(type) || 0) + 1)
  })

  const total = Math.max(reports.length, 1)

  return reportTypes
    .map(({ type, name, fill }) => {
      const count = counts.get(type) || 0
      return {
        type,
        name,
        count,
        percentage: Math.round((count / total) * 1000) / 10,
        fill,
      }
    })
    .filter((row) => row.count > 0)
}

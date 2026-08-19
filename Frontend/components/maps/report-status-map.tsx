"use client"

import dynamic from "next/dynamic"

const ReportStatusMapInner = dynamic(
  () => import("./report-status-map-impl").then((module) => module.ReportStatusMapImpl),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        Loading report map...
      </div>
    ),
  }
)

export interface ReportMapItem {
  id: string
  trackingId: string
  description: string
  latitude: number
  longitude: number
  status: string
  priority?: string
  dmaName?: string | null
  teamName?: string | null
}

export function ReportStatusMap(props: {
  title: string
  description: string
  reports: ReportMapItem[]
  center?: [number, number] | null
  onReportSelect?: (reportId: string) => void
  emptyMessage?: string
}) {
  return <ReportStatusMapInner {...props} />
}

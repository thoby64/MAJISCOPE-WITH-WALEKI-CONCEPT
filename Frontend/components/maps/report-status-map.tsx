"use client"

import { useMemo, useState } from "react"
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet"
import { Button } from "@/components/ui/button"
import { PALETTE } from "@/lib/palette"

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

const DEFAULT_CENTER: [number, number] = [-6.7924, 39.2083]
const CLUSTER_CELL_SIZE = 0.0035

type StatusFilter = "all" | "new" | "active" | "completed"

const getReportColor = (status: string) => {
  switch (status) {
    case "new": {
      const c = PALETTE.map.status.open
      return { fill: c.fill, stroke: c.stroke, label: "Unassigned" }
    }
    case "assigned":
    case "in_progress":
    case "pending_approval": {
      const c = PALETTE.map.status.pendingApproval
      return { fill: c.fill, stroke: c.stroke, label: "Assigned / In Progress" }
    }
    case "approved":
    case "closed": {
      const c = PALETTE.map.status.resolved
      return { fill: c.fill, stroke: c.stroke, label: "Completed" }
    }
    default:
      return { fill: PALETTE.semantic.neutral.base, stroke: PALETTE.semantic.neutral.strong, label: "Other" }
  }
}

export function ReportStatusMap({
  title,
  description,
  reports,
  center,
  onReportSelect,
  emptyMessage = "No reports with location data are available for this map yet.",
}: {
  title: string
  description: string
  reports: ReportMapItem[]
  center?: [number, number] | null
  onReportSelect?: (reportId: string) => void
  emptyMessage?: string
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const validReports = useMemo(
    () =>
      reports.filter(
        (report) =>
          Number.isFinite(report.latitude) &&
          Number.isFinite(report.longitude) &&
          !(report.latitude === 0 && report.longitude === 0)
      ),
    [reports]
  )

  const filteredReports = useMemo(() => {
    switch (statusFilter) {
      case "new":
        return validReports.filter((report) => report.status === "new")
      case "active":
        return validReports.filter((report) =>
          ["assigned", "in_progress", "pending_approval"].includes(report.status)
        )
      case "completed":
        return validReports.filter((report) =>
          ["approved", "closed"].includes(report.status)
        )
      default:
        return validReports
    }
  }, [statusFilter, validReports])

  const clusteredReports = useMemo(() => {
    const groups = new Map<
      string,
      {
        latitude: number
        longitude: number
        reports: ReportMapItem[]
      }
    >()

    filteredReports.forEach((report) => {
      const latKey = Math.round(report.latitude / CLUSTER_CELL_SIZE)
      const lngKey = Math.round(report.longitude / CLUSTER_CELL_SIZE)
      const key = `${latKey}:${lngKey}`
      const existing = groups.get(key)
      if (existing) {
        existing.reports.push(report)
        existing.latitude =
          existing.reports.reduce((sum, item) => sum + item.latitude, 0) / existing.reports.length
        existing.longitude =
          existing.reports.reduce((sum, item) => sum + item.longitude, 0) / existing.reports.length
      } else {
        groups.set(key, {
          latitude: report.latitude,
          longitude: report.longitude,
          reports: [report],
        })
      }
    })

    return Array.from(groups.values())
  }, [filteredReports])

  const mapCenter = useMemo<[number, number]>(() => {
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      return center
    }

    if (filteredReports.length === 0) {
      return DEFAULT_CENTER
    }

    const latitudeAverage =
      filteredReports.reduce((sum, report) => sum + report.latitude, 0) / filteredReports.length
    const longitudeAverage =
      filteredReports.reduce((sum, report) => sum + report.longitude, 0) / filteredReports.length

    return [latitudeAverage, longitudeAverage]
  }, [center, filteredReports])

  const redCount = validReports.filter((report) => report.status === "new").length
  const yellowCount = validReports.filter((report) =>
    ["assigned", "in_progress", "pending_approval"].includes(report.status)
  ).length
  const greenCount = validReports.filter((report) =>
    ["approved", "closed"].includes(report.status)
  ).length

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-lg shadow-slate-200/25">
      <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-cyan-50/30 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <div className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">
              Red: {redCount} unassigned
            </div>
            <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
              Yellow: {yellowCount} assigned
            </div>
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              Green: {greenCount} completed
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { key: "all", label: "All reports" },
            { key: "new", label: "New only" },
            { key: "active", label: "Assigned / Active" },
            { key: "completed", label: "Completed" },
          ].map((filterOption) => {
            const selected = statusFilter === filterOption.key
            return (
              <button
                key={filterOption.key}
                type="button"
                onClick={() => setStatusFilter(filterOption.key as StatusFilter)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  selected
                    ? "border-cyan-500 bg-cyan-500 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {filterOption.label}
              </button>
            )
          })}
        </div>
      </div>

      {filteredReports.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center bg-slate-50 px-6 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <MapContainer
          center={mapCenter}
          zoom={13}
          scrollWheelZoom
          className="h-[380px] w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxNativeZoom={18}
            maxZoom={19}
            keepBuffer={6}
            updateWhenIdle={false}
            detectRetina
          />
          {clusteredReports.map((cluster, clusterIndex) => {
            const primaryStatus =
              cluster.reports.find((report) => report.status === "new")?.status ||
              cluster.reports.find((report) =>
                ["assigned", "in_progress", "pending_approval"].includes(report.status)
              )?.status ||
              cluster.reports[0]?.status ||
              "new"
            const color = getReportColor(primaryStatus)
            const count = cluster.reports.length
            const radius = Math.min(5 + count * 0.8, 10)
            return (
              <CircleMarker
                key={`${cluster.latitude}-${cluster.longitude}-${clusterIndex}`}
                center={[cluster.latitude, cluster.longitude]}
                radius={radius}
                pathOptions={{
                  color: color.stroke,
                  fillColor: color.fill,
                  fillOpacity: 0.92,
                  weight: 2,
                }}
              >
                <Popup>
                  <div className="min-w-[240px] space-y-3">
                    <div>
                      <p className="font-sans text-xs font-extrabold uppercase tracking-[0.045em] text-slate-400">
                        {count > 1 ? `${count} reports nearby` : cluster.reports[0]?.trackingId}
                      </p>
                      <p className="text-sm font-semibold text-slate-800">
                        {count > 1 ? "Clustered report hotspot" : cluster.reports[0]?.description}
                      </p>
                    </div>
                    <div className="space-y-2 text-xs text-slate-600">
                      {cluster.reports.slice(0, 4).map((report) => {
                        const reportColor = getReportColor(report.status)
                        return (
                          <div
                            key={report.id}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-sans font-extrabold tracking-[0.04em] text-slate-700">{report.trackingId}</span>
                              <span style={{ color: reportColor.stroke }}>{reportColor.label}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-slate-500">{report.description}</p>
                            <div className="mt-2 flex items-center justify-between gap-3">
                              {report.teamName ? <span>Team: {report.teamName}</span> : <span>Unassigned</span>}
                              {onReportSelect ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-lg px-3"
                                  onClick={() => onReportSelect(report.trackingId || report.id)}
                                >
                                  View
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                      {count > 4 ? (
                        <p className="text-[11px] text-slate-400">+{count - 4} more reports in this area</p>
                      ) : null}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
      )}
    </div>
  )
}

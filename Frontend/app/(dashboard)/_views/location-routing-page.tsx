"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ExternalLink,
  Globe2,
  Loader2,
  MapPin,
  Route,
  Save,
  Search,
} from "lucide-react"
import { toast } from "sonner"

import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type Report } from "@/store/data-store"
import { PriorityBadge, ReportStatusBadge } from "@/components/shared/status-badge"
import { SummaryMetricCard } from "@/components/shared/summary-metric-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatTanzaniaDateTime } from "@/lib/date-time"

function getReportLocationLabel(report: Pick<Report, "address" | "districtName" | "regionName" | "latitude" | "longitude">) {
  if (report.address?.trim()) return report.address
  if (report.districtName?.trim() && report.regionName?.trim()) return `${report.districtName}, ${report.regionName}`
  if (report.districtName?.trim()) return report.districtName
  if (report.regionName?.trim()) return report.regionName
  if (Number.isFinite(report.latitude) && Number.isFinite(report.longitude)) {
    return `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`
  }
  return "Location not available"
}

function RoutingQueueTable({
  reports,
  onResolve,
  onOpen,
}: {
  reports: Report[]
  onResolve: (report: Report) => void
  onOpen: (reportId: string) => void
}) {
  return (
    <div className="reports-table-container">
      <Table className="reports-data-table min-w-[1050px]">
        <TableHeader>
          <TableRow>
            <TableHead>Tracking ID</TableHead>
            <TableHead>Report location</TableHead>
            <TableHead>Current scope</TableHead>
            <TableHead>Location hints</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reported</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((report) => (
            <TableRow key={report.id}>
              <TableCell data-label="Tracking ID">
                <div className="min-w-0">
                  <p className="truncate font-semibold" title={report.trackingId}>{report.trackingId}</p>
                  <PriorityBadge priority={report.priority} />
                </div>
              </TableCell>
              <TableCell data-label="Report location">
                <div className="min-w-0">
                  <p className="reports-cell-truncate font-medium" title={report.description || "Report without description"}>{report.description || "Report without description"}</p>
                  <p className="reports-cell-truncate text-xs text-slate-500" title={getReportLocationLabel(report)}>{getReportLocationLabel(report)}</p>
                </div>
              </TableCell>
              <TableCell data-label="Current scope">
                <p className="reports-cell-truncate" title={report.utilityName || "Unassigned Utility"}>{report.utilityName || "Unassigned Utility"}</p>
                <p className="reports-cell-truncate text-xs text-slate-500" title={report.dmaName || "Unassigned DMA"}>{report.dmaName || "Unassigned DMA"}</p>
              </TableCell>
              <TableCell data-label="Location hints">
                <p className="reports-cell-truncate" title={report.regionName || "Region not captured"}>{report.regionName || "Region not captured"}</p>
                <p className="reports-cell-truncate text-xs text-slate-500" title={report.districtName || "District not captured"}>{report.districtName || "District not captured"}</p>
              </TableCell>
              <TableCell data-label="Status"><ReportStatusBadge status={report.status} /></TableCell>
              <TableCell data-label="Reported" className="whitespace-nowrap">{formatTanzaniaDateTime(report.createdAt)}</TableCell>
              <TableCell data-label="Actions" className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => onResolve(report)}><Route className="h-4 w-4" />Resolve</Button>
                  <Button size="sm" variant="outline" onClick={() => onOpen(report.trackingId || report.id)}><ExternalLink className="h-4 w-4" /><span className="sr-only">Open report</span></Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function LocationRoutingPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { reports, utilities, dmas, fetchReports, fetchUtilities, fetchDMAs, updateReport } = useDataStore()

  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [resolveOpen, setResolveOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [resolveUtilityId, setResolveUtilityId] = useState("")
  const [resolveDMAId, setResolveDMAId] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const isAdmin = currentUser?.role === "admin"

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      await Promise.all([fetchReports(), fetchUtilities(), fetchDMAs()])
      setLoading(false)
    }
    void loadData()
  }, [fetchReports, fetchUtilities, fetchDMAs])

  const routedReports = useMemo(() => {
    return reports
      .filter((report) => !report.utilityId || !report.dmaId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [reports])

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return routedReports

    return routedReports.filter((report) =>
      report.trackingId.toLowerCase().includes(query) ||
      report.description.toLowerCase().includes(query) ||
      (report.address?.toLowerCase() || "").includes(query) ||
      (report.regionName?.toLowerCase() || "").includes(query) ||
      (report.districtName?.toLowerCase() || "").includes(query) ||
      (report.utilityName?.toLowerCase() || "").includes(query) ||
      (report.dmaName?.toLowerCase() || "").includes(query)
    )
  }, [routedReports, search])

  const unassignedUtilityReports = filteredReports.filter((report) => !report.utilityId)
  const unassignedDMAReports = filteredReports.filter((report) => report.utilityId && !report.dmaId)

  const availableDMAs = useMemo(() => {
    if (!resolveUtilityId) return []
    return dmas.filter((dma) => dma.utilityId === resolveUtilityId)
  }, [dmas, resolveUtilityId])

  function openResolve(report: Report) {
    setSelectedReport(report)
    setResolveUtilityId(report.utilityId || "")
    setResolveDMAId(report.dmaId || "")
    setResolveOpen(true)
  }

  async function handleSaveResolution() {
    if (!selectedReport) return

    setIsSaving(true)
    try {
      await updateReport(selectedReport.id, {
        utilityId: resolveUtilityId || null,
        dmaId: resolveDMAId || null,
      })
      toast.success(`Routing updated for ${selectedReport.trackingId}`)
      setResolveOpen(false)
      setSelectedReport(null)
      setResolveUtilityId("")
      setResolveDMAId("")
    } catch (error) {
      console.error("Failed to update routing", error)
      toast.error("Failed to save report routing")
    } finally {
      setIsSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900">
            <Route className="h-7 w-7 text-cyan-600" />
            Location Routing
          </h1>
          <p className="mt-1 text-sm text-slate-500">Only administrators can route reports with missing utility or DMA assignments.</p>
        </div>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <AlertTriangle className="h-10 w-10 text-amber-600" />
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="mt-1 text-sm text-slate-500">
                  Administrators route reports whose geography could not be matched confidently.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900">
            <Route className="h-7 w-7 text-cyan-600" />
            Location Routing
          </h1>
          <p className="mt-1 text-sm text-slate-500">Loading reports that still need utility or DMA placement.</p>
        </div>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="content-panel-card rounded-3xl p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-cyan-700">Routing review</p>
            <h1 className="mt-2 flex items-center gap-3 text-2xl font-extrabold tracking-tight text-slate-900">
              <Route className="h-7 w-7 text-cyan-600" />
              Location Routing
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Review report items with missing regional utility or district DMA placement and assign them from one admin queue.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-200/70 bg-cyan-50/60 px-4 py-3 text-sm text-cyan-800">
            <span className="font-semibold">{filteredReports.length}</span> reports waiting for routing
          </div>
        </div>
      </div>

      <div className="content-metric-grid grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryMetricCard label="Needs Utility" value={unassignedUtilityReports.length} icon={Globe2} tone="blue" />
        <SummaryMetricCard label="Needs DMA" value={unassignedDMAReports.length} icon={MapPin} tone="amber" />
        <SummaryMetricCard label="Routing Queue" value={filteredReports.length} icon={Route} tone="slate" />
      </div>

      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tracking ID, location hint, utility, DMA, or description..."
              className="h-11 rounded-xl pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <section className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Globe2 className="h-5 w-5 text-sky-600" />
              Unassigned Utility
            </h2>
            <p className="text-sm text-slate-500">Reports that still need a regional utility like DUWASA or AUWSA.</p>
          </div>
          {unassignedUtilityReports.length ? (
            <RoutingQueueTable reports={unassignedUtilityReports} onResolve={openResolve} onOpen={(id) => router.push(`/dashboard/reports/${id}`)} />
          ) : (
            <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-slate-500">
                <Globe2 className="h-8 w-8 text-sky-600" />
                <span>No reports are waiting for utility placement right now.</span>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <MapPin className="h-5 w-5 text-emerald-600" />
              Unassigned DMA
            </h2>
            <p className="text-sm text-slate-500">Reports that already know the utility but still need the correct district DMA.</p>
          </div>
          {unassignedDMAReports.length ? (
            <RoutingQueueTable reports={unassignedDMAReports} onResolve={openResolve} onOpen={(id) => router.push(`/dashboard/reports/${id}`)} />
          ) : (
            <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-slate-500">
                <MapPin className="h-8 w-8 text-emerald-600" />
                <span>No reports are waiting for DMA placement right now.</span>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      <Dialog
        open={resolveOpen}
        onOpenChange={(open) => {
          setResolveOpen(open)
          if (!open) {
            setSelectedReport(null)
            setResolveUtilityId("")
            setResolveDMAId("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Route className="h-5 w-5 text-cyan-600" />
              Resolve Report Routing
            </DialogTitle>
            <DialogDescription>
              Assign the correct utility and district DMA for this report.
            </DialogDescription>
          </DialogHeader>

          {selectedReport ? (
            <div className="space-y-5">
              <div className="dashboard-modal-note rounded-xl border p-4">
                <p className="font-sans text-sm font-extrabold tracking-[0.04em] text-slate-800">{selectedReport.trackingId}</p>
                <p className="mt-1 text-sm text-slate-500">{selectedReport.description || "No description"}</p>
                <p className="mt-2 text-xs text-slate-500">{getReportLocationLabel(selectedReport)}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-slate-700">Utility / Region</Label>
                <Select
                  value={resolveUtilityId || "__none__"}
                  onValueChange={(value) => {
                    const nextValue = value === "__none__" ? "" : value
                    setResolveUtilityId(nextValue)
                    setResolveDMAId("")
                  }}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Select utility" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="__none__" className="rounded-lg">
                      Unassigned Utility
                    </SelectItem>
                    {utilities.map((utility) => (
                      <SelectItem key={utility.id} value={utility.id} className="rounded-lg">
                        {utility.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-slate-700">DMA / District</Label>
                <Select
                  value={resolveDMAId || "__none__"}
                  onValueChange={(value) => setResolveDMAId(value === "__none__" ? "" : value)}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Select DMA" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="__none__" className="rounded-lg">
                      {resolveUtilityId ? "Unassigned DMA" : "Unassigned Location"}
                    </SelectItem>
                    {availableDMAs.map((dma) => (
                      <SelectItem key={dma.id} value={dma.id} className="rounded-lg">
                        {dma.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleSaveResolution}
              disabled={isSaving}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-600 hover:to-blue-700"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Routing
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

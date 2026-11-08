"use client"

import { useMemo, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { ReportStatusBadge, PriorityBadge } from "@/components/shared/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { SummaryMetricCard } from "@/components/shared/summary-metric-card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Search,
  Filter,
  Loader2,
  FileText,
  CheckCircle2,
  Clock,
  Siren,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
} from "lucide-react"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { LeakageTypeBadge } from "@/components/shared/leakage-type-badge"
import { ReportTypeBadge } from "@/components/shared/report-type-badge"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faArrowUpRightFromSquare, faCalendarDays, faFileLines, faLocationDot } from "@fortawesome/free-solid-svg-icons"

type ReportStatus = "new" | "assigned" | "in_progress" | "pending_approval" | "approved" | "rejected" | "closed"
type ReportPriority = "low" | "medium" | "high" | "critical"
type ReportType = "leakage" | "non_leakage"

const STATUS_FILTERS: { value: "all" | ReportStatus; label: string }[] = [
  { value: "all", label: "All Status" },
  { value: "new", label: "New" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "pending_approval", label: "Awaiting DMA Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "closed", label: "Closed" },
]

const PRIORITY_FILTERS: { value: "all" | ReportPriority; label: string }[] = [
  { value: "all", label: "All Priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
]

const REPORT_TYPE_FILTERS: { value: "all" | ReportType; label: string }[] = [
  { value: "all", label: "All Report Types" },
  { value: "leakage", label: "Leakage" },
  { value: "non_leakage", label: "Non-leakage" },
]

const PAGE_SIZE_OPTIONS = [25, 50, 100, 150, 200, 250, 300] as const

const getReportLocationLabel = (report: {
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  districtName?: string | null
  regionName?: string | null
  dmaName?: string | null
}) => {
  if (report.address?.trim()) {
    return report.address
  }

  if (report.districtName?.trim() && report.regionName?.trim()) {
    return `${report.districtName}, ${report.regionName}`
  }

  if (report.districtName?.trim()) {
    return report.districtName
  }

  if (Number.isFinite(report.latitude) && Number.isFinite(report.longitude)) {
    return `${report.latitude!.toFixed(5)}, ${report.longitude!.toFixed(5)}`
  }

  if (report.dmaName?.trim()) {
    return report.dmaName
  }

  return "Location not available"
}

const formatReportTime = (dateString: string | undefined): string => {
  if (!dateString) return "-"
  
  try {
    const date = new Date(dateString)
    // Tanzania time is UTC+3 (East Africa Time)
    const tanzaniaTime = new Date(date.toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam' }))
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam' }))
    
    const diffMs = now.getTime() - tanzaniaTime.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    // Show relative time for recent items
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    // Show full Tanzania date for older items
    return formatTanzaniaDateTime(date)
  } catch {
    return "-"
  }
}

const formatReportDateLabel = (dateString: string | undefined): string => {
  if (!dateString) return "-"

  try {
    return new Date(dateString).toLocaleDateString("en-GB", {
      timeZone: "Africa/Dar_es_Salaam",
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  } catch {
    return "-"
  }
}

export default function ReportsPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { 
    reports, 
    reportsListTotal,
    fetchReports, 
    fetchTeams, 
    fetchEngineers,
  } = useDataStore()

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | ReportStatus>("all")
  const [priorityFilter, setPriorityFilter] = useState<"all" | ReportPriority>("all")
  const [reportTypeFilter, setReportTypeFilter] = useState<"all" | ReportType>("all")
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [loading, setLoading] = useState(true)

  const isAdmin = currentUser?.role === "admin"
  const isUtility = currentUser?.role === "utility_manager"
  const isDMA = currentUser?.role === "dma_manager"

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    async function loadRelatedData() {
      const dmaId = isDMA ? currentUser?.dmaId ?? "" : undefined
      await Promise.all([
        fetchTeams(dmaId),
        fetchEngineers(dmaId),
      ])
    }
    void loadRelatedData()
  }, [fetchTeams, fetchEngineers, currentUser, isDMA])

  useEffect(() => {
    async function loadReportsPage() {
      setLoading(true)
      const dmaId = isDMA ? currentUser?.dmaId ?? "" : undefined
      const utilityId = isUtility ? currentUser?.utilityId ?? "" : undefined
      const filters = {
        ...(isDMA ? { dmaId } : isUtility ? { utilityId } : {}),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(priorityFilter !== "all" ? { priority: priorityFilter } : {}),
        ...(reportTypeFilter !== "all" ? { reportType: reportTypeFilter } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        limit: pageSize,
        skip: (currentPage - 1) * pageSize,
      }

      await fetchReports(filters)
      setLoading(false)
    }
    void loadReportsPage()
  }, [currentPage, currentUser, debouncedSearch, fetchReports, isDMA, isUtility, pageSize, priorityFilter, reportTypeFilter, statusFilter])

  // Scope reports based on role
  const scopedReports = useMemo(() => {
    if (!currentUser) return []
    if (isAdmin) return reports
    if (isUtility) {
      return reports.filter((r) => r.utilityId === currentUser.utilityId)
    }
    if (isDMA) {
      return reports.filter((r) => r.dmaId === currentUser.dmaId)
    }
    return []
  }, [currentUser, isAdmin, isUtility, isDMA, reports])

  const filteredReports = useMemo(
    () => {
      const filtered = scopedReports.filter((r) => {
        const query = debouncedSearch.toLowerCase()
        const matchesSearch =
          !query ||
          r.trackingId.toLowerCase().includes(query) ||
          (r.description?.toLowerCase() || "").includes(query) ||
          (r.address?.toLowerCase() || "").includes(query) ||
          (r.dmaName?.toLowerCase() || "").includes(query) ||
          (r.utilityName?.toLowerCase() || "").includes(query) ||
          (r.regionName?.toLowerCase() || "").includes(query) ||
          (r.districtName?.toLowerCase() || "").includes(query)

        const matchesStatus =
          statusFilter === "all" ? true : r.status === statusFilter

        const matchesPriority =
          priorityFilter === "all" ? true : r.priority === priorityFilter

        const matchesReportType =
          reportTypeFilter === "all" ? true : (r.reportType || "leakage") === reportTypeFilter

        return matchesSearch && matchesStatus && matchesPriority && matchesReportType
      })

      // Sort by createdAt (most recent first)
      return filtered.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime()
        const dateB = new Date(b.createdAt).getTime()
        return dateB - dateA
      })
    },
    [debouncedSearch, scopedReports, statusFilter, priorityFilter, reportTypeFilter]
  )

  const totalFilteredReports = reportsListTotal ?? filteredReports.length
  const totalPages = Math.max(1, Math.ceil(totalFilteredReports / pageSize))
  const pageStartIndex = totalFilteredReports ? (currentPage - 1) * pageSize : 0
  const pageEndIndex = Math.min(pageStartIndex + filteredReports.length, totalFilteredReports)
  const paginatedReports = useMemo(
    () => filteredReports,
    [filteredReports]
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [pageSize, priorityFilter, reportTypeFilter, search, statusFilter])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  function openDetail(report: { id: string; trackingId?: string }) {
    router.push(`/dashboard/reports/${report.trackingId || report.id}`)
  }

  // Stats
  const totalReports = reportsListTotal ?? scopedReports.length
  const newReports = scopedReports.filter(r => r.status === "new").length
  const inProgressReports = scopedReports.filter(r => ["assigned", "in_progress"].includes(r.status)).length
  const pendingApproval = scopedReports.filter(r => r.status === "pending_approval").length

  if (loading) {
    return (
      <div className="reports-workspace flex min-h-full flex-col gap-4">
        <Card className="rounded-[20px] border-[#afbec9] bg-[#cbd6de] shadow-none dark:border-[#2b3b4a] dark:bg-[#17222e]">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="reports-workspace flex min-h-full flex-col gap-4">
      {/* Modern Header with Stats */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-[1.7rem] font-semibold leading-tight tracking-[-0.05em] text-[#172b3a] dark:text-[#edf3f7] sm:text-[2rem]">
              <FileText className="h-6 w-6 text-[#147b91] dark:text-[#74c7d7]" />
              Reports
            </h1>
            <p className="mt-1 text-[13px] text-[#627587] dark:text-[#a0afbd]">
              {isDMA
                ? "Assign and manage report items in your DMA"
                : isUtility
                  ? "Monitor report items across your utility"
                  : "National view of all report items"}
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <SummaryMetricCard label="Total Reports" value={totalReports} icon={FileText} tone="slate" />
          <SummaryMetricCard label="New Reports" value={newReports} icon={Siren} tone="blue" />
          <SummaryMetricCard label="In Progress" value={inProgressReports} icon={Clock} tone="amber" />
          <SummaryMetricCard label="Awaiting DMA Approval" value={pendingApproval} icon={CheckCircle2} tone="red" />
        </div>
      </div>

      {/* Modern Search & Filters */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {/* Search */}
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71879a] dark:text-[#93a7b6]" />
            <Input
              placeholder="Search by tracking ID, address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-xl border-[#afbec9] bg-[#cbd6de] pl-10 text-[#263c4d] shadow-none placeholder:text-[#71879a] focus-visible:ring-[#147b91]/25 dark:border-[#344453] dark:bg-[#192633] dark:text-[#dce6ed] dark:placeholder:text-[#8295a5]"
            />
          </div>
          
          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="h-10 w-full rounded-xl border-[#afbec9] bg-[#cbd6de] text-[#263c4d] shadow-none dark:border-[#344453] dark:bg-[#192633] dark:text-[#dce6ed] sm:w-44">
              <Filter className="h-4 w-4 mr-2 text-slate-400" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="dashboard-scope-select-content rounded-xl shadow-xl shadow-slate-900/15">
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s.value} value={s.value} className="rounded-lg">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* Priority Filter */}
          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as typeof priorityFilter)}>
            <SelectTrigger className="h-10 w-full rounded-xl border-[#afbec9] bg-[#cbd6de] text-[#263c4d] shadow-none dark:border-[#344453] dark:bg-[#192633] dark:text-[#dce6ed] sm:w-36">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent className="dashboard-scope-select-content rounded-xl shadow-xl shadow-slate-900/15">
              {PRIORITY_FILTERS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="rounded-lg">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={reportTypeFilter} onValueChange={(v) => setReportTypeFilter(v as typeof reportTypeFilter)}>
            <SelectTrigger className="h-10 w-full rounded-xl border-[#afbec9] bg-[#cbd6de] text-[#263c4d] shadow-none dark:border-[#344453] dark:bg-[#192633] dark:text-[#dce6ed] sm:w-44">
              <SelectValue placeholder="Report type" />
            </SelectTrigger>
            <SelectContent className="dashboard-scope-select-content rounded-xl shadow-xl shadow-slate-900/15">
              {REPORT_TYPE_FILTERS.map((type) => (
                <SelectItem key={type.value} value={type.value} className="rounded-lg">
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <FileText className="h-4 w-4" />
          <span>{totalFilteredReports} report item{totalFilteredReports !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Modern Table */}
      <Card className="overflow-hidden rounded-[20px] border border-[#afbec9] bg-[#cbd6de] shadow-[0_12px_28px_-24px_rgba(20,42,60,0.46)] dark:border-[#2b3b4a] dark:bg-[#17222e] dark:shadow-none">
        <CardContent className="p-0">
          <div className="border-b border-[#afbec9] bg-[#c5d1da] px-4 py-3.5 dark:border-[#2b3b4a] dark:bg-[#192633] sm:px-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">Live Report Queue</p>
                <p className="text-xs text-slate-500">
                  Newest report items appear first. Select any report row to open the full report page.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                  {totalFilteredReports
                    ? `${pageStartIndex + 1}-${pageEndIndex} of ${totalFilteredReports}`
                    : "0 visible"}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Rows</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => setPageSize(Number(value) as typeof pageSize)}
                  >
                    <SelectTrigger className="h-8 w-24 rounded-lg border-[#afbec9] bg-[#cbd6de] text-xs text-[#263c4d] shadow-none dark:border-[#344453] dark:bg-[#192633] dark:text-[#dce6ed]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="dashboard-scope-select-content z-[5000] rounded-xl">
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          <div className="reports-table-container">
            <Table className="reports-data-table w-full min-w-[980px]">
              <TableHeader>
                <TableRow className="border-b border-[#afbec9] bg-[#c5d1da] hover:bg-[#c5d1da] dark:border-[#2b3b4a] dark:bg-[#1b2936] dark:hover:bg-[#1b2936]">
                  <TableHead className="w-[17%] whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faFileLines} className="h-3.5 w-3.5" />
                      Tracking ID
                    </div>
                  </TableHead>
                  <TableHead className="w-[20%] whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faLocationDot} className="h-3.5 w-3.5" />
                      Location
                    </div>
                  </TableHead>
                  <TableHead className="w-[12%] whitespace-nowrap">Report Type</TableHead>
                  <TableHead className="w-[14%] whitespace-nowrap">Leakage Type</TableHead>
                  <TableHead className="w-[12%] whitespace-nowrap">Status</TableHead>
                  <TableHead className="w-[17%] whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faCalendarDays} className="h-3.5 w-3.5" />
                      Created
                    </div>
                  </TableHead>
                  <TableHead className="w-[8%] whitespace-nowrap text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedReports.length === 0 ? (
                  <TableRow className="reports-empty-row">
                    <TableCell colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                          <FileText className="h-8 w-8 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-slate-800">No report found</p>
                          <p className="text-sm text-slate-500 mt-1">
                            {search || statusFilter !== "all" || priorityFilter !== "all" || reportTypeFilter !== "all"
                              ? "Try adjusting your filters" 
                              : "Reports will appear here when available"}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedReports.map((report) => {
                    return (
                      <TableRow
                        key={report.id}
                        onClick={() => openDetail(report)}
                        className="cursor-pointer border-b border-[#afbec9]/65 dark:border-[#2b3b4a]"
                      >
                        {/* Tracking ID */}
                        <TableCell data-label="Tracking ID">
                          <div className="flex items-start gap-3">
                            <FontAwesomeIcon icon={faFileLines} className="mt-0.5 h-4 w-4 shrink-0 text-[#147b91] dark:text-[#74c7d7]" />
                            <div className="min-w-0 space-y-1">
                              <span className="reports-cell-truncate font-mono text-[0.7rem] font-semibold tracking-[0.015em] text-[#314b5d] dark:text-[#dce6ed]">
                                {report.trackingId}
                              </span>
                              {!isDMA && report.dmaName ? (
                                <p className="reports-cell-truncate text-xs text-slate-500" title={report.dmaName}>{report.dmaName}</p>
                              ) : null}
                              <PriorityBadge priority={report.priority} className="!px-2 !py-0.5 !text-[0.65rem]" />
                            </div>
                          </div>
                        </TableCell>

                        {/* Location */}
                        <TableCell data-label="Location">
                          <div className="flex min-w-0 items-start gap-2">
                            <FontAwesomeIcon icon={faLocationDot} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#147b91] dark:text-[#74c7d7]" />
                            <div className="min-w-0 space-y-1">
                              <p className="reports-cell-truncate text-sm font-medium text-slate-700" title={getReportLocationLabel(report)}>
                                {getReportLocationLabel(report)}
                              </p>
                              {report.address && Number.isFinite(report.latitude) && Number.isFinite(report.longitude) ? (
                                <p className="reports-cell-truncate font-mono text-[0.65rem] text-slate-400" title={`${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`}>
                                  {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                                </p>
                              ) : report.utilityName ? (
                                <p className="reports-cell-truncate text-xs text-slate-400" title={report.utilityName}>
                                  {report.utilityName}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>

                        {/* Report Type */}
                        <TableCell data-label="Report type">
                          <ReportTypeBadge type={report.reportType} />
                        </TableCell>

                        {/* Leakage Type */}
                        <TableCell data-label="Leakage type">
                          {(report.reportType || "leakage") === "leakage" ? (
                            <LeakageTypeBadge type={report.leakageType} />
                          ) : (
                            <span className="text-sm font-medium text-slate-400">Not applicable</span>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell data-label="Status">
                          <ReportStatusBadge status={report.status} />
                        </TableCell>

                        {/* Created Time */}
                        <TableCell data-label="Created">
                          <div className="flex min-w-0 items-start gap-2 text-sm text-slate-600">
                            <FontAwesomeIcon icon={faCalendarDays} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <div className="space-y-1">
                              <p className="whitespace-nowrap text-sm font-medium text-slate-700" title={formatTanzaniaDateTime(report.createdAt)}>
                                {formatReportDateLabel(report.createdAt)}
                              </p>
                              <p className="whitespace-nowrap text-xs text-slate-500">
                                {formatReportTime(report.createdAt)}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell data-label="Open" className="text-right">
                          <div className="inline-flex items-center gap-1 text-sm font-medium text-[#147b91] dark:text-[#74c7d7]">
                            Open
                            <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="h-3 w-3" />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#afbec9] bg-[#c5d1da] px-4 py-3.5 dark:border-[#2b3b4a] dark:bg-[#192633] sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-sm text-slate-500">
              {totalFilteredReports
                ? `Showing ${pageStartIndex + 1}-${pageEndIndex} of ${totalFilteredReports} reports`
                : "No reports to display"}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#afbec9] bg-[#cbd6de] text-[#52697c] transition hover:bg-[#b9c8d2] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#344453] dark:bg-[#192633] dark:text-[#a8b8c6] dark:hover:bg-[#243544]"
                aria-label="First page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#afbec9] bg-[#cbd6de] text-[#52697c] transition hover:bg-[#b9c8d2] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#344453] dark:bg-[#192633] dark:text-[#a8b8c6] dark:hover:bg-[#243544]"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-28 rounded-xl border border-[#afbec9] bg-[#cbd6de] px-3 py-2 text-center text-sm font-semibold text-[#314b5d] dark:border-[#344453] dark:bg-[#192633] dark:text-[#dce6ed]">
                Page {currentPage} / {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#afbec9] bg-[#cbd6de] text-[#52697c] transition hover:bg-[#b9c8d2] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#344453] dark:bg-[#192633] dark:text-[#a8b8c6] dark:hover:bg-[#243544]"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#afbec9] bg-[#cbd6de] text-[#52697c] transition hover:bg-[#b9c8d2] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#344453] dark:bg-[#192633] dark:text-[#a8b8c6] dark:hover:bg-[#243544]"
                aria-label="Last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

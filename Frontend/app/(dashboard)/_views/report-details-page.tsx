"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Droplets,
  Expand,
  FileText,
  ImageIcon,
  Loader2,
  MapPin,
  PlayCircle,
  Save,
  User,
  UserCog,
  Users,
  X,
  Trash2,
} from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type Report } from "@/store/data-store"
import { PriorityBadge, ReportStatusBadge } from "@/components/shared/status-badge"
import { ResolvedImage } from "@/components/shared/resolved-image"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { LeakageTypeBadge } from "@/components/shared/leakage-type-badge"
import { ReportTypeBadge } from "@/components/shared/report-type-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { apiClient } from "@/lib/api-client"
import { LEAKAGE_TYPE_CONFIG } from "@/lib/constants"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { transformKeys } from "@/lib/transform-data"
import type { LeakageType } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const getOriginalReportPhotos = (report: Report) =>
  report.reportPhotos !== undefined ? report.reportPhotos : report.photos

const getRepairPhotos = (report: Report) => [
  ...(report.submissionBeforePhotos ?? []).map((uri) => ({ uri, label: "Before Resolution" })),
  ...(report.submissionAfterPhotos ?? []).map((uri) => ({ uri, label: "After Resolution" })),
]

const getReportLocationLabel = (report: Pick<Report, "address" | "latitude" | "longitude" | "regionName" | "districtName">) => {
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
    return `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`
  }

  return "Location not available"
}

const isVideoMedia = (uri: string) => {
  const normalized = uri.toLowerCase()
  return (
    normalized.startsWith("data:video/") ||
    normalized.endsWith(".mp4") ||
    normalized.endsWith(".mov") ||
    normalized.endsWith(".webm") ||
    normalized.endsWith(".m4v")
  )
}

interface MediaItem {
  key: string
  uri: string
  alt: string
  label: string | null
}

interface ReportActivityLog {
  id: string
  action: string
  userName: string
  userRole: string
  entity: string
  entityId: string
  details?: string | null
  timestamp: string
}

interface WorkflowStep {
  title: string
  detail: string
  active: boolean
  current: boolean
}

interface MissingReportInsight {
  title: string
  description: string
}

type SlaState = "critical_overdue" | "overdue" | "due_soon" | "on_track" | "resolved" | "unknown"

const getSlaState = (report: Report): SlaState => {
  if (report.status === "approved" || report.status === "closed") return "resolved"
  if (!report.slaDeadline) return "unknown"
  const deadline = new Date(report.slaDeadline).getTime()
  if (Number.isNaN(deadline)) return "unknown"
  const hoursRemaining = (deadline - Date.now()) / (1000 * 60 * 60)
  if (hoursRemaining < -24) return "critical_overdue"
  if (hoursRemaining < 0) return "overdue"
  if (hoursRemaining <= 24) return "due_soon"
  return "on_track"
}

const getSlaMeta = (report: Report) => {
  const state = getSlaState(report)
  switch (state) {
    case "critical_overdue":
      return {
        label: "Critical overdue",
        tone: "border-red-200 bg-red-50 text-red-700",
        icon: <AlertTriangle className="h-4 w-4" />,
      }
    case "overdue":
      return {
        label: "Overdue",
        tone: "border-orange-200 bg-orange-50 text-orange-700",
        icon: <AlertTriangle className="h-4 w-4" />,
      }
    case "due_soon":
      return {
        label: "Due soon",
        tone: "border-amber-200 bg-amber-50 text-amber-700",
        icon: <Clock className="h-4 w-4" />,
      }
    case "resolved":
      return {
        label: "Resolved",
        tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
        icon: <CheckCircle2 className="h-4 w-4" />,
      }
    case "on_track":
      return {
        label: "On track",
        tone: "border-blue-200 bg-blue-50 text-blue-700",
        icon: <Clock className="h-4 w-4" />,
      }
    default:
      return {
        label: "Deadline pending",
        tone: "border-slate-200 bg-slate-50 text-slate-600",
        icon: <Clock className="h-4 w-4" />,
      }
  }
}

const getResolvedTimingMeta = (report: Report) => {
  if (report.resolvedAt) {
    return {
      icon: <CheckCheck className="h-5 w-5 text-emerald-600" />,
      value: formatTanzaniaDateTime(report.resolvedAt),
      tone: "bg-emerald-100",
    }
  }

  switch (report.status) {
    case "approved":
    case "closed":
      return {
        icon: <CheckCheck className="h-5 w-5 text-emerald-600" />,
        value: "Resolved, time not recorded",
        tone: "bg-emerald-100",
      }
    case "rejected":
      return {
        icon: <AlertTriangle className="h-5 w-5 text-rose-600" />,
        value: "Returned for rework",
        tone: "bg-rose-100",
      }
    case "pending_approval":
      return {
        icon: <Clock className="h-5 w-5 text-amber-600" />,
        value: "Awaiting DMA approval",
        tone: "bg-amber-100",
      }
    case "in_progress":
      return {
        icon: <Clock className="h-5 w-5 text-blue-600" />,
        value: "Resolution in progress",
        tone: "bg-blue-100",
      }
    case "assigned":
      return {
        icon: <Clock className="h-5 w-5 text-amber-600" />,
        value: "Assigned, not resolved yet",
        tone: "bg-amber-100",
      }
    default:
      return {
        icon: <Clock className="h-5 w-5 text-slate-600" />,
        value: "Not resolved yet",
        tone: "bg-slate-100",
      }
  }
}

function getWorkflowSteps(report: Report): WorkflowStep[] {
  const status = report.status
  const wasSentForRework = Boolean(report.dmaReviewNotes && status === "assigned")

  return [
    {
      title: "Reported",
      detail: "Citizen or operator submitted the report.",
      active: true,
      current: status === "new",
    },
    {
      title: wasSentForRework ? "Assigned Again" : "Assigned",
      detail: wasSentForRework
        ? "The report was returned for rework and is back with the field team."
        : report.teamName
        ? `Assigned to ${report.teamName}.`
        : "Waiting for DMA assignment.",
      active: Boolean(report.teamName) || status !== "new",
      current: status === "assigned",
    },
    {
      title: "Field Resolution",
      detail:
        status === "in_progress"
          ? "Field work is actively happening on site."
          : report.engineerSubmissionNotes
          ? "Engineer submitted resolution evidence from the field."
          : "Awaiting field resolution activity.",
      active: ["in_progress", "pending_approval", "approved", "closed"].includes(status) || Boolean(report.engineerSubmissionNotes),
      current: status === "in_progress",
    },
    {
      title: "Team Leader Review",
      detail: report.teamLeaderReviewNotes
        ? report.teamLeaderReviewNotes
        : status === "pending_approval"
        ? "Resolution evidence passed through team leader review and reached DMA."
        : "Waiting for team leader review notes.",
      active: ["pending_approval", "approved", "closed"].includes(status) || Boolean(report.teamLeaderReviewNotes),
      current: false,
    },
    {
      title:
        status === "approved" || status === "closed"
          ? "Resolved and Closed"
          : wasSentForRework
          ? "Returned for Rework"
          : status === "pending_approval"
          ? "Awaiting DMA Approval"
          : "DMA Decision",
      detail:
        status === "approved" || status === "closed"
          ? report.dmaReviewNotes || "DMA approved the report resolution and closed the item."
          : wasSentForRework
          ? report.dmaReviewNotes || "DMA returned the resolution for more field work."
          : "Waiting for the final DMA decision.",
      active: status === "pending_approval" || Boolean(report.dmaReviewNotes) || status === "approved" || status === "closed",
      current: status === "pending_approval" || status === "approved" || status === "closed" || wasSentForRework,
    },
  ]
}

export default function ReportDetailPage() {
  const router = useRouter()
  const params = useParams<{ reportId: string }>()
  const reportId = Array.isArray(params?.reportId) ? params.reportId[0] : params?.reportId

  const { currentUser } = useAuthStore()
  const { reports, teams, utilities, dmas, fetchReports, fetchTeams, fetchUtilities, fetchDMAs, updateReport, deleteReport } = useDataStore()
  const [loading, setLoading] = useState(true)
  const [assignOpen, setAssignOpen] = useState(false)
  const [resolveLocationOpen, setResolveLocationOpen] = useState(false)
  const [approveDialogOpen, setApproveDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [assignTeamId, setAssignTeamId] = useState("")
  const [resolveUtilityId, setResolveUtilityId] = useState("")
  const [resolveDMAId, setResolveDMAId] = useState("")
  const [approveComment, setApproveComment] = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null)
  const [activityLogs, setActivityLogs] = useState<ReportActivityLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [directReport, setDirectReport] = useState<Report | null>(null)
  const [missingInsight, setMissingInsight] = useState<MissingReportInsight | null>(null)
  const [checkingMissingReport, setCheckingMissingReport] = useState(false)

  const isAdmin = currentUser?.role === "admin"
  const isUtility = currentUser?.role === "utility_manager"
  const isDMA = currentUser?.role === "dma_manager"

  useEffect(() => {
    async function loadData() {
      if (!currentUser) {
        setLoading(false)
        return
      }

      setLoading(true)
      const dmaId = isDMA ? currentUser.dmaId ?? "" : undefined
      const utilityId = isUtility ? currentUser.utilityId ?? "" : undefined
      await Promise.all([
        fetchUtilities(),
        fetchDMAs(),
        fetchReports(isDMA ? { dmaId } : isUtility ? { utilityId } : undefined),
        fetchTeams(dmaId),
      ])
      setLoading(false)
    }

    void loadData()
  }, [currentUser, fetchDMAs, fetchReports, fetchTeams, fetchUtilities, isDMA, isUtility])

  const scopedReports = useMemo(() => {
    if (!currentUser) return []
    if (isAdmin) return reports
    if (isUtility) return reports.filter((report) => report.utilityId === currentUser.utilityId)
    if (isDMA) return reports.filter((report) => report.dmaId === currentUser.dmaId)
    return []
  }, [currentUser, isAdmin, isUtility, isDMA, reports])

  const report = scopedReports.find((item) => item.id === reportId || item.trackingId === reportId) ?? directReport
  const reportRecordId = report?.id ?? null
  const slaMeta = report ? getSlaMeta(report) : null
  const latestWorkflowNote = report?.notes?.trim() || null
  const workflowSteps = report ? getWorkflowSteps(report) : []

  const districtTeams = useMemo(() => {
    if (isDMA && currentUser?.dmaId) {
      return teams.filter((team) => team.dmaId === currentUser.dmaId)
    }
    if (isUtility && currentUser?.utilityId) {
      return teams.filter((team) => team.utilityId === currentUser.utilityId)
    }
    return []
  }, [teams, isDMA, isUtility, currentUser])

  const availableUtilities = useMemo(() => {
    if (isUtility && currentUser?.utilityId) {
      return utilities.filter((utility) => utility.id === currentUser.utilityId)
    }
    return utilities
  }, [currentUser, isUtility, utilities])

  const availableDMAs = useMemo(() => {
    if (!resolveUtilityId) return []
    return dmas.filter((dma) => dma.utilityId === resolveUtilityId)
  }, [dmas, resolveUtilityId])

  const loadActivityLogs = async () => {
    if (!currentUser || !reportRecordId) {
      setActivityLogs([])
      return
    }

    setLogsLoading(true)
    try {
      const response = await apiClient.get<{ total: number; items: ReportActivityLog[] }>(
        `/logs/report/${reportRecordId}`
      )
      if (!response.success || !response.data) {
        setActivityLogs([])
        return
      }
      const items = Array.isArray(response.data.items) ? response.data.items.map(transformKeys) : []
      setActivityLogs(items)
    } catch (error) {
      console.error("Error loading report activity logs:", error)
      setActivityLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    void loadActivityLogs()
  }, [currentUser, reportRecordId])

  useEffect(() => {
    setDirectReport(null)
    setMissingInsight(null)
    setCheckingMissingReport(false)
  }, [reportId])

  useEffect(() => {
    let cancelled = false

    async function inspectMissingReport() {
      if (loading || !currentUser || !reportId || report) {
        if (!loading && report) {
          setMissingInsight(null)
          setCheckingMissingReport(false)
        }
        return
      }

      setCheckingMissingReport(true)
      try {
        const response = await apiClient.get<Report>(`/reports/${reportId}`)
        if (cancelled) return

        if (response.success && response.data) {
          setDirectReport(transformKeys(response.data) as Report)
          setMissingInsight(null)
          return
        }

        const normalizedError = String(response.error || "").toLowerCase()
        setDirectReport(null)

        if (normalizedError.includes("access denied")) {
          setMissingInsight({
            title: "Report is outside your access scope",
            description: "This link is valid, but your current role is not allowed to open this report item.",
          })
          return
        }

        if (normalizedError.includes("not found")) {
          setMissingInsight({
            title: "Report no longer exists",
            description: "This item may have been deleted or the link may be outdated.",
          })
          return
        }

        setMissingInsight({
          title: "We could not load this report",
          description: response.error || "Try refreshing the reports list and opening the item again.",
        })
      } catch (error) {
        if (cancelled) return
        console.error("Error checking missing report:", error)
        setDirectReport(null)
        setMissingInsight({
          title: "We could not load this report",
          description: "The report details could not be checked right now. Try refreshing and opening it again.",
        })
      } finally {
        if (!cancelled) {
          setCheckingMissingReport(false)
        }
      }
    }

    void inspectMissingReport()

    return () => {
      cancelled = true
    }
  }, [currentUser, loading, report, reportId])

  const openAssign = () => {
    if (!report) return
    setAssignTeamId(report.teamId ?? "")
    setAssignOpen(true)
  }

  const openResolveLocation = () => {
    if (!report) return
    const initialUtilityId = report.utilityId || (isUtility ? currentUser?.utilityId ?? "" : "")
    setResolveUtilityId(initialUtilityId)
    setResolveDMAId(report.dmaId || "")
    setResolveLocationOpen(true)
  }

  const openMediaViewer = (media: MediaItem) => {
    setActiveMedia(media)
    setViewerOpen(true)
  }

  const handleAssign = async () => {
    if (!report || !assignTeamId) {
      toast.error("Please select a team.")
      return
    }

    setIsSubmitting(true)
    try {
      const response = await apiClient.put(`/reports/${report.id}/assign`, {
        team_id: assignTeamId,
      })

      if (!response.success) {
        toast.error(response.error || "Failed to assign report")
        return
      }

      toast.success("Report assigned successfully")
      setAssignOpen(false)
      await fetchReports({ dmaId: currentUser?.dmaId ?? undefined, utilityId: currentUser?.utilityId ?? undefined })
      await loadActivityLogs()
    } catch (error) {
      console.error("Error assigning report:", error)
      toast.error("Failed to assign report")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResolveLocation = async () => {
    if (!report) return
    if (isUtility && !currentUser?.utilityId) {
      toast.error("Your account has no utility scope configured.")
      return
    }
    if (!isAdmin && !isUtility) {
      toast.error("Only admin and utility managers can update report geography.")
      return
    }

    const nextUtilityId = isUtility ? currentUser?.utilityId ?? null : resolveUtilityId || null
    const nextDMAId = resolveDMAId || null

    if (nextDMAId && !nextUtilityId) {
      toast.error("Please select a utility before selecting a DMA.")
      return
    }

    setIsSubmitting(true)
    try {
      await updateReport(report.id, {
        utilityId: nextUtilityId,
        dmaId: nextDMAId,
      })
      toast.success("Report location routing updated successfully")
      setResolveLocationOpen(false)
      await fetchReports({ dmaId: currentUser?.dmaId ?? undefined, utilityId: currentUser?.utilityId ?? undefined })
      await loadActivityLogs()
    } catch (error) {
      console.error("Error resolving report location:", error)
      toast.error("Failed to update report location routing")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleApprove = async () => {
    if (!report || !approveComment.trim()) {
      toast.error("Please add a DMA approval comment.")
      return
    }
    setIsSubmitting(true)
    try {
      const response = await apiClient.post(`/reports/${report.id}/approve`, {
        notes: approveComment.trim(),
      })
      if (!response.success) {
        toast.error(response.error || "Failed to approve report")
        return
      }

      toast.success("Report approved and marked as resolved")
      setApproveDialogOpen(false)
      setApproveComment("")
      await fetchReports({ dmaId: currentUser?.dmaId ?? undefined, utilityId: currentUser?.utilityId ?? undefined })
      await loadActivityLogs()
    } catch (error) {
      console.error("Error approving report:", error)
      toast.error("Failed to approve report")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!report || !rejectReason.trim()) {
      toast.error("Please add a DMA rejection reason.")
      return
    }
    setIsSubmitting(true)
    try {
      const response = await apiClient.post(`/reports/${report.id}/reject`, {
        notes: rejectReason.trim(),
      })
      if (!response.success) {
        toast.error(response.error || "Failed to reject report")
        return
      }

      toast.success("Report returned to the assigned team for rework")
      setRejectDialogOpen(false)
      setRejectReason("")
      await fetchReports({ dmaId: currentUser?.dmaId ?? undefined, utilityId: currentUser?.utilityId ?? undefined })
      await loadActivityLogs()
    } catch (error) {
      console.error("Error rejecting report:", error)
      toast.error("Failed to reject report")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!report) return
    setIsSubmitting(true)
    try {
      await deleteReport(report.id)
      toast.success("Report deleted successfully")
      setDeleteDialogOpen(false)
      router.push("/dashboard/reports")
    } catch (error) {
      console.error("Error deleting report:", error)
      toast.error("Failed to delete report")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    )
  }

  if (!report && checkingMissingReport) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="outline" onClick={() => router.push("/dashboard/reports")} className="w-fit rounded-xl">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Reports
        </Button>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="flex items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Checking report access...
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="outline" onClick={() => router.push("/dashboard/reports")} className="w-fit rounded-xl">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Reports
        </Button>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold text-slate-800">{missingInsight?.title || "Report not found"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {missingInsight?.description || "This report item may be outside your current access scope."}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const originalPhotos = getOriginalReportPhotos(report)
  const repairPhotos = getRepairPhotos(report)
  const originalMediaItems: MediaItem[] = originalPhotos.map((uri, index) => ({
    key: `${uri}-${index}`,
    uri,
    alt: `Original report media ${index + 1}`,
    label: null,
  }))
  const repairMediaItems: MediaItem[] = repairPhotos.map(({ uri, label }, index) => ({
    key: `${uri}-${index}`,
    uri,
    alt: `${label} ${index + 1}`,
    label,
  }))
  const createdLabel = report.createdAt ? formatTanzaniaDateTime(report.createdAt) : "Not recorded"
  const dueLabel = report.slaDeadline ? formatTanzaniaDateTime(report.slaDeadline) : "Deadline pending"
  const resolvedTimingMeta = getResolvedTimingMeta(report)
  const utilityLabel = report.utilityName?.trim() || report.regionName?.trim() || "Unassigned utility"
  const dmaLabel = report.dmaName?.trim() || report.districtName?.trim() || "Unassigned DMA"
  const reportType = report.reportType || "leakage"
  const isLeakageReport = reportType === "leakage"
  const leakageType = report.leakageType || "unknown"
  const leakageTypeMeta = LEAKAGE_TYPE_CONFIG[leakageType] || LEAKAGE_TYPE_CONFIG.unknown
  const fieldOwnerLabel =
    report.assignedEngineerName?.trim() || report.teamLeaderName?.trim() || report.teamName?.trim() || "Waiting for team routing"
  const hasWorkflowNotes = Boolean(
    report.engineerSubmissionNotes || report.teamLeaderReviewNotes || report.dmaReviewNotes || latestWorkflowNote
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-lg shadow-slate-200/20">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl">
            <Button variant="outline" onClick={() => router.push("/dashboard/reports")} className="mb-4 w-fit rounded-xl">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Reports
            </Button>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-rose-600">Report review</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-sans text-2xl font-extrabold leading-none tracking-[0.025em] text-slate-900 sm:text-3xl">
                {report.trackingId}
              </h1>
              <PriorityBadge priority={report.priority} />
              <ReportStatusBadge status={report.status} />
              <ReportTypeBadge type={reportType} />
              {isLeakageReport ? <LeakageTypeBadge type={leakageType} /> : null}
              {slaMeta ? (
                <div className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold", slaMeta.tone)}>
                  {slaMeta.icon}
                  <span>{slaMeta.label}</span>
                </div>
              ) : null}
            </div>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
              {report.description || "No description was provided for this report item."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                Utility: {utilityLabel}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                DMA: {dmaLabel}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                Reported: {createdLabel}
              </span>
            </div>
          </div>

          <div className="grid min-w-[260px] grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Location</p>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-700">{getReportLocationLabel(report)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Reporter</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">{report.reporterName || "Unknown"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Field owner</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">{fieldOwnerLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <FileText className="mt-1 h-7 w-7 shrink-0 text-rose-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Report Summary</p>
                  <p className="mt-2 text-base leading-7 text-slate-700">
                    {report.description || "No detailed description was submitted with this report item."}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <DetailCard icon={<MapPin className="h-5 w-5 text-emerald-600" />} label="Location" value={getReportLocationLabel(report)} tone="bg-emerald-100" />
                <DetailCard icon={<FileText className="h-5 w-5 text-sky-600" />} label="Report Type" value={isLeakageReport ? "Leakage" : "Non-leakage"} tone="bg-sky-100" />
                {isLeakageReport ? <DetailCard icon={<Droplets className="h-5 w-5 text-cyan-600" />} label="Leakage Type" value={leakageTypeMeta.label} tone="bg-cyan-100" /> : null}
                <DetailCard icon={<Users className="h-5 w-5 text-cyan-600" />} label="Utility / Region" value={utilityLabel} tone="bg-cyan-100" />
                <DetailCard icon={<Users className="h-5 w-5 text-sky-600" />} label="DMA / District" value={dmaLabel} tone="bg-sky-100" />
                <DetailCard icon={<UserCog className="h-5 w-5 text-amber-600" />} label="Assigned Team" value={report.teamName || "Not assigned"} tone="bg-amber-100" />
              </div>
            </CardContent>
          </Card>

          {hasWorkflowNotes && (
            <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
              <CardContent className="p-6">
              <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-6 w-6 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Workflow Notes</p>
                    <p className="text-xs text-slate-500">Only the comments that matter for review and follow-up.</p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {report.engineerSubmissionNotes && (
                    <div className="rounded-2xl border border-sky-200/60 bg-sky-50/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Engineer Note</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{report.engineerSubmissionNotes}</p>
                    </div>
                  )}
                  {report.teamLeaderReviewNotes && (
                    <div className="rounded-2xl border border-sky-200/60 bg-sky-50/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Team Leader Review</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{report.teamLeaderReviewNotes}</p>
                    </div>
                  )}
                  {report.dmaReviewNotes && (
                    <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">DMA Decision</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{report.dmaReviewNotes}</p>
                    </div>
                  )}
                  {latestWorkflowNote &&
                    latestWorkflowNote !== report.dmaReviewNotes &&
                    latestWorkflowNote !== report.teamLeaderReviewNotes &&
                    latestWorkflowNote !== report.engineerSubmissionNotes && (
                      <div className="rounded-2xl border border-slate-200/60 bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Latest Note</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{latestWorkflowNote}</p>
                      </div>
                    )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4">
            <MediaSection
              title="Original Reports Photos"
              description="Reporter evidence from the first submission. Click any tile to open it."
              icon={<ImageIcon className="h-4 w-4 text-blue-600" />}
              emptyMessage={
                repairMediaItems.length > 0
                  ? "No original reporter media is currently stored for this report item. Only resolution evidence is available on this record."
                  : "No original report photos are currently stored for this item."
              }
              items={originalMediaItems}
              onOpen={openMediaViewer}
            />

            <MediaSection
              title="Resolved Images"
              description="Field evidence submitted during resolution. Click any tile to inspect it."
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              emptyMessage="No resolved images have been attached yet."
              items={repairMediaItems}
              onOpen={openMediaViewer}
            />
          </div>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <Clock className="h-6 w-6 shrink-0 text-cyan-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Activity Timeline</p>
                  <p className="text-xs text-slate-500">Assignments, approvals, and routing events for this report.</p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {logsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading activity history...
                  </div>
                ) : activityLogs.length > 0 ? (
                  activityLogs.map((log) => (
                    <div key={log.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="mt-1 h-3 w-3 rounded-full bg-cyan-500 shadow-sm shadow-cyan-500/30" />
                        <div className="mt-2 h-full w-px bg-slate-200" />
                      </div>
                      <div className="pb-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-800">{log.action.replace(/_/g, " ")}</p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                            {formatTanzaniaDateTime(log.timestamp)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {log.userName} | {log.userRole}
                        </p>
                        {log.details ? <p className="mt-2 text-sm text-slate-600">{log.details}</p> : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    No activity history has been recorded for this report item yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6 xl:sticky xl:top-6 xl:self-start">
          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-6 w-6 text-rose-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Decision Panel</p>
                  <p className="text-xs text-slate-500">Take the next action without hunting across the page.</p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3">
                {(isAdmin || isUtility) && (
                  <Button
                    variant="outline"
                    onClick={openResolveLocation}
                    className="w-full justify-start rounded-xl border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 hover:text-cyan-800"
                  >
                    <MapPin className="mr-2 h-4 w-4" />
                    {report.utilityId && report.dmaId ? "Adjust Utility / DMA" : "Resolve Utility / DMA"}
                  </Button>
                )}
                {isDMA && !report.teamName && (
                  <Button
                    onClick={openAssign}
                    className="w-full justify-start rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25 hover:from-amber-600 hover:to-orange-700"
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Assign Reports
                  </Button>
                )}
                {isDMA && report.status === "pending_approval" && (
                  <>
                    <Button
                      onClick={() => setApproveDialogOpen(true)}
                      className="w-full justify-start rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-green-700"
                    >
                      <CheckCheck className="mr-2 h-4 w-4" />
                      Approve Resolution
                    </Button>
                    <Button variant="destructive" onClick={() => setRejectDialogOpen(true)} className="w-full justify-start rounded-xl">
                      <X className="mr-2 h-4 w-4" />
                      Return For Rework
                    </Button>
                  </>
                )}
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => setDeleteDialogOpen(true)}
                    className="w-full justify-start rounded-xl border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Reports
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-6">
              <p className="text-sm font-semibold text-slate-800">Workflow</p>
              <p className="mt-1 text-xs text-slate-500">Where the report is right now and what happened before.</p>
              <div className="mt-5 space-y-4">
                {workflowSteps.map((step) => (
                  <TimelineStep
                    key={step.title}
                    title={step.title}
                    detail={step.detail}
                    active={step.active}
                    current={step.current}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-6">
              <p className="text-sm font-semibold text-slate-800">Routing & Ownership</p>
              <div className="mt-4 grid grid-cols-1 gap-3">
                <DetailCard icon={<Users className="h-5 w-5 text-cyan-600" />} label="Utility / Region" value={utilityLabel} tone="bg-cyan-100" />
                <DetailCard icon={<MapPin className="h-5 w-5 text-emerald-600" />} label="DMA / District" value={dmaLabel} tone="bg-emerald-100" />
                <DetailCard icon={<UserCog className="h-5 w-5 text-sky-600" />} label="Team Leader" value={report.teamLeaderName || "Not assigned"} tone="bg-sky-100" />
                <DetailCard icon={<Users className="h-5 w-5 text-amber-600" />} label="Assigned Engineer" value={report.assignedEngineerName || "Not assigned"} tone="bg-amber-100" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-6">
              <p className="text-sm font-semibold text-slate-800">Reporter & Timing</p>
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <User className="h-6 w-6 shrink-0 text-teal-600" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{report.reporterName || "Unknown reporter"}</p>
                  <p className="text-xs text-slate-500">{report.reporterPhone || "No phone provided"}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <DetailCard icon={<Clock className="h-5 w-5 text-blue-600" />} label="Created" value={createdLabel} tone="bg-blue-100" />
                <DetailCard icon={<CalendarClock className="h-5 w-5 text-cyan-600" />} label="Due Date" value={dueLabel} tone="bg-cyan-100" />
                <DetailCard
                  icon={resolvedTimingMeta.icon}
                  label="Resolved At"
                  value={resolvedTimingMeta.value}
                  tone={resolvedTimingMeta.tone}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border-slate-200/50 bg-white/95 shadow-2xl shadow-slate-200/50 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ClipboardCheck className="h-5 w-5 text-amber-600" />
              Assign Reports to Team
            </DialogTitle>
            <DialogDescription>Select the team that should handle this report item.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 overflow-y-auto py-4 pr-1">
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/60 p-4">
              <p className="font-sans text-sm font-extrabold tracking-[0.04em] text-slate-800">{report.trackingId}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{report.description || "No description"}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Select Team</Label>
              <Select
                value={assignTeamId}
                onValueChange={setAssignTeamId}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
                  {districtTeams.map((team) => (
                    <SelectItem key={team.id} value={team.id} className="rounded-lg">
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={handleAssign}
              disabled={isSubmitting || !assignTeamId}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25 hover:from-amber-600 hover:to-orange-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <UserCog className="mr-2 h-4 w-4" />
                  Assign Reports
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resolveLocationOpen} onOpenChange={setResolveLocationOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border-slate-200/50 bg-white/95 shadow-2xl shadow-slate-200/50 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <MapPin className="h-5 w-5 text-cyan-600" />
              Resolve Report Location
            </DialogTitle>
            <DialogDescription>
              Link this report to the correct regional utility and district DMA when the automatic match was uncertain.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 overflow-y-auto py-4 pr-1">
            <div className="rounded-xl border border-cyan-200/80 bg-cyan-50/60 p-4">
              <p className="font-sans text-sm font-extrabold tracking-[0.04em] text-slate-800">{report.trackingId}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{report.description || "No description"}</p>
              <p className="mt-2 text-xs text-slate-500">{getReportLocationLabel(report)}</p>
            </div>

            {!isUtility && (
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium text-slate-700">Utility / Region</Label>
                <Select
                  value={resolveUtilityId || "__none__"}
                  onValueChange={(value) => {
                    const nextValue = value === "__none__" ? "" : value
                    setResolveUtilityId(nextValue)
                    setResolveDMAId("")
                  }}
                >
                  <SelectTrigger className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80">
                    <SelectValue placeholder="Select utility" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
                    <SelectItem value="__none__" className="rounded-lg">
                      Unassigned Utility
                    </SelectItem>
                    {availableUtilities.map((utility) => (
                      <SelectItem key={utility.id} value={utility.id} className="rounded-lg">
                        {utility.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">DMA / District</Label>
              <Select
                value={resolveDMAId || "__none__"}
                onValueChange={(value) => setResolveDMAId(value === "__none__" ? "" : value)}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80">
                  <SelectValue placeholder="Select DMA" />
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveLocationOpen(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={handleResolveLocation}
              disabled={isSubmitting}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-600 hover:to-blue-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Location Routing
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={approveDialogOpen}
        onOpenChange={(open) => {
          setApproveDialogOpen(open)
          if (!open) setApproveComment("")
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border-slate-200/50 bg-white/95 shadow-2xl shadow-slate-200/50 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Approve Resolution</DialogTitle>
            <DialogDescription>
              Add the DMA approval comment that should stay with this report resolution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 overflow-y-auto pr-1">
            <Label htmlFor="approve-comment">DMA Approval Comment</Label>
            <Textarea
              id="approve-comment"
              value={approveComment}
              onChange={(event) => setApproveComment(event.target.value)}
              placeholder="Example: Resolution evidence verified, site condition matches the submitted outcome, approved for closure."
              className="min-h-[130px]"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setApproveDialogOpen(false)
                setApproveComment("")
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApprove}
              disabled={isSubmitting || !approveComment.trim()}
              className="rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-green-700"
            >
              {isSubmitting ? "Approving..." : "Approve Reports"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open)
          if (!open) setRejectReason("")
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border-slate-200/50 bg-white/95 shadow-2xl shadow-slate-200/50 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Reject Resolution</DialogTitle>
            <DialogDescription>
              Add the DMA rejection reason. This report will return to the assigned team for rework instead of staying rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 overflow-y-auto pr-1">
            <Label htmlFor="reject-reason">DMA Rework Reason</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Example: Final images do not clearly prove the reported issue was resolved. Please revisit the site and resubmit clearer evidence."
              className="min-h-[130px]"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setRejectDialogOpen(false)
                setRejectReason("")
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleReject}
              disabled={isSubmitting || !rejectReason.trim()}
              className="rounded-xl"
            >
              {isSubmitting ? "Returning..." : "Return For Rework"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Reports"
        description={`Delete report ${report.trackingId}? This action cannot be undone.`}
        confirmLabel={isSubmitting ? "Deleting..." : "Delete Reports"}
        onConfirm={handleDelete}
        variant="destructive"
      />

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-5xl rounded-3xl border-slate-200/60 bg-slate-950/95 p-3 text-white shadow-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Media Viewer</DialogTitle>
          </DialogHeader>
          {activeMedia ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">{activeMedia.label || "Reports Media"}</p>
                  <p className="text-xs text-slate-300">{activeMedia.alt}</p>
                </div>
                <Button variant="ghost" onClick={() => setViewerOpen(false)} className="rounded-xl text-slate-200 hover:bg-white/10 hover:text-white">
                  <X className="mr-2 h-4 w-4" />
                  Close
                </Button>
              </div>
              <div className="flex min-h-[70vh] items-center justify-center rounded-2xl bg-black/40 p-4">
                {isVideoMedia(activeMedia.uri) ? (
                  <video src={activeMedia.uri} controls className="max-h-[68vh] w-full rounded-2xl bg-black" />
                ) : (
                  <ResolvedImage
                    uri={activeMedia.uri}
                    alt={activeMedia.alt}
                    className="max-h-[68vh] w-auto max-w-full rounded-2xl object-contain"
                    fallbackClassName="h-[50vh] w-full"
                  />
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function HeroMetric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
      <div className={cn("h-1.5 w-20 rounded-full bg-gradient-to-r", accent)} />
      <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 break-words text-base font-semibold leading-snug text-slate-800">{value}</p>
    </div>
  )
}

function TimelineStep({
  title,
  detail,
  active,
  current,
}: {
  title: string
  detail: string
  active: boolean
  current: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "mt-1 h-3.5 w-3.5 rounded-full",
          current
            ? "bg-cyan-500 shadow-lg shadow-cyan-500/30"
            : active
            ? "bg-emerald-500 shadow-lg shadow-emerald-500/30"
            : "bg-slate-200"
        )}
      />
      <div className="min-w-0">
        <span className={cn("text-sm", active ? "font-medium text-slate-700" : "text-slate-400")}>{title}</span>
        <p className={cn("mt-1 text-xs leading-5", active ? "text-slate-500" : "text-slate-400")}>{detail}</p>
      </div>
    </div>
  )
}

function DetailCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200/60 bg-slate-50/80 p-3">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="break-words text-sm font-medium leading-snug text-slate-700">{value}</p>
      </div>
    </div>
  )
}

function MediaSection({
  title,
  description,
  icon,
  emptyMessage,
  items,
  onOpen,
}: {
  title: string
  description: string
  icon: React.ReactNode
  emptyMessage: string
  items: MediaItem[]
  onOpen: (item: MediaItem) => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-slate-50/70 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="shrink-0">{icon}</div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg">
              <button type="button" onClick={() => onOpen(item)} className="group block w-full text-left">
                <div className="relative">
                  {isVideoMedia(item.uri) ? (
                    <div className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-t-2xl bg-slate-950">
                      <video src={item.uri} className="h-full w-full object-cover opacity-70" muted />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                          <PlayCircle className="h-8 w-8 text-white" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <ResolvedImage
                      uri={item.uri}
                      alt={item.alt}
                      className="h-40 w-full rounded-t-2xl object-cover"
                      fallbackClassName="h-40 w-full rounded-t-2xl"
                    />
                  )}
                  <div className="pointer-events-none absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/60 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Expand className="h-4 w-4" />
                  </div>
                </div>

                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-700">{item.label || "Reporter Media"}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                      {isVideoMedia(item.uri) ? "Video" : "Image"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Click to open full view</p>
                </div>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-6 text-sm text-slate-500">
          {emptyMessage}
        </div>
      )}
    </div>
  )
}

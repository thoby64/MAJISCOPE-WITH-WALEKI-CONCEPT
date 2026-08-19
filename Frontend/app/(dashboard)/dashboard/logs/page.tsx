"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FileJson,
  FileSearch,
  Globe2,
  Info,
  ServerCog,
  ShieldCheck,
  Target,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import { apiClient } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuthStore } from "@/store/auth-store"
import { cn } from "@/lib/utils"

type AuditStatus = "success" | "failed" | string

interface ActivityLogItem {
  id: string
  action: string
  event_type?: string | null
  status?: AuditStatus | null
  user_id?: string | null
  utility_mgr_id?: string | null
  dma_mgr_id?: string | null
  engineer_id?: string | null
  user_name: string
  user_role: string
  entity: string
  entity_id: string
  target_name?: string | null
  details?: string | null
  ip_address?: string | null
  user_agent?: string | null
  request_method?: string | null
  request_path?: string | null
  error_message?: string | null
  before_data?: Record<string, unknown> | null
  after_data?: Record<string, unknown> | null
  metadata_json?: Record<string, unknown> | null
  utility_id?: string | null
  dma_id?: string | null
  timestamp: string
}

const PAGE_SIZES = [25, 50, 100, 150, 200, 250, 300]

const EVENT_TYPE_OPTIONS = [
  { value: "all", label: "All event types" },
  { value: "auth", label: "Authentication" },
  { value: "utility", label: "Utility" },
  { value: "dma", label: "DMA" },
  { value: "report", label: "Report" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "manager", label: "Manager" },
  { value: "engineer", label: "Engineer" },
  { value: "team", label: "Team" },
  { value: "user", label: "User" },
  { value: "media", label: "Media" },
  { value: "system", label: "System" },
]

const ENTITY_OPTIONS = [
  { value: "all", label: "All entities" },
  { value: "auth", label: "Auth" },
  { value: "utility", label: "Utility" },
  { value: "dma", label: "DMA" },
  { value: "report", label: "Report" },
  { value: "utility_infrastructure", label: "Infrastructure" },
  { value: "team", label: "Team" },
  { value: "engineer", label: "Engineer" },
  { value: "utility_manager", label: "Utility Manager" },
  { value: "dma_manager", label: "DMA Manager" },
  { value: "user", label: "User" },
  { value: "image_upload", label: "Media Upload" },
]

function prettyLabel(value?: string | null) {
  if (!value) return "Not specified"
  return value.replace(/_/g, " ").replace(/\./g, " / ")
}

function normalizedStatus(value?: AuditStatus | null) {
  return (value || "success").toLowerCase()
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== ""
}

function formatValue(value: unknown) {
  if (!hasValue(value)) return "N/A"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-900 dark:text-slate-100">{formatValue(value)}</p>
    </div>
  )
}

function SummaryPanel({
  icon: Icon,
  title,
  primary,
  secondary,
}: {
  icon: LucideIcon
  title: string
  primary: unknown
  secondary?: unknown
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{title}</p>
          <p className="mt-2 break-words font-semibold text-slate-950 dark:text-white">{formatValue(primary)}</p>
          {hasValue(secondary) ? (
            <p className="break-words text-sm text-slate-600 dark:text-slate-300">{formatValue(secondary)}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function JsonBlock({ title, value }: { title: string; value?: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="mb-2 flex items-center gap-2">
        <FileJson className="h-4 w-4 text-sky-600 dark:text-sky-300" />
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{title}</p>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function eventIcon(value?: string | null) {
  switch ((value || "").toLowerCase()) {
    case "auth":
      return ShieldCheck
    case "report":
      return FileSearch
    case "infrastructure":
      return Database
    case "system":
      return ServerCog
    default:
      return Activity
  }
}

export default function ActivityLogsPage() {
  const { currentUser } = useAuthStore()
  const [logs, setLogs] = useState<ActivityLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedLog, setSelectedLog] = useState<ActivityLogItem | null>(null)
  const [search, setSearch] = useState("")
  const [eventType, setEventType] = useState("all")
  const [status, setStatus] = useState("all")
  const [entity, setEntity] = useState("all")
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)

  const isAdmin = currentUser?.role === "admin"
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const skip = (page - 1) * pageSize

  const stats = useMemo(() => {
    const successful = logs.filter((log) => normalizedStatus(log.status) === "success").length
    const failed = logs.filter((log) => normalizedStatus(log.status) === "failed").length
    const auth = logs.filter((log) => log.event_type === "auth").length
    return { successful, failed, auth }
  }, [logs])

  const updateSearch = (value: string) => {
    setPage(1)
    setSearch(value)
  }

  const updateEventType = (value: string) => {
    setPage(1)
    setEventType(value)
  }

  const updateStatus = (value: string) => {
    setPage(1)
    setStatus(value)
  }

  const updateEntity = (value: string) => {
    setPage(1)
    setEntity(value)
  }

  const updatePageSize = (value: string) => {
    setPage(1)
    setPageSize(Number(value))
  }

  const loadLogs = async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("skip", String(skip))
      params.set("limit", String(pageSize))
      if (search.trim()) params.set("search", search.trim())
      if (eventType !== "all") params.set("event_type", eventType)
      if (status !== "all") params.set("status", status)
      if (entity !== "all") params.set("entity", entity)

      const response = await apiClient.get<{ total: number; items: ActivityLogItem[] }>(`/logs?${params}`)
      if (!response.success || !response.data) {
        setLogs([])
        setTotal(0)
        return
      }
      setLogs(response.data.items || [])
      setTotal(response.data.total || 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLogs()
  }, [isAdmin, skip, pageSize, search, eventType, status, entity])

  const SelectedEventIcon = selectedLog ? eventIcon(selectedLog.event_type) : Activity

  if (!isAdmin) {
    return (
      <Card className="border-slate-200/70 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center">
          <ShieldCheck className="h-10 w-10 text-slate-500" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin Access Required</h1>
          <p className="max-w-lg text-slate-600 dark:text-slate-300">
            Activity logs contain system-wide audit data and are available only to administrators.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <FileSearch className="h-7 w-7 text-cyan-600" />
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Activity Logs</h1>
          </div>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            Admin audit trail for authentication, data changes, routing, uploads, and system actions.
          </p>
        </div>
        <Button onClick={loadLogs} disabled={loading} className="bg-sky-600 text-white hover:bg-sky-700">
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-slate-200/70 bg-white/90 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <Activity className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              Loaded Logs
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{logs.length}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/70 bg-white/90 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Successful
            </p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">{stats.successful}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/70 bg-white/90 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <XCircle className="h-4 w-4 text-rose-600" />
              Failed
            </p>
            <p className="mt-2 text-3xl font-bold text-rose-600">{stats.failed}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/70 bg-white/90 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              Auth Events
            </p>
            <p className="mt-2 text-3xl font-bold text-sky-600">{stats.auth}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/70 bg-white/90 dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto]">
            <Input
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="Search actor, action, entity, target, or details..."
              className="h-11"
            />
            <Select value={eventType} onValueChange={updateEventType}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Event type" /></SelectTrigger>
              <SelectContent>
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={updateStatus}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={entity} onValueChange={updateEntity}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Entity" /></SelectTrigger>
              <SelectContent>
                {ENTITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={updatePageSize}>
              <SelectTrigger className="h-11 w-full lg:w-28"><SelectValue placeholder="Rows" /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-[150px_1fr_150px_130px_130px_90px] gap-3 bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-white">
              <span>Time</span>
              <span>Action</span>
              <span>Actor</span>
              <span>Entity</span>
              <span>Status</span>
              <span>Open</span>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {logs.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center text-slate-500 dark:text-slate-400">
                  {loading ? "Loading activity logs..." : "No logs match the selected filters."}
                </div>
              ) : (
                logs.map((log) => {
                  const EventIcon = eventIcon(log.event_type)
                  return (
                  <div key={log.id} className="grid grid-cols-[150px_1fr_150px_130px_130px_90px] gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(log.timestamp)}</span>
                    <div className="flex min-w-0 items-start gap-2">
                      <EventIcon className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950 dark:text-white">{prettyLabel(log.action)}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{log.target_name || log.details || log.request_path || "No target"}</p>
                      </div>
                    </div>
                    <span className="truncate">{log.user_name}</span>
                    <span className="truncate capitalize">{prettyLabel(log.entity)}</span>
                    <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", normalizedStatus(log.status) === "failed" ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200")}>
                      {normalizedStatus(log.status) === "failed" ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {normalizedStatus(log.status)}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setSelectedLog(log)}>Details</Button>
                  </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
            <span>{total ? `${skip + 1}-${Math.min(skip + logs.length, total)} of ${total}` : "0 logs"}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedLog ? (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={() => setSelectedLog(null)}>
          <div className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <SelectedEventIcon className="mt-1 h-6 w-6 shrink-0 text-sky-600 dark:text-sky-300" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{prettyLabel(selectedLog.event_type)} audit event</p>
                  <h2 className="mt-1 break-words text-2xl font-bold text-slate-950 dark:text-white">{prettyLabel(selectedLog.action)}</h2>
                  {selectedLog.details ? (
                    <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{selectedLog.details}</p>
                  ) : null}
                </div>
              </div>
              <Button variant="outline" onClick={() => setSelectedLog(null)}>Close</Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SummaryPanel
                icon={UserRound}
                title="Actor"
                primary={selectedLog.user_name}
                secondary={prettyLabel(selectedLog.user_role)}
              />
              <SummaryPanel
                icon={Globe2}
                title="Request"
                primary={`${selectedLog.request_method || "N/A"} ${selectedLog.request_path || ""}`.trim()}
                secondary={selectedLog.ip_address || "IP not captured"}
              />
              <SummaryPanel
                icon={Target}
                title="Target"
                primary={selectedLog.target_name || selectedLog.entity_id}
                secondary={prettyLabel(selectedLog.entity)}
              />
              <SummaryPanel
                icon={normalizedStatus(selectedLog.status) === "failed" ? AlertTriangle : CheckCircle2}
                title="Status"
                primary={normalizedStatus(selectedLog.status)}
                secondary={formatDate(selectedLog.timestamp)}
              />
            </div>

            {selectedLog.error_message ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                {selectedLog.error_message}
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-3 flex items-center gap-2">
                <Info className="h-4 w-4 text-sky-600 dark:text-sky-300" />
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Audit Columns</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <DetailRow label="Log ID" value={selectedLog.id} />
                <DetailRow label="Timestamp" value={formatDate(selectedLog.timestamp)} />
                <DetailRow label="Action" value={selectedLog.action} />
                <DetailRow label="Event Type" value={selectedLog.event_type} />
                <DetailRow label="Status" value={selectedLog.status || "success"} />
                <DetailRow label="Entity" value={selectedLog.entity} />
                <DetailRow label="Entity ID" value={selectedLog.entity_id} />
                <DetailRow label="Target Name" value={selectedLog.target_name} />
                <DetailRow label="Actor Name" value={selectedLog.user_name} />
                <DetailRow label="Actor Role" value={selectedLog.user_role} />
                <DetailRow label="User ID" value={selectedLog.user_id} />
                <DetailRow label="Utility Manager ID" value={selectedLog.utility_mgr_id} />
                <DetailRow label="DMA Manager ID" value={selectedLog.dma_mgr_id} />
                <DetailRow label="Engineer ID" value={selectedLog.engineer_id} />
                <DetailRow label="Utility ID" value={selectedLog.utility_id} />
                <DetailRow label="DMA ID" value={selectedLog.dma_id} />
                <DetailRow label="Request Method" value={selectedLog.request_method} />
                <DetailRow label="Request Path" value={selectedLog.request_path} />
                <DetailRow label="IP Address" value={selectedLog.ip_address} />
                <DetailRow label="User Agent" value={selectedLog.user_agent} />
                <DetailRow label="Details" value={selectedLog.details} />
                <DetailRow label="Error Message" value={selectedLog.error_message} />
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <JsonBlock title="Before" value={selectedLog.before_data} />
              <JsonBlock title="After" value={selectedLog.after_data} />
              <JsonBlock title="Metadata" value={selectedLog.metadata_json} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

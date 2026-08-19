"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAuthStore } from "@/store/auth-store"
import { CONFIG } from "@/lib/config"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CheckCircle2, Download, Eye, Layers, Loader2, Mail, MailPlus, MoreHorizontal, Pencil, Phone, Plus, Search, Send, ShieldCheck, Trash2, Upload, User, UserCog, Users } from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { toast } from "sonner"
import type { EntityStatus } from "@/lib/types"

interface TeamOption { id: string; name: string; dmaId: string; dmaName?: string; utilityId?: string; status: EntityStatus }
type OnboardingStatus = "completed" | "pending_setup" | "expired"
interface Engineer {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  status: EntityStatus
  teamId: string | null
  teamName: string | null
  dmaId: string
  dmaName?: string
  assignedReports?: number
  onboardingStatus: OnboardingStatus
  inviteExpiresAt?: string | null
  setupCompletedAt?: string | null
}
interface EngineerTemplateRow { email: string; role: string; team_name: string }

const ENGINEER_TEMPLATE_HEADERS = ["email", "role", "team_name"] as const
const ENGINEER_TEMPLATE_ROW_COUNT = 25

const escapeCsvValue = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

const buildEngineerTemplateCsv = () => {
  const headerRow = ENGINEER_TEMPLATE_HEADERS.map(escapeCsvValue).join(",")
  const templateRows = Array.from({ length: ENGINEER_TEMPLATE_ROW_COUNT }, () => ["", "engineer", ""].map(escapeCsvValue).join(","))
  return `${headerRow}\n${templateRows.join("\n")}\n`
}

const parseCsvLine = (line: string) => {
  const values: string[] = []
  let current = ""
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  values.push(current.trim())
  return values
}

const parseEngineerTemplate = (csvText: string): EngineerTemplateRow[] => {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase())
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    const record = headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] ?? ""
      return acc
    }, {})
    return { email: record.email ?? "", role: record.role ?? "", team_name: record.team_name ?? record.teamname ?? "" }
  })
}

const normalizeTemplateRole = (value: string) => {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return "engineer"
  if (normalized === "team leader") return "team_leader"
  return normalized
}

const isEmptyTemplateRow = (row: EngineerTemplateRow) => !row.email.trim() && !row.role.trim() && !row.team_name.trim()

const mapEngineer = (raw: Record<string, unknown>): Engineer => ({
  id: raw.id as string,
  name: raw.name as string,
  email: raw.email as string,
  phone: (raw.phone as string | null) ?? null,
  role: (raw.role as string) || "engineer",
  status: (raw.status as EntityStatus) || "active",
  teamId: (raw.team_id as string | null) ?? null,
  teamName: (raw.team_name as string | null) ?? null,
  dmaId: raw.dma_id as string,
  dmaName: raw.dma_name as string | undefined,
  assignedReports: (raw.assigned_reports as number) || 0,
  onboardingStatus: ((raw.onboarding_status as OnboardingStatus | undefined) || "completed"),
  inviteExpiresAt: (raw.invite_expires_at as string | null | undefined) ?? null,
  setupCompletedAt: (raw.setup_completed_at as string | null | undefined) ?? null,
})

const mapTeam = (raw: Record<string, unknown>): TeamOption => ({
  id: raw.id as string,
  name: raw.name as string,
  dmaId: raw.dma_id as string,
  dmaName: raw.dma_name as string | undefined,
  utilityId: raw.utility_id as string | undefined,
  status: (raw.status as EntityStatus) || "active",
})

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not set"
  return formatTanzaniaDateTime(value, value)
}

const copyText = async (text: string, successMessage: string) => {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    toast.success(successMessage)
    toast.message(text)
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.success(successMessage)
    toast.message(text)
  }
}

function OnboardingBadge({ status }: { status: OnboardingStatus }) {
  if (status === "completed") return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Ready</Badge>
  if (status === "expired") return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">Expired Invite</Badge>
  return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pending Setup</Badge>
}

function StatCard({ icon, label, value, gradient }: { icon: ReactNode; label: string; value: number; gradient: string }) {
  return (
    <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-lg`}>{icon}</div>
          <div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="text-2xl font-bold text-slate-800">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white">{icon}</div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-700">{value}</p>
      </div>
    </div>
  )
}

export default function EngineersPage() {
  const { currentUser } = useAuthStore()
  const isDMAManager = currentUser?.role === "dma_manager"
  const canAccess = isDMAManager || currentUser?.role === "utility_manager"
  const canManage = isDMAManager
  const dmaId = currentUser?.dmaId ?? ""
  const utilityId = currentUser?.utilityId ?? ""

  const [loading, setLoading] = useState(true)
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [editingEngineer, setEditingEngineer] = useState<Engineer | null>(null)
  const [viewingEngineer, setViewingEngineer] = useState<Engineer | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [formEmail, setFormEmail] = useState("")
  const [formTeamId, setFormTeamId] = useState("")
  const [formRole, setFormRole] = useState("engineer")
  const [formStatus, setFormStatus] = useState<EntityStatus>("active")

  const availableTeams = useMemo(() => (isDMAManager ? teams.filter((team) => team.dmaId === dmaId) : teams), [teams, isDMAManager, dmaId])

  const filteredEngineers = engineers.filter((engineer) => {
    const searchLower = search.trim().toLowerCase()
    const matchesSearch = !searchLower || engineer.name.toLowerCase().includes(searchLower) || engineer.email.toLowerCase().includes(searchLower) || (engineer.teamName || "").toLowerCase().includes(searchLower) || (engineer.dmaName || "").toLowerCase().includes(searchLower)
    const matchesStatus = statusFilter === "all" || engineer.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const totalEngineers = engineers.length
  const activeEngineers = engineers.filter((engineer) => engineer.status === "active").length
  const teamLeadersCount = engineers.filter((engineer) => engineer.role === "team_leader").length
  const pendingSetupCount = engineers.filter((engineer) => engineer.onboardingStatus !== "completed").length

  const loadData = async () => {
    if (!canAccess) return
    try {
      setLoading(true)
      const teamUrl = isDMAManager && dmaId ? `${CONFIG.backend.fullUrl}/teams?dma_id=${dmaId}` : `${CONFIG.backend.fullUrl}/teams?utility_id=${utilityId}`
      const engineerUrl = isDMAManager && dmaId ? `${CONFIG.backend.fullUrl}/engineers?dma_id=${dmaId}` : `${CONFIG.backend.fullUrl}/engineers`
      const headers = { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
      const [teamsRes, engineersRes] = await Promise.all([fetch(teamUrl, { headers }), fetch(engineerUrl, { headers })])
      const teamPayload = teamsRes.ok ? await teamsRes.json() : { items: [] }
      const engineerPayload = engineersRes.ok ? await engineersRes.json() : { items: [] }
      const rawTeams = (Array.isArray(teamPayload) ? teamPayload : teamPayload.items || []) as Record<string, unknown>[]
      const rawEngineers = (Array.isArray(engineerPayload) ? engineerPayload : engineerPayload.items || []) as Record<string, unknown>[]
      const nextTeams = rawTeams.map(mapTeam).filter((team) => team.status === "active")
      const scopedDmaIds = new Set(nextTeams.map((team) => team.dmaId))
      setTeams(nextTeams)
      setEngineers(rawEngineers.map(mapEngineer).filter((engineer) => isDMAManager || scopedDmaIds.has(engineer.dmaId)))
    } catch (error) {
      console.error("Error fetching engineers page data:", error)
      toast.error("Failed to load engineers")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData() }, [canAccess, dmaId, utilityId, isDMAManager])

  const resetForm = () => {
    setFormEmail("")
    setFormTeamId("")
    setFormRole("engineer")
    setFormStatus("active")
  }

  const openCreateDialog = () => {
    setEditingEngineer(null)
    resetForm()
    setDialogOpen(true)
  }

  const openEditDialog = (engineer: Engineer) => {
    setEditingEngineer(engineer)
    setFormEmail(engineer.email)
    setFormTeamId(engineer.teamId || "")
    setFormRole(engineer.role)
    setFormStatus(engineer.status)
    setDialogOpen(true)
  }

  const handleInviteResult = async (result: { invite_url?: string | null; delivery_message?: string }, successMessage: string) => {
    if (result.invite_url) {
      await copyText(result.invite_url, "Invite link copied to clipboard")
    }
    toast.success(successMessage)
    if (result.delivery_message) toast.message(result.delivery_message)
  }

  const handleSubmit = async () => {
    if (!formEmail.trim()) return toast.error("Email is required")
    if (!formTeamId) return toast.error("Please select a team")
    if (!["engineer", "team_leader"].includes(formRole)) return toast.error("Select a valid role")

    const payload: Record<string, unknown> = {
      email: formEmail.trim(),
      team_id: formTeamId,
      role: formRole,
      status: formStatus,
    }

    try {
      setSubmitting(true)
      const response = await fetch(editingEngineer ? `${CONFIG.backend.fullUrl}/engineers` : `${CONFIG.backend.fullUrl}/engineers/invitations`, {
        method: editingEngineer ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editingEngineer ? { ...payload, id: editingEngineer.id } : payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error((data as { detail?: string; error?: string }).detail || (data as { detail?: string; error?: string }).error || "Failed to save engineer")
        return
      }
      if (editingEngineer) {
        toast.success("Engineer updated successfully")
      } else {
        await handleInviteResult(data as { invite_url?: string | null; delivery_message?: string }, "Invitation created successfully")
      }
      setDialogOpen(false)
      await loadData()
    } catch (error) {
      console.error("Error saving engineer:", error)
      toast.error("Failed to save engineer")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const response = await fetch(`${CONFIG.backend.fullUrl}/engineers?id=${deleteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error((data as { detail?: string; error?: string }).detail || (data as { detail?: string; error?: string }).error || "Failed to delete engineer")
        return
      }
      toast.success("Engineer removed successfully")
      setDeleteId(null)
      await loadData()
    } catch (error) {
      console.error("Error deleting engineer:", error)
      toast.error("Failed to delete engineer")
    }
  }

  const handleResendInvite = async (engineer: Engineer) => {
    try {
      setResendingInviteId(engineer.id)
      const response = await fetch(`${CONFIG.backend.fullUrl}/engineers/${engineer.id}/resend-invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          "Content-Type": "application/json",
        },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error((data as { detail?: string; error?: string }).detail || (data as { detail?: string; error?: string }).error || "Failed to resend invite")
        return
      }
      await handleInviteResult(data as { invite_url?: string | null; delivery_message?: string }, "Invitation resent successfully")
      await loadData()
    } catch (error) {
      console.error("Error resending invite:", error)
      toast.error("Failed to resend invite")
    } finally {
      setResendingInviteId(null)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([buildEngineerTemplateCsv()], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "engineers-template.csv"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    toast.success("Engineer invitation template downloaded")
  }

  const resolveTeamIdForImport = (row: EngineerTemplateRow) => {
    const teamName = row.team_name.trim().toLowerCase()
    if (!teamName) return null
    const exactMatches = availableTeams.filter((team) => team.name.trim().toLowerCase() === teamName)
    return exactMatches.length === 1 ? exactMatches[0].id : null
  }

  const handleTemplateUpload = async (file: File) => {
    if (!availableTeams.length) return toast.error("No active teams are available for engineer import")
    try {
      setImporting(true)
      const rows = parseEngineerTemplate(await file.text()).filter((row) => !isEmptyTemplateRow(row))
      if (!rows.length) return toast.error("The uploaded template is empty")
      const validationErrors: string[] = []
      const invitations = rows.flatMap((row, index) => {
        const rowNumber = index + 2
        const teamId = resolveTeamIdForImport(row)
        const role = normalizeTemplateRole(row.role)
        if (!row.email.trim()) validationErrors.push(`Row ${rowNumber}: email is required`)
        if (!row.team_name.trim()) validationErrors.push(`Row ${rowNumber}: team_name is required`)
        if (!teamId) validationErrors.push(`Row ${rowNumber}: team_name does not match an active team in your DMA`)
        if (!["engineer", "team_leader"].includes(role)) validationErrors.push(`Row ${rowNumber}: role must be engineer or team_leader`)
        if (!row.email.trim() || !row.team_name.trim() || !teamId || !["engineer", "team_leader"].includes(role)) return []
        return [{ email: row.email.trim(), role, team_id: teamId, status: "active" }]
      })
      if (validationErrors.length) {
        toast.error(validationErrors.slice(0, 3).join(" | "))
        if (validationErrors.length > 3) toast.error(`${validationErrors.length - 3} more row errors found in the template`)
        return
      }
      const response = await fetch(`${CONFIG.backend.fullUrl}/engineers/invitations/bulk`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invitations }),
      })
      const data = await response.json().catch(() => ({ items: [] }))
      if (!response.ok) {
        toast.error((data as { detail?: string; error?: string }).detail || (data as { detail?: string; error?: string }).error || "Failed to import engineers")
        return
      }
      const results = ((data as { items?: Array<Record<string, unknown>> }).items || [])
      const successes = results.filter((result) => result.ok)
      const failures = results.filter((result) => !result.ok)
      const manualLinks = successes.filter((result) => typeof result.invite_url === "string" && result.invite_url).map((result) => `${result.email}: ${String(result.invite_url)}`)
      if (successes.length) toast.success(`Prepared ${successes.length} invitation${successes.length === 1 ? "" : "s"}`)
      if (manualLinks.length) await copyText(manualLinks.join("\n"), "Manual invite links copied to clipboard")
      if (failures.length) {
        const failurePreview = failures.slice(0, 3).map((failure) => `${failure.email}: ${String(failure.detail || "Failed to invite")}`).join(" | ")
        toast.error(failurePreview)
        if (failures.length > 3) toast.error(`${failures.length - 3} more import errors occurred`)
      }
      if (successes.length) await loadData()
    } catch (error) {
      console.error("Error importing engineer template:", error)
      toast.error("Failed to import engineer template")
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()

  if (!canAccess) {
    return <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20"><CardContent className="py-16 text-center"><p className="text-lg font-semibold text-slate-800">Access Restricted</p><p className="mt-1 text-sm text-slate-500">Only DMA and Utility Managers can view engineers.</p></CardContent></Card>
  }

  if (loading) {
    return <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20"><CardContent className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></CardContent></Card>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-800">
              <Users className="h-7 w-7 text-teal-600" />
              Engineers
            </h1>
            <p className="mt-1 text-slate-500">Invite engineers by email, assign the role and team, then let them finish their own setup.</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleTemplateUpload(file) }} />
              <Button variant="outline" onClick={downloadTemplate} className="h-11 rounded-xl border-slate-200 bg-white"><Download className="mr-2 h-4 w-4" />Download Template</Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing} className="h-11 rounded-xl border-slate-200 bg-white">{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload Filled Template</Button>
              <Button onClick={openCreateDialog} className="h-11 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700"><Plus className="mr-2 h-4 w-4" />Invite Engineer</Button>
            </div>
          )}
        </div>

        {canManage && (
          <Card className="border-dashed border-teal-200 bg-teal-50/60 shadow-none dark:border-teal-400/35 dark:bg-slate-900/85 dark:shadow-sm dark:shadow-black/20">
            <CardContent className="flex flex-col gap-3 p-4 text-sm text-slate-600 dark:text-slate-200 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-semibold text-slate-800 dark:text-white">Bulk invitation template</p>
                <p className="mt-1 text-slate-600 dark:text-slate-300">Use the CSV template to invite many engineers at once. Fill only <span className="font-medium text-slate-800 dark:text-white">email</span>, <span className="font-medium text-slate-800 dark:text-white">role</span>, and <span className="font-medium text-slate-800 dark:text-white">team_name</span>. MajiScope keeps the account inside your current DMA, sends the invitation email when a provider is configured, and gives you a secure invite link when manual sharing is needed.</p>
              </div>
              <div className="rounded-xl bg-white px-4 py-3 text-xs text-slate-500 shadow-sm shadow-slate-900/[0.03] dark:border dark:border-teal-400/20 dark:bg-slate-950/80 dark:text-slate-300 dark:shadow-black/20">Active teams available for import: <span className="font-semibold text-slate-800 dark:text-white">{availableTeams.length}</span></div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard icon={<Users className="h-6 w-6 text-white" />} label="Total Engineers" value={totalEngineers} gradient="from-teal-500 to-cyan-600" />
          <StatCard icon={<CheckCircle2 className="h-6 w-6 text-white" />} label="Active" value={activeEngineers} gradient="from-green-500 to-emerald-600" />
          <StatCard icon={<UserCog className="h-6 w-6 text-white" />} label="Team Leaders" value={teamLeadersCount} gradient="from-sky-500 to-cyan-600" />
          <StatCard icon={<MailPlus className="h-6 w-6 text-white" />} label="Pending Setup" value={pendingSetupCount} gradient="from-amber-500 to-orange-600" />
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search by name, email, team, or DMA..." value={search} onChange={(event) => setSearch(event.target.value)} className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80 pl-11" />
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 w-36 rounded-xl border-slate-200/80 bg-slate-50/80"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-slate-500">{filteredEngineers.length} engineers</span>
        </div>
      </div>

      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="p-0">
          <div className="space-y-3 p-4 md:hidden">
            {filteredEngineers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center">
                <p className="text-lg font-semibold text-slate-800">No engineers found</p>
                <p className="mt-1 text-sm text-slate-500">Try adjusting your filters or invite a new engineer.</p>
              </div>
            ) : filteredEngineers.map((engineer) => (
              <div key={engineer.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-gradient-to-br from-teal-500 to-cyan-600 text-white">{initials(engineer.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-slate-800">{engineer.name}</p>
                      <p className="text-xs text-slate-500 break-all">{engineer.email}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">{engineer.role.replace("_", " ")}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Team</p>
                    <p className="mt-1 font-medium text-slate-700">{engineer.teamName || "Unassigned"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">DMA</p>
                    <p className="mt-1 font-medium text-slate-700">{engineer.dmaName || "Not set"}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <EntityStatusBadge status={engineer.status} />
                  <OnboardingBadge status={engineer.onboardingStatus} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setViewingEngineer(engineer); setViewDialogOpen(true) }}>
                    <Eye className="mr-2 h-4 w-4" />
                    Details
                  </Button>
                  {canManage ? <Button variant="outline" size="sm" onClick={() => openEditDialog(engineer)}><Pencil className="mr-2 h-4 w-4" />Edit</Button> : null}
                  {canManage && engineer.onboardingStatus !== "completed" ? <Button variant="outline" size="sm" onClick={() => void handleResendInvite(engineer)}><Send className="mr-2 h-4 w-4" />Resend</Button> : null}
                  {canManage ? <Button variant="outline" size="sm" className="text-red-600" onClick={() => setDeleteId(engineer.id)}><Trash2 className="mr-2 h-4 w-4" />Remove</Button> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="px-6 py-4">Engineer</TableHead>
                  <TableHead className="px-6 py-4">Team</TableHead>
                  <TableHead className="px-6 py-4">DMA</TableHead>
                  <TableHead className="px-6 py-4">Role</TableHead>
                  <TableHead className="px-6 py-4">Access</TableHead>
                  <TableHead className="px-6 py-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEngineers.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-16 text-center"><p className="text-lg font-semibold text-slate-800">No engineers found</p><p className="mt-1 text-sm text-slate-500">Try adjusting your filters or invite a new engineer.</p></TableCell></TableRow>
                ) : filteredEngineers.map((engineer) => (
                  <TableRow key={engineer.id} className="border-b border-slate-100">
                    <TableCell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10"><AvatarFallback className="bg-gradient-to-br from-teal-500 to-cyan-600 text-white">{initials(engineer.name)}</AvatarFallback></Avatar>
                        <div><p className="font-semibold text-slate-800">{engineer.name}</p><p className="break-all text-xs text-slate-500">{engineer.email}</p></div>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4 break-words">{engineer.teamName ? <span className="font-medium text-slate-700">{engineer.teamName}</span> : <Badge variant="outline">Unassigned</Badge>}</TableCell>
                    <TableCell className="px-6 py-4 break-words">{engineer.dmaName || "Not set"}</TableCell>
                    <TableCell className="px-6 py-4"><Badge variant="outline" className="capitalize">{engineer.role.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="px-6 py-4"><div className="flex flex-col items-start gap-2"><EntityStatusBadge status={engineer.status} /><OnboardingBadge status={engineer.onboardingStatus} /></div></TableCell>
                    <TableCell className="px-6 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-lg"><MoreHorizontal className="h-4 w-4 text-slate-500" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setViewingEngineer(engineer); setViewDialogOpen(true) }}><Eye className="mr-2 h-4 w-4" />View Details</DropdownMenuItem>
                          {canManage && engineer.onboardingStatus !== "completed" && <DropdownMenuItem onClick={() => void handleResendInvite(engineer)}><Send className="mr-2 h-4 w-4" />Resend Invite</DropdownMenuItem>}
                          {canManage && <DropdownMenuItem onClick={() => openEditDialog(engineer)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
                          {canManage && <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteId(engineer.id)}><Trash2 className="mr-2 h-4 w-4" />Remove</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editingEngineer ? "Edit Engineer Access" : "Invite Engineer"}</DialogTitle>
            <DialogDescription>{editingEngineer ? "Update the assigned team, role, email, or account status." : "Fill only the email, role, and team. The invited person will complete the remaining account setup from their secure link."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 overflow-y-auto py-4 pr-1">
            <div className="grid gap-2">
              <Label htmlFor="engineer-email">Email</Label>
              <Input id="engineer-email" type="email" value={formEmail} onChange={(event) => setFormEmail(event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={formRole} onValueChange={setFormRole}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="engineer">Engineer</SelectItem>
                    <SelectItem value="team_leader">Team Leader</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={(value) => setFormStatus(value as EntityStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Team</Label>
              <Select value={formTeamId} onValueChange={setFormTeamId}>
                <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                <SelectContent>
                  {availableTeams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name} {team.dmaName ? `- ${team.dmaName}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting} className="bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingEngineer ? "Save Changes" : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Engineer Details</DialogTitle></DialogHeader>
          {viewingEngineer && (
            <div className="grid gap-4 overflow-y-auto py-4 pr-1">
              <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <Avatar className="h-16 w-16"><AvatarFallback className="bg-gradient-to-br from-teal-500 to-cyan-600 text-white">{initials(viewingEngineer.name)}</AvatarFallback></Avatar>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{viewingEngineer.name}</h3>
                  <p className="text-sm text-slate-500">{viewingEngineer.role.replace("_", " ")}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><EntityStatusBadge status={viewingEngineer.status} /><OnboardingBadge status={viewingEngineer.onboardingStatus} /></div>
                </div>
              </div>
              <DetailRow icon={<Mail className="h-4 w-4 text-blue-600" />} label="Email" value={viewingEngineer.email} />
              <DetailRow icon={<Phone className="h-4 w-4 text-green-600" />} label="Phone" value={viewingEngineer.phone || "Provided during setup"} />
              <DetailRow icon={<Layers className="h-4 w-4 text-cyan-600" />} label="Team" value={viewingEngineer.teamName || "Unassigned"} />
              <DetailRow icon={<WaterUtilityIcon className="h-4 w-4 text-teal-600" />} label="DMA" value={viewingEngineer.dmaName || "Not assigned"} />
              <DetailRow icon={<ShieldCheck className="h-4 w-4 text-amber-600" />} label="Onboarding" value={viewingEngineer.onboardingStatus.replace("_", " ")} />
              <DetailRow icon={<MailPlus className="h-4 w-4 text-orange-600" />} label="Invite Expires" value={formatDateTime(viewingEngineer.inviteExpiresAt)} />
              <DetailRow icon={<User className="h-4 w-4 text-sky-600" />} label="Assigned Reports" value={String(viewingEngineer.assignedReports || 0)} />
            </div>
          )}
          <DialogFooter>
            {canManage && viewingEngineer?.onboardingStatus !== "completed" && <Button onClick={() => viewingEngineer && void handleResendInvite(viewingEngineer)} disabled={resendingInviteId === viewingEngineer?.id} className="bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700">{resendingInviteId === viewingEngineer?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Resend Invite</Button>}
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Engineer" description="Are you sure you want to remove this engineer? This action cannot be undone." confirmLabel="Remove Engineer" onConfirm={handleDelete} />
    </div>
  )
}

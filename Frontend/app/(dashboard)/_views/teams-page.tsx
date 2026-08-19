"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { CONFIG } from "@/lib/config"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CheckCircle2, FileText, Loader2, MoreHorizontal, Pencil, Plus, Search, Settings, Trash2, UserCog, Users } from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { EntityStatus } from "@/lib/types"

interface Team {
  id: string
  slug?: string | null
  name: string
  description: string | null
  dmaId: string
  dmaName: string
  utilityId?: string
  utilityName?: string
  leaderId: string | null
  leaderName?: string | null
  status: EntityStatus
  memberCount: number
  activeReports: number
  engineerIds: string[]
  createdAt: string
  updatedAt: string
}

const mapTeam = (raw: Record<string, unknown>): Team => ({
  id: raw.id as string,
  slug: (raw.slug as string | null) ?? null,
  name: raw.name as string,
  description: (raw.description as string | null) ?? null,
  dmaId: raw.dma_id as string,
  dmaName: (raw.dma_name as string) || "",
  utilityId: raw.utility_id as string | undefined,
  utilityName: raw.utility_name as string | undefined,
  leaderId: (raw.leader_id as string | null) ?? null,
  leaderName: (raw.leader_name as string | null) ?? null,
  status: (raw.status as EntityStatus) || "active",
  memberCount: (raw.member_count as number) || 0,
  activeReports: (raw.active_reports as number) || 0,
  engineerIds: (raw.engineer_ids as string[]) || [],
  createdAt: raw.created_at as string,
  updatedAt: raw.updated_at as string,
})

export default function TeamsPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const isDMAManager = currentUser?.role === "dma_manager"
  const dmaId = currentUser?.dmaId ?? ""

  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formStatus, setFormStatus] = useState<EntityStatus>("active")
  const [dmaName, setDmaName] = useState("")

  const loadTeams = async () => {
    if (!isDMAManager || !dmaId) return
    try {
      setLoading(true)
      const response = await fetch(`${CONFIG.backend.fullUrl}/teams?dma_id=${dmaId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
      })
      const payload = response.ok ? await response.json() : { items: [] }
      const rawTeams = Array.isArray(payload) ? payload : payload.items || []
      const nextTeams = rawTeams.map(mapTeam)
      setTeams(nextTeams)
      if (nextTeams[0]?.dmaName) setDmaName(nextTeams[0].dmaName)
      if (!nextTeams[0]?.dmaName) {
        const dmaResponse = await fetch(`${CONFIG.backend.fullUrl}/dmas/${dmaId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
        })
        if (dmaResponse.ok) {
          const dmaData = await dmaResponse.json()
          setDmaName(dmaData.name || "")
        }
      }
    } catch (error) {
      console.error("Error fetching teams:", error)
      toast.error("Failed to load teams")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTeams()
  }, [dmaId, isDMAManager])

  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const searchLower = search.trim().toLowerCase()
      const matchesSearch =
        !searchLower ||
        team.name.toLowerCase().includes(searchLower) ||
        (team.description || "").toLowerCase().includes(searchLower) ||
        (team.leaderName || "").toLowerCase().includes(searchLower)
      const matchesStatus = statusFilter === "all" || team.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [teams, search, statusFilter])

  const totalTeams = teams.length
  const activeTeams = teams.filter((team) => team.status === "active").length
  const totalMembers = teams.reduce((count, team) => count + team.memberCount, 0)
  const totalReports = teams.reduce((count, team) => count + team.activeReports, 0)

  const openCreateDialog = () => {
    setEditingTeam(null)
    setFormName("")
    setFormDescription("")
    setFormStatus("active")
    setDialogOpen(true)
  }

  const openEditDialog = (team: Team) => {
    setEditingTeam(team)
    setFormName(team.name)
    setFormDescription(team.description || "")
    setFormStatus(team.status)
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!formName.trim()) return toast.error("Team name is required")
    if (!dmaId) return toast.error("DMA is required")

    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        dma_id: dmaId,
        status: formStatus,
      }

      const response = await fetch(
        editingTeam ? `${CONFIG.backend.fullUrl}/teams/${editingTeam.id}` : `${CONFIG.backend.fullUrl}/teams`,
        {
          method: editingTeam ? "PUT" : "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      )

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error((data as any).detail || (data as any).error || "Failed to save team")
        return
      }

      toast.success(editingTeam ? "Team updated successfully" : "Team created successfully")
      setDialogOpen(false)
      await loadTeams()
    } catch (error) {
      console.error("Error saving team:", error)
      toast.error("Failed to save team")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const response = await fetch(`${CONFIG.backend.fullUrl}/teams/${deleteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error((data as any).detail || (data as any).error || "Failed to delete team")
        return
      }
      toast.success("Team deleted successfully")
      setDeleteId(null)
      await loadTeams()
    } catch (error) {
      console.error("Error deleting team:", error)
      toast.error("Failed to delete team")
    }
  }

  if (!isDMAManager) {
    return (
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="py-16 text-center">
          <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
          <p className="mt-1 text-sm text-slate-500">Only DMA Managers can manage teams.</p>
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-sky-600 shadow-lg shadow-cyan-500/20">
                <UserCog className="h-5 w-5 text-white" />
              </div>
              Team Management
            </h1>
            <p className="mt-1 text-slate-500">
              Teams now sit directly under {dmaName || "your DMA"}.
            </p>
          </div>
          <Button onClick={openCreateDialog} className="h-11 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-600 text-white hover:from-cyan-600 hover:to-sky-700">
            <Plus className="mr-2 h-4 w-4" />
            Create Team
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard icon={<UserCog className="h-6 w-6 text-white" />} label="Total Teams" value={totalTeams} gradient="from-cyan-500 to-sky-600" />
          <StatCard icon={<CheckCircle2 className="h-6 w-6 text-white" />} label="Active Teams" value={activeTeams} gradient="from-green-500 to-emerald-600" />
          <StatCard icon={<Users className="h-6 w-6 text-white" />} label="Total Members" value={totalMembers} gradient="from-blue-500 to-cyan-600" />
          <StatCard icon={<FileText className="h-6 w-6 text-white" />} label="Active Reports" value={totalReports} gradient="from-amber-500 to-orange-600" />
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search teams..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80 pl-11"
          />
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 w-36 rounded-xl border-slate-200/80 bg-slate-50/80">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-slate-500">{filteredTeams.length} teams</span>
        </div>
      </div>

      {filteredTeams.length === 0 ? (
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold text-slate-800">No teams found</p>
            <p className="mt-1 text-sm text-slate-500">Create your first team to start assigning engineers.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTeams.map((team) => (
            <Card key={team.id} className={cn("border-slate-200/60 shadow-lg shadow-slate-200/20 transition-all duration-300 hover:-translate-y-1", team.status === "active" ? "hover:shadow-xl hover:shadow-cyan-500/10" : "bg-red-50/20 hover:shadow-xl hover:shadow-red-500/10")}>
              <div className={cn("h-1", team.status === "active" ? "bg-gradient-to-r from-cyan-400 via-sky-500 to-cyan-400" : "bg-gradient-to-r from-red-400 via-rose-500 to-red-400")} />
              <CardContent className="p-5">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-sky-600 shadow-lg shadow-cyan-500/20">
                      <UserCog className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">{team.name}</h3>
                      <EntityStatusBadge status={team.status} />
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="rounded-lg">
                        <MoreHorizontal className="h-4 w-4 text-slate-500" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => router.push(`/dashboard/teams/${team.slug || team.id}`)}>
                        <Settings className="mr-2 h-4 w-4" />
                        Manage Team
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEditDialog(team)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Info
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setDeleteId(team.id)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {team.description && <p className="mb-4 line-clamp-2 text-sm text-slate-500">{team.description}</p>}

                <div className="space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2">
                    <WaterUtilityIcon className="h-4 w-4 text-cyan-500" />
                    <span className="font-medium">{team.dmaName}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4 text-blue-500" />
                      <span className="font-medium">{team.memberCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FileText className="h-4 w-4 text-cyan-500" />
                      <span className="font-medium">{team.activeReports}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Leader: </span>
                    <span className="font-medium text-slate-700">{team.leaderName || "Not assigned"}</span>
                  </div>
                </div>

                <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => router.push(`/dashboard/teams/${team.slug || team.id}`)}>
                  <Settings className="mr-2 h-4 w-4" />
                  Manage Team Members
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editingTeam ? "Edit Team" : "Create Team"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 overflow-y-auto py-4 pr-1">
            <div className="rounded-xl border border-cyan-200/80 bg-gradient-to-r from-cyan-50/50 to-sky-50/50 p-4">
              <div className="flex items-center gap-2 text-sm">
                <WaterUtilityIcon className="h-4 w-4 text-cyan-600" />
                <span className="font-semibold text-cyan-700">{dmaName || "Your DMA"}</span>
              </div>
              <p className="mt-2 text-xs text-cyan-500/80">Teams are now created directly under this DMA.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="team-name">Team Name</Label>
              <Input id="team-name" value={formName} onChange={(event) => setFormName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="team-description">Description</Label>
              <Textarea id="team-description" value={formDescription} onChange={(event) => setFormDescription(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={formStatus} onValueChange={(value) => setFormStatus(value as EntityStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-gradient-to-r from-cyan-500 to-sky-600 text-white hover:from-cyan-600 hover:to-sky-700">
              {saving ? "Saving..." : editingTeam ? "Save Changes" : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Team"
        description="Are you sure you want to delete this team? Its members will be unassigned."
        confirmLabel="Delete Team"
        onConfirm={handleDelete}
      />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  gradient,
}: {
  icon: ReactNode
  label: string
  value: number
  gradient: string
}) {
  return (
    <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-lg`}>
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="text-2xl font-bold text-slate-800">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

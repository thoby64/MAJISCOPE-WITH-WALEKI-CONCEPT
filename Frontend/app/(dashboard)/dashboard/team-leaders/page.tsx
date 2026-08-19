"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useAuthStore } from "@/store/auth-store"
import { CONFIG } from "@/lib/config"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CheckCircle2, Crown, Eye, Loader2, Pencil, Search, Users, XCircle } from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { toast } from "sonner"

interface Team {
  id: string
  name: string
  description: string | null
  dmaId: string
  dmaName: string
  leaderId: string | null
  leaderName?: string | null
  leaderEmail?: string | null
  leaderPhone?: string | null
  status: "active" | "inactive"
  memberCount: number
}

interface Engineer {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  teamId?: string | null
  dmaId: string
}

const mapTeam = (raw: Record<string, unknown>): Team => ({
  id: raw.id as string,
  name: raw.name as string,
  description: (raw.description as string | null) ?? null,
  dmaId: raw.dma_id as string,
  dmaName: (raw.dma_name as string) || "",
  leaderId: (raw.leader_id as string | null) ?? null,
  leaderName: (raw.leader_name as string | null) ?? null,
  leaderEmail: (raw.leader_email as string | null) ?? null,
  leaderPhone: (raw.leader_phone as string | null) ?? null,
  status: (raw.status as "active" | "inactive") || "active",
  memberCount: (raw.member_count as number) || 0,
})

const mapEngineer = (raw: Record<string, unknown>): Engineer => ({
  id: raw.id as string,
  name: raw.name as string,
  email: raw.email as string,
  phone: (raw.phone as string | null) ?? null,
  status: (raw.status as string) || "active",
  teamId: (raw.team_id as string | null) ?? null,
  dmaId: raw.dma_id as string,
})

export default function TeamLeadersPage() {
  const { currentUser } = useAuthStore()
  const isDMAManager = currentUser?.role === "dma_manager"
  const dmaId = currentUser?.dmaId ?? ""

  const [teams, setTeams] = useState<Team[]>([])
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [viewingTeam, setViewingTeam] = useState<Team | null>(null)
  const [formLeaderId, setFormLeaderId] = useState("")
  const [dmaName, setDmaName] = useState("")

  const loadData = async () => {
    if (!isDMAManager || !dmaId) return
    try {
      setLoading(true)
      const headers = { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
      const [teamsRes, engineersRes] = await Promise.all([
        fetch(`${CONFIG.backend.fullUrl}/teams?dma_id=${dmaId}`, { headers }),
        fetch(`${CONFIG.backend.fullUrl}/engineers?dma_id=${dmaId}`, { headers }),
      ])
      const teamsPayload = teamsRes.ok ? await teamsRes.json() : { items: [] }
      const engineersPayload = engineersRes.ok ? await engineersRes.json() : { items: [] }
      const nextTeams = (Array.isArray(teamsPayload) ? teamsPayload : teamsPayload.items || []).map(mapTeam)
      const nextEngineers = (Array.isArray(engineersPayload) ? engineersPayload : engineersPayload.items || []).map(mapEngineer)
      setTeams(nextTeams)
      setEngineers(nextEngineers)
      if (nextTeams[0]?.dmaName) setDmaName(nextTeams[0].dmaName)
    } catch (error) {
      console.error("Error loading team leaders page:", error)
      toast.error("Failed to load team leaders")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [isDMAManager, dmaId])

  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const searchLower = search.trim().toLowerCase()
      const matchesSearch =
        !searchLower ||
        team.name.toLowerCase().includes(searchLower) ||
        (team.leaderName || "").toLowerCase().includes(searchLower)
      const matchesStatus = statusFilter === "all" || team.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [teams, search, statusFilter])

  const availableLeaders = editingTeam
    ? engineers.filter((engineer) => engineer.dmaId === editingTeam.dmaId && engineer.status === "active" && (!engineer.teamId || engineer.teamId === editingTeam.id))
    : []

  const teamsWithLeaders = teams.filter((team) => team.leaderName).length
  const teamsWithoutLeaders = teams.filter((team) => !team.leaderName).length
  const activeTeams = teams.filter((team) => team.status === "active").length

  const openEditDialog = (team: Team) => {
    setEditingTeam(team)
    setFormLeaderId(team.leaderId || "")
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!editingTeam || !formLeaderId) return toast.error("Please select a team leader")
    try {
      setSaving(true)
      const response = await fetch(`${CONFIG.backend.fullUrl}/teams/${editingTeam.id}/leader`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ engineerId: formLeaderId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error((data as any).detail || (data as any).error || "Failed to update team leader")
        return
      }
      toast.success("Team leader updated successfully")
      setDialogOpen(false)
      await loadData()
    } catch (error) {
      console.error("Error updating team leader:", error)
      toast.error("Failed to update team leader")
    } finally {
      setSaving(false)
    }
  }

  if (!isDMAManager) {
    return (
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="py-16 text-center">
          <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
          <p className="mt-1 text-sm text-slate-500">Only DMA Managers can manage team leaders.</p>
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
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-800">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
              <Crown className="h-5 w-5 text-white" />
            </div>
            Team Leaders
          </h1>
          <p className="mt-1 text-slate-500">
            Assign leaders to teams in {dmaName || "your DMA"}.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard icon={<Users className="h-6 w-6 text-white" />} label="Total Teams" value={teams.length} gradient="from-amber-500 to-orange-600" />
          <StatCard icon={<CheckCircle2 className="h-6 w-6 text-white" />} label="Active Teams" value={activeTeams} gradient="from-green-500 to-emerald-600" />
          <StatCard icon={<Crown className="h-6 w-6 text-white" />} label="With Leaders" value={teamsWithLeaders} gradient="from-sky-500 to-cyan-600" />
          <StatCard icon={<XCircle className="h-6 w-6 text-white" />} label="Without Leaders" value={teamsWithoutLeaders} gradient="from-red-500 to-rose-600" />
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search teams..." className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80 pl-11" />
        </div>
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
      </div>

      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="p-0">
          <div className="space-y-3 p-4 md:hidden">
            {filteredTeams.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center">
                <p className="text-lg font-semibold text-slate-800">No teams found</p>
              </div>
            ) : filteredTeams.map((team) => (
              <div key={team.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-800">{team.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{team.description || "No description"}</p>
                  </div>
                  <EntityStatusBadge status={team.status} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">DMA</p>
                    <p className="mt-1 font-medium text-slate-700">{team.dmaName}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Leader</p>
                    <p className="mt-1 font-medium text-slate-700">{team.leaderName || "Not assigned"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Members</p>
                    <p className="mt-1 font-medium text-slate-700">{team.memberCount}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setViewingTeam(team); setDetailOpen(true) }}>
                    <Eye className="mr-2 h-4 w-4" />
                    Details
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditDialog(team)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Assign Leader
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="px-6 py-4">Team</TableHead>
                  <TableHead className="px-6 py-4">DMA</TableHead>
                  <TableHead className="px-6 py-4">Leader</TableHead>
                  <TableHead className="px-6 py-4">Members</TableHead>
                  <TableHead className="px-6 py-4">Status</TableHead>
                  <TableHead className="px-6 py-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTeams.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center">
                      <p className="text-lg font-semibold text-slate-800">No teams found</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTeams.map((team) => (
                    <TableRow key={team.id} className="border-b border-slate-100">
                      <TableCell className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-slate-800">{team.name}</p>
                          <p className="text-xs text-slate-500">{team.description || "No description"}</p>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 break-words">
                        <div className="flex items-center gap-2">
                          <WaterUtilityIcon className="h-4 w-4 text-cyan-600" />
                          <span>{team.dmaName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">{team.leaderName || "Not assigned"}</TableCell>
                      <TableCell className="px-6 py-4">{team.memberCount}</TableCell>
                      <TableCell className="px-6 py-4"><EntityStatusBadge status={team.status} /></TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => { setViewingTeam(team); setDetailOpen(true) }}>
                            <Eye className="h-4 w-4 text-slate-500" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(team)}>
                            <Pencil className="h-4 w-4 text-slate-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Assign Team Leader</DialogTitle>
          </DialogHeader>
          {editingTeam && (
            <div className="grid gap-4 overflow-y-auto py-4 pr-1">
              <div className="rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50/50 to-orange-50/50 p-4">
                <p className="font-semibold text-slate-800">{editingTeam.name}</p>
                <p className="text-xs text-slate-500">{editingTeam.dmaName}</p>
              </div>
              <div className="grid gap-2">
                <Label>Select Team Leader</Label>
                <Select value={formLeaderId} onValueChange={setFormLeaderId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an engineer" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLeaders.length === 0 ? (
                      <div className="px-2 py-4 text-center text-sm text-slate-500">No active engineers available in this DMA.</div>
                    ) : (
                      availableLeaders.map((engineer) => (
                        <SelectItem key={engineer.id} value={engineer.id}>
                          {engineer.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !formLeaderId} className="bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-600 hover:to-orange-700">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Team Details</DialogTitle>
          </DialogHeader>
          {viewingTeam && (
            <div className="grid gap-4 overflow-y-auto py-4 pr-1">
              <DetailRow label="Team" value={viewingTeam.name} />
              <DetailRow label="DMA" value={viewingTeam.dmaName} />
              <DetailRow label="Leader" value={viewingTeam.leaderName || "Not assigned"} />
              <DetailRow label="Leader Email" value={viewingTeam.leaderEmail || "N/A"} />
              <DetailRow label="Leader Phone" value={viewingTeam.leaderPhone || "N/A"} />
              <DetailRow label="Members" value={String(viewingTeam.memberCount)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-700">{value}</p>
    </div>
  )
}

"use client"

import { useState, useEffect } from "react"
import { useDataStore, type DMAManager } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { usePageAccess } from "@/hooks/use-page-access"
import { CONFIG } from "@/lib/config"
import { PageHeader } from "@/components/shared/page-header"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { SummaryMetricCard } from "@/components/shared/summary-metric-card"
import type { EntityStatus } from "@/lib/types"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Search,
  Plus,
  UserCog,
  CheckCircle2,
  XCircle,
  Users,
  MapPin,
  Mail,
  Phone,
  Save,
  Unlink,
  Lock,
  Eye,
  EyeOff,
  User,
  Layers,
  FileText,
  Send,
} from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export default function DMAManagersPage() {
  usePageAccess()

  const { currentUser } = useAuthStore()
  const {
    dmaManagers,
    dmas,
    utilities,
    fetchDMAManagers,
    fetchDMAs,
    fetchUtilities,
    addDMAManager,
    updateDMAManager,
    deleteDMAManager,
  } = useDataStore()

  const [search, setSearch] = useState("")
  const [searchInputEnabled, setSearchInputEnabled] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingManager, setEditingManager] = useState<DMAManager | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [unassignId, setUnassignId] = useState<string | null>(null)
  const [viewingManager, setViewingManager] = useState<DMAManager | null>(null)
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)

  const [formName, setFormName] = useState("")
  const [formEmail, setFormEmail] = useState("")
  const [formPhone, setFormPhone] = useState("")
  const [formPassword, setFormPassword] = useState("")
  const [formConfirmPassword, setFormConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [formUtilityId, setFormUtilityId] = useState("")
  const [formDMAId, setFormDMAId] = useState("unassigned")
  const [formStatus, setFormStatus] = useState<EntityStatus>("active")

  useEffect(() => {
    fetchDMAManagers()
    fetchDMAs()
    fetchUtilities()
  }, [fetchDMAManagers, fetchDMAs, fetchUtilities])

  const isAdmin = currentUser?.role === "admin"
  const isUtilityManager = currentUser?.role === "utility_manager"
  const myUtilityId = currentUser?.utilityId
  const myUtility = isUtilityManager ? utilities.find((u) => u.id === myUtilityId) : null
  const myUtilityDisplayName = myUtility?.name || currentUser?.utilityName || "Your Utility"
  const selectedUtilityId = isUtilityManager ? (myUtilityId || "") : formUtilityId
  const selectedUtility = utilities.find((u) => u.id === selectedUtilityId)

  let visibleManagers = dmaManagers
  if (isUtilityManager && myUtilityId) {
    visibleManagers = dmaManagers.filter((m) => {
      if (m.utilityId === myUtilityId) return true
      const dma = dmas.find((d) => d.id === m.dmaId)
      return dma?.utilityId === myUtilityId
    })
  }

  const availableDMAs = dmas.filter((d) => {
    if (!selectedUtilityId || d.utilityId !== selectedUtilityId) return false
    if (d.status !== "active") return false
    if (editingManager) {
      return !d.managerId || d.managerId === editingManager.id
    }
    return !d.managerId
  })

  const availableUtilities = utilities.filter((utility) => utility.status === "active")

  const filteredManagers = visibleManagers.filter((m) => {
    const searchLower = search.toLowerCase().trim()
    if (!searchLower) return true
    return (
      m.name?.toLowerCase().includes(searchLower) ||
      m.email?.toLowerCase().includes(searchLower) ||
      m.phone?.toLowerCase().includes(searchLower) ||
      m.dmaName?.toLowerCase().includes(searchLower) ||
      m.utilityName?.toLowerCase().includes(searchLower)
    )
  })

  const stats = {
    total: visibleManagers.length,
    active: visibleManagers.filter((m) => m.status === "active").length,
    assigned: visibleManagers.filter((m) => m.dmaId).length,
    unassigned: visibleManagers.filter((m) => !m.dmaId).length,
  }

  function openCreateDialog() {
    setEditingManager(null)
    setFormName("")
    setFormEmail("")
    setFormPhone("")
    setFormPassword("")
    setFormConfirmPassword("")
    setFormUtilityId(isUtilityManager ? (myUtilityId || "") : "")
    setFormDMAId("unassigned")
    setFormStatus("active")
    setShowPassword(false)
    setDialogOpen(true)
  }

  function openEditDialog(manager: DMAManager) {
    // Keep browser credential autofill from turning the list filter into the
    // signed-in user's email when the edit dialog focuses its email field.
    setSearch("")
    setEditingManager(manager)
    setFormName(manager.name)
    setFormEmail(manager.email)
    setFormPhone(manager.phone || "")
    setFormPassword("")
    setFormConfirmPassword("")
    setFormUtilityId(manager.utilityId || (myUtilityId || ""))
    setFormDMAId(manager.dmaId || "unassigned")
    setFormStatus(manager.status)
    setShowPassword(false)
    setDialogOpen(true)
  }

  function closeEditor() {
    setDialogOpen(false)
    setEditingManager(null)
    setFormName("")
    setFormEmail("")
    setFormPhone("")
    setFormPassword("")
    setFormConfirmPassword("")
    setFormUtilityId(isUtilityManager ? (myUtilityId || "") : "")
    setFormDMAId("unassigned")
    setFormStatus("active")
    setShowPassword(false)
    // Keep the current list intact when the editor is dismissed without saving.
  }

  async function handleSubmit() {
    if (!formEmail.trim()) { toast.error("Email is required"); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail)) { toast.error("Invalid email format"); return }
    if (!selectedUtilityId) { toast.error("Please select a utility"); return }
    if (editingManager && !formName.trim()) { toast.error("Manager name is required"); return }
    if (editingManager && formPassword.trim() && formPassword.length < 6) { toast.error("Password must be at least 6 characters"); return }
    if (editingManager && formPassword.trim() && formPassword !== formConfirmPassword) { toast.error("Passwords do not match"); return }

    try {
      if (editingManager) {
        const updateData: Record<string, any> = {
          name: formName,
          email: formEmail,
          phone: formPhone || null,
          status: formStatus,
          utilityId: selectedUtilityId,
          dmaId: formDMAId === "unassigned" ? null : formDMAId,
        }
        if (formPassword) updateData.password = formPassword
        await updateDMAManager(editingManager.id, updateData)
        toast.success("DMA Manager updated successfully")
      } else {
        const response = await fetch(`${CONFIG.backend.fullUrl}/dma-managers/invitations`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: formEmail,
            status: formStatus,
            utility_id: selectedUtilityId,
            dma_id: formDMAId === "unassigned" ? null : formDMAId,
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error((data as any).detail || (data as any).error || "Failed to invite DMA manager")
        }
        if ((data as any).invite_url && navigator?.clipboard) {
          await navigator.clipboard.writeText((data as any).invite_url)
          toast.success("DMA manager invited and invite link copied")
        } else {
          toast.success("DMA manager invited successfully")
        }
        if ((data as any).delivery_message) {
          toast.message((data as any).delivery_message)
        }
        await Promise.all([fetchDMAManagers(), fetchDMAs()])
      }
      setDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operation failed")
    }
  }

  async function handleDelete() {
    if (deleteId) {
      try {
        await deleteDMAManager(deleteId)
        toast.success("DMA Manager deleted successfully")
        setDeleteId(null)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete manager")
      }
    }
  }

  async function handleUnassignDMA() {
    if (unassignId) {
      try {
        await updateDMAManager(unassignId, { dmaId: null })
        toast.success("DMA unassigned successfully")
        setUnassignId(null)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to unassign DMA")
      }
    }
  }

  async function handleResendInvite(managerId: string) {
    try {
      setResendingInviteId(managerId)
      const response = await fetch(`${CONFIG.backend.fullUrl}/dma-managers/${managerId}/resend-invite`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
          "Content-Type": "application/json",
        },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error((data as any).detail || (data as any).error || "Failed to resend invite")
      }
      if ((data as any).invite_url && navigator?.clipboard) {
        await navigator.clipboard.writeText((data as any).invite_url)
        toast.success("Invite resent and copied to clipboard")
      } else {
        toast.success("Invite resent successfully")
      }
      if ((data as any).delivery_message) {
        toast.message((data as any).delivery_message)
      }
      await Promise.all([fetchDMAManagers(), fetchDMAs()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to resend invite")
    } finally {
      setResendingInviteId(null)
    }
  }

  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
  const renderOnboardingBadge = (status?: DMAManager["onboardingStatus"]) => {
    if (status === "expired") return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">Expired Invite</Badge>
    if (status === "pending_setup") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pending Setup</Badge>
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Ready</Badge>
  }

  if (!isAdmin && !isUtilityManager) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="DMA Manager Management" description="Only Admins and Utility Managers can manage DMA Managers" />
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <UserCog className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="text-sm text-slate-500 mt-1">Only Admins and Utility Managers can manage DMA Managers</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <UserCog className="h-7 w-7 text-primary" />
              DMA Managers
            </h1>
            <p className="text-slate-500 mt-1">
              {isUtilityManager ? `Manage DMA Managers for ${myUtilityDisplayName}` : "Manage all DMA Managers in the system"}
            </p>
          </div>
          <Button onClick={openCreateDialog} className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/15 hover:shadow-cyan-500/40 transition-all duration-300 rounded-xl h-11 px-6">
            <Plus className="h-4 w-4 mr-2" />
            Invite Manager
          </Button>
        </div>

        <div className="content-metric-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetricCard label="Total Managers" value={stats.total} icon={UserCog} tone="slate" />
          <SummaryMetricCard label="Active Managers" value={stats.active} icon={CheckCircle2} tone="blue" />
          <SummaryMetricCard label="With DMAs" value={stats.assigned} icon={MapPin} tone="slate" />
          <SummaryMetricCard label="Unassigned" value={stats.unassigned} icon={Unlink} tone="amber" />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-80">
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-400/10 to-sky-500/10 blur-lg opacity-0 focus-within:opacity-100 transition-opacity duration-300 pointer-events-none" />
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input type="search" name="dma-manager-list-filter" autoComplete="off" readOnly={!searchInputEnabled} onFocus={() => setSearchInputEnabled(true)} placeholder="Search by name, email, DMA..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-11 h-11  rounded-xl focus:border-primary/50 focus:ring-primary/15 shadow-sm" />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Users className="h-4 w-4" />
          <span>{filteredManagers.length} manager{filteredManagers.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden">
        <CardContent className="p-0">
          <div className="space-y-3 p-4 md:hidden">
            {filteredManagers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center">
                <p className="text-lg font-semibold text-slate-800">No managers found</p>
                <p className="mt-1 text-sm text-slate-500">{search ? "Try adjusting your search terms" : "Get started by inviting your first DMA manager"}</p>
                {!search ? <Button onClick={openCreateDialog} className="mt-4 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/15 rounded-xl"><Plus className="h-4 w-4 mr-2" />Invite DMA Manager</Button> : null}
              </div>
            ) : filteredManagers.map((manager) => {
              const dma = dmas.find((d) => d.id === manager.dmaId)
              const isInactive = manager.status === "inactive"
              return (
                <div key={manager.id} className={cn("rounded-2xl border p-4 shadow-sm", isInactive ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-white")}>
                  <div className="flex items-start gap-3">
                    <Avatar className={cn("h-10 w-10 shadow-lg", isInactive ? "ring-2 ring-red-200" : "ring-2 ring-cyan-200")}>
                      <AvatarFallback className={cn("text-sm font-semibold", isInactive ? "bg-gradient-to-br from-red-400 to-rose-500 text-white" : "bg-primary text-white")}>
                        {getInitials(manager.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">{manager.name}</p>
                      <p className="text-xs text-slate-500">DMA Manager</p>
                      <p className="mt-2 break-all text-sm text-slate-600">{manager.email}</p>
                      {manager.phone ? <p className="mt-1 text-sm text-slate-500">{manager.phone}</p> : null}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Assigned DMA</p>
                      <p className="mt-1 font-medium text-slate-700">{dma?.name || "Unassigned"}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <EntityStatusBadge status={manager.status} />
                    {renderOnboardingBadge(manager.onboardingStatus)}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setViewingManager(manager)}><Eye className="mr-2 h-4 w-4" />Details</Button>
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(manager)}><Pencil className="mr-2 h-4 w-4" />Edit</Button>
                    {manager.onboardingStatus !== "completed" ? <Button variant="outline" size="sm" onClick={() => handleResendInvite(manager.id)}><Send className="mr-2 h-4 w-4" />Resend</Button> : null}
                    {manager.dmaId ? <Button variant="outline" size="sm" className="text-amber-600" onClick={() => setUnassignId(manager.id)}><Unlink className="mr-2 h-4 w-4" />Unassign</Button> : null}
                    <Button variant="outline" size="sm" className="text-red-600" onClick={() => setDeleteId(manager.id)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="hidden md:block">
            <Table className="reports-data-table table-fixed min-w-[860px]">
              <TableHeader>
                <TableRow >
                  <TableHead className="w-[20%] py-4 px-4"><div className="flex items-center gap-2"><User className="h-4 w-4" />Manager</div></TableHead>
                  <TableHead className="w-[31%] py-4 px-4"><div className="flex items-center gap-2"><Mail className="h-4 w-4" />Contact</div></TableHead>
                  <TableHead className="w-[23%] py-4 px-4">Assigned DMA</TableHead>
                  <TableHead className="w-[18%] py-4 px-4"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Status</div></TableHead>
                  <TableHead className="w-14 min-w-14 max-w-14 py-4 px-1 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredManagers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center"><UserCog className="h-8 w-8 text-slate-400" /></div>
                        <div>
                          <p className="text-lg font-semibold text-slate-800">No managers found</p>
                          <p className="text-sm text-slate-500 mt-1">{search ? "Try adjusting your search terms" : "Get started by inviting your first DMA manager"}</p>
                        </div>
                        {!search && <Button onClick={openCreateDialog} className="mt-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/15 rounded-xl"><Plus className="h-4 w-4 mr-2" />Invite DMA Manager</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredManagers.map((manager) => {
                    const dma = dmas.find((d) => d.id === manager.dmaId)
                    return (
                      <TableRow key={manager.id} >
                        <TableCell className="py-4 px-4">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800">{manager.name}</p>
                            <p className="text-xs text-slate-500">DMA Manager</p>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex min-w-0 items-center gap-2 text-sm text-slate-600"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="min-w-0 truncate" title={manager.email}>{manager.email}</span></div>
                            {manager.phone && <div className="flex min-w-0 items-center gap-2 text-sm text-slate-500"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate" title={manager.phone}>{manager.phone}</span></div>}
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4">
                          {dma ? (
                            <span className="font-medium text-slate-700">{dma.name}</span>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100">Unassigned</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-4 px-4"><div className="flex flex-col items-start gap-2"><EntityStatusBadge status={manager.status} />{renderOnboardingBadge(manager.onboardingStatus)}</div></TableCell>
                        <TableCell className="w-14 min-w-14 max-w-14 py-4 px-1 text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-slate-100 transition-colors"><MoreHorizontal className="h-4 w-4 text-slate-500" /><span className="sr-only">Actions</span></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 rounded-xl border-slate-200/60">
                              <DropdownMenuItem onClick={() => setViewingManager(manager)} className="rounded-lg gap-2 cursor-pointer"><Eye className="h-4 w-4 text-cyan-500" />View Details</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(manager)} className="rounded-lg gap-2 cursor-pointer"><Pencil className="h-4 w-4 text-cyan-500" />Edit Manager</DropdownMenuItem>
                              {manager.onboardingStatus !== "completed" && <DropdownMenuItem onClick={() => handleResendInvite(manager.id)} className="rounded-lg gap-2 cursor-pointer"><Send className="h-4 w-4 text-cyan-500" />{resendingInviteId === manager.id ? "Sending..." : "Resend Invite"}</DropdownMenuItem>}
                              {manager.dmaId && <DropdownMenuItem onClick={() => setUnassignId(manager.id)} className="text-amber-600 focus:text-amber-600 focus:bg-amber-50 rounded-lg gap-2 cursor-pointer"><Unlink className="h-4 w-4" />Unassign from DMA</DropdownMenuItem>}
                              <DropdownMenuItem onClick={() => setDeleteId(manager.id)} className="text-red-600 focus:text-red-600 focus:bg-red-50 rounded-lg gap-2 cursor-pointer"><Trash2 className="h-4 w-4" />Delete Manager</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); else closeEditor() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="dashboard-modal-accent h-8 w-8 rounded-lg bg-primary flex items-center justify-center">{editingManager ? <Pencil className="h-4 w-4 text-white" /> : <Plus className="h-4 w-4 text-white" />}</div>
              {editingManager ? "Edit DMA Manager" : "Invite DMA Manager"}
            </DialogTitle>
            {editingManager && <DialogDescription>Currently assigned to: <span className="font-semibold">{dmas.find(d => d.id === editingManager.dmaId)?.name || editingManager?.dmaName || "Unassigned"}</span></DialogDescription>}
          </DialogHeader>
          <div className="flex flex-col gap-5 py-4 max-h-[60vh] overflow-y-auto">
            <div className="dashboard-modal-note rounded-xl border border-primary/25 bg-secondary/70 p-4">
              <div className="flex items-center gap-2 text-sm"><WaterUtilityIcon className="h-4 w-4 text-primary" /><span className="font-semibold text-primary">{selectedUtility?.name || myUtilityDisplayName}</span></div>
              <p className="text-xs text-muted-foreground mt-2">
                {isUtilityManager
                  ? "This DMA manager will be associated with your utility."
                  : "Select the utility first, then optionally assign a DMA under it."}
              </p>
            </div>
            {!isUtilityManager && (
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium text-slate-700">Utility <span className="text-red-500">*</span></Label>
                <Select
                  value={formUtilityId}
                  onValueChange={(value) => {
                    setFormUtilityId(value)
                    setFormDMAId("unassigned")
                  }}
                >
                  <SelectTrigger className="h-11  rounded-xl">
                    <SelectValue placeholder="Select a utility" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
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
              <Label htmlFor="dma-manager-email" className="text-sm font-medium text-slate-700">Email <span className="text-red-500">*</span></Label>
              <Input id="dma-manager-email" name="dma-manager-contact-email" type="email" autoComplete="new-password" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="john@example.com" className="h-11  rounded-xl focus:border-primary/50 focus:ring-primary/15" />
            </div>
            {editingManager && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="manager-name" className="text-sm font-medium text-slate-700">Manager Name <span className="text-red-500">*</span></Label>
                  <Input id="manager-name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., John Mwangi" className="h-11  rounded-xl focus:border-primary/50 focus:ring-primary/15" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="manager-phone" className="text-sm font-medium text-slate-700">Phone Number</Label>
                  <Input id="manager-phone" type="tel" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="+254 712 345 678" className="h-11  rounded-xl focus:border-primary/50 focus:ring-primary/15" />
                </div>
              </>
            )}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Assign DMA</Label>
              <Select value={formDMAId} onValueChange={setFormDMAId}>
                <SelectTrigger className="h-11  rounded-xl"><SelectValue placeholder="Select a DMA (optional)" /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="unassigned" className="rounded-lg"><span className="text-slate-500">None (Unassigned)</span></SelectItem>
                  {availableDMAs.map((dma) => (<SelectItem key={dma.id} value={dma.id} className="rounded-lg"><span>{dma.name}</span>{dma.managerId && dma.managerId === editingManager?.id && <span className="text-slate-400 ml-2">(currently assigned)</span>}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Status <span className="text-red-500">*</span></Label>
              <Select value={formStatus} onValueChange={(v) => setFormStatus(v as EntityStatus)}>
                <SelectTrigger className="h-11  rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="active" className="rounded-lg"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Active</div></SelectItem>
                  <SelectItem value="inactive" className="rounded-lg"><div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-slate-400" />Inactive</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editingManager ? (
              <div className="border-t border-slate-200 pt-4 flex flex-col gap-3">
                <Label className="flex items-center gap-2 text-sm font-medium text-slate-700"><Lock className="h-4 w-4" />Change Password (optional)</Label>
                <div className="relative">
                  <Input type={showPassword ? "text" : "password"} value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Enter new password (optional)" className="h-11  rounded-xl pr-10 focus:border-primary/50 focus:ring-primary/15" />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                </div>
                <Input type={showPassword ? "text" : "password"} value={formConfirmPassword} onChange={(e) => setFormConfirmPassword(e.target.value)} placeholder="Confirm password" className="h-11  rounded-xl focus:border-primary/50 focus:ring-primary/15" />
              </div>
            ) : (
              <div className="dashboard-modal-note rounded-xl border border-dashed border-primary/25 bg-secondary/70 p-4 text-sm text-slate-600">
                The system will send this DMA manager a secure setup link so they can finish their own profile and password.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeEditor} className="rounded-xl">Cancel</Button>
            <Button onClick={handleSubmit} className="dashboard-modal-submit bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/15 rounded-xl">
              {editingManager ? <><Save className="h-4 w-4 mr-2" />Save Changes</> : <><Plus className="h-4 w-4 mr-2" />Invite Manager</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Delete DMA Manager" description="Are you sure you want to delete this DMA Manager? This action cannot be undone." confirmLabel="Delete Manager" onConfirm={handleDelete} />
      <ConfirmDialog open={!!unassignId} onOpenChange={() => setUnassignId(null)} title="Unassign DMA" description="Are you sure you want to unassign the DMA from this manager? They will no longer manage this DMA." confirmLabel="Unassign DMA" onConfirm={handleUnassignDMA} variant="warning" />

      {/* View Details Modal */}
      <Dialog open={!!viewingManager} onOpenChange={() => setViewingManager(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="dashboard-modal-accent h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                <Eye className="h-5 w-5 text-white" />
              </div>
              DMA Manager Details
            </DialogTitle>
          </DialogHeader>
          {viewingManager && (() => {
            const utility = utilities.find(u => u.id === viewingManager.utilityId)
            const dma = dmas.find(d => d.id === viewingManager.dmaId)
            
            return (
              <div className="flex flex-col gap-6 py-4">
                {/* Manager Profile Card */}
                <Card className="dashboard-modal-panel dashboard-modal-profile">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <Avatar className="h-16 w-16 shadow-lg ring-2 ring-cyan-200">
                        <AvatarFallback className="text-xl font-bold bg-primary text-white">
                          {getInitials(viewingManager.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-slate-800">{viewingManager.name}</h3>
                        <p className="text-sm text-slate-500">DMA Manager</p>
                        <div className="flex items-center gap-4 mt-3 flex-wrap">
                          <EntityStatusBadge status={viewingManager.status} />
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Mail className="h-4 w-4" />
                            {viewingManager.email}
                          </div>
                          {viewingManager.phone && (
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <Phone className="h-4 w-4" />
                              {viewingManager.phone}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Associated Utility Card */}
                {utility && (
                  <Card className="dashboard-modal-panel">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                          <WaterUtilityIcon className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-800">{utility.name}</h4>
                          <p className="text-xs text-slate-500">Associated Utility</p>
                        </div>
                        <EntityStatusBadge status={utility.status} className="ml-auto" />
                      </div>
                      {utility.description && (
                        <p className="text-sm text-slate-600 mb-4">{utility.description}</p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Assigned DMA Card */}
                {dma && (
                  <Card className="dashboard-modal-panel">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                          <MapPin className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-800">{dma.name}</h4>
                          <p className="text-xs text-slate-500">Assigned DMA</p>
                        </div>
                        <EntityStatusBadge status={dma.status} className="ml-auto" />
                      </div>
                      {dma.description && (
                        <p className="text-sm text-slate-600 mb-4">{dma.description}</p>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <div className="dashboard-modal-subpanel p-3">
                          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                            <WaterUtilityIcon className="h-3.5 w-3.5" />
                            Utility
                          </div>
                          <p className="text-sm font-medium text-slate-800">{utility?.name || "N/A"}</p>
                        </div>
                        <div className="dashboard-modal-subpanel p-3">
                          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                            <Layers className="h-3.5 w-3.5" />
                            Teams
                          </div>
                          <p className="text-lg font-bold text-slate-800">{dma.teamsCount || 0}</p>
                        </div>
                        <div className="dashboard-modal-subpanel p-3">
                          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                            <Users className="h-3.5 w-3.5" />
                            Engineers
                          </div>
                          <p className="text-lg font-bold text-slate-800">{dma.engineersCount || 0}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* No DMA assigned message */}
                {!dma && (
                  <Card className="dashboard-modal-panel">
                    <CardContent className="p-6 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="dashboard-modal-status-icon h-12 w-12 rounded-xl flex items-center justify-center">
                          <Unlink className="h-6 w-6 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">No DMA Assigned</p>
                          <p className="text-sm text-slate-500">This manager is not currently assigned to any DMA</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

"use client"

import { useState, useEffect } from "react"
import { useDataStore } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { usePageAccess } from "@/hooks/use-page-access"
import { CONFIG } from "@/lib/config"
import { EntityStatusBadge } from "@/components/shared/status-badge"
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
  Users,
  Eye,
  EyeOff,
  Phone,
  Mail,
  MapPin,
  UserCog,
  Lock,
  CheckCircle2,
  Save,
  ArrowUpDown,
  User,
  ChevronRight,
  Layers,
  FileText,
  Activity,
  Calendar,
  Clock,
  XCircle,
  Send,
} from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { transformKeys } from "@/lib/transform-data"

interface Manager {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  status: string
  utilityId?: string
  onboardingStatus?: "completed" | "pending_setup" | "expired"
  inviteExpiresAt?: string | null
  setupCompletedAt?: string | null
}

export default function UtilityManagersPage() {
  usePageAccess()  // Check if user has access to this page

  const { currentUser } = useAuthStore()
  const { utilities, dmas, dmaManagers, engineers, reports, fetchUtilities, fetchDMAs, fetchDMAManagers, fetchEngineers, fetchReports } = useDataStore()
  const [managers, setManagers] = useState<Manager[]>([])
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingManager, setEditingManager] = useState<Manager | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [viewingManager, setViewingManager] = useState<Manager | null>(null)
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState("")
  const [formEmail, setFormEmail] = useState("")
  const [formPhone, setFormPhone] = useState("")
  const [formUtilityId, setFormUtilityId] = useState("")
  const [formStatus, setFormStatus] = useState<string>("active")
  const [formPassword, setFormPassword] = useState("")
  const [formConfirmPassword, setFormConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  // Fetch data on mount
  useEffect(() => {
    fetchManagers()
    fetchUtilities()
  }, [])

  // Refresh utilities whenever managers are fetched
  useEffect(() => {
    if (managers.length > 0) {
      fetchUtilities()
    }
  }, [managers.length])

  async function fetchManagers() {
    try {
      const response = await fetch(`${CONFIG.backend.fullUrl}/utility-managers`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
          "Content-Type": "application/json"
        }
      })
      if (response.ok) {
        const data = await response.json()
        const transformed = (data.items || []).map(transformKeys)
        setManagers(transformed)
      }
    } catch (error) {
      console.error("Error fetching managers:", error)
    }
  }

  // Only admins can access this page
  const isAdmin = currentUser?.role === "admin"
  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <Users className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="text-sm text-slate-500 mt-1">Only Admins can manage Utility Managers</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const filteredManagers = managers.filter((m) => {
    const searchLower = search.toLowerCase().trim()
    if (!searchLower) return true
    
    // Get utility name for this manager
    const utility = utilities.find((u) => u.id === m.utilityId)
    
    // Search in multiple fields
    const matchesName = m.name?.toLowerCase().includes(searchLower)
    const matchesEmail = m.email?.toLowerCase().includes(searchLower)
    const matchesPhone = m.phone?.toLowerCase().includes(searchLower)
    const matchesStatus = m.status?.toLowerCase().includes(searchLower)
    const matchesUtility = utility?.name?.toLowerCase().includes(searchLower)
    
    return matchesName || matchesEmail || matchesPhone || matchesStatus || matchesUtility
  })

  // Get utilities that are not assigned to any manager
  const availableUtilities = utilities.filter((u) => {
    if (u.status !== "active") return false
    // Check if utility is already assigned to another manager
    const assignedToManager = managers.some((m) => m.utilityId === u.id)
    if (!assignedToManager) return true
    // When editing, include the utility currently assigned to this manager
    if (editingManager && editingManager.utilityId === u.id) return true
    return false
  })

  // Function to unassign a manager from their utility
  async function handleUnassign(managerId: string) {
    try {
      const manager = managers.find(m => m.id === managerId)
      if (!manager) return

      const response = await fetch(`${CONFIG.backend.fullUrl}/utility-managers/${managerId}`, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${localStorage.getItem('access_token')}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: manager.name,
          email: manager.email,
          phone: manager.phone || null,
          status: manager.status,
          utilityId: null, // Unassign from utility
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to unassign manager")
      }

      toast.success("Manager unassigned from utility successfully")
      await fetchManagers()
      await fetchUtilities()
    } catch (error) {
      console.error("Error unassigning manager:", error)
      toast.error(error instanceof Error ? error.message : "Failed to unassign manager")
    }
  }

  function openCreateDialog() {
    setEditingManager(null)
    setFormEmail("")
    setFormUtilityId("")
    setFormStatus("active")
    setFormName("")
    setFormPhone("")
    setFormPassword("")
    setFormConfirmPassword("")
    setShowPassword(false)
    setDialogOpen(true)
  }

  function openEditDialog(manager: Manager) {
    setEditingManager(manager)
    setFormEmail(manager.email)
    setFormUtilityId(manager.utilityId ?? "")
    setFormStatus(manager.status ?? "active")
    setFormName(manager.name)
    setFormPhone(manager.phone ?? "")
    setFormPassword("")
    setFormConfirmPassword("")
    setShowPassword(false)
    setDialogOpen(true)
  }

  async function handleSubmit() {
    if (!formEmail.trim()) {
      toast.error("Email is required")
      return
    }
    if (!formUtilityId) {
      toast.error("Please select a utility")
      return
    }

    if (editingManager) {
      if (!formName.trim()) {
        toast.error("Manager name is required")
        return
      }
      if (formPassword && formPassword.length < 6) {
        toast.error("Password must be at least 6 characters")
        return
      }
      if (formPassword && formPassword !== formConfirmPassword) {
        toast.error("Passwords do not match")
        return
      }
    }

    try {
      if (editingManager) {
        const updateData: Record<string, any> = {
          name: formName,
          email: formEmail,
          phone: formPhone,
          status: formStatus,
          utility_id: formUtilityId,
        }
        if (formPassword) {
          updateData.password = formPassword
        }
        const response = await fetch(`${CONFIG.backend.fullUrl}/utility-managers/${editingManager.id}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${localStorage.getItem('access_token')}`, "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Failed to update manager")
        }
        toast.success("Manager updated successfully")
      } else {
        const response = await fetch(`${CONFIG.backend.fullUrl}/utility-managers/invitations`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${localStorage.getItem('access_token')}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: formEmail,
            status: formStatus,
            utility_id: formUtilityId,
          }),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.detail || data.error || "Failed to invite manager")
        }
        const data = await response.json()
        if (data.invite_url && navigator?.clipboard) {
          await navigator.clipboard.writeText(data.invite_url)
          toast.success("Manager invited and invite link copied")
        } else {
          toast.success("Manager invitation created successfully")
        }
        if (data.delivery_message) {
          toast.message(data.delivery_message)
        }
      }
      setDialogOpen(false)
      fetchManagers()
      fetchUtilities()
    } catch (error) {
      console.error("Error saving manager:", error)
      toast.error(error instanceof Error ? error.message : "Failed to save manager")
    }
  }

  async function handleResendInvite(managerId: string) {
    try {
      setResendingInviteId(managerId)
      const response = await fetch(`${CONFIG.backend.fullUrl}/utility-managers/${managerId}/resend-invite`, {
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
      fetchManagers()
    } catch (error) {
      console.error("Error resending invite:", error)
      toast.error(error instanceof Error ? error.message : "Failed to resend invite")
    } finally {
      setResendingInviteId(null)
    }
  }

  async function handleDelete() {
    if (deleteId) {
      try {
        const response = await fetch(`${CONFIG.backend.fullUrl}/utility-managers/${deleteId}`, {
          method: "DELETE",
        })
        const data = await response.json()
        if (!response.ok) {
          toast.error(data.error || "Failed to delete manager")
          return
        }
        toast.success("Manager deleted successfully")
        setDeleteId(null)
        fetchManagers()
        fetchUtilities()
      } catch (error) {
        console.error("Error deleting manager:", error)
        toast.error("Failed to delete manager")
      }
    }
  }

  // Stats
  const totalManagers = managers.length
  const activeManagers = managers.filter(m => m.status === "active").length
  const assignedManagers = managers.filter(m => m.utilityId).length

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const renderOnboardingBadge = (status?: Manager["onboardingStatus"]) => {
    if (status === "expired") return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">Expired Invite</Badge>
    if (status === "pending_setup") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pending Setup</Badge>
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Ready</Badge>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Modern Header with Stats */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <Users className="h-7 w-7 text-cyan-600" />
              Utility Managers
            </h1>
            <p className="text-slate-500 mt-1">Create and manage Utility Managers and assign them to utilities</p>
          </div>
          <Button 
            onClick={openCreateDialog}
            className="bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all duration-300 rounded-xl h-11 px-6"
          >
            <Plus className="h-4 w-4 mr-2" />
            Invite Manager
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden group hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 bg-gradient-to-br from-cyan-50/30 to-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <Users className="h-8 w-8 shrink-0 text-cyan-600" />
                <div>
                  <p className="text-sm font-medium text-slate-500">Total Managers</p>
                  <p className="text-2xl font-bold text-slate-800">{totalManagers}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden group hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300 bg-gradient-to-br from-emerald-50/30 to-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-slate-500">Active Managers</p>
                  <p className="text-2xl font-bold text-slate-800">{activeManagers}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden group hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 bg-gradient-to-br from-cyan-50/30 to-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <WaterUtilityIcon className="h-8 w-8 shrink-0 text-cyan-600" />
                <div>
                  <p className="text-sm font-medium text-slate-500">Assigned to Utilities</p>
                  <p className="text-2xl font-bold text-slate-800">{assignedManagers}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modern Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-80">
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-400/10 to-sky-500/10 blur-lg opacity-0 focus-within:opacity-100 transition-opacity duration-300 pointer-events-none" />
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search by name, email, phone, utility..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-11 h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <UserCog className="h-4 w-4" />
          <span>{filteredManagers.length} manager{filteredManagers.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Modern Table */}
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden">
        <CardContent className="p-0">
          <div className="space-y-3 p-4 md:hidden">
            {filteredManagers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center">
                <p className="text-lg font-semibold text-slate-800">No managers found</p>
                <p className="mt-1 text-sm text-slate-500">
                  {search ? "Try adjusting your search terms" : "Get started by inviting your first utility manager"}
                </p>
                {!search ? (
                  <Button
                    onClick={openCreateDialog}
                    className="mt-4 bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white shadow-lg shadow-cyan-500/25 rounded-xl"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Invite Manager
                  </Button>
                ) : null}
              </div>
            ) : filteredManagers.map((manager) => {
              const utility = utilities.find((u) => u.id === manager.utilityId)
              const isInactive = manager.status === "inactive"
              return (
                <div
                  key={manager.id}
                  className={cn(
                    "rounded-2xl border p-4 shadow-sm",
                    isInactive ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-white"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar className={cn("h-10 w-10 shadow-lg", isInactive ? "ring-2 ring-red-200" : "ring-2 ring-cyan-200")}>
                      <AvatarFallback className={cn(
                        "text-sm font-semibold",
                        isInactive ? "bg-gradient-to-br from-red-400 to-rose-500 text-white" : "bg-gradient-to-br from-sky-500 to-cyan-600 text-white"
                      )}>
                        {getInitials(manager.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">{manager.name}</p>
                      <p className="text-xs text-slate-500">Utility Manager</p>
                      <p className="mt-2 break-all text-sm text-slate-600">{manager.email}</p>
                      {manager.phone ? <p className="mt-1 text-sm text-slate-500">{manager.phone}</p> : null}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Assigned Utility</p>
                      <p className="mt-1 font-medium text-slate-700">{utility?.name || "Unassigned"}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <EntityStatusBadge status={(manager.status as EntityStatus) ?? "active"} />
                    {renderOnboardingBadge(manager.onboardingStatus)}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setViewingManager(manager)}><Eye className="mr-2 h-4 w-4" />Details</Button>
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(manager)}><Pencil className="mr-2 h-4 w-4" />Edit</Button>
                    {manager.onboardingStatus !== "completed" ? <Button variant="outline" size="sm" onClick={() => handleResendInvite(manager.id)}><Send className="mr-2 h-4 w-4" />Resend</Button> : null}
                    {manager.utilityId ? <Button variant="outline" size="sm" className="text-amber-600" onClick={() => handleUnassign(manager.id)}><MapPin className="mr-2 h-4 w-4" />Unassign</Button> : null}
                    <Button variant="outline" size="sm" className="text-red-600" onClick={() => setDeleteId(manager.id)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="hidden md:block">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-slate-50 to-slate-100/80 hover:from-slate-50 hover:to-slate-100/80 border-b border-slate-200/60">
                  <TableHead className="font-semibold text-slate-600 py-4 px-6">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Manager
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600 py-4 px-6">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Contact
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600 py-4 px-6">
                    <div className="flex items-center gap-2">
                      <WaterUtilityIcon className="h-4 w-4" />
                      Assigned Utility
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600 py-4 px-6">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Status
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600 py-4 px-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredManagers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                          <Users className="h-8 w-8 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-slate-800">No managers found</p>
                          <p className="text-sm text-slate-500 mt-1">
                            {search ? "Try adjusting your search terms" : "Get started by inviting your first utility manager"}
                          </p>
                        </div>
                        {!search && (
                          <Button 
                            onClick={openCreateDialog}
                            className="mt-2 bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white shadow-lg shadow-cyan-500/25 rounded-xl"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Invite Manager
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredManagers.map((manager, index) => {
                    const utility = utilities.find((u) => u.id === manager.utilityId)
                    const isInactive = manager.status === "inactive"
                    
                    return (
                      <TableRow 
                        key={manager.id} 
                        className={cn(
                          "border-b border-slate-100 transition-all duration-200",
                          isInactive 
                            ? "bg-red-50/30 hover:bg-red-50/50" 
                            : "hover:bg-cyan-50/50"
                        )}
                      >
                        {/* Manager Info with Avatar */}
                        <TableCell className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <Avatar className={cn(
                              "h-10 w-10 shadow-lg transition-all duration-300",
                              isInactive 
                                ? "ring-2 ring-red-200" 
                                : "ring-2 ring-cyan-200"
                            )}>
                              <AvatarFallback className={cn(
                                "text-sm font-semibold",
                                isInactive
                                  ? "bg-gradient-to-br from-red-400 to-rose-500 text-white"
                                  : "bg-gradient-to-br from-sky-500 to-cyan-600 text-white"
                              )}>
                                {getInitials(manager.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold text-slate-800">{manager.name}</p>
                              <p className="text-xs text-slate-500">Utility Manager</p>
                            </div>
                          </div>
                        </TableCell>

                        {/* Contact Info */}
                        <TableCell className="py-4 px-6">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <Mail className="h-3.5 w-3.5 text-slate-400" />
                              <span className="break-all">{manager.email}</span>
                            </div>
                            {manager.phone && (
                              <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Phone className="h-3.5 w-3.5 text-slate-400" />
                                <span>{manager.phone}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Assigned Utility */}
                        <TableCell className="py-4 px-6">
                          {utility ? (
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-100 to-cyan-200 flex items-center justify-center">
                                <WaterUtilityIcon className="h-4 w-4 text-cyan-600" />
                              </div>
                              <span className="font-medium text-slate-700">{utility.name}</span>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100">
                              <MapPin className="h-3 w-3 mr-1" />
                              Unassigned
                            </Badge>
                          )}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="py-4 px-6">
                          <div className="flex flex-col items-start gap-2">
                            <EntityStatusBadge status={(manager.status as EntityStatus) ?? "active"} />
                            {renderOnboardingBadge(manager.onboardingStatus)}
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="py-4 px-6 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-9 w-9 rounded-lg hover:bg-slate-100 transition-colors"
                              >
                                <MoreHorizontal className="h-4 w-4 text-slate-500" />
                                <span className="sr-only">Actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent 
                              align="end" 
                              className="w-48 rounded-xl shadow-lg shadow-slate-200/50 border-slate-200/60"
                            >
                              <DropdownMenuItem 
                                onClick={() => setViewingManager(manager)} 
                                className="rounded-lg gap-2 cursor-pointer"
                              >
                                <Eye className="h-4 w-4 text-cyan-500" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => openEditDialog(manager)} 
                                className="rounded-lg gap-2 cursor-pointer"
                              >
                                <Pencil className="h-4 w-4 text-cyan-500" />
                                Edit Manager
                              </DropdownMenuItem>
                              {manager.onboardingStatus !== "completed" && (
                                <DropdownMenuItem
                                  onClick={() => handleResendInvite(manager.id)}
                                  className="rounded-lg gap-2 cursor-pointer"
                                >
                                  <Send className="h-4 w-4 text-cyan-500" />
                                  {resendingInviteId === manager.id ? "Sending..." : "Resend Invite"}
                                </DropdownMenuItem>
                              )}
                              {manager.utilityId && (
                                <DropdownMenuItem
                                  onClick={() => handleUnassign(manager.id)}
                                  className="text-amber-600 focus:text-amber-600 focus:bg-amber-50 rounded-lg gap-2 cursor-pointer"
                                >
                                  <MapPin className="h-4 w-4" />
                                  Unassign from Utility
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => setDeleteId(manager.id)}
                                className="text-red-600 focus:text-red-600 focus:bg-red-50 rounded-lg gap-2 cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete Manager
                              </DropdownMenuItem>
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

      {/* Modern Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col bg-white/95 backdrop-blur-xl border-slate-200/50 shadow-2xl shadow-slate-200/50 rounded-2xl">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center">
                {editingManager ? (
                  <Pencil className="h-4 w-4 text-white" />
                ) : (
                  <Plus className="h-4 w-4 text-white" />
                )}
              </div>
              {editingManager ? "Edit Utility Manager" : "Invite Utility Manager"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="flex flex-col gap-2">
              <Label htmlFor="manager-email" className="text-sm font-medium text-slate-700">Email</Label>
              <Input
                id="manager-email"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="e.g., john@example.com"
                className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
              />
            </div>
            {editingManager && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="manager-name" className="text-sm font-medium text-slate-700">Full Name</Label>
                  <Input
                    id="manager-name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., John Smith"
                    className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="manager-phone" className="text-sm font-medium text-slate-700">Phone</Label>
                  <Input
                    id="manager-phone"
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="e.g., +255 22 211 0001"
                    className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Assigned Utility</Label>
              <Select value={formUtilityId} onValueChange={setFormUtilityId}>
                <SelectTrigger className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl">
                  <SelectValue placeholder={availableUtilities.length === 0 ? "No unassigned utilities available" : "Select a utility"} />
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
                  {availableUtilities.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No unassigned utilities
                    </SelectItem>
                  ) : (
                    availableUtilities.map((u) => (
                      <SelectItem key={u.id} value={u.id} className="rounded-lg">
                        {u.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {availableUtilities.length === 0 && !editingManager && (
                <p className="text-xs text-muted-foreground">
                  All active utilities have managers assigned. Create a new utility or unassign an existing manager first.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Status</Label>
              <Select value={formStatus} onValueChange={setFormStatus}>
                <SelectTrigger className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
                  <SelectItem value="active" className="rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      Active
                    </div>
                  </SelectItem>
                  <SelectItem value="inactive" className="rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full bg-slate-400" />
                      Inactive
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {editingManager ? (
              <div className="border-t border-slate-200 pt-4">
                <Label className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
                  <Lock className="h-4 w-4" />
                  Change Password (leave blank to keep current)
                </Label>
                <div className="flex flex-col gap-3">
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Enter new password (optional)"
                      className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20 pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formConfirmPassword}
                    onChange={(e) => setFormConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-cyan-200 bg-cyan-50/60 p-4 text-sm text-slate-600">
                The system will send this manager a secure setup link so they can finish their own profile and password.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              className="bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white shadow-lg shadow-cyan-500/25 rounded-xl"
            >
              {editingManager ? (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Invite Manager
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Utility Manager"
        description="Are you sure you want to delete this Utility Manager? This action cannot be undone."
        confirmLabel="Delete Manager"
        onConfirm={handleDelete}
      />

      {/* View Details Modal */}
      <Dialog open={!!viewingManager} onOpenChange={() => setViewingManager(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto bg-white/95 backdrop-blur-xl border-slate-200/50 shadow-2xl shadow-slate-200/50 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center">
                <Eye className="h-5 w-5 text-white" />
              </div>
              Manager Details
            </DialogTitle>
          </DialogHeader>
          {viewingManager && (
            <div className="flex flex-col gap-6 py-4">
              {/* Manager Profile Card */}
              <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 bg-gradient-to-r from-cyan-50/50 to-sky-50/50">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-16 w-16 shadow-lg ring-2 ring-cyan-200">
                      <AvatarFallback className="text-xl font-bold bg-gradient-to-br from-sky-500 to-cyan-600 text-white">
                        {getInitials(viewingManager.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-slate-800">{viewingManager.name}</h3>
                      <p className="text-sm text-slate-500">Utility Manager</p>
                      <div className="flex items-center gap-4 mt-3">
                        <EntityStatusBadge status={(viewingManager.status as EntityStatus) ?? "active"} />
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

              {/* Assigned Utility Section */}
              {viewingManager.utilityId && (() => {
                const utility = utilities.find(u => u.id === viewingManager.utilityId)
                if (!utility) return null
                const utilityDMAs = dmas.filter(d => d.utilityId === utility.id)
                const utilityManagers = dmaManagers.filter(m => m.utilityId === utility.id)
                const utilityEngineers = engineers.filter(e => utilityDMAs.some(d => d.id === e.dmaId))
                const utilityReports = reports.filter(r => r.utilityId === utility.id)

                return (
                  <div className="flex flex-col gap-4">
                    {/* Utility Card */}
                    <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
                      <CardContent className="p-5">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center">
                            <WaterUtilityIcon className="h-5 w-5 text-white" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-slate-800">{utility.name}</h4>
                            <p className="text-xs text-slate-500">Assigned Utility</p>
                          </div>
                          <EntityStatusBadge status={utility.status} className="ml-auto" />
                        </div>
                        {utility.description && (
                          <p className="text-sm text-slate-600 mb-4">{utility.description}</p>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                              <Layers className="h-3.5 w-3.5" />
                              DMAs
                            </div>
                            <p className="text-lg font-bold text-slate-800">{utilityDMAs.length}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                              <UserCog className="h-3.5 w-3.5" />
                              DMA Managers
                            </div>
                            <p className="text-lg font-bold text-slate-800">{utilityManagers.length}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                              <Users className="h-3.5 w-3.5" />
                              Engineers
                            </div>
                            <p className="text-lg font-bold text-slate-800">{utilityEngineers.length}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                              <FileText className="h-3.5 w-3.5" />
                              Reports
                            </div>
                            <p className="text-lg font-bold text-slate-800">{utilityReports.length}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* DMAs under this utility */}
                    {utilityDMAs.length > 0 && (
                      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
                        <CardContent className="p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <Layers className="h-5 w-5 text-cyan-500" />
                            <h4 className="font-semibold text-slate-800">DMAs under {utility.name}</h4>
                          </div>
                          <div className="flex flex-col gap-2">
                            {utilityDMAs.map(dma => {
                              const dmaManager = dmaManagers.find(m => m.dmaId === dma.id)
                              const dmaEngineers = engineers.filter(e => e.dmaId === dma.id)
                              const dmaReports = reports.filter(r => r.dmaId === dma.id)
                              return (
                                <div key={dma.id} className="rounded-xl border border-slate-200/80 bg-gradient-to-r from-slate-50/50 to-white p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <MapPin className="h-4 w-4 text-cyan-500" />
                                      <span className="font-medium text-slate-700">{dma.name}</span>
                                    </div>
                                    <EntityStatusBadge status={dma.status} />
                                  </div>
                                  <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                                    <div className="flex items-center gap-1">
                                      <UserCog className="h-3 w-3" />
                                      Manager: {dmaManager ? dmaManager.name : "Unassigned"}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Users className="h-3 w-3" />
                                      Engineers: {dmaEngineers.length}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <FileText className="h-3 w-3" />
                                      Reports: {dmaReports.length}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

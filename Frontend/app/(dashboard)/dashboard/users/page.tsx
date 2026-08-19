"use client"

import { useState, useEffect } from "react"
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
  CheckCircle2,
  Save,
  User,
  Lock,
  UserPlus,
  Send,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { transformKeys } from "@/lib/transform-data"

interface AppUser {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  avatar?: string | null
  onboardingStatus?: "completed" | "pending_setup" | "expired"
  inviteExpiresAt?: string | null
  setupCompletedAt?: string | null
}

export default function UsersPage() {
  usePageAccess()  // Check if user has access to this page

  const { currentUser } = useAuthStore()
  const [users, setUsers] = useState<AppUser[]>([])
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AppUser | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [viewingUser, setViewingUser] = useState<AppUser | null>(null)
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState("")
  const [formEmail, setFormEmail] = useState("")
  const [formPhone, setFormPhone] = useState("")
  const [formStatus, setFormStatus] = useState<string>("active")
  const [formPassword, setFormPassword] = useState("")
  const [formConfirmPassword, setFormConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Fetch data on mount
  useEffect(() => {
    fetchUsers()
  }, [])

  async function fetchUsers() {
    try {
      const response = await fetch(`${CONFIG.backend.fullUrl}/api/users`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
          "Content-Type": "application/json"
        }
      })
      if (response.ok) {
        const data = await response.json()
        const transformed = (data.items || []).map(transformKeys)
        setUsers(transformed)
      }
    } catch (error) {
      console.error("Error fetching users:", error)
      toast.error("Failed to fetch users")
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
                <p className="text-sm text-slate-500 mt-1">Only Admins can manage Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const filteredUsers = users.filter((u) => {
    const searchLower = search.toLowerCase().trim()
    if (!searchLower) return true
    
    // Search in multiple fields
    const matchesName = u.name?.toLowerCase().includes(searchLower)
    const matchesEmail = u.email?.toLowerCase().includes(searchLower)
    const matchesPhone = u.phone?.toLowerCase().includes(searchLower)
    const matchesStatus = u.status?.toLowerCase().includes(searchLower)
    
    return matchesName || matchesEmail || matchesPhone || matchesStatus
  })

  function openCreateDialog() {
    setEditingUser(null)
    setFormName("")
    setFormEmail("")
    setFormPhone("")
    setFormStatus("active")
    setFormPassword("")
    setFormConfirmPassword("")
    setShowPassword(false)
    setDialogOpen(true)
  }

  function openEditDialog(user: AppUser) {
    setEditingUser(user)
    setFormName(user.name)
    setFormEmail(user.email)
    setFormPhone(user.phone ?? "")
    setFormStatus(user.status ?? "active")
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(formEmail)) {
      toast.error("Please enter a valid email address")
      return
    }

    if (editingUser) {
      if (!formName.trim()) {
        toast.error("User name is required")
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

    setIsLoading(true)

    try {
      if (editingUser) {
        const updateData: Record<string, any> = {
          name: formName,
          email: formEmail,
          phone: formPhone || null,
          status: formStatus,
        }
        if (formPassword) {
          updateData.password = formPassword
        }
        const response = await fetch(`${CONFIG.backend.fullUrl}/api/users/${editingUser.id}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(updateData),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.detail || data.error || "Failed to update user")
        }
        toast.success("User updated successfully")
      } else {
        const response = await fetch(`${CONFIG.backend.fullUrl}/api/users/invitations`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: formEmail,
            status: formStatus,
          }),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.detail || data.error || "Failed to invite user")
        }
        const data = await response.json()
        if (data.invite_url && navigator?.clipboard) {
          await navigator.clipboard.writeText(data.invite_url)
          toast.success("User invited and invite link copied")
        } else {
          toast.success("User invitation created successfully")
        }
        if (data.delivery_message) {
          toast.message(data.delivery_message)
        }
      }
      setDialogOpen(false)
      fetchUsers()
    } catch (error) {
      console.error("Error saving user:", error)
      toast.error(error instanceof Error ? error.message : "Failed to save user")
    } finally {
      setIsLoading(false)
    }
  }

  async function handleResendInvite(userId: string) {
    try {
      setResendingInviteId(userId)
      const response = await fetch(`${CONFIG.backend.fullUrl}/api/users/${userId}/resend-invite`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
          "Content-Type": "application/json"
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
      fetchUsers()
    } catch (error) {
      console.error("Error resending invite:", error)
      toast.error(error instanceof Error ? error.message : "Failed to resend invite")
    } finally {
      setResendingInviteId(null)
    }
  }

  async function handleDelete() {
    if (deleteId) {
      setIsLoading(true)
      try {
        const response = await fetch(`${CONFIG.backend.fullUrl}/api/users/${deleteId}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
            "Content-Type": "application/json"
          },
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.detail || data.error || "Failed to delete user")
        }
        toast.success("User deleted successfully")
        setDeleteId(null)
        fetchUsers()
      } catch (error) {
        console.error("Error deleting user:", error)
        toast.error(error instanceof Error ? error.message : "Failed to delete user")
      } finally {
        setIsLoading(false)
      }
    }
  }

  // Stats
  const totalUsers = users.length
  const activeUsers = users.filter(u => u.status === "active").length
  const inactiveUsers = users.filter(u => u.status === "inactive").length

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const renderOnboardingBadge = (status?: AppUser["onboardingStatus"]) => {
    if (status === "expired") return <div className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">Expired Invite</div>
    if (status === "pending_setup") return <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Pending Setup</div>
    return <div className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Ready</div>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Modern Header with Stats */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <Users className="h-7 w-7 text-cyan-600" />
              Users
            </h1>
            <p className="text-slate-500 mt-1">Invite and manage public reporting user accounts</p>
          </div>
          <Button 
            onClick={openCreateDialog}
            className="bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all duration-300 rounded-xl h-11 px-6"
          >
            <Plus className="h-4 w-4 mr-2" />
            Invite User
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden group hover:shadow-xl hover:shadow-cyan-500/10 transition-all duration-300 bg-gradient-to-br from-cyan-50/30 to-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <Users className="h-8 w-8 shrink-0 text-cyan-600" />
                <div>
                  <p className="text-sm font-medium text-slate-500">Total Users</p>
                  <p className="text-2xl font-bold text-slate-800">{totalUsers}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden group hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300 bg-gradient-to-br from-emerald-50/30 to-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-slate-500">Active Users</p>
                  <p className="text-2xl font-bold text-slate-800">{activeUsers}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden group hover:shadow-xl hover:shadow-red-500/10 transition-all duration-300 bg-gradient-to-br from-red-50/30 to-white">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <UserPlus className="h-8 w-8 shrink-0 text-rose-600" />
                <div>
                  <p className="text-sm font-medium text-slate-500">Inactive Users</p>
                  <p className="text-2xl font-bold text-slate-800">{inactiveUsers}</p>
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
            placeholder="Search by name, email, phone, status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-11 h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <UserPlus className="h-4 w-4" />
          <span>{filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Modern Table */}
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-slate-50 to-slate-100/80 hover:from-slate-50 hover:to-slate-100/80 border-b border-slate-200/60">
                  <TableHead className="font-semibold text-slate-600 py-4 px-6">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      User
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
                      <CheckCircle2 className="h-4 w-4" />
                      Status
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600 py-4 px-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                          <Users className="h-8 w-8 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-lg font-semibold text-slate-800">No users found</p>
                          <p className="text-sm text-slate-500 mt-1">
                            {search ? "Try adjusting your search terms" : "Get started by inviting your first user"}
                          </p>
                        </div>
                        {!search && (
                          <Button 
                            onClick={openCreateDialog}
                            className="mt-2 bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white shadow-lg shadow-cyan-500/25 rounded-xl"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Invite User
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => {
                    const isInactive = user.status === "inactive"
                    
                    return (
                      <TableRow 
                        key={user.id} 
                        className={cn(
                          "border-b border-slate-100 transition-all duration-200",
                          isInactive 
                            ? "bg-red-50/30 hover:bg-red-50/50" 
                            : "hover:bg-cyan-50/50"
                        )}
                      >
                        {/* User Info with Avatar */}
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
                                {getInitials(user.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold text-slate-800">{user.name}</p>
                              <p className="text-xs text-slate-500">Regular User</p>
                            </div>
                          </div>
                        </TableCell>

                        {/* Contact Info */}
                        <TableCell className="py-4 px-6">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                              <Mail className="h-3.5 w-3.5 text-slate-400" />
                              <span className="truncate max-w-[200px]">{user.email}</span>
                            </div>
                            {user.phone && (
                              <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Phone className="h-3.5 w-3.5 text-slate-400" />
                                <span>{user.phone}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell className="py-4 px-6">
                          <div className="flex flex-col items-start gap-2">
                            <EntityStatusBadge status={(user.status as EntityStatus) ?? "active"} />
                            {renderOnboardingBadge(user.onboardingStatus)}
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
                                onClick={() => setViewingUser(user)} 
                                className="rounded-lg gap-2 cursor-pointer"
                              >
                                <Eye className="h-4 w-4 text-cyan-500" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => openEditDialog(user)} 
                                className="rounded-lg gap-2 cursor-pointer"
                              >
                                <Pencil className="h-4 w-4 text-cyan-500" />
                                Edit User
                              </DropdownMenuItem>
                              {user.onboardingStatus !== "completed" && (
                                <DropdownMenuItem
                                  onClick={() => handleResendInvite(user.id)}
                                  className="rounded-lg gap-2 cursor-pointer"
                                >
                                  <Send className="h-4 w-4 text-cyan-500" />
                                  {resendingInviteId === user.id ? "Sending..." : "Resend Invite"}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => setDeleteId(user.id)}
                                className="text-red-600 focus:text-red-600 focus:bg-red-50 rounded-lg gap-2 cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete User
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
                {editingUser ? (
                  <Pencil className="h-4 w-4 text-white" />
                ) : (
                  <Plus className="h-4 w-4 text-white" />
                )}
              </div>
              {editingUser ? "Edit User" : "Invite User"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="flex flex-col gap-2">
              <Label htmlFor="user-email" className="text-sm font-medium text-slate-700">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="e.g., john@example.com"
                className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
                disabled={isLoading}
              />
            </div>
            {editingUser && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="user-name" className="text-sm font-medium text-slate-700">Full Name</Label>
                  <Input
                    id="user-name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., John Smith"
                    className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
                    disabled={isLoading}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="user-phone" className="text-sm font-medium text-slate-700">Phone (Optional)</Label>
                  <Input
                    id="user-phone"
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="e.g., +255 22 211 0001"
                    className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
                    disabled={isLoading}
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Status</Label>
              <Select value={formStatus} onValueChange={setFormStatus} disabled={isLoading}>
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
            
            {editingUser ? (
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
                      disabled={isLoading}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formConfirmPassword}
                    onChange={(e) => setFormConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20"
                    disabled={isLoading}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-cyan-200 bg-cyan-50/60 p-4 text-sm text-slate-600">
                The system will send this user a secure setup link so they can finish their own profile and password.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl" disabled={isLoading}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={isLoading}
              className="bg-gradient-to-r from-sky-500 to-cyan-600 hover:from-sky-600 hover:to-cyan-700 text-white shadow-lg shadow-cyan-500/25 rounded-xl"
            >
              {editingUser ? (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Invite User
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
        title="Delete User"
        description="Are you sure you want to delete this user? This action cannot be undone."
        confirmLabel="Delete User"
        onConfirm={handleDelete}
        isLoading={isLoading}
      />

      {/* View Details Modal */}
      <Dialog open={!!viewingUser} onOpenChange={() => setViewingUser(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto bg-white/95 backdrop-blur-xl border-slate-200/50 shadow-2xl shadow-slate-200/50 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center">
                <Eye className="h-5 w-5 text-white" />
              </div>
              User Details
            </DialogTitle>
          </DialogHeader>
          {viewingUser && (
            <div className="flex flex-col gap-6 py-4">
              {/* User Profile Card */}
              <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 bg-gradient-to-r from-cyan-50/50 to-sky-50/50">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-16 w-16 shadow-lg ring-2 ring-cyan-200">
                      <AvatarFallback className="text-xl font-bold bg-gradient-to-br from-sky-500 to-cyan-600 text-white">
                        {getInitials(viewingUser.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-slate-800">{viewingUser.name}</h3>
                      <p className="text-sm text-slate-500">Regular User</p>
                      <div className="flex items-center gap-4 mt-3 flex-wrap">
                        <EntityStatusBadge status={(viewingUser.status as EntityStatus) ?? "active"} />
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Mail className="h-4 w-4" />
                          {viewingUser.email}
                        </div>
                        {viewingUser.phone && (
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Phone className="h-4 w-4" />
                            {viewingUser.phone}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Additional Info */}
              <div className="flex flex-col gap-3">
                <div className="px-4 py-3 bg-slate-50 rounded-lg border border-slate-200/60">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Account Type</p>
                  <p className="text-sm text-slate-800">Public Report User</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

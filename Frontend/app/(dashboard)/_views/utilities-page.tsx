"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useDataStore, type Utility } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { usePageAccess } from "@/hooks/use-page-access"
import { CONFIG } from "@/lib/config"
import { PageHeader } from "@/components/shared/page-header"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { 
  ChevronDown,
  Eye,
  MoreHorizontal, 
  Pencil, 
  Power,
  PowerOff,
  Trash2, 
  Search, 
  MapPin,
  Users,
  FileText,
  CheckCircle2,
  Phone,
  Mail,
} from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { InfrastructureUploadIcon } from "@/components/icons/infrastructure-upload-icon"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export default function UtilitiesPage() {
  usePageAccess() // Check if user has access to this page

  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { utilities, dmas, fetchUtilities, fetchDMAs, updateUtility } = useDataStore()
  const [search, setSearch] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [regionFilter, setRegionFilter] = useState("")
  const [managerFilter, setManagerFilter] = useState("")
  const [emptyFilters, setEmptyFilters] = useState<Set<string>>(new Set())

  const isAdmin = currentUser?.role === "admin"
  const isUtilityManager = currentUser?.role === "utility_manager"

  // Fetch data on mount
  useEffect(() => {
    fetchUtilities()
    fetchDMAs()
  }, [fetchUtilities, fetchDMAs])

  // Only Admins and Utility Managers can access utilities
  if (!isAdmin && !isUtilityManager) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Utility Management"
          description="Only Admins and Utility Managers can manage utilities"
        />
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <WaterUtilityIcon className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="text-sm text-slate-500 mt-1">Only Admins and Utility Managers can manage utilities</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const scopedUtilities = isUtilityManager
    ? utilities.filter((u) => u.id === currentUser?.utilityId)
    : utilities

  const regionOptions = Array.from(new Set(scopedUtilities.map((u) => u.regionName).filter((r): r is string => !!r))).sort()
  const managerOptions = Array.from(new Set(scopedUtilities.map((u) => u.managerName).filter((m): m is string => !!m))).sort()

  const filteredUtilities = scopedUtilities.filter((u) => {
    const searchLower = search.toLowerCase().trim()
    
    // Status filter
    if (statusFilter !== "all" && u.status !== statusFilter) return false
    
    // Region / manager filters
    if (regionFilter && u.regionName !== regionFilter) return false
    if (managerFilter && u.managerName !== managerFilter) return false
    
    // Empty-data filters
    if (emptyFilters.has("dmas") && (u.dmasCount ?? 0) > 0) return false
    if (emptyFilters.has("reports") && (u.reportsCount ?? 0) > 0) return false
    
    // Search matches multiple fields (ignored when empty)
    if (searchLower) {
      const matchesName = u.name?.toLowerCase().includes(searchLower)
      const matchesManager = u.managerName?.toLowerCase().includes(searchLower)
      const matchesDescription = u.description?.toLowerCase().includes(searchLower)
      const matchesStatus = u.status?.toLowerCase().includes(searchLower)
      const matchesDmasCount = u.dmasCount?.toString().includes(searchLower)
      
      if (!(matchesName || matchesManager || matchesDescription || matchesStatus || matchesDmasCount)) return false
    }
    
    return true
  })

  const hasActiveFilters = statusFilter !== "all" || !!regionFilter || !!managerFilter || emptyFilters.size > 0 || !!search.trim()

  function resetFilters() {
    setSearch("")
    setStatusFilter("all")
    setRegionFilter("")
    setManagerFilter("")
    setEmptyFilters(new Set())
  }

  function toggleEmptyFilter(key: string) {
    setEmptyFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openCreateDialog() {
    if (!isAdmin) return
    router.push("/dashboard/utilities/new")
  }

  function openEditDialog(utility: Utility) {
    router.push(`/dashboard/utilities/${utility.slug || utility.id}/edit`)
  }

  function openViewDialog(utility: Utility) {
    router.push(`/dashboard/utilities/${utility.slug || utility.id}`)
  }

  async function handleToggleStatus(utility: Utility) {
    const nextStatus = utility.status === "active" ? "inactive" : "active"
    try {
      await updateUtility(utility.id, { status: nextStatus })
      toast.success(
        nextStatus === "active"
          ? "Utility activated"
          : "Utility deactivated"
      )
      await fetchUtilities()
    } catch (error) {
      console.error("Error toggling utility status:", error)
      toast.error("Failed to update utility status")
    }
  }

  async function handleDelete() {
    if (deleteId) {
      try {
        const response = await fetch(`${CONFIG.backend.fullUrl}/utilities/${deleteId}`, {
          method: "DELETE",
        })
        const data = await response.json()
        
        if (!response.ok) {
          if (data.message) {
            toast.error(data.message, { duration: 5000 })
          } else {
            toast.error(data.error || "Failed to delete utility")
          }
          return
        }
        
        toast.success("Utility deleted successfully")
        setDeleteId(null)
        await fetchUtilities()
      } catch (error) {
        console.error("Error deleting utility:", error)
        toast.error("Failed to delete utility")
      }
    }
  }

  // Stats
  const totalUtilities = scopedUtilities?.length || 0
  const activeUtilities = scopedUtilities?.filter(u => u.status === "active").length || 0
  const totalDmas = isUtilityManager
    ? dmas.filter((dma) => dma.utilityId === currentUser?.utilityId).length
    : dmas?.length || 0

  return (
    <div className="flex flex-col gap-6">
      {/* Modern Header with Stats */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <WaterUtilityIcon className="h-7 w-7 text-sky-600" />
              Utility Management
            </h1>
            <p className="text-slate-500 mt-1">
              {isAdmin ? "Manage all utilities in the water infrastructure system" : "Manage your utility profile and upload its pipe network"}
            </p>
          </div>
          {isAdmin ? (
            <Button 
              onClick={openCreateDialog}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all duration-300 rounded-xl h-11 px-6"
            >
              Add Utility
            </Button>
          ) : null}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:shadow-slate-200/60">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
                  <WaterUtilityIcon className="h-5 w-5 text-cyan-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Total Utilities</p>
                  <p className="text-2xl font-bold text-slate-800">{totalUtilities}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:shadow-slate-200/60">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Active Utilities</p>
                  <p className="text-2xl font-bold text-slate-800">{activeUtilities}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:shadow-slate-200/60">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <MapPin className="h-5 w-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Total DMAs</p>
                  <p className="text-2xl font-bold text-slate-800">{totalDmas}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modern Search + Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="relative w-full lg:w-80">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-400/10 to-blue-500/10 blur-lg opacity-0 focus-within:opacity-100 transition-opacity duration-300 pointer-events-none" />
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search by name, manager, status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 h-11 bg-slate-50/80 border-slate-200/80 rounded-xl focus:border-cyan-400 focus:ring-cyan-400/20 shadow-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status segmented toggle */}
            <div className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "h-9 rounded-[10px] px-3 text-xs font-medium transition-colors",
                  statusFilter === "all"
                    ? "bg-cyan-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("active")}
                className={cn(
                  "h-9 rounded-[10px] px-3 text-xs font-medium transition-colors",
                  statusFilter === "active"
                    ? "bg-cyan-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("inactive")}
                className={cn(
                  "h-9 rounded-[10px] px-3 text-xs font-medium transition-colors",
                  statusFilter === "inactive"
                    ? "bg-cyan-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                Inactive
              </button>
            </div>

            {/* Region dropdown */}
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className={cn(
                "h-10 rounded-xl border bg-slate-50/60 text-xs font-medium shadow-sm focus:outline-none focus:border-cyan-400 focus:ring-cyan-400/20 px-3",
                regionFilter
                  ? "border-cyan-400/70 text-cyan-700"
                  : "border-slate-200/80 text-slate-500"
              )}
            >
              <option value="">All regions</option>
              {regionOptions.map((region) => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>

            {/* Manager dropdown */}
            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
              className={cn(
                "h-10 rounded-xl border bg-slate-50/60 text-xs font-medium shadow-sm focus:outline-none focus:border-cyan-400 focus:ring-cyan-400/20 px-3 max-w-[160px]",
                managerFilter
                  ? "border-cyan-400/70 text-cyan-700"
                  : "border-slate-200/80 text-slate-500"
              )}
            >
              <option value="">All managers</option>
              {managerOptions.map((manager) => (
                <option key={manager} value={manager}>{manager}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <Button
                onClick={resetFilters}
                variant="ghost"
                className="h-10 rounded-xl px-3 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Empty-data toggles + count */}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500">
            <input
              type="checkbox"
              checked={emptyFilters.has("dmas")}
              onChange={() => toggleEmptyFilter("dmas")}
              className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 accent-cyan-600"
            />
            No DMAs yet
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500">
            <input
              type="checkbox"
              checked={emptyFilters.has("reports")}
              onChange={() => toggleEmptyFilter("reports")}
              className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 accent-cyan-600"
            />
            No reports yet
          </label>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
            <WaterUtilityIcon className="h-4 w-4" />
            <span>{filteredUtilities.length} utilit{filteredUtilities.length !== 1 ? 'ies' : 'y'}</span>
          </div>
        </div>
      </div>

      {/* Modern Cards Grid */}
      {filteredUtilities.length === 0 ? (
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <WaterUtilityIcon className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">No utilities found</p>
                <p className="text-sm text-slate-500 mt-1">Get started by creating your first utility</p>
              </div>
              {isAdmin ? (
                <Button 
                  onClick={openCreateDialog}
                  className="mt-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg shadow-cyan-500/25 rounded-xl"
                >
                  Add Utility
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUtilities.map((utility) => (
            <Card 
              key={utility.id} 
              className={cn(
                "overflow-hidden rounded-xl border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:shadow-slate-200/60"
              )}
            >
              {/* Top accent line */}
              <div className={cn(
                "h-1",
                utility.status === "active" 
                  ? "bg-gradient-to-r from-cyan-400 to-sky-500" 
                  : "bg-slate-200"
              )} />
              
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-slate-800">{utility.name}</h3>
                      <EntityStatusBadge status={utility.status} />
                    </div>
                    {utility.regionName && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">{utility.regionName}</p>
                    )}
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 shrink-0 gap-1 rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        Actions
                        <ChevronDown className="h-3 w-3 opacity-60" />
                        <span className="sr-only">Open actions menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()} className="w-44 rounded-xl shadow-lg shadow-slate-200/50">
                      <DropdownMenuItem onClick={() => openViewDialog(utility)} className="rounded-lg">
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEditDialog(utility)} className="rounded-lg">
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleToggleStatus(utility)}
                        className={cn(
                          "rounded-lg",
                          utility.status === "active"
                            ? "text-slate-600 focus:text-slate-700"
                            : "text-emerald-700 focus:text-emerald-800 focus:bg-emerald-50"
                        )}
                      >
                        {utility.status === "active" ? (
                          <PowerOff className="mr-2 h-4 w-4" />
                        ) : (
                          <Power className="mr-2 h-4 w-4" />
                        )}
                        {utility.status === "active" ? "Deactivate" : "Activate"}
                      </DropdownMenuItem>
                      {isAdmin ? (
                        <DropdownMenuItem
                          onClick={() => setDeleteId(utility.id)}
                          className="text-red-600 focus:text-red-600 focus:bg-red-50 rounded-lg"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {utility.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-500">{utility.description}</p>
                )}

                {/* Metric strip */}
                <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Users className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate font-medium">{utility.managerName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="font-medium">{utility.dmasCount} DMAs</span>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="font-medium">{utility.reportsCount}</span>
                  </div>
                </div>

                {/* Infrastructure assets */}
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <InfrastructureUploadIcon className="h-4 w-4 shrink-0 text-cyan-600" />
                    <span className="truncate text-xs font-medium text-slate-600">Infrastructure assets</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => router.push("/dashboard/utility-infrastructure")}
                    className="h-7 rounded-md px-2.5 text-xs font-medium text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
                  >
                    Manage
                  </Button>
                </div>

                {/* Contacts */}
                {(utility.contactPhone || utility.contactEmail || utility.contactAddress) ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-col gap-1.5 text-xs text-slate-500">
                      {utility.contactPhone ? (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{utility.contactPhone}</span>
                        </div>
                      ) : null}
                      {utility.contactEmail ? (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{utility.contactEmail}</span>
                        </div>
                      ) : null}
                      {utility.contactAddress ? (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{utility.contactAddress}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Utility"
        description="Are you sure you want to delete this utility? This action cannot be undone."
        confirmLabel="Delete Utility"
        onConfirm={handleDelete}
      />
    </div>
  )
}

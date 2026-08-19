"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useDataStore, type DMA } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
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
  GitBranch
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export default function DMAsPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { dmas, utilities, teams, fetchDMAs, fetchUtilities, fetchTeams, deleteDMA, updateDMA } = useDataStore()
  const [search, setSearch] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [utilityFilter, setUtilityFilter] = useState("")
  const [managerFilter, setManagerFilter] = useState("")
  const [emptyFilters, setEmptyFilters] = useState<Set<string>>(new Set())

  // Fetch data on mount
  useEffect(() => {
    fetchDMAs()
    fetchUtilities()
    fetchTeams()
  }, [fetchDMAs, fetchUtilities, fetchTeams])

  const isAdmin = currentUser?.role === "admin"
  const isUtility = currentUser?.role === "utility_manager"
  const isDMA = currentUser?.role === "dma_manager"
  
  // Only Utility Managers can create and manage DMAs
  // Admin can only view DMAs
  const canEdit = isUtility

  // DMA Managers cannot access this page
  if (isDMA) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="DMA Management"
          description="Only Utility Managers can manage DMAs"
        />
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <MapPin className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="text-sm text-slate-500 mt-1">Only Utility Managers can manage DMAs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Get the utility info for the current utility manager
  const myUtilityId = currentUser?.utilityId || null
  const utilityFromList = myUtilityId ? utilities.find((u) => u.id === myUtilityId) : null
  const utilityByManager = isUtility ? utilities.find((u) => u.managerId === currentUser?.id) : null
  
  // Priority: currentUser.utilityName > utilities list > utilities by manager > empty
  const myUtilityName = currentUser?.utilityName || utilityFromList?.name || utilityByManager?.name || ""
  const resolvedUtilityId = myUtilityId || utilityByManager?.id || null

  // Scope dmas based on role
  const scopedDMAs = isAdmin
    ? dmas
    : isUtility
      ? dmas.filter((d) => d.utilityId === resolvedUtilityId)
      : dmas

  const utilityOptions = Array.from(new Set(scopedDMAs.map((d) => d.utilityName).filter((u): u is string => !!u))).sort()
  const managerOptions = Array.from(new Set(scopedDMAs.map((d) => d.managerName).filter((m): m is string => !!m))).sort()

  const filteredDMAs = scopedDMAs.filter((d) => {
    const searchLower = search.toLowerCase().trim()
    
    // Status filter
    if (statusFilter !== "all" && d.status !== statusFilter) return false
    
    // Utility / manager filters
    if (utilityFilter && d.utilityName !== utilityFilter) return false
    if (managerFilter && d.managerName !== managerFilter) return false
    
    // Empty-data filters
    if (emptyFilters.has("teams") && (d.teamsCount ?? 0) > 0) return false
    if (emptyFilters.has("reports") && (d.reportsCount ?? 0) > 0) return false
    if (emptyFilters.has("engineers") && (d.engineersCount ?? 0) > 0) return false
    
    // Search matches multiple fields (ignored when empty)
    if (searchLower) {
      const matchesName = d.name?.toLowerCase().includes(searchLower)
      const matchesUtility = d.utilityName?.toLowerCase().includes(searchLower)
      const matchesManager = d.managerName?.toLowerCase().includes(searchLower)
      const matchesStatus = d.status?.toLowerCase().includes(searchLower)
      
      if (!(matchesName || matchesUtility || matchesManager || matchesStatus)) return false
    }
    
    return true
  })

  const hasActiveFilters = statusFilter !== "all" || !!utilityFilter || !!managerFilter || emptyFilters.size > 0 || !!search.trim()

  function resetFilters() {
    setSearch("")
    setStatusFilter("all")
    setUtilityFilter("")
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

  function openCreatePage() {
    router.push("/dashboard/dmas/new")
  }

  function openEditPage(dma: DMA) {
    router.push(`/dashboard/dmas/${dma.slug || dma.id}/edit`)
  }

  function openViewPage(dma: DMA) {
    router.push(`/dashboard/dmas/${dma.slug || dma.id}`)
  }

  async function handleToggleStatus(dma: DMA) {
    const nextStatus = dma.status === "active" ? "inactive" : "active"
    try {
      await updateDMA(dma.id, { status: nextStatus })
      toast.success(
        nextStatus === "active"
          ? "DMA activated"
          : "DMA deactivated"
      )
      await fetchDMAs()
    } catch (error) {
      console.error("Error toggling DMA status:", error)
      toast.error("Failed to update DMA status")
    }
  }

  async function handleDelete() {
    if (deleteId) {
      try {
        await deleteDMA(deleteId)
        toast.success("DMA deleted successfully")
        setDeleteId(null)
        await fetchDMAs()
      } catch {
        toast.error("Failed to delete DMA")
      }
    }
  }

  // Stats
  const totalDMAs = scopedDMAs?.length || 0
  const activeDMAs = scopedDMAs?.filter(d => d.status === "active").length || 0
  const totalTeams = isAdmin
    ? teams?.length || 0
    : teams?.filter(t => scopedDMAs?.some(d => d.id === t.dmaId)).length || 0
  const totalReports = scopedDMAs?.reduce((acc, d) => acc + (d.reportsCount || 0), 0) || 0

  return (
    <div className="flex flex-col gap-6">
      {/* Modern Header with Stats */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <MapPin className="h-7 w-7 text-cyan-600" />
              DMA Management
            </h1>
            <p className="text-slate-500 mt-1">
              {isUtility 
                ? `Manage District Meter Areas for ${myUtilityName}`
                : "Manage all District Meter Areas in the system"
              }
            </p>
          </div>
          {canEdit && (
            <Button 
              onClick={openCreatePage}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all duration-300 rounded-xl h-11 px-6"
            >
              Create DMA
            </Button>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:shadow-slate-200/60">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
                  <MapPin className="h-5 w-5 text-cyan-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Total DMAs</p>
                  <p className="text-2xl font-bold text-slate-800">{totalDMAs}</p>
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
                  <p className="text-sm font-medium text-slate-500">Active DMAs</p>
                  <p className="text-2xl font-bold text-slate-800">{activeDMAs}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:shadow-slate-200/60">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <GitBranch className="h-5 w-5 text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Total Teams</p>
                  <p className="text-2xl font-bold text-slate-800">{totalTeams}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:shadow-md hover:shadow-slate-200/60">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
                  <FileText className="h-5 w-5 text-cyan-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Total Reports</p>
                  <p className="text-2xl font-bold text-slate-800">{totalReports}</p>
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
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-400/10 to-sky-500/10 blur-lg opacity-0 focus-within:opacity-100 transition-opacity duration-300 pointer-events-none" />
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search by name, utility, manager..."
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

            {/* Utility dropdown */}
            <select
              value={utilityFilter}
              onChange={(e) => setUtilityFilter(e.target.value)}
              className={cn(
                "h-10 rounded-xl border bg-slate-50/60 text-xs font-medium shadow-sm focus:outline-none focus:border-cyan-400 focus:ring-cyan-400/20 px-3 max-w-[180px]",
                utilityFilter
                  ? "border-cyan-400/70 text-cyan-700"
                  : "border-slate-200/80 text-slate-500"
              )}
            >
              <option value="">All utilities</option>
              {utilityOptions.map((utility) => (
                <option key={utility} value={utility}>{utility}</option>
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
              checked={emptyFilters.has("teams")}
              onChange={() => toggleEmptyFilter("teams")}
              className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 accent-cyan-600"
            />
            No teams
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500">
            <input
              type="checkbox"
              checked={emptyFilters.has("reports")}
              onChange={() => toggleEmptyFilter("reports")}
              className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 accent-cyan-600"
            />
            No reports
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500">
            <input
              type="checkbox"
              checked={emptyFilters.has("engineers")}
              onChange={() => toggleEmptyFilter("engineers")}
              className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 accent-cyan-600"
            />
            No engineers
          </label>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
            <MapPin className="h-4 w-4" />
            <span>{filteredDMAs.length} DMA{filteredDMAs.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Modern Cards Grid */}
      {filteredDMAs.length === 0 ? (
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <MapPin className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">No DMAs found</p>
                <p className="text-sm text-slate-500 mt-1">
                  {canEdit ? "Get started by creating your first DMA" : "No DMAs match your search criteria"}
                </p>
              </div>
              {canEdit && (
                <Button 
                  onClick={openCreatePage}
                  className="mt-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 rounded-xl"
                >
                  Create DMA
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDMAs.map((dma) => (
            <Card 
              key={dma.id} 
              className={cn(
                "overflow-hidden rounded-xl border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:shadow-slate-200/60"
              )}
            >
              {/* Top accent line */}
              <div className={cn(
                "h-1",
                dma.status === "active" 
                  ? "bg-gradient-to-r from-cyan-400 to-sky-500" 
                  : "bg-slate-200"
              )} />
              
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-slate-800">{dma.name}</h3>
                      <EntityStatusBadge status={dma.status} />
                    </div>
                    {dma.utilityName && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">{dma.utilityName}</p>
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
                      <DropdownMenuItem onClick={() => openViewPage(dma)} className="rounded-lg">
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </DropdownMenuItem>
                      {canEdit && (
                        <>
                          <DropdownMenuItem onClick={() => openEditPage(dma)} className="rounded-lg">
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleToggleStatus(dma)}
                            className={cn(
                              "rounded-lg",
                              dma.status === "active"
                                ? "text-slate-600 focus:text-slate-700"
                                : "text-emerald-700 focus:text-emerald-800 focus:bg-emerald-50"
                            )}
                          >
                            {dma.status === "active" ? (
                              <PowerOff className="mr-2 h-4 w-4" />
                            ) : (
                              <Power className="mr-2 h-4 w-4" />
                            )}
                            {dma.status === "active" ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteId(dma.id)}
                            className="text-red-600 focus:text-red-600 focus:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {dma.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-500">{dma.description}</p>
                )}

                {/* Metric strip */}
                <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Users className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate font-medium">{dma.managerName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="font-medium">{dma.teamsCount ?? 0} teams</span>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="font-medium">{dma.reportsCount}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete DMA"
        description="Are you sure you want to delete this DMA? This will also remove all associated teams and engineers. This action cannot be undone."
        confirmLabel="Delete DMA"
        onConfirm={handleDelete}
      />
    </div>
  )
}

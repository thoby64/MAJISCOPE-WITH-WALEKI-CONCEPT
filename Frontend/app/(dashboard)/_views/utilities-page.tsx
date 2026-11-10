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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { 
  Eye,
  MoreHorizontal, 
  Pencil, 
  Power,
  PowerOff,
  Trash2, 
  Search, 
  MapPin,
  FileText,
  CheckCircle2,
  Droplet,
  Phone,
  Mail,
} from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { InfrastructureUploadIcon } from "@/components/icons/infrastructure-upload-icon"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { SummaryMetricCard } from "@/components/shared/summary-metric-card"

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
  const totalInfrastructureAssets = scopedUtilities.reduce(
    (total, utility) => total + (utility.infrastructureLayers ?? []).reduce((count, layer) => count + (layer.featureCount || 0), 0),
    0,
  )

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
        <div className="content-metric-grid grid grid-cols-2 gap-2.5 xl:grid-cols-4">
          <SummaryMetricCard label="Total Utilities" value={totalUtilities} icon={Droplet} tone="slate" />
          <SummaryMetricCard label="Active Utilities" value={activeUtilities} icon={CheckCircle2} tone="blue" />
          <SummaryMetricCard label="Total DMAs" value={totalDmas} icon={MapPin} tone="amber" />
          <SummaryMetricCard label="Infrastructure Assets" value={totalInfrastructureAssets} icon={InfrastructureUploadIcon} tone="red" />
        </div>
      </div>

      {/* Modern Search + Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search by name, manager, status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="utility-directory-filter-search pl-11 h-11 rounded-xl border-slate-200/80 bg-slate-50/80 shadow-sm focus:border-cyan-400 focus:ring-cyan-400/20 dark:border-[#304252] dark:bg-[#111d28] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-[#397e91] dark:focus:ring-[#397e91]/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status segmented toggle */}
            <div className="utility-directory-filter-status inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-0.5 shadow-sm dark:border-[#304252] dark:bg-[#111d28] dark:shadow-none">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "h-9 rounded-[10px] px-3 text-xs font-medium transition-colors",
                  statusFilter === "all"
                    ? "bg-cyan-600 text-white shadow-sm dark:bg-[#286779] dark:shadow-none"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-[#1b2b38] dark:hover:text-slate-100"
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
                    ? "bg-cyan-600 text-white shadow-sm dark:bg-[#286779] dark:shadow-none"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-[#1b2b38] dark:hover:text-slate-100"
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
                    ? "bg-cyan-600 text-white shadow-sm dark:bg-[#286779] dark:shadow-none"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-[#1b2b38] dark:hover:text-slate-100"
                )}
              >
                Inactive
              </button>
            </div>

            {/* Region dropdown */}
            <Select value={regionFilter || "__all_regions__"} onValueChange={(value) => setRegionFilter(value === "__all_regions__" ? "" : value)}>
              <SelectTrigger className="h-10 w-auto min-w-[8.5rem] rounded-xl px-3 text-xs font-medium shadow-none">
                <SelectValue placeholder="All regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all_regions__">All regions</SelectItem>
                {regionOptions.map((region) => <SelectItem key={region} value={region}>{region}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Manager dropdown */}
            <Select value={managerFilter || "__all_managers__"} onValueChange={(value) => setManagerFilter(value === "__all_managers__" ? "" : value)}>
              <SelectTrigger className="h-10 w-auto min-w-[9.5rem] max-w-[10rem] rounded-xl px-3 text-xs font-medium shadow-none">
                <SelectValue placeholder="All managers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all_managers__">All managers</SelectItem>
                {managerOptions.map((manager) => <SelectItem key={manager} value={manager}>{manager}</SelectItem>)}
              </SelectContent>
            </Select>

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filteredUtilities.map((utility) => {
            const assetCount = (utility.infrastructureLayers ?? []).reduce((count, layer) => count + (layer.featureCount || 0), 0)
            return (
            <Card 
              key={utility.id} 
              className={cn(
                "utility-directory-card group overflow-hidden rounded-[22px] transition-all duration-300 hover:-translate-y-0.5"
              )}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => openViewDialog(utility)} className="min-w-0 text-left">
                    <h3 className="truncate text-[17px] font-semibold tracking-[-0.025em] text-slate-800 dark:text-slate-100">{utility.name}</h3>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {[utility.regionName, utility.description].filter(Boolean).join(" · ") || "Water utility"}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <EntityStatusBadge status={utility.status} />
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 shrink-0 rounded-lg p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <MoreHorizontal className="h-4 w-4" />
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
                            ? "menu-action-deactivate"
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
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="utility-card-metric">
                    <MapPin className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-300" />
                    <span className="utility-card-metric__value">{utility.dmasCount ?? 0}</span>
                    <span className="utility-card-metric__label">DMAs</span>
                  </div>
                  <div className="utility-card-metric">
                    <FileText className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-300" />
                    <span className="utility-card-metric__value">{utility.reportsCount ?? 0}</span>
                    <span className="utility-card-metric__label">Reports</span>
                  </div>
                  <div className="utility-card-metric">
                    <InfrastructureUploadIcon className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-300" />
                    <span className="utility-card-metric__value">{assetCount}</span>
                    <span className="utility-card-metric__label">Assets</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Utility Manager</p>
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{utility.managerName || "Unassigned"}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push("/dashboard/utility-infrastructure")}
                    className="utility-directory-card-action h-9 shrink-0 rounded-xl border-slate-300/70 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <InfrastructureUploadIcon className="mr-1.5 h-4 w-4" />
                    Manage assets
                  </Button>
                </div>
                {(utility.contactPhone || utility.contactEmail) ? (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {utility.contactPhone ? <span className="inline-flex min-w-0 items-center gap-1.5"><Phone className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{utility.contactPhone}</span></span> : null}
                    {utility.contactEmail ? <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{utility.contactEmail}</span></span> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )})}
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

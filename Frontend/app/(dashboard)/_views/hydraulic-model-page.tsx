"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, MapPin, ShieldCheck, XCircle } from "lucide-react"
import { toast } from "sonner"

import { usePageAccess } from "@/hooks/use-page-access"
import { apiClient } from "@/lib/api-client"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { HydraulicPumpIcon } from "@/components/icons/hydraulic-pump-icon"
import { HYDRAULIC_LAUNCH_STORAGE_KEY } from "@/lib/hydraulic-workspace"

type Choice = {
  id: string
  name: string
}

type Requirement = {
  key: string
  label: string
  present: boolean
  required: boolean
  message?: string | null
}

type ReadinessResponse = {
  ready: boolean
  can_prepare: boolean
  role: string
  selected_utility_id?: string | null
  selected_dma_id?: string | null
  utilities: Choice[]
  dmas: Choice[]
  required: Requirement[]
  optional: Requirement[]
  message: string
  action_hint?: string | null
}

type PrepareResponse = {
  session_id: string
  ready: boolean
  status: string
  launch_url?: string | null
  expires_at: string
  message: string
}

function RequirementRow({ item }: { item: Requirement }) {
  const Icon = item.present ? CheckCircle2 : item.required ? XCircle : AlertTriangle

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        item.present
          ? "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
          : item.required
            ? "border-rose-200 bg-rose-50/80 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
            : "border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{item.label}</p>
        <p className="mt-0.5 text-sm opacity-80">
          {item.message || (item.present ? "Available inside or on this DMA boundary." : item.required ? "Required before model preparation." : "Optional.")}
        </p>
      </div>
    </div>
  )
}

export default function HydraulicModelPage() {
  usePageAccess()
  const router = useRouter()

  const { currentUser } = useAuthStore()
  const { utilities, dmas, initialized, isLoading: storeLoading } = useDataStore()
  const [selectedUtilityId, setSelectedUtilityId] = useState("")
  const [selectedDmaId, setSelectedDmaId] = useState("")
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null)
  const [checkingReadiness, setCheckingReadiness] = useState(false)
  const [preparing, setPreparing] = useState(false)

  const role = currentUser?.role
  const utilityLocked = role === "utility_manager" || role === "dma_manager"
  const dmaLocked = role === "dma_manager"
  const currentDMA = useMemo(
    () => dmas.find((dma) => dma.id === currentUser?.dmaId) ?? null,
    [currentUser?.dmaId, dmas]
  )
  const effectiveUserUtilityId = currentUser?.utilityId || currentDMA?.utilityId || ""

  const utilityOptions = useMemo<Choice[]>(() => {
    if (role === "utility_manager" || role === "dma_manager") {
      return utilities
        .filter((utility) => utility.id === effectiveUserUtilityId)
        .map((utility) => ({ id: utility.id, name: utility.name }))
    }

    return utilities.map((utility) => ({ id: utility.id, name: utility.name }))
  }, [effectiveUserUtilityId, role, utilities])

  const dmaOptions = useMemo<Choice[]>(() => {
    if (role === "dma_manager" && currentUser?.dmaId) {
      return dmas
        .filter((dma) => dma.id === currentUser.dmaId)
        .map((dma) => ({ id: dma.id, name: dma.name }))
    }

    if (!selectedUtilityId) return []

    return dmas
      .filter((dma) => dma.utilityId === selectedUtilityId)
      .map((dma) => ({ id: dma.id, name: dma.name }))
  }, [currentUser?.dmaId, dmas, role, selectedUtilityId])
  const hasSelectedDma = Boolean(selectedDmaId)
  const scopeLoading = !initialized || storeLoading

  useEffect(() => {
    if (!initialized) return

    if ((role === "utility_manager" || role === "dma_manager") && effectiveUserUtilityId) {
      setSelectedUtilityId(effectiveUserUtilityId)
    }

    if (role === "dma_manager" && currentUser?.dmaId) {
      setSelectedDmaId(currentUser.dmaId)
    }
  }, [currentUser?.dmaId, effectiveUserUtilityId, initialized, role])

  useEffect(() => {
    if (!selectedDmaId) {
      setReadiness(null)
      return
    }

    if (!dmaOptions.some((dma) => dma.id === selectedDmaId)) {
      setReadiness(null)
      if (!dmaLocked) setSelectedDmaId("")
    }
  }, [dmaLocked, dmaOptions, selectedDmaId])

  useEffect(() => {
    let cancelled = false

    async function loadReadiness() {
      if (!selectedDmaId) {
        setReadiness(null)
        return
      }

      setCheckingReadiness(true)
      const response = await apiClient.post<ReadinessResponse>("/hydraulic-model/readiness", {
        utilityId: selectedUtilityId || undefined,
        dmaId: selectedDmaId || undefined,
      })
      if (cancelled) return

      setCheckingReadiness(false)
      if (!response.success || !response.data) {
        toast.error(response.error || "Failed to check hydraulic model readiness.")
        return
      }

      setReadiness(response.data)
    }

    void loadReadiness()
    return () => {
      cancelled = true
    }
  }, [selectedDmaId, selectedUtilityId])

  const requiredItems = readiness?.required || []
  const optionalItems = readiness?.optional || []
  const missingRequired = useMemo(
    () => requiredItems.filter((item) => !item.present),
    [requiredItems]
  )

  async function handlePrepare() {
    if (!readiness?.can_prepare) return

    setPreparing(true)
    const response = await apiClient.post<PrepareResponse>("/hydraulic-model/prepare", {
      utilityId: selectedUtilityId || undefined,
      dmaId: selectedDmaId || undefined,
    })
    setPreparing(false)

    if (!response.success || !response.data) {
      toast.error(response.error || "Failed to prepare the hydraulic model.")
      return
    }

    toast.success(response.data.message || "Hydraulic model is ready.")
    if (response.data.launch_url) {
      window.sessionStorage.setItem(HYDRAULIC_LAUNCH_STORAGE_KEY, response.data.launch_url)
      router.push("/dashboard/hydraulic-model/workspace")
    } else {
      toast.info("Hydraulic model URL is not configured yet on the backend.")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <HydraulicPumpIcon className="h-9 w-9 text-sky-600 dark:text-sky-300" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
                Run Hydraulic Model
              </h1>
              <p className="mt-1 max-w-3xl text-base text-slate-600 dark:text-slate-300">
                Prepare a DMA-scoped hydraulic model using saved boundaries and uploaded utility infrastructure.
              </p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          onClick={handlePrepare}
          disabled={!readiness?.can_prepare || preparing || checkingReadiness}
          className="min-w-56 bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/20 hover:from-sky-600 hover:to-blue-700"
        >
          {preparing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing Hydraulic Model...
            </>
          ) : (
            "Prepare Hydraulic Model"
          )}
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
          <CardContent className="space-y-5 p-6">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Access Scope</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Choose the utility and DMA for this hydraulic model run.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Utility</label>
              <Select
                value={selectedUtilityId}
                onValueChange={(value) => {
                  setSelectedUtilityId(value)
                  setSelectedDmaId("")
                }}
                disabled={utilityLocked || scopeLoading}
              >
                <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                  <SelectValue
                    placeholder={
                      scopeLoading && !utilityOptions.length
                        ? "Loading utilities..."
                        : !scopeLoading && !utilityOptions.length
                          ? "No utilities available"
                          : "Select utility"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {utilityOptions.length ? (
                    utilityOptions.map((utility) => (
                      <SelectItem key={utility.id} value={utility.id}>
                        {utility.name}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-slate-500">No utilities available</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">DMA</label>
              <Select
                value={selectedDmaId}
                onValueChange={setSelectedDmaId}
                disabled={dmaLocked || !selectedUtilityId || scopeLoading}
              >
                <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                  <SelectValue
                    placeholder={
                      !selectedUtilityId
                        ? "Select utility first"
                        : scopeLoading && !dmaOptions.length
                          ? "Loading DMAs..."
                          : !scopeLoading && !dmaOptions.length
                            ? "No DMAs available"
                            : "Select DMA"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {dmaOptions.length ? (
                    dmaOptions.map((dma) => (
                      <SelectItem key={dma.id} value={dma.id}>
                        {dma.name}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-slate-500">No DMAs available</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/70">
              <p className="font-semibold text-slate-950 dark:text-white">
                {checkingReadiness && hasSelectedDma
                  ? "Checking readiness..."
                  : scopeLoading
                    ? "Loading available choices..."
                    : !utilityOptions.length
                      ? "No utilities are available for your account."
                      : selectedUtilityId && !dmaOptions.length
                        ? "No DMAs are available for the selected utility."
                        : readiness?.message || "Select a utility and DMA to continue."}
              </p>
              {readiness?.action_hint ? (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{readiness.action_hint}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/90 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Model Requirements</h2>
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Required data must be present before the hydraulic model can open.
                </p>
              </div>
              {checkingReadiness && hasSelectedDma ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {hasSelectedDma && requiredItems.length ? (
                requiredItems.map((item) => <RequirementRow key={item.key} item={item} />)
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-400">
                  Select a DMA to check model requirements.
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Optional Data
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {hasSelectedDma && optionalItems.length ? (
                  optionalItems.map((item) => <RequirementRow key={item.key} item={item} />)
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-400">
                    Optional infrastructure checks appear after selecting a DMA.
                  </div>
                )}
              </div>
            </div>

            {missingRequired.length ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                <p className="font-semibold">Missing required data</p>
                <p className="mt-1">
                  {missingRequired.map((item) => item.label).join(", ")} must be completed before the model can run.
                </p>
              </div>
            ) : readiness?.ready ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                <p className="font-semibold">Ready to run</p>
                <p className="mt-1">The selected DMA has the minimum data needed to prepare the hydraulic model.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

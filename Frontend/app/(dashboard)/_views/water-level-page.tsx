"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Droplets, Gauge, MapPin, Plus, RefreshCw } from "lucide-react"
import { InfrastructureIcon } from "@/components/icons/infrastructure-icon"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorSnap, type TankSnap } from "@/store/data-store"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
import {
  WATER_LEVEL_POLL_INTERVAL_MS,
  fillPercent,
  formatRelativeTime,
  readStoredTankLength,
  tankLengthFor,
} from "@/lib/water-level"
import { cn } from "@/lib/utils"

interface TankGroup {
  tank: TankSnap
  representative: SensorSnap | null
  sensorCount: number
  activeSensorCount: number
}

export default function WaterLevelPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { sensors, tanks, dmas, utilities, fetchSensors, fetchTanks, fetchDMAs, fetchUtilities } = useDataStore()

  const role = currentUser?.role
  const canView = role === "admin" || role === "utility_manager" || role === "dma_manager"

  const [utilityFilter, setUtilityFilter] = useState("")
  const [dmaFilter, setDmaFilter] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTankId, setModalTankId] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())

  const effectiveUtilityId =
    currentUser?.utilityId ||
    dmas.find((dma) => dma.id === currentUser?.dmaId)?.utilityId ||
    ""

  // Initial load + poll
  useEffect(() => {
    void fetchSensors()
    void fetchTanks()
    void fetchUtilities()
    void fetchDMAs()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSensors()
        void fetchTanks()
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    const ticker = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      clearInterval(interval)
      clearInterval(ticker)
    }
  }, [fetchSensors, fetchTanks, fetchUtilities, fetchDMAs])

  // Lock utility filter for managers
  useEffect(() => {
    if (role === "utility_manager" || role === "dma_manager") {
      if (effectiveUtilityId) setUtilityFilter(effectiveUtilityId)
    }
  }, [effectiveUtilityId, role])

  // Re-fetch DMAs scoped to the selected utility
  useEffect(() => {
    if (utilityFilter) {
      void fetchDMAs(utilityFilter)
    } else {
      void fetchDMAs()
    }
  }, [utilityFilter, fetchDMAs])

  // DMA manager is locked to their own DMA
  useEffect(() => {
    if (role === "dma_manager" && currentUser?.dmaId) setDmaFilter(currentUser.dmaId)
  }, [currentUser?.dmaId, role])

  const utilityOptions = useMemo(() => {
    if (role === "utility_manager" || role === "dma_manager") {
      return utilities.filter((u) => u.id === effectiveUtilityId)
    }
    return utilities
  }, [effectiveUtilityId, role, utilities])

  const dmaOptions = useMemo(() => {
    if (role === "dma_manager" && currentUser?.dmaId) {
      return dmas.filter((dma) => dma.id === currentUser.dmaId)
    }
    if (utilityFilter) {
      return dmas.filter((dma) => dma.utilityId === utilityFilter)
    }
    return dmas
  }, [currentUser?.dmaId, dmas, role, utilityFilter])

  // Build latest sensor-per-tank
  const latestSensorByTank = useMemo(() => {
    const map = new Map<string, SensorSnap>()
    for (const sensor of sensors) {
      const current = map.get(sensor.tankId)
      if (
        !current ||
        (sensor.activated &&
          sensor.lastReading &&
          new Date(sensor.lastReading.occurredAt) > new Date(current.lastReading?.occurredAt ?? 0))
      ) {
        if (sensor.activated || !current) map.set(sensor.tankId, sensor)
      }
    }
    return map
  }, [sensors])

  const tankGroups: TankGroup[] = useMemo(() => {
    return tanks
      .map((tank) => {
        const tankSensors = sensors.filter((s) => s.tankId === tank.id)
        return {
          tank,
          representative: latestSensorByTank.get(tank.id) ?? null,
          sensorCount: tankSensors.length,
          activeSensorCount: tank.activeSensorCount,
        }
      })
      .filter((group) => {
        if (utilityFilter && group.tank.utilityId !== utilityFilter) return false
        if (dmaFilter) {
          return dmaFilter === "unassigned" ? !group.tank.dmaId : group.tank.dmaId === dmaFilter
        }
        return true
      })
  }, [dmaFilter, latestSensorByTank, sensors, tanks, utilityFilter])

  const canRegister = role === "admin" || role === "utility_manager"
  const canCreateFacility = role === "admin" || role === "utility_manager"

  const openTank = useCallback(
    (tankId: string) => router.push(`/dashboard/water-level/${tankId}`),
    [router]
  )

  const openCreateFacility = useCallback(() => {
    router.push('/dashboard/storage-facilities/new')
  }, [router])

  const openRegister = useCallback((tankId?: string) => {
    setModalTankId(tankId)
    setModalOpen(true)
  }, [])

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Water Level Monitoring" description="Access restricted" />
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="mt-1 text-sm text-slate-500">
                  Only admin, utility manager, and DMA manager roles can view water levels.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Water Level Monitoring"
        description="Live tank water levels from connected sensors. Refreshes every 10 seconds."
        actionLabel="Refresh"
        actionIcon={RefreshCw}
        onAction={() => {
          void fetchSensors()
          void fetchTanks()
        }}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={utilityFilter}
          onChange={(e) => {
            setUtilityFilter(e.target.value)
            setDmaFilter("")
          }}
          disabled={role === "utility_manager" || role === "dma_manager"}
          className={cn(
            "h-10 rounded-xl border bg-slate-50/60 px-3 text-xs font-medium shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-cyan-400/20",
            utilityFilter ? "border-cyan-400/70 text-cyan-700" : "border-slate-200/80 text-slate-500",
            (role === "utility_manager" || role === "dma_manager") && "cursor-not-allowed opacity-70"
          )}
        >
          <option value="">All Utilities</option>
          {utilityOptions.map((utility) => (
            <option key={utility.id} value={utility.id}>
              {utility.name}
            </option>
          ))}
        </select>

        <select
          value={dmaFilter}
          onChange={(e) => setDmaFilter(e.target.value)}
          disabled={role === "dma_manager"}
          className={cn(
            "h-10 rounded-xl border bg-slate-50/60 px-3 text-xs font-medium shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-cyan-400/20",
            dmaFilter ? "border-cyan-400/70 text-cyan-700" : "border-slate-200/80 text-slate-500",
            role === "dma_manager" && "cursor-not-allowed opacity-70"
          )}
        >
          <option value="">All DMAs</option>
          <option value="unassigned">Unassigned</option>
          {dmaOptions.map((dma) => (
            <option key={dma.id} value={dma.id}>
              {dma.utilityName || utilityFilter ? dma.name : `${dma.name}${dma.utilityName ? ` · ${dma.utilityName}` : ""}`}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <Gauge className="h-4 w-4" />
            {tankGroups.length} tank{tankGroups.length !== 1 ? "s" : ""}
          </span>
          {canCreateFacility && (
            <Button size="sm" variant="outline" onClick={openCreateFacility}>
              <InfrastructureIcon assetType="storage_facilities" className="mr-1.5 h-4 w-4" />
              Add Storage Facility
            </Button>
          )}
          {canRegister && (
            <Button size="sm" onClick={() => openRegister(undefined)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Register sensor
            </Button>
          )}
        </div>
      </div>

      {/* Cards */}
      {tanks.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : tankGroups.length === 0 ? (
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">No tanks found</p>
                <p className="mt-1 text-sm text-slate-500">No monitored tanks match the current filter.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tankGroups.map((group) => {
            const { tank, representative } = group
            const reading = representative?.lastReading ?? null
            const tankLength = tankLengthFor(representative ?? {}, readStoredTankLength(tank.id))
            const percent = reading ? fillPercent(reading.waterLevelM, tankLength) : 0
            const status = representative?.status ?? (tank.status === "deactivated" ? "inactive" : "unknown")

            return (
              <Card
                key={tank.id}
                onClick={() => openTank(tank.id)}
                className="cursor-pointer overflow-hidden rounded-xl border-slate-200/70 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:shadow-slate-200/60"
              >
                <div
                  className={cn(
                    "h-1",
                    status === "critical"
                      ? "bg-gradient-to-r from-rose-400 to-red-500"
                      : status === "warning"
                        ? "bg-gradient-to-r from-amber-400 to-orange-500"
                        : status === "active"
                          ? "bg-gradient-to-r from-cyan-400 to-sky-500"
                          : "bg-slate-200"
                  )}
                />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                        <h3 className="truncate font-semibold text-slate-800">{tank.name || tank.sourceKey}</h3>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {group.tank.dmaId ? dmas.find((dma) => dma.id === group.tank.dmaId)?.name || "Unassigned" : "Unassigned"}
                      </p>
                    </div>
                    {representative ? <WaterStatusPill status={representative.status} /> : <WaterStatusPill status="inactive" />}
                  </div>

                  <div className="mt-4">
                    <div className="flex items-end justify-between text-sm">
                      <div>
                        <p className="text-xs text-slate-500">Water level</p>
                        <p className="font-semibold text-slate-800">
                          {reading ? `${reading.waterLevelM.toFixed(2)} m` : "—"}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-slate-500">
                        {reading ? `${percent.toFixed(0)}%` : "No readings yet"}
                      </span>
                    </div>
                    <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-700",
                          status === "critical"
                            ? "bg-gradient-to-r from-rose-400 to-red-500"
                            : status === "warning"
                              ? "bg-gradient-to-r from-amber-400 to-orange-500"
                              : status === "active"
                                ? "bg-gradient-to-r from-cyan-400 to-sky-500"
                                : "bg-slate-300"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span>{reading ? `Updated ${formatRelativeTime(reading.occurredAt, now)}` : "No readings yet"}</span>
                    <span>{group.activeSensorCount} sensor{group.activeSensorCount !== 1 ? "s" : ""}</span>
                  </div>

                  {canRegister && !group.activeSensorCount && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={(event) => {
                        event.stopPropagation()
                        openRegister(tank.id)
                      }}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Register sensor
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <RegisterSensorModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        defaultTankId={modalTankId}
      />
    </div>
  )
}

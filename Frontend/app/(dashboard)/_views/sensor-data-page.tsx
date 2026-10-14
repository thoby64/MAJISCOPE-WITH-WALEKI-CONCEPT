"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Droplets, FlaskConical, Gauge, MapPin, Plus, RefreshCw, Waves } from "lucide-react"
import { InfrastructureIcon } from "@/components/icons/infrastructure-icon"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorCategory, type SensorSnap, type StorageFacilitySnap } from "@/store/data-store"
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
  readStoredStorageFacilityLength,
  storageFacilityLengthFor,
} from "@/lib/water-level"
import { cn } from "@/lib/utils"

interface StorageFacilityGroup {
  storageFacility: StorageFacilitySnap
  representative: SensorSnap | null
  sensorCount: number
  activeSensorCount: number
  activeCategories: SensorCategory[]
  sensorCategories: SensorCategory[]
}

function wqHeadline(parameters: Record<string, number> | null | undefined): string {
  if (!parameters) return "—"
  const pick = (...keys: string[]) => {
    for (const k of keys) if (parameters[k] != null) return parameters[k]
    return null
  }
  const parts: string[] = []
  const ph = pick("ph")
  if (ph != null) parts.push(`pH ${ph}`)
  const turb = pick("turbidity_ntu", "turbidityNtu")
  if (turb != null) parts.push(`Turb ${turb} NTU`)
  const temp = pick("temperature_c", "temperatureC")
  if (temp != null) parts.push(`${temp}°C`)
  return parts.slice(0, 2).join(" · ") || "—"
}

export default function SensorDataPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { sensors, storageFacilities, dmas, utilities, fetchSensors, fetchStorageFacilities, fetchDMAs, fetchUtilities } = useDataStore()

  const role = currentUser?.role
  const canView = role === "admin" || role === "utility_manager" || role === "dma_manager"

  const [utilityFilter, setUtilityFilter] = useState("")
  const [dmaFilter, setDmaFilter] = useState("")
  const [search, setSearch] = useState("")
  const [sensorFilter, setSensorFilter] = useState("all")
  const [modalOpen, setModalOpen] = useState(false)
  const [modalStorageFacilityId, setModalStorageFacilityId] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())

  const effectiveUtilityId =
    currentUser?.utilityId ||
    dmas.find((dma) => dma.id === currentUser?.dmaId)?.utilityId ||
    ""

  // Initial load + poll
  useEffect(() => {
    void fetchSensors()
    void fetchStorageFacilities()
    void fetchUtilities()
    void fetchDMAs()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSensors()
        void fetchStorageFacilities()
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    const ticker = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      clearInterval(interval)
      clearInterval(ticker)
    }
  }, [fetchSensors, fetchStorageFacilities, fetchUtilities, fetchDMAs])

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

  // Build latest sensor-per-storageFacility (prefer activated sensors with fresh readings)
  const latestSensorByStorageFacility = useMemo(() => {
    const map = new Map<string, SensorSnap>()
    for (const sensor of sensors) {
      const facilityId = sensor.storageFacilityId
      if (sensor.assetType !== "storage_facility" || !facilityId) continue
      const current = map.get(facilityId)
      if (
        !current ||
        (sensor.activated &&
          sensor.lastReading &&
          new Date(sensor.lastReading.occurredAt) > new Date(current.lastReading?.occurredAt ?? 0))
      ) {
        if (sensor.activated || !current) map.set(facilityId, sensor)
      }
    }
    return map
  }, [sensors])

  const storageFacilityGroups: StorageFacilityGroup[] = useMemo(() => {
    return storageFacilities
      .map((storageFacility) => {
        const storageFacilitySensors = sensors.filter(
          (sensor) => sensor.assetType === "storage_facility" && sensor.storageFacilityId === storageFacility.id
        )
        const activeCategories = Array.from(
          new Set(storageFacilitySensors.filter((s) => s.activated).map((s) => s.category))
        )
        return {
          storageFacility,
          representative: latestSensorByStorageFacility.get(storageFacility.id) ?? null,
          sensorCount: storageFacilitySensors.length,
          activeSensorCount: storageFacility.activeSensorCount,
          activeCategories,
          sensorCategories: Array.from(new Set(storageFacilitySensors.map((sensor) => sensor.category))),
        }
      })
      .filter((group) => {
        if (utilityFilter && group.storageFacility.utilityId !== utilityFilter) return false
        if (dmaFilter) {
          return dmaFilter === "unassigned" ? !group.storageFacility.dmaId : group.storageFacility.dmaId === dmaFilter
        }
        return true
      })
      .filter((group) => {
        if (sensorFilter === "with_sensors" && group.sensorCount === 0) return false
        if (sensorFilter === "without_sensors" && group.sensorCount > 0) return false
        if (sensorFilter === "water_quality" && !group.sensorCategories.includes("water_quality")) return false
        if (sensorFilter === "water_level" && !group.sensorCategories.includes("water_level")) return false
        if (sensorFilter === "water_quality_only" && (
          !group.sensorCategories.includes("water_quality") || group.sensorCategories.includes("water_level")
        )) return false
        if (sensorFilter === "water_level_only" && (
          !group.sensorCategories.includes("water_level") || group.sensorCategories.includes("water_quality")
        )) return false
        if (sensorFilter === "both" && !(
          group.sensorCategories.includes("water_quality") && group.sensorCategories.includes("water_level")
        )) return false
        const query = search.trim().toLocaleLowerCase()
        const dmaName = dmas.find((dma) => dma.id === group.storageFacility.dmaId)?.name ?? "unassigned"
        const utilityName = utilities.find((utility) => utility.id === group.storageFacility.utilityId)?.name ?? ""
        return !query || [group.storageFacility.name, group.storageFacility.sourceKey, dmaName, utilityName]
          .some((value) => value?.toLocaleLowerCase().includes(query))
      })
      .sort((a, b) =>
        (a.storageFacility.name || a.storageFacility.sourceKey).localeCompare(
          b.storageFacility.name || b.storageFacility.sourceKey,
          undefined,
          { sensitivity: "base" }
        )
      )
  }, [dmaFilter, dmas, latestSensorByStorageFacility, search, sensorFilter, sensors, storageFacilities, utilities, utilityFilter])

  const canRegister = role === "admin" || role === "utility_manager"
  const canCreateFacility = role === "admin" || role === "utility_manager"

  const openStorageFacility = useCallback(
    (storageFacilityId: string) => router.push(`/dashboard/sensor-data/${storageFacilityId}`),
    [router]
  )

  const openCreateFacility = useCallback(() => {
    router.push('/dashboard/storage-facilities/new')
  }, [router])

  const openRegister = useCallback((storageFacilityId?: string) => {
    setModalStorageFacilityId(storageFacilityId)
    setModalOpen(true)
  }, [])

  if (!canView) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader title="Sensor Data Monitoring" description="Access restricted" />
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="mt-1 text-sm text-slate-500">
                  Only admin, utility manager, and DMA manager roles can view sensor data.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Sensor Data Monitoring"
        description="Live readings from connected water-level and water-quality sensors. Refreshes every 10 seconds."
        actionLabel="Refresh"
        actionIcon={RefreshCw}
        onAction={() => {
          void fetchSensors()
          void fetchStorageFacilities()
        }}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, DMA, or utility"
          aria-label="Search storage facilities by name, DMA, or utility"
          className="h-10 min-w-56 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 text-xs font-medium shadow-sm focus:border-cyan-400 focus:outline-none"
        />
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
        <select
          value={sensorFilter}
          onChange={(event) => setSensorFilter(event.target.value)}
          aria-label="Filter storage facilities by installed sensors"
          className={cn(
            "h-10 rounded-xl border bg-slate-50/60 px-3 text-xs font-medium shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-cyan-400/20",
            sensorFilter !== "all" ? "border-cyan-400/70 text-cyan-700" : "border-slate-200/80 text-slate-500"
          )}
        >
          <option value="all">All sensor configurations</option>
          <option value="with_sensors">With sensors</option>
          <option value="without_sensors">Without sensors</option>
          <option value="water_quality">With water-quality sensor</option>
          <option value="water_level">With water-level sensor</option>
          <option value="water_quality_only">Water-quality sensor only</option>
          <option value="water_level_only">Water-level sensor only</option>
          <option value="both">Both sensor types</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <Gauge className="h-4 w-4" />
            {storageFacilityGroups.length} storageFacility{storageFacilityGroups.length !== 1 ? "s" : ""}
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
      {storageFacilities.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : storageFacilityGroups.length === 0 ? (
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">No storage facilities found</p>
                <p className="mt-1 text-sm text-slate-500">No monitored storage facilities match the current filter.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {storageFacilityGroups.map((group) => {
            const { storageFacility, representative } = group
            const reading = representative?.lastReading ?? null
            const isWq = representative?.category === "water_quality"
            const storageFacilityLength = storageFacilityLengthFor(representative ?? {}, readStoredStorageFacilityLength(storageFacility.id))
            const percent = reading && !isWq ? fillPercent(reading.waterLevelM ?? 0, storageFacilityLength) : 0
            const status = representative?.status ?? (storageFacility.status === "deactivated" ? "inactive" : "unknown")

            return (
              <Card
                key={storageFacility.id}
                onClick={() => openStorageFacility(storageFacility.id)}
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
                        <h3 className="truncate font-semibold text-slate-800">{storageFacility.name || storageFacility.sourceKey}</h3>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {group.storageFacility.dmaId ? dmas.find((dma) => dma.id === group.storageFacility.dmaId)?.name || "Unassigned" : "Unassigned"}
                      </p>
                      {/* Category chips: which sensor types are fitted on this storageFacility */}
                      {group.activeCategories.length > 0 && (
                        <div className="mt-1.5 flex items-center gap-1">
                          {group.activeCategories.map((cat) => (
                            <span
                              key={cat}
                              className={cn(
                                "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                cat === "water_quality"
                                  ? "bg-cyan-50 text-cyan-700"
                                  : "bg-emerald-50 text-emerald-700"
                              )}
                            >
                              {cat === "water_quality" ? (
                                <FlaskConical className="h-2.5 w-2.5" />
                              ) : (
                                <Waves className="h-2.5 w-2.5" />
                              )}
                              {cat === "water_quality" ? "Quality" : "Level"}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {representative ? <WaterStatusPill status={representative.status} /> : <WaterStatusPill status="inactive" />}
                  </div>

                  <div className="mt-4">
                    {isWq ? (
                      /* Water-quality summary */
                      <div className="flex items-end justify-between text-sm">
                        <div>
                          <p className="text-xs text-slate-500">Water quality</p>
                          <p className="font-semibold text-slate-800">{wqHeadline(reading?.parameters)}</p>
                        </div>
                        <span className="text-xs font-medium text-slate-500">
                          {reading ? "Live" : "No readings yet"}
                        </span>
                      </div>
                    ) : (
                      /* Water-level bar (unchanged behaviour) */
                      <div className="flex items-end justify-between text-sm">
                        <div>
                          <p className="text-xs text-slate-500">Water level</p>
                          <p className="font-semibold text-slate-800">
                            {reading ? `${(reading.waterLevelM ?? 0).toFixed(2)} m` : "—"}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-slate-500">
                          {reading ? `${percent.toFixed(0)}%` : "No readings yet"}
                        </span>
                      </div>
                    )}
                    {!isWq && (
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
                    )}
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
                        openRegister(storageFacility.id)
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
        defaultStorageFacilityId={modalStorageFacilityId}
      />
    </div>
  )
}

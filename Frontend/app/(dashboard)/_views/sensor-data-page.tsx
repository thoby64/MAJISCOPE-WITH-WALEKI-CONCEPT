"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, ArrowUpRight, Building2, Clock3, Database, Droplets, FlaskConical, Gauge, MapPin, RefreshCw, Waves } from "lucide-react"
import { InfrastructureIcon } from "@/components/icons/infrastructure-icon"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorCategory, type SensorSnap, type StorageFacilitySnap } from "@/store/data-store"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  WATER_LEVEL_POLL_INTERVAL_MS,
  fillPercent,
  formatRelativeTime,
  readStoredStorageFacilityLength,
} from "@/lib/water-level"
import { cn } from "@/lib/utils"

interface StorageFacilityGroup {
  storageFacility: StorageFacilitySnap
  representative: SensorSnap | null
  sensors: SensorSnap[]
  sensorCount: number
  activeSensorCount: number
  readingCount: number | null
  activeCategories: SensorCategory[]
  sensorCategories: SensorCategory[]
}

function configuredFacilityHeight(sensor: SensorSnap | null, override: number | null): number | null {
  if (override && override > 0) return override
  if (!sensor) return null
  const configured = sensor.config?.h1M ?? sensor.config?.h1_m ?? sensor.lastReading?.h1M
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : null
}

function hasQualityData(parameters: Record<string, number> | null | undefined): boolean {
  return Boolean(parameters && Object.values(parameters).some((value) => Number.isFinite(value)))
}

function displaySensorStatus(status: string | null | undefined, facilityStatus: string): { label: string; tone: string } {
  const normalized = (status || facilityStatus).toLowerCase()
  if (normalized === "critical") return { label: "Critical", tone: "border-rose-300/70 bg-rose-50/70 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-300" }
  if (normalized === "warning") return { label: "Warning", tone: "border-amber-300/70 bg-amber-50/70 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300" }
  if (normalized === "active" || normalized === "operational") return { label: "Operational", tone: "border-emerald-300/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300" }
  return { label: "Inactive", tone: "border-slate-300/70 bg-slate-100/70 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300" }
}

function wqHeadline(parameters: Record<string, number> | null | undefined): string {
  if (!parameters) return "—"
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const value = parameters[k]
      if (typeof value === "number" && Number.isFinite(value)) return value
    }
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
          sensors: storageFacilitySensors,
          sensorCount: storageFacilitySensors.length,
          activeSensorCount: storageFacility.activeSensorCount,
          readingCount: storageFacilitySensors.some((sensor) => typeof sensor.promotedReadings === "number")
            ? storageFacilitySensors.reduce((total, sensor) => total + (sensor.promotedReadings ?? 0), 0)
            : null,
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

  const canCreateFacility = role === "admin" || role === "utility_manager"

  const openStorageFacility = useCallback(
    (storageFacilityId: string) => router.push(`/dashboard/sensor-data/${storageFacilityId}`),
    [router]
  )

  const openCreateFacility = useCallback(() => {
    router.push('/dashboard/storage-facilities/new')
  }, [router])

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
        <Select value={utilityFilter || "__all_utilities__"} onValueChange={(value) => { setUtilityFilter(value === "__all_utilities__" ? "" : value); setDmaFilter("") }} disabled={role === "utility_manager" || role === "dma_manager"}>
          <SelectTrigger className="h-10 w-auto rounded-xl px-3 text-xs font-medium"><SelectValue placeholder="All Utilities" /></SelectTrigger>
          <SelectContent><SelectItem value="__all_utilities__">All Utilities</SelectItem>{utilityOptions.map((utility) => <SelectItem key={utility.id} value={utility.id}>{utility.name}</SelectItem>)}</SelectContent>
        </Select>

        <Select value={dmaFilter || "__all_dmas__"} onValueChange={(value) => setDmaFilter(value === "__all_dmas__" ? "" : value)} disabled={role === "dma_manager"}>
          <SelectTrigger className="h-10 w-auto rounded-xl px-3 text-xs font-medium"><SelectValue placeholder="All DMAs" /></SelectTrigger>
          <SelectContent><SelectItem value="__all_dmas__">All DMAs</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>{dmaOptions.map((dma) => <SelectItem key={dma.id} value={dma.id}>{dma.utilityName || utilityFilter ? dma.name : `${dma.name}${dma.utilityName ? ` · ${dma.utilityName}` : ""}`}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sensorFilter} onValueChange={setSensorFilter}>
          <SelectTrigger aria-label="Filter storage facilities by installed sensors" className="h-10 w-auto rounded-xl px-3 text-xs font-medium"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sensor configurations</SelectItem><SelectItem value="with_sensors">With sensors</SelectItem><SelectItem value="without_sensors">Without sensors</SelectItem><SelectItem value="water_quality">With water-quality sensor</SelectItem><SelectItem value="water_level">With water-level sensor</SelectItem><SelectItem value="water_quality_only">Water-quality sensor only</SelectItem><SelectItem value="water_level_only">Water-level sensor only</SelectItem><SelectItem value="both">Both sensor types</SelectItem>
          </SelectContent>
        </Select>

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
            const { storageFacility, representative, sensors } = group
            const latestReadingFor = (category: SensorCategory) => sensors
              .filter((sensor) => sensor.category === category && sensor.lastReading)
              .sort((a, b) => new Date(b.lastReading!.occurredAt).getTime() - new Date(a.lastReading!.occurredAt).getTime())[0] ?? null
            const levelSensor = latestReadingFor("water_level")
            const qualitySensor = latestReadingFor("water_quality")
            const levelReading = levelSensor?.lastReading ?? null
            const qualityReading = qualitySensor?.lastReading ?? null
            const waterLevel = typeof levelReading?.waterLevelM === "number" && Number.isFinite(levelReading.waterLevelM)
              ? levelReading.waterLevelM
              : null
            const qualitySummary = hasQualityData(qualityReading?.parameters) ? wqHeadline(qualityReading?.parameters) : null
            const qualityHeadline = qualitySummary && qualitySummary !== "—" ? qualitySummary : null
            const lastReadingAt = sensors
              .map((sensor) => sensor.lastReading?.occurredAt)
              .filter((value): value is string => Boolean(value))
              .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
            const capacity = configuredFacilityHeight(levelSensor, readStoredStorageFacilityLength(storageFacility.id))
            const percent = waterLevel !== null && capacity !== null ? fillPercent(waterLevel, capacity) : null
            const rawFillPercent = waterLevel !== null && capacity !== null ? (waterLevel / capacity) * 100 : null
            const exceedsReferenceHeight = rawFillPercent !== null && rawFillPercent > 100
            const status = displaySensorStatus(representative?.status, storageFacility.status)
            const utilityName = utilities.find((utility) => utility.id === storageFacility.utilityId)?.name ?? null
            const dmaName = storageFacility.dmaId
              ? dmas.find((dma) => dma.id === storageFacility.dmaId)?.name ?? null
              : null

            return (
              <Card
                key={storageFacility.id}
                onClick={() => openStorageFacility(storageFacility.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    openStorageFacility(storageFacility.id)
                  }
                }}
                className="utility-directory-card group cursor-pointer overflow-hidden rounded-[22px] transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-700/35 dark:focus-visible:ring-cyan-300/30"
              >
                <CardContent className="flex h-full flex-col p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <InfrastructureIcon assetType="storage_facilities" className="h-7 w-7 shrink-0 text-cyan-700 dark:text-cyan-300" />
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold tracking-tight text-slate-800 dark:text-slate-100">
                          {storageFacility.name || storageFacility.sourceKey}
                        </h3>
                        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" />
                          <span className="truncate">{dmaName || "Unassigned DMA"}</span>
                        </p>
                      </div>
                    </div>
                    <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold", status.tone)}>
                      {status.label}
                    </span>
                  </div>

                  <div className="mt-4 grid min-h-[64px] grid-cols-2 gap-2">
                    {waterLevel !== null && (
                      <div className="storage-facility-metric">
                        <Waves className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                        <span className="storage-facility-metric__label">Water level</span>
                        <strong className="storage-facility-metric__value">{waterLevel.toFixed(2)} m</strong>
                      </div>
                    )}
                    {capacity !== null && (
                      <div className="storage-facility-metric">
                        <Gauge className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        <span className="storage-facility-metric__label">Reference height</span>
                        <strong className="storage-facility-metric__value">{capacity.toFixed(2)} m</strong>
                      </div>
                    )}
                    {qualityHeadline && (
                      <div className={cn("storage-facility-metric", waterLevel === null && capacity === null && "storage-facility-metric--wide")}>
                        <FlaskConical className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                        <span className="storage-facility-metric__label">Water quality</span>
                        <strong className="storage-facility-metric__value truncate">{qualityHeadline}</strong>
                      </div>
                    )}
                    {waterLevel === null && capacity === null && !qualityHeadline && (
                      <div className="storage-facility-no-data col-span-2">
                        <span>No reading data</span>
                      </div>
                    )}
                  </div>

                  {waterLevel !== null && capacity !== null && percent !== null && rawFillPercent !== null && (
                    <div className="storage-facility-fill mt-3" aria-label="Water level compared with reference height">
                      <div className="storage-facility-fill__heading">
                        <span>Level vs reference height</span>
                        <strong>{exceedsReferenceHeight ? "Above reference" : `${Math.round(rawFillPercent)}%`}</strong>
                      </div>
                      <div
                        className="storage-facility-fill__track"
                        role="progressbar"
                        aria-label="Water level compared with reference height"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        aria-valuetext={`${waterLevel.toFixed(2)} meters of ${capacity.toFixed(2)} meters${exceedsReferenceHeight ? ", above reference height" : ""}`}
                      >
                        <div
                          className={cn("storage-facility-fill__value", exceedsReferenceHeight && "storage-facility-fill__value--over")}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className="storage-facility-fill__scale">
                        <span>{waterLevel.toFixed(2)} m of {capacity.toFixed(2)} m</span>
                        <span>reference height</span>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-300/70 pt-3 text-xs dark:border-slate-700/80">
                    <div className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" />
                      <span className="truncate">{utilityName || "Unassigned utility"}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" />
                      <span className="truncate">{dmaName || "No DMA assigned"}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Clock3 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{lastReadingAt ? `Synced ${formatRelativeTime(lastReadingAt, now)}` : "No sync data"}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Activity className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{group.readingCount !== null ? `${group.readingCount.toLocaleString()} readings` : "No reading count"}</span>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-slate-300/70 pt-3 dark:border-slate-700/80">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {group.sensorCount} sensor{group.sensorCount === 1 ? "" : "s"}
                      {group.activeSensorCount > 0 ? ` · ${group.activeSensorCount} active` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-800 transition-colors group-hover:text-cyan-950 dark:text-cyan-300 dark:group-hover:text-cyan-100">
                      View details <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

    </div>
  )
}

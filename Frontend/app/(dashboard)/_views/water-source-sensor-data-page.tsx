"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, ArrowLeft, Droplets, MapPin, Search, Waves } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"

export default function WaterSourceSensorDataPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { sensors, waterSources, dmas, utilities, fetchSensors, fetchWaterSources, fetchDMAs, fetchUtilities } = useDataStore()
  const [search, setSearch] = useState("")
  const [utilityFilter, setUtilityFilter] = useState("")
  const [dmaFilter, setDmaFilter] = useState("")
  const [sensorFilter, setSensorFilter] = useState("all")

  useEffect(() => {
    void fetchSensors()
    void fetchWaterSources()
    void fetchDMAs()
    void fetchUtilities()
  }, [fetchSensors, fetchWaterSources, fetchDMAs, fetchUtilities])

  const groups = useMemo(
    () => waterSources.map((source) => {
      const sourceSensors = sensors.filter((sensor) =>
        sensor.assetType === "water_source" && sensor.waterSourceId === source.id
      )
      const latest = sourceSensors
        .filter((sensor) => sensor.activated && sensor.lastReading)
        .sort((a, b) => new Date(b.lastReading!.occurredAt).getTime() - new Date(a.lastReading!.occurredAt).getTime())[0]
      return { source, sourceSensors, latest }
    }).sort((a, b) =>
      (a.source.name || a.source.sourceKey).localeCompare(b.source.name || b.source.sourceKey, undefined, { sensitivity: "base" })
    ),
    [sensors, waterSources]
  )

  const canView = ["admin", "utility_manager", "dma_manager"].includes(currentUser?.role ?? "")
  const ownUtilityId = currentUser?.utilityId || dmas.find((dma) => dma.id === currentUser?.dmaId)?.utilityId
  const allowedUtilities = currentUser?.role === "admin" || !ownUtilityId
    ? utilities
    : utilities.filter((utility) => utility.id === ownUtilityId)
  const allowedDmas = dmas.filter((dma) => !utilityFilter || dma.utilityId === utilityFilter)
  const filteredGroups = groups.filter(({ source, sourceSensors }) => {
    if (utilityFilter && source.utilityId !== utilityFilter) return false
    if (dmaFilter === "unassigned" ? source.dmaId != null : dmaFilter && source.dmaId !== dmaFilter) return false
    const categories = new Set(sourceSensors.map((sensor) => sensor.category))
    if (sensorFilter === "with_sensors" && sourceSensors.length === 0) return false
    if (sensorFilter === "without_sensors" && sourceSensors.length > 0) return false
    if (sensorFilter === "water_quality" && !categories.has("water_quality")) return false
    if (sensorFilter === "water_level" && !categories.has("water_level")) return false
    if (sensorFilter === "water_quality_only" && (!categories.has("water_quality") || categories.has("water_level"))) return false
    if (sensorFilter === "water_level_only" && (!categories.has("water_level") || categories.has("water_quality"))) return false
    if (sensorFilter === "both" && !(categories.has("water_quality") && categories.has("water_level"))) return false
    const dmaName = dmas.find((dma) => dma.id === source.dmaId)?.name ?? "unassigned"
    const utilityName = utilities.find((utility) => utility.id === source.utilityId)?.name ?? ""
    const query = search.trim().toLocaleLowerCase()
    return !query || [source.name, source.sourceKey, dmaName, utilityName]
      .some((value) => value?.toLocaleLowerCase().includes(query))
  })

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Water Source Sensor Data"
        description="Live monitoring for boreholes, wells, intakes, and other water sources."
        actionLabel="Back to sensor data"
        actionIcon={ArrowLeft}
        onAction={() => router.push("/dashboard/sensor-data")}
      />
      {!canView ? (
        <Card><CardContent className="py-14 text-center text-sm text-slate-500">Access restricted.</CardContent></Card>
      ) : groups.length === 0 ? (
        <Card><CardContent className="py-14 text-center text-sm text-slate-500">
          No water sources are available yet. Upload a water-sources GeoPackage from Utility Infrastructure.
        </CardContent></Card>
      ) : (
        <>
        <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, DMA, or utility" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm" />
          </label>
          <select value={utilityFilter} onChange={(event) => { setUtilityFilter(event.target.value); setDmaFilter("") }} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" aria-label="Filter water sources by utility">
            <option value="">All utilities</option>
            {allowedUtilities.map((utility) => <option key={utility.id} value={utility.id}>{utility.name}</option>)}
          </select>
          <select value={dmaFilter} onChange={(event) => setDmaFilter(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" aria-label="Filter water sources by DMA">
            <option value="">All DMAs</option>
            <option value="unassigned">Unassigned DMA</option>
            {allowedDmas.map((dma) => <option key={dma.id} value={dma.id}>{dma.name}</option>)}
          </select>
          <select value={sensorFilter} onChange={(event) => setSensorFilter(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" aria-label="Filter water sources by installed sensors">
            <option value="all">All sensor configurations</option>
            <option value="with_sensors">With sensors</option>
            <option value="without_sensors">Without sensors</option>
            <option value="water_quality">With water-quality sensor</option>
            <option value="water_level">With water-level sensor</option>
            <option value="water_quality_only">Water-quality sensor only</option>
            <option value="water_level_only">Water-level sensor only</option>
            <option value="both">Both sensor types</option>
          </select>
        </div>
        {filteredGroups.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-slate-500">No water sources match these filters.</CardContent></Card>
        ) : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredGroups.map(({ source, sourceSensors, latest }) => {
            const reading = latest?.lastReading
            return (
              <Card
                key={source.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/dashboard/sensor-data/water-sources/${source.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") router.push(`/dashboard/sensor-data/water-sources/${source.id}`)
                }}
                className="cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-900">{source.name || source.sourceKey}</h2>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5" />
                        {source.dmaId ? dmas.find((dma) => dma.id === source.dmaId)?.name || "Unassigned DMA" : "Unassigned DMA"}
                      </p>
                      <p className="mt-1 text-xs capitalize text-slate-500">{source.sourceType?.replaceAll("_", " ") || "Water source"}</p>
                    </div>
                    <span className="rounded-xl bg-sky-50 p-2.5 text-sky-700"><Waves className="h-5 w-5" /></span>
                  </div>
                  <div className="mt-5 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500">Installed sensors</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-800">
                        <Activity className="h-4 w-4 text-cyan-600" /> {source.activeSensorCount} active · {sourceSensors.length} total
                      </p>
                    </div>
                    <div className="text-right">
                      {reading ? (
                        <>
                          <WaterStatusPill status={latest?.status ?? "inactive"} />
                          <p className="mt-1 text-xs text-slate-500">
                            {reading.category === "water_quality"
                              ? `${Object.keys(reading.parameters ?? {}).length} quality parameters`
                              : `Depth ${reading.depthM?.toFixed(2) ?? "—"} m`}
                          </p>
                        </>
                      ) : (
                        <p className="flex items-center gap-1 text-xs text-slate-400"><Droplets className="h-3.5 w-3.5" /> No readings yet</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
        }
        </>
      )}
      <Button variant="outline" className="w-fit" onClick={() => router.push("/dashboard/sensors")}>
        Manage all sensors
      </Button>
    </div>
  )
}

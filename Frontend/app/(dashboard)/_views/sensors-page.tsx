"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Droplets, FlaskConical, Loader2, Waves } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { apiClient } from "@/lib/api-client"
import { transformKeys } from "@/lib/transform-data"
import { useDataStore } from "@/store/data-store"

interface SimulatorPendingReading {
  occurredAt: string
  payload: Record<string, unknown>
}

interface SimulatorPendingSensor {
  deviceId: string
  category: "water_level" | "water_quality"
  assetType: "storage_facility" | "water_source"
  utilityName: string
  dmaName: string
  pendingReadingCount: number
  latestReading: SimulatorPendingReading | null
  recentReadings: SimulatorPendingReading[]
}

const simulatorMeasurementLabels: Record<string, string> = {
  depthM: "Depth",
  temperatureC: "Temperature",
  ph: "pH",
  ecUsCm: "Conductivity",
  doMgl: "Dissolved oxygen",
  doPctSat: "Oxygen saturation",
  turbidityNtu: "Turbidity",
  orpMv: "ORP",
  freeChlorineMgl: "Free chlorine",
  nitrateMgl: "Nitrate",
  ammoniaMgl: "Ammonia",
  phosphateMgl: "Phosphate",
  chlorophyllUgl: "Chlorophyll",
  phycocyaninUgl: "Phycocyanin",
  pressure: "Pressure",
}

const simulatorMeasurementUnits: Record<string, string> = {
  depthM: "m",
  temperatureC: "°C",
  ecUsCm: "µS/cm",
  doMgl: "mg/L",
  doPctSat: "%",
  turbidityNtu: "NTU",
  orpMv: "mV",
  freeChlorineMgl: "mg/L",
  nitrateMgl: "mg/L",
  ammoniaMgl: "mg/L",
  phosphateMgl: "mg/L",
  chlorophyllUgl: "µg/L",
  phycocyaninUgl: "µg/L",
  pressure: "kPa",
}

function getSimulatorMeasurements(payload: Record<string, unknown>) {
  return Object.entries(payload).filter(
    (entry): entry is [string, number] =>
      entry[0] !== "deviceId" &&
      entry[0] !== "occurredAt" &&
      typeof entry[1] === "number"
  )
}

function formatSimulatorMeasurement(key: string, value: number) {
  const label = simulatorMeasurementLabels[key] || key
  const unit = simulatorMeasurementUnits[key] ? ` ${simulatorMeasurementUnits[key]}` : ""
  return `${label}: ${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit}`
}

export default function SensorsPage() {
  const {
    sensors,
    storageFacilities,
    waterSources,
    utilities,
    dmas,
    fetchSensors,
    fetchStorageFacilities,
    fetchWaterSources,
    fetchUtilities,
    fetchDMAs,
  } = useDataStore()

  const [assetFilter, setAssetFilter] = useState<"all" | "water_source" | "storage_facility">("all")
  const [categoryFilter, setCategoryFilter] = useState<"all" | "water_level" | "water_quality">("all")
  const [deviceIdFilter, setDeviceIdFilter] = useState("")
  const [assetNameFilter, setAssetNameFilter] = useState("")
  const [utilityFilter, setUtilityFilter] = useState("")
  const [dmaFilter, setDmaFilter] = useState("")
  const [simulatorDevices, setSimulatorDevices] = useState<SimulatorPendingSensor[]>([])
  const [simulatorLoading, setSimulatorLoading] = useState(true)
  const [simulatorError, setSimulatorError] = useState<string | null>(null)

  useEffect(() => {
    void fetchSensors()
    void fetchStorageFacilities()
    void fetchWaterSources()
    void fetchUtilities()
    void fetchDMAs()
  }, [fetchSensors, fetchStorageFacilities, fetchWaterSources, fetchUtilities, fetchDMAs])

  const fetchSimulatorDevices = useCallback(async () => {
    try {
      const response = await apiClient.get("/sensors/simulator-pending", { skipCache: true })
      if (!response.success || !response.data) {
        throw new Error(response.error || "Could not load simulator sensor readings.")
      }
      const result = transformKeys(response.data) as { items?: SimulatorPendingSensor[] }
      setSimulatorDevices(result.items || [])
      setSimulatorError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load simulator sensor readings."
      setSimulatorError(message)
      console.error("Error fetching simulator sensor readings:", error)
    } finally {
      setSimulatorLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSimulatorDevices()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchSimulatorDevices()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [fetchSimulatorDevices])

  const utilityNameById = useMemo(() => new Map(utilities.map((u) => [u.id, u.name])), [utilities])
  const dmaNameById = useMemo(() => new Map(dmas.map((d) => [d.id, d.name])), [dmas])
  const visibleSensors = useMemo(
    () => sensors.filter((sensor) => {
      if (assetFilter !== "all" && sensor.assetType !== assetFilter) return false
      if (categoryFilter !== "all" && sensor.category !== categoryFilter) return false
      if (utilityFilter && sensor.utilityId !== utilityFilter) return false
      if (dmaFilter === "unassigned" ? Boolean(sensor.dmaId) : dmaFilter && sensor.dmaId !== dmaFilter) return false
      const deviceQuery = deviceIdFilter.trim().toLocaleLowerCase()
      if (deviceQuery && !sensor.deviceId.toLocaleLowerCase().includes(deviceQuery)) return false
      const nameQuery = assetNameFilter.trim().toLocaleLowerCase()
      if (nameQuery) {
        const parentName = sensor.assetType === "water_source"
          ? waterSources.find((source) => source.id === sensor.waterSourceId)?.name || sensor.waterSourceName || sensor.parentAssetName
          : storageFacilities.find((facility) => facility.id === sensor.storageFacilityId)?.name || sensor.storageFacilityName || sensor.parentAssetName
        if (!parentName?.toLocaleLowerCase().includes(nameQuery)) return false
      }
      return true
    }),
    [assetFilter, assetNameFilter, categoryFilter, deviceIdFilter, dmaFilter, sensors, storageFacilities, utilityFilter, waterSources]
  )

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Sensor Management"
        description="View live and buffered readings from sensors linked to water sources and storage facilities."
      />

      <Card className="border-cyan-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Simulator sensors · AUWSA / Nambala</h2>
              <p className="mt-1 text-sm text-slate-500">
                Automatically refreshed readings from four devices. Buffered readings appear here until the mobile app links each device to an asset.
              </p>
            </div>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
              Buffered · awaiting device link
            </span>
          </div>

          {simulatorError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Simulator readings could not be loaded: {simulatorError}
            </p>
          )}
          {simulatorLoading && simulatorDevices.length === 0 && (
            <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading sensor readings…
            </div>
          )}
          {!simulatorLoading && !simulatorError && simulatorDevices.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">
              No buffered simulator sensors are available for this account.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {simulatorDevices.map((device) => (
              <section key={device.deviceId} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{device.deviceId}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    device.category === "water_quality" ? "bg-cyan-50 text-cyan-700" : "bg-emerald-50 text-emerald-700"
                  }`}>
                    {device.category === "water_quality" ? "Water quality" : "Water level"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Intended for {device.assetType === "water_source" ? "a water source" : "a storage facility"} · {device.pendingReadingCount.toLocaleString()} buffered readings
                </p>
                {device.latestReading ? (
                  <>
                    <p className="mt-3 text-xs text-slate-500">
                      Latest: {new Date(device.latestReading.occurredAt).toLocaleString()}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {getSimulatorMeasurements(device.latestReading.payload).map(([key, value]) => (
                        <span key={key} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                          {formatSimulatorMeasurement(key, value)}
                        </span>
                      ))}
                    </div>
                    <details className="mt-3 border-t border-slate-200 pt-3">
                      <summary className="cursor-pointer text-xs font-medium text-cyan-700">
                        Recent readings ({device.recentReadings.length})
                      </summary>
                      <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                        {device.recentReadings.map((reading, index) => (
                          <div key={`${reading.occurredAt}-${index}`} className="rounded-md bg-white p-2">
                            <p className="text-[11px] text-slate-500">{new Date(reading.occurredAt).toLocaleString()}</p>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                              {getSimulatorMeasurements(reading.payload).map(([key, value]) => (
                                <span key={key} className="text-xs text-slate-700">
                                  {formatSimulatorMeasurement(key, value)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No buffered readings yet.</p>
                )}
              </section>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-500">{visibleSensors.length} sensor{visibleSensors.length === 1 ? "" : "s"}</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <input
            value={deviceIdFilter}
            onChange={(event) => setDeviceIdFilter(event.target.value)}
            placeholder="Filter by device ID"
            aria-label="Filter sensors by device ID"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
          <input
            value={assetNameFilter}
            onChange={(event) => setAssetNameFilter(event.target.value)}
            placeholder="Filter by asset name"
            aria-label="Filter sensors by parent asset name"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
          <select value={utilityFilter} onChange={(event) => { setUtilityFilter(event.target.value); setDmaFilter("") }} aria-label="Filter sensors by utility" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <option value="">All utilities</option>
            {utilities.map((utility) => <option key={utility.id} value={utility.id}>{utility.name}</option>)}
          </select>
          <select value={dmaFilter} onChange={(event) => setDmaFilter(event.target.value)} aria-label="Filter sensors by DMA" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <option value="">All DMAs</option>
            <option value="unassigned">Unassigned DMA</option>
            {dmas.filter((dma) => !utilityFilter || dma.utilityId === utilityFilter).map((dma) => <option key={dma.id} value={dma.id}>{dma.name}</option>)}
          </select>
          <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value as typeof assetFilter)} aria-label="Filter sensors by parent asset type" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All parent types</option>
            <option value="water_source">Water-source sensors</option>
            <option value="storage_facility">Storage-facility sensors</option>
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)} aria-label="Filter sensors by category" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All categories</option>
            <option value="water_level">Water-level sensors</option>
            <option value="water_quality">Water-quality sensors</option>
          </select>
        </div>
      </div>

      <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="px-6 py-4">Device ID</TableHead>
                <TableHead className="px-6 py-4">Category</TableHead>
                <TableHead className="px-6 py-4">Parent type</TableHead>
                <TableHead className="px-6 py-4">Attached to</TableHead>
                <TableHead className="px-6 py-4">Utility</TableHead>
                <TableHead className="px-6 py-4">DMA</TableHead>
                <TableHead className="px-6 py-4">Status</TableHead>
                <TableHead className="px-6 py-4">Last reading</TableHead>
                <TableHead className="px-6 py-4">Activation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSensors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="px-6 py-16 text-center text-sm text-slate-500">
                    {sensors.length === 0 ? "No linked sensors are available yet." : "No sensors match the selected filters."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleSensors.map((sensor) => {
                  const storageFacility = storageFacilities.find((t) => t.id === sensor.storageFacilityId)
                  const waterSource = waterSources.find((source) => source.id === sensor.waterSourceId)
                  return (
                    <TableRow key={sensor.id}>
                      <TableCell className="px-6 py-4">
                        <span className="flex items-center gap-2 font-medium text-slate-800">
                          <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                          {sensor.deviceId}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          sensor.category === "water_quality"
                            ? "bg-cyan-50 text-cyan-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}>
                          {sensor.category === "water_quality" ? (
                            <FlaskConical className="h-3 w-3" />
                          ) : (
                            <Waves className="h-3 w-3" />
                          )}
                          {sensor.category === "water_quality" ? "Quality" : "Level"}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {sensor.assetType === "water_source" ? "Water source" : "Storage facility"}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {sensor.assetType === "water_source"
                          ? waterSource?.name || waterSource?.sourceKey || sensor.waterSourceName || sensor.waterSourceId
                          : storageFacility?.name || storageFacility?.sourceKey || sensor.storageFacilityName || sensor.storageFacilityId}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {utilityNameById.get(sensor.utilityId) || "—"}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {sensor.dmaId ? dmaNameById.get(sensor.dmaId) || "—" : "Unassigned"}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <WaterStatusPill status={sensor.status} />
                      </TableCell>
                      <TableCell className="px-6 py-4 text-xs text-slate-500">
                        {sensor.lastReading
                          ? sensor.lastReading.category === "water_quality"
                            ? `${Object.values(sensor.lastReading.parameters ?? {}).length} param(s) · ${sensor.lastReading.occurredAt}`
                            : `${(sensor.lastReading.waterLevelM ?? 0).toFixed(2)} m · ${sensor.lastReading.occurredAt}`
                          : "No readings"}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${sensor.activated ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                          {sensor.activated ? "Active" : "Inactive"}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Droplets, FlaskConical, Loader2, Pencil, Power, Trash2, Waves } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/page-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
import { RegisterWaterSourceSensorModal } from "@/components/water-level/register-water-source-sensor-modal"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorSnap } from "@/store/data-store"

export default function SensorsPage() {
  const { currentUser } = useAuthStore()
  const role = currentUser?.role
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
    updateSensor,
    deleteSensor,
    updateStorageFacilityStatus,
    updateWaterSourceStatus,
  } = useDataStore()

  const [editTarget, setEditTarget] = useState<SensorSnap | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SensorSnap | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busyDevice, setBusyDevice] = useState<string | null>(null)
  const [assetFilter, setAssetFilter] = useState<"all" | "water_source" | "storage_facility">("all")
  const [categoryFilter, setCategoryFilter] = useState<"all" | "water_level" | "water_quality">("all")
  const [deviceIdFilter, setDeviceIdFilter] = useState("")
  const [assetNameFilter, setAssetNameFilter] = useState("")
  const [utilityFilter, setUtilityFilter] = useState("")
  const [dmaFilter, setDmaFilter] = useState("")

  const isAdmin = role === "admin"
  const isUtilityManager = role === "utility_manager"
  const canManage = isAdmin || isUtilityManager

  useEffect(() => {
    void fetchSensors()
    void fetchStorageFacilities()
    void fetchWaterSources()
    void fetchUtilities()
    void fetchDMAs()
  }, [fetchSensors, fetchStorageFacilities, fetchWaterSources, fetchUtilities, fetchDMAs])

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

  const handleActivateToggle = async (sensor: SensorSnap) => {
    setBusyDevice(sensor.deviceId)
    try {
      await updateSensor(sensor.deviceId, { activated: !sensor.activated })
      toast.success(sensor.activated ? "Sensor deactivated." : "Sensor activated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle sensor state.")
    } finally {
      setBusyDevice(null)
    }
  }

  const handleStorageFacilityToggle = async (sensor: SensorSnap) => {
    setBusyDevice(sensor.deviceId)
    const storageFacility = storageFacilities.find((t) => t.id === sensor.storageFacilityId)
    if (!storageFacility) {
      setBusyDevice(null)
      return
    }
    const next = storageFacility.status === "deactivated" ? "active" : "deactivated"
    try {
      await updateStorageFacilityStatus(storageFacility.id, next)
      toast.success(next === "active" ? "Storage facility activated." : "Storage facility deactivated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle storage facility status.")
    } finally {
      setBusyDevice(null)
    }
  }

  const handleWaterSourceToggle = async (sensor: SensorSnap) => {
    setBusyDevice(sensor.deviceId)
    const source = waterSources.find((item) => item.id === sensor.waterSourceId)
    if (!source) {
      setBusyDevice(null)
      return
    }
    const next = source.status === "deactivated" ? "active" : "deactivated"
    try {
      await updateWaterSourceStatus(source.id, next)
      toast.success(next === "active" ? "Water source activated." : "Water source deactivated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update water source.")
    } finally {
      setBusyDevice(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSensor(deleteTarget.deviceId)
      toast.success("Sensor deleted.")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete sensor.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Sensor Management"
        description="Manage sensors attached to either water sources or storage facilities. Each sensor remains in its dedicated registry."
      />

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
                <TableHead className="px-6 py-4">Activated</TableHead>
                <TableHead className="px-6 py-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSensors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="px-6 py-16 text-center text-sm text-slate-500">
                    {sensors.length === 0 ? "No sensors registered yet." : "No sensors match the selected filters."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleSensors.map((sensor) => {
                  const storageFacility = storageFacilities.find((t) => t.id === sensor.storageFacilityId)
                  const waterSource = waterSources.find((source) => source.id === sensor.waterSourceId)
                  const busy = busyDevice === sensor.deviceId
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
                        <Switch
                          checked={sensor.activated}
                          onCheckedChange={() => canManage && void handleActivateToggle(sensor)}
                          disabled={!canManage || busy}
                        />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditTarget(sensor)
                                  setModalOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4 text-slate-500" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void (sensor.assetType === "water_source"
                                  ? handleWaterSourceToggle(sensor)
                                  : handleStorageFacilityToggle(sensor))}
                                disabled={busy}
                                title={sensor.assetType === "water_source"
                                  ? waterSource?.status === "deactivated" ? "Activate water source" : "Deactivate water source"
                                  : storageFacility?.status === "deactivated" ? "Activate storage facility" : "Deactivate storage facility"}
                              >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Power className="h-4 w-4 text-slate-500" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeleteTarget(sensor)}
                                className="hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4 text-slate-500" />
                              </Button>
                            </>
                          )}
                          {!canManage && (
                            <Activity className="h-4 w-4 text-slate-300" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RegisterSensorModal
        open={modalOpen && editTarget?.assetType !== "water_source"}
        onOpenChange={(open) => {
          setModalOpen(open)
          if (!open) setEditTarget(null)
        }}
        sensor={editTarget}
      />
      <RegisterWaterSourceSensorModal
        open={modalOpen && editTarget?.assetType === "water_source"}
        onOpenChange={(open) => {
          if (!open) {
            setModalOpen(false)
            setEditTarget(null)
          }
        }}
        sensor={editTarget?.assetType === "water_source" ? editTarget : null}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete sensor?"
        description={`This permanently deletes sensor "${deleteTarget?.deviceId}" and all of its readings. This cannot be undone.`}
        confirmLabel="Delete sensor"
        variant="destructive"
        isLoading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
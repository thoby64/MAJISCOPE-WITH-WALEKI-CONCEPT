"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Droplets, Loader2, Pencil, Power, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/page-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type SensorSnap } from "@/store/data-store"

export default function SensorsPage() {
  const { currentUser } = useAuthStore()
  const role = currentUser?.role
  const {
    sensors,
    tanks,
    utilities,
    dmas,
    fetchSensors,
    fetchTanks,
    fetchUtilities,
    fetchDMAs,
    updateSensor,
    deleteSensor,
    updateTankStatus,
  } = useDataStore()

  const [editTarget, setEditTarget] = useState<SensorSnap | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SensorSnap | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busyDevice, setBusyDevice] = useState<string | null>(null)

  const isAdmin = role === "admin"
  const isUtilityManager = role === "utility_manager"
  const canManage = isAdmin || isUtilityManager

  useEffect(() => {
    void fetchSensors()
    void fetchTanks()
    void fetchUtilities()
    void fetchDMAs()
  }, [fetchSensors, fetchTanks, fetchUtilities, fetchDMAs])

  const utilityNameById = useMemo(() => new Map(utilities.map((u) => [u.id, u.name])), [utilities])
  const dmaNameById = useMemo(() => new Map(dmas.map((d) => [d.id, d.name])), [dmas])

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

  const handleTankToggle = async (sensor: SensorSnap) => {
    setBusyDevice(sensor.deviceId)
    const tank = tanks.find((t) => t.id === sensor.tankId)
    if (!tank) return
    const next = tank.status === "deactivated" ? "active" : "deactivated"
    try {
      await updateTankStatus(tank.id, next)
      toast.success(next === "active" ? "Tank activated." : "Tank deactivated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle tank status.")
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sensor Management"
        description="Edit and manage water-level sensors across tanks. New sensors are registered on the Water Level page."
      />

      <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="px-6 py-4">Device ID</TableHead>
                <TableHead className="px-6 py-4">Tank</TableHead>
                <TableHead className="px-6 py-4">Utility</TableHead>
                <TableHead className="px-6 py-4">DMA</TableHead>
                <TableHead className="px-6 py-4">Status</TableHead>
                <TableHead className="px-6 py-4">Last reading</TableHead>
                <TableHead className="px-6 py-4">Activated</TableHead>
                <TableHead className="px-6 py-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sensors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="px-6 py-16 text-center text-sm text-slate-500">
                    No sensors registered yet.
                  </TableCell>
                </TableRow>
              ) : (
                sensors.map((sensor) => {
                  const tank = tanks.find((t) => t.id === sensor.tankId)
                  const busy = busyDevice === sensor.deviceId
                  return (
                    <TableRow key={sensor.id}>
                      <TableCell className="px-6 py-4">
                        <span className="flex items-center gap-2 font-medium text-slate-800">
                          <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                          {sensor.deviceId}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-sm text-slate-600">
                        {tank?.name || tank?.sourceKey || sensor.tankName || sensor.tankId}
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
                          ? `${sensor.lastReading.waterLevelM.toFixed(2)} m · ${sensor.lastReading.occurredAt}`
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
                                onClick={() => void handleTankToggle(sensor)}
                                disabled={busy}
                                title={tank?.status === "deactivated" ? "Activate tank" : "Deactivate tank"}
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
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open)
          if (!open) setEditTarget(null)
        }}
        sensor={editTarget}
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
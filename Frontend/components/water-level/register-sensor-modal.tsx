"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type RegisterSensorInput, type SensorSnap } from "@/store/data-store"

interface RegisterSensorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTankId?: string
  sensor?: SensorSnap | null
}

export function RegisterSensorModal({ open, onOpenChange, defaultTankId, sensor }: RegisterSensorModalProps) {
  const { currentUser } = useAuthStore()
  const { tanks, fetchTanks, registerSensor, updateSensor } = useDataStore()

  const role = currentUser?.role
  const isEdit = Boolean(sensor)

  const [deviceId, setDeviceId] = useState("")
  const [tankId, setTankId] = useState("")
  const [h1M, setH1M] = useState("")
  const [depthM, setDepthM] = useState("")
  const [warningHeightM, setWarningHeightM] = useState("")
  const [criticalHeightM, setCriticalHeightM] = useState("")
  const [activated, setActivated] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    setDialogOpen(open)
  }, [open])

  useEffect(() => {
    if (!open) return
    void fetchTanks()
    if (sensor) {
      setDeviceId(sensor.deviceId)
      setTankId(sensor.tankId)
      setH1M(sensor.h1M != null ? String(sensor.h1M) : "")
      setDepthM(sensor.depthM != null ? String(sensor.depthM) : "")
      setWarningHeightM(sensor.warningHeightM != null ? String(sensor.warningHeightM) : "")
      setCriticalHeightM(sensor.criticalHeightM != null ? String(sensor.criticalHeightM) : "")
      setActivated(sensor.activated)
    } else {
      setDeviceId("")
      setTankId(defaultTankId ?? "")
      setH1M("")
      setDepthM("")
      setWarningHeightM("")
      setCriticalHeightM("")
      setActivated(true)
    }
  }, [open, sensor, defaultTankId, fetchTanks])

  const scopedTanks = useMemo(() => {
    if (!tanks.length) return []
    if (role === "admin") return tanks
    const myUtility = currentUser?.utilityId
    return myUtility ? tanks.filter((t) => t.utilityId === myUtility) : tanks
  }, [currentUser?.utilityId, role, tanks])

  const selectedTankName = useMemo(() => {
    const tank = scopedTanks.find((t) => t.id === tankId)
    return tank ? (tank.name || tank.sourceKey) : ""
  }, [scopedTanks, tankId])

  const tankHasActivatedSensor = (tankId: string) => {
    const { sensors } = useDataStore.getState()
    return sensors.some((s) => s.tankId === tankId && s.activated)
  }

  const parseOptional = (raw: string): number | undefined => {
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) ? value : undefined
  }

  const handleSave = async () => {
    setConfirmOpen(false)
    setSaving(true)
    try {
      const payload: RegisterSensorInput = {
        device_id: deviceId.trim(),
        tank_id: tankId,
        h1_m: parseOptional(h1M),
        depth_m: parseOptional(depthM),
        warning_height_m: parseOptional(warningHeightM),
        critical_height_m: parseOptional(criticalHeightM),
        activated,
      }
      if (isEdit && sensor) {
        await updateSensor(sensor.deviceId, {
          tank_id: tankId,
          h1_m: payload.h1_m,
          depth_m: payload.depth_m,
          warning_height_m: payload.warning_height_m,
          critical_height_m: payload.critical_height_m,
          activated,
        })
        toast.success("Sensor updated.")
      } else {
        const created = await registerSensor(payload)
        const promoted = created?.promotedReadings ?? 0
        if (promoted > 0) {
          toast.success(`Sensor registered. ${promoted} historical reading${promoted === 1 ? "" : "s"} attached.`)
        } else {
          toast.success("Sensor registered.")
        }
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save sensor.")
    } finally {
      setSaving(false)
    }
  }

  const confirmDescription = isEdit ? (
    <span>
      You are updating sensor <strong className="text-slate-900">"{sensor?.deviceId}"</strong>.
      Please verify the details below are correct.
    </span>
  ) : (
    <span>
      You are registering a new sensor. Please verify the <strong className="text-amber-700">Device ID</strong> matches
      the physical sensor planted (or to be planted) in the field.
    </span>
  )

  return (
    <>
      <Dialog open={dialogOpen} onOpenChange={(nextOpen) => {
        setDialogOpen(nextOpen)
        if (!nextOpen) {
          setConfirmOpen(false)
          onOpenChange(false)
        }
      }}>
        <DialogContent className="bg-white/95 backdrop-blur-xl border-slate-200/50 shadow-2xl rounded-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">{isEdit ? "Edit sensor" : "Register sensor"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the sensor configuration and tank assignment."
                : "Connect a water-level sensor to a tank."}
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-amber-200 bg-amber-50/80">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800 text-sm font-semibold">Verify Device ID</AlertTitle>
            <AlertDescription className="text-amber-700 text-xs">
              Double-check that the Device ID below exactly matches the ID printed on the physical sensor
              planted (or to be planted) in the field. A wrong ID will link readings to the wrong tank.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="device-id">Device ID</Label>
              <Input
                id="device-id"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="e.g. tl-001-42"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="tank-id">Tank</Label>
              <select
                id="tank-id"
                value={tankId}
                onChange={(e) => setTankId(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 text-sm focus:border-cyan-400 focus:outline-none"
              >
                <option value="">Select a tank…</option>
                {scopedTanks.map((tank) => (
                  <option key={tank.id} value={tank.id}>
                    {tank.name || tank.sourceKey}{tankHasActivatedSensor(tank.id) ? " (sensor attached)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="h1">Sensor hanging (h1, m)</Label>
                <Input id="h1" type="number" min="0" step="0.1" value={h1M} onChange={(e) => setH1M(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="depth">Depth (m)</Label>
                <Input id="depth" type="number" min="0" step="0.1" value={depthM} onChange={(e) => setDepthM(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="warning">Warning height (m)</Label>
                <Input id="warning" type="number" min="0" step="0.1" value={warningHeightM} onChange={(e) => setWarningHeightM(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="critical">Critical height (m)</Label>
                <Input id="critical" type="number" min="0" step="0.1" value={criticalHeightM} onChange={(e) => setCriticalHeightM(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200/80 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Activated</p>
                <p className="text-xs text-slate-500">Only activated sensors produce live readings.</p>
              </div>
              <Switch checked={activated} onCheckedChange={setActivated} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); onOpenChange(false) }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => {
              if (!deviceId.trim() || !tankId) {
                toast.error("Device ID and tank are required.")
                return
              }
              setDialogOpen(false); setConfirmOpen(true)
            }} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Register sensor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(nextOpen) => {
          setConfirmOpen(nextOpen)
          if (!nextOpen) setDialogOpen(true)
        }}
        title={isEdit ? "Confirm sensor update" : "Confirm sensor registration"}
        description={confirmDescription}
        confirmLabel={isEdit ? "Save changes" : "Register sensor"}
        cancelLabel="Go back"
        onConfirm={() => void handleSave()}
        variant="default"
        isLoading={saving}
      >
        <div className="mx-6 mb-2 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Device ID</span>
            <span className="font-mono font-semibold text-slate-800">{deviceId.trim() || "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Tank</span>
            <span className="font-medium text-slate-800">{selectedTankName || "—"}</span>
          </div>
          <div className="border-t border-slate-200/80" />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">h1</span>
              <span className="text-slate-800">{h1M ? `${h1M} m` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Depth</span>
              <span className="text-slate-800">{depthM ? `${depthM} m` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Warning</span>
              <span className="text-slate-800">{warningHeightM ? `${warningHeightM} m` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Critical</span>
              <span className="text-slate-800">{criticalHeightM ? `${criticalHeightM} m` : "—"}</span>
            </div>
          </div>
          <div className="border-t border-slate-200/80" />
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Activated</span>
            <span className={`font-medium ${activated ? "text-emerald-600" : "text-slate-400"}`}>
              {activated ? "Yes" : "No"}
            </span>
          </div>
        </div>
      </ConfirmDialog>
    </>
  )
}

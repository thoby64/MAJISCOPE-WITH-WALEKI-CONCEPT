"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, FlaskConical, Loader2, Waves } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { TankCombobox } from "@/components/water-level/tank-combobox"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type RegisterSensorInput, type SensorCategory, type SensorSnap } from "@/store/data-store"

interface RegisterSensorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTankId?: string
  sensor?: SensorSnap | null
}

function configValue(config: Record<string, unknown>, snakeCaseKey: string): unknown {
  const camelCaseKey = snakeCaseKey.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return config[camelCaseKey] ?? config[snakeCaseKey]
}

export function RegisterSensorModal({ open, onOpenChange, defaultTankId, sensor }: RegisterSensorModalProps) {
  const { currentUser } = useAuthStore()
  const { tanks, dmas, fetchTanks, fetchSensor, fetchDMAs, registerSensor, updateSensor, detectSensorDma } = useDataStore()

  const role = currentUser?.role
  const isEdit = Boolean(sensor)

  const [deviceId, setDeviceId] = useState("")
  const [tankId, setTankId] = useState("")
  const [category, setCategory] = useState<SensorCategory>("water_level")
  const [h1M, setH1M] = useState("")
  const [depthM, setDepthM] = useState("")
  const [warningHeightM, setWarningHeightM] = useState("")
  const [criticalHeightM, setCriticalHeightM] = useState("")
  const [phWarnBelow, setPhWarnBelow] = useState("")
  const [turbWarnAbove, setTurbWarnAbove] = useState("")
  const [chlorineWarnAbove, setChlorineWarnAbove] = useState("")
  const [nitrateWarnAbove, setNitrateWarnAbove] = useState("")
  const [activated, setActivated] = useState(true)
  const [dmaId, setDmaId] = useState("")
  const [detectedDmaId, setDetectedDmaId] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [loadingSensor, setLoadingSensor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    setDialogOpen(open)
  }, [open])

  useEffect(() => {
    let cancelled = false
    if (!open) return
    if (!tanks.length) void fetchTanks()
    if (sensor) {
      setLoadingSensor(true)
      void fetchSensor(sensor.deviceId)
        .then((liveSensor) => {
          if (cancelled) return
          setDeviceId(liveSensor.deviceId)
          setTankId(liveSensor.tankId)
          setCategory(liveSensor.category ?? "water_level")
          const cfg = (liveSensor.config ?? {}) as Record<string, any>
          const configText = (key: string) => {
            const value = configValue(cfg, key)
            return value != null ? String(value) : ""
          }
          const parameters = (configValue(cfg, "parameters") ?? configValue(cfg, "parameter_thresholds") ?? {}) as Record<string, Record<string, unknown>>
          const thresholdText = (parameter: string, bound: string) => {
            const value = configValue(parameters[parameter] ?? {}, bound)
            return value != null ? String(value) : ""
          }

          setH1M(configText("h1_m"))
          setDepthM(configText("depth_m"))
          setWarningHeightM(configText("warning_height_m"))
          setCriticalHeightM(configText("critical_height_m"))
          setPhWarnBelow(thresholdText("ph", "warning_below"))
          setTurbWarnAbove(thresholdText("turbidity_ntu", "warning_above"))
          setChlorineWarnAbove(thresholdText("free_chlorine_mgl", "warning_above"))
          setNitrateWarnAbove(thresholdText("nitrate_mgl", "warning_above"))
          setActivated(liveSensor.activated)
          setDmaId(liveSensor.dmaId ?? "")
          setDetectedDmaId(null)
          setDetecting(false)
          if (!dmas.some((dma) => dma.utilityId === liveSensor.utilityId)) {
            void fetchDMAs(liveSensor.utilityId)
          }
        })
        .catch((error) => {
          if (!cancelled) toast.error(error instanceof Error ? error.message : "Failed to load the latest sensor details.")
        })
        .finally(() => {
          if (!cancelled) setLoadingSensor(false)
        })
    } else {
      setLoadingSensor(false)
      setDeviceId("")
      setTankId(defaultTankId ?? "")
      setCategory("water_level")
      setH1M("")
      setDepthM("")
      setWarningHeightM("")
      setCriticalHeightM("")
      setPhWarnBelow("")
      setTurbWarnAbove("")
      setChlorineWarnAbove("")
      setNitrateWarnAbove("")
      setActivated(true)
      setDmaId("")
      setDetectedDmaId(null)
      setDetecting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      cancelled = true
    }
  }, [open, sensor, defaultTankId])

  // Active categories per tank (for the one-active-sensor-per-category rule)
  const activeCategoriesByTank = useMemo(() => {
    const { sensors: all } = useDataStore.getState()
    const map = new Map<string, Set<string>>()
    for (const s of all) {
      if (!s.activated) continue
      const set = map.get(s.tankId) ?? new Set<string>()
      set.add(s.category)
      map.set(s.tankId, set)
    }
    return map
  }, [tanks, isEdit])

  const scopedTanks = useMemo(() => {
    if (!tanks.length) return []
    let filtered = tanks
    if (role !== "admin") {
      const myUtility = currentUser?.utilityId
      filtered = myUtility ? tanks.filter((t) => t.utilityId === myUtility) : tanks
    }
    return filtered
  }, [currentUser?.utilityId, role, tanks])

  // A tank is selectable for NEW registration when the chosen category is not
  // yet active on it (edit keeps the sensor's own tank selectable).
  const selectableTanks = useMemo(() => {
    if (isEdit) return scopedTanks
    return scopedTanks.filter((t) => {
      const active = activeCategoriesByTank.get(t.id)
      return !active?.has(category)
    })
  }, [scopedTanks, activeCategoriesByTank, category, isEdit])

  const categoryUnavailable = useMemo(() => {
    if (!tankId) return false
    const active = activeCategoriesByTank.get(tankId)
    if (!active) return false
    if (isEdit && sensor) {
      // Only other sensors count for edit
      const { sensors: all } = useDataStore.getState()
      const others = all.filter((s) => s.activated && s.tankId === tankId && s.id !== sensor.id)
      return others.some((s) => s.category === category)
    }
    return active.has(category)
  }, [tankId, activeCategoriesByTank, category, isEdit, sensor])

  // Submit is enabled only when every required input is satisfied:
  // device ID + tank (+ valid category combination for that tank).
  const formValid = Boolean(
    deviceId.trim() && tankId && !categoryUnavailable
  )

  const tankOptions = useMemo(
    () =>
      selectableTanks.map((tank) => ({
        id: tank.id,
        name: tank.name || tank.sourceKey || tank.id,
        latitude: tank.latitude,
        longitude: tank.longitude,
      })),
    [selectableTanks]
  )

  const selectedTankName = useMemo(() => {
    const option = tankOptions.find((o) => o.id === tankId)
    return option ? option.name : ""
  }, [tankOptions, tankId])

  const scopedDMAs = useMemo(() => {
    if (!sensor) return []
    return dmas.filter((d) => d.utilityId === sensor.utilityId)
  }, [dmas, sensor])

  const selectedDmaName = useMemo(() => {
    const dma = scopedDMAs.find((d) => d.id === dmaId)
    return dma ? dma.name : ""
  }, [scopedDMAs, dmaId])

  const parseOptional = (raw: string): number | undefined => {
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) ? value : undefined
  }

  const runDmaDetection = async (tankIdToCheck: string) => {
    if (!tankIdToCheck) return
    setDetecting(true)
    try {
      const detected = await detectSensorDma(tankIdToCheck)
      if (detected.dmaId) {
        setDetectedDmaId(detected.dmaId)
        setDmaId(detected.dmaId)
      } else {
        setDetectedDmaId(null)
      }
    } finally {
      setDetecting(false)
    }
  }

  const handleTankChange = (newTankId: string) => {
    setTankId(newTankId)
    if (isEdit) {
      setDetectedDmaId(null)
      void runDmaDetection(newTankId)
    }
  }

  const handleSave = async () => {
    setConfirmOpen(false)
    setSaving(true)
    try {
      const isWq = category === "water_quality"
      const parameterThresholds: Record<string, Record<string, number>> = {}
      if (isWq) {
        if (parseOptional(phWarnBelow) != null) parameterThresholds.ph = { warning_below: parseOptional(phWarnBelow)! }
        if (parseOptional(turbWarnAbove) != null) parameterThresholds.turbidity_ntu = { warning_above: parseOptional(turbWarnAbove)! }
        if (parseOptional(chlorineWarnAbove) != null) parameterThresholds.free_chlorine_mgl = { warning_above: parseOptional(chlorineWarnAbove)! }
        if (parseOptional(nitrateWarnAbove) != null) parameterThresholds.nitrate_mgl = { warning_above: parseOptional(nitrateWarnAbove)! }
      }
      const payload: RegisterSensorInput = {
        device_id: deviceId.trim(),
        tank_id: tankId,
        category,
        activated,
        ...(isWq
          ? { parameter_thresholds: Object.keys(parameterThresholds).length ? parameterThresholds : undefined }
          : {
              h1_m: parseOptional(h1M),
              depth_m: parseOptional(depthM),
              warning_height_m: parseOptional(warningHeightM),
              critical_height_m: parseOptional(criticalHeightM),
            }),
      }
      if (isEdit && sensor) {
        await updateSensor(sensor.deviceId, {
          tank_id: tankId,
          activated,
          dma_id: dmaId || null,
          ...(isWq
            ? { parameter_thresholds: Object.keys(parameterThresholds).length ? parameterThresholds : undefined }
            : {
                h1_m: payload.h1_m,
                depth_m: payload.depth_m,
                warning_height_m: payload.warning_height_m,
                critical_height_m: payload.critical_height_m,
              }),
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
        <DialogContent className="max-h-[80vh] bg-white/95 backdrop-blur-xl border-slate-200/50 shadow-2xl rounded-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">{isEdit ? "Edit sensor" : "Register sensor"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the sensor configuration and tank assignment."
                : "Connect a water-level or water-quality sensor to a tank."}
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

          {loadingSensor && (
            <p className="text-sm text-slate-500">Loading the latest sensor details…</p>
          )}

          <fieldset disabled={loadingSensor || saving} className="grid gap-3.5 py-1 disabled:opacity-60">
            <div className="grid gap-1.5">
              <Label htmlFor="device-id">Device ID</Label>
              <Input
                id="device-id"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="e.g. JKA_NHW_003"
              />
            </div>

            {!isEdit && (
              <div className="grid gap-1.5">
                <Label>Category</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["water_level", "water_quality"] as SensorCategory[]).map((cat) => {
                    const disabledByTank = Boolean(tankId) && (activeCategoriesByTank.get(tankId)?.has(cat) ?? false)
                    return (
                      <button
                        key={cat}
                        type="button"
                        disabled={disabledByTank}
                        onClick={() => setCategory(cat)}
                        className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                          category === cat
                            ? "border-cyan-500 bg-cyan-50 text-cyan-800"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        } ${disabledByTank ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        <span className="flex items-center gap-1.5">
                          {cat === "water_level" ? <Waves className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
                          {cat === "water_level" ? "Water Level" : "Water Quality"}
                        </span>
                        {disabledByTank && (
                          <span className="mt-0.5 block text-[11px] font-normal text-amber-600">
                            Already active on this tank
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-slate-400">
                  One active sensor per category per tank. Tanks with the chosen category already active are hidden from the list.
                </p>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label>Tank</Label>
              <TankCombobox
                value={tankId}
                onChange={handleTankChange}
                options={tankOptions}
                placeholder="Select a tank…"
                searchPlaceholder="Type to search tanks…"
                emptyText={category === "water_quality" ? "All tanks already have an active water-quality sensor." : "No tanks match your search."}
              />
              {isEdit && categoryUnavailable && (
                <p className="text-xs text-amber-600">
                  Another {category === "water_quality" ? "water-quality" : "water-level"} sensor is already active on this tank.
                </p>
              )}
            </div>

            {isEdit ? (
              <div className="grid gap-1.5">
                <Label htmlFor="dma-id" className="flex items-center gap-2">
                  DMA
                  {detecting && (
                    <span className="flex items-center gap-1 text-xs font-normal text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> detecting…
                    </span>
                  )}
                </Label>
                <select
                  id="dma-id"
                  value={dmaId}
                  onChange={(e) => setDmaId(e.target.value)}
                  disabled={detecting || detectedDmaId !== null}
                  className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 text-sm focus:border-cyan-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Unassigned</option>
                  {scopedDMAs.map((dma) => (
                    <option key={dma.id} value={dma.id}>
                      {dma.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400">
                  {detectedDmaId !== null
                    ? "DMA auto-detected from the tank's location. Change the tank to re-detect."
                    : "No DMA matched the tank's location — choose one manually."}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                The DMA is detected automatically from the tank's location when the sensor is registered.
              </p>
            )}

            {category === "water_level" ? (
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
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ph-warn">pH warning below</Label>
                  <Input id="ph-warn" type="number" step="0.1" value={phWarnBelow} onChange={(e) => setPhWarnBelow(e.target.value)} placeholder="default 6.5" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="turb-warn">Turbidity warning above (NTU)</Label>
                  <Input id="turb-warn" type="number" step="0.1" value={turbWarnAbove} onChange={(e) => setTurbWarnAbove(e.target.value)} placeholder="default 5" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cl-warn">Free chlorine warning above (mg/L)</Label>
                  <Input id="cl-warn" type="number" step="0.1" value={chlorineWarnAbove} onChange={(e) => setChlorineWarnAbove(e.target.value)} placeholder="default 2" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="no3-warn">Nitrate warning above (mg/L)</Label>
                  <Input id="no3-warn" type="number" step="0.1" value={nitrateWarnAbove} onChange={(e) => setNitrateWarnAbove(e.target.value)} placeholder="default 50" />
                </div>
                <p className="col-span-2 text-xs text-slate-400">
                  Thresholds drive warning/critical statuses. Leave blank for conservative defaults
                  (pH 6.5–8.5 warning band, turbidity &gt; 5 NTU, chlorine 0.2–2.0 mg/L, nitrate &gt; 50 mg/L).
                </p>
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border border-slate-200/80 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Activated</p>
                <p className="text-xs text-slate-500">Only activated sensors produce live readings.</p>
              </div>
              <Switch checked={activated} onCheckedChange={setActivated} />
            </div>
          </fieldset>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); onOpenChange(false) }} disabled={saving}>
              Cancel
            </Button>
            <div className="flex flex-col items-end gap-1.5">
              {!formValid && (
                <span className="text-[11px] font-medium text-slate-400">
                  {isEdit ? "Select a tank to save changes" : "Enter Device ID and select a tank to continue"}
                </span>
              )}
              <Button
                onClick={() => {
                  if (!formValid) return
                  setDialogOpen(false); setConfirmOpen(true)
                }}
                disabled={loadingSensor || saving || !formValid}
              >
                {saving ? "Saving…" : isEdit ? "Save changes" : "Register sensor"}
              </Button>
            </div>
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
          {!isEdit && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Category</span>
              <span className="font-medium text-slate-800">
                {category === "water_quality" ? "Water Quality" : "Water Level"}
              </span>
            </div>
          )}
          {isEdit && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">DMA</span>
              <span className="font-medium text-slate-800">
                {selectedDmaName || "Unassigned"}
                {detectedDmaId && <span className="ml-1 text-xs text-emerald-600">(auto-detected)</span>}
              </span>
            </div>
          )}
          <div className="border-t border-slate-200/80" />
          {category === "water_level" ? (
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
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">pH warn &lt;</span>
                <span className="text-slate-800">{phWarnBelow || "default (6.5)"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Turbidity warn &gt;</span>
                <span className="text-slate-800">{turbWarnAbove || "default (5 NTU)"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Chlorine warn &gt;</span>
                <span className="text-slate-800">{chlorineWarnAbove || "default (2 mg/L)"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Nitrate warn &gt;</span>
                <span className="text-slate-800">{nitrateWarnAbove || "default (50 mg/L)"}</span>
              </div>
            </div>
          )}
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

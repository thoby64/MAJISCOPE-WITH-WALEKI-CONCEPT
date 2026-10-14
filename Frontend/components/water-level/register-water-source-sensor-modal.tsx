"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { FlaskConical, Waves } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore, type RegisterSensorInput, type SensorCategory, type SensorSnap } from "@/store/data-store"

interface RegisterWaterSourceSensorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultWaterSourceId?: string
  sensor?: SensorSnap | null
}

function readConfig(config: Record<string, unknown>, key: string): string {
  const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  const value = config[key] ?? config[camel]
  return value == null ? "" : String(value)
}

function readThreshold(config: Record<string, unknown>, parameter: string, bound: string): string {
  const parameters = config.parameters ?? config.parameterThresholds ?? config.parameter_thresholds
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return ""
  const values = parameters as Record<string, unknown>
  const camelParameter = parameter.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  const threshold = values[parameter] ?? values[camelParameter]
  if (!threshold || typeof threshold !== "object" || Array.isArray(threshold)) return ""
  const bounds = threshold as Record<string, unknown>
  const camelBound = bound.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  const value = bounds[bound] ?? bounds[camelBound]
  return value == null ? "" : String(value)
}

export function RegisterWaterSourceSensorModal({
  open,
  onOpenChange,
  defaultWaterSourceId,
  sensor,
}: RegisterWaterSourceSensorModalProps) {
  const { currentUser } = useAuthStore()
  const {
    sensors,
    waterSources,
    dmas,
    fetchWaterSources,
    fetchSensor,
    fetchDMAs,
    registerSensor,
    updateSensor,
    detectWaterSourceDma,
  } = useDataStore()
  const isEdit = Boolean(sensor)
  const [deviceId, setDeviceId] = useState("")
  const [waterSourceId, setWaterSourceId] = useState("")
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    if (!open) return
    void fetchWaterSources()
    if (!sensor) {
      setDeviceId("")
      setWaterSourceId(defaultWaterSourceId ?? "")
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
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchSensor(sensor.deviceId)
      .then((live) => {
        if (cancelled) return
        if (live.assetType !== "water_source" || !live.waterSourceId) {
          throw new Error("This sensor is not registered to a water source.")
        }
        setDeviceId(live.deviceId)
        setWaterSourceId(live.waterSourceId)
        setCategory(live.category)
        const config = live.config ?? {}
        setH1M(readConfig(config, "h1_m"))
        setDepthM(readConfig(config, "depth_m"))
        setWarningHeightM(readConfig(config, "warning_height_m"))
        setCriticalHeightM(readConfig(config, "critical_height_m"))
        setPhWarnBelow(readThreshold(config, "ph", "warning_below"))
        setTurbWarnAbove(readThreshold(config, "turbidity_ntu", "warning_above"))
        setChlorineWarnAbove(readThreshold(config, "free_chlorine_mgl", "warning_above"))
        setNitrateWarnAbove(readThreshold(config, "nitrate_mgl", "warning_above"))
        setActivated(live.activated)
        setDmaId(live.dmaId ?? "")
        if (live.utilityId) void fetchDMAs(live.utilityId)
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Failed to load water-source sensor.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, sensor, defaultWaterSourceId, fetchWaterSources, fetchSensor, fetchDMAs])

  const scopedSources = useMemo(() => {
    if (currentUser?.role === "admin" || !currentUser?.utilityId) return waterSources
    return waterSources.filter((source) => source.utilityId === currentUser.utilityId)
  }, [currentUser?.role, currentUser?.utilityId, waterSources])

  const activeCategories = useMemo(() => {
    const map = new Map<string, Set<SensorCategory>>()
    for (const item of sensors) {
      if (!item.activated || item.assetType !== "water_source") continue
      const set = map.get(item.parentAssetId) ?? new Set<SensorCategory>()
      set.add(item.category)
      map.set(item.parentAssetId, set)
    }
    return map
  }, [sensors])

  const sourceOptions = useMemo(
    () => scopedSources.filter((source) => {
      if (isEdit && source.id === sensor?.waterSourceId) return true
      return !activeCategories.get(source.id)?.has(category)
    }),
    [activeCategories, category, isEdit, scopedSources, sensor?.waterSourceId]
  )
  const selectedSource = scopedSources.find((source) => source.id === waterSourceId)
  const sourceName = selectedSource?.name || selectedSource?.sourceKey || ""
  const categoryUnavailable = sensors.some((item) =>
    item.assetType === "water_source" &&
    item.activated &&
    item.category === category &&
    item.parentAssetId === waterSourceId &&
    item.id !== sensor?.id
  )
  const canSave = Boolean(deviceId.trim() && waterSourceId && !categoryUnavailable)

  const handleSave = async () => {
    setSaving(true)
    try {
      const parse = (value: string) => {
        const parsed = Number.parseFloat(value)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      const parameterThresholds: Record<string, Record<string, number>> = {}
      const phThreshold = parse(phWarnBelow)
      const turbidityThreshold = parse(turbWarnAbove)
      const chlorineThreshold = parse(chlorineWarnAbove)
      const nitrateThreshold = parse(nitrateWarnAbove)
      if (phThreshold != null) parameterThresholds.ph = { warning_below: phThreshold }
      if (turbidityThreshold != null) parameterThresholds.turbidity_ntu = { warning_above: turbidityThreshold }
      if (chlorineThreshold != null) parameterThresholds.free_chlorine_mgl = { warning_above: chlorineThreshold }
      if (nitrateThreshold != null) parameterThresholds.nitrate_mgl = { warning_above: nitrateThreshold }
      const body: RegisterSensorInput = {
        device_id: deviceId.trim(),
        asset_type: "water_source",
        water_source_id: waterSourceId,
        category,
        activated,
        ...(category === "water_level"
          ? {
              h1_m: parse(h1M),
              depth_m: parse(depthM),
              warning_height_m: parse(warningHeightM),
              critical_height_m: parse(criticalHeightM),
            }
          : { parameter_thresholds: parameterThresholds }),
      }
      if (sensor) {
        await updateSensor(sensor.deviceId, {
          asset_type: "water_source",
          water_source_id: waterSourceId,
          activated,
          dma_id: dmaId || null,
          ...(category === "water_level"
            ? {
                h1_m: body.h1_m,
                depth_m: body.depth_m,
                warning_height_m: body.warning_height_m,
                critical_height_m: body.critical_height_m,
              }
            : { parameter_thresholds: parameterThresholds }),
        })
        toast.success("Water-source sensor updated.")
      } else {
        const created = await registerSensor(body)
        const promoted = created.promotedReadings ?? 0
        toast.success(
          promoted
            ? `Sensor registered. ${promoted} buffered reading${promoted === 1 ? "" : "s"} attached.`
            : "Water-source sensor registered."
        )
      }
      setConfirmOpen(false)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save water-source sensor.")
    } finally {
      setSaving(false)
    }
  }

  const detectDma = async () => {
    if (!waterSourceId) return
    setDetecting(true)
    try {
      const result = await detectWaterSourceDma(waterSourceId)
      setDmaId(result.dmaId ?? "")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to detect the source DMA.")
    } finally {
      setDetecting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit water-source sensor" : "Register water-source sensor"}</DialogTitle>
            <DialogDescription>
              This sensor is linked only to a borehole, well, intake, or other water source.
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertTitle>Verify device identity</AlertTitle>
            <AlertDescription>
              Readings sent to the water-source endpoint are stored in water-source sensor tables.
            </AlertDescription>
          </Alert>
          {loading ? <p className="text-sm text-slate-500">Loading sensor details…</p> : null}
          <fieldset disabled={loading || saving} className="grid gap-4 disabled:opacity-60">
            <div className="grid gap-1.5">
              <Label htmlFor="water-source-device-id">Device ID</Label>
              <Input
                id="water-source-device-id"
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                disabled={isEdit}
                placeholder="e.g. JKA_NHW_003"
              />
            </div>
            {!isEdit && (
              <div className="grid gap-2">
                <Label>Sensor category</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["water_level", "water_quality"] as SensorCategory[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCategory(value)}
                      className={`rounded-lg border p-3 text-left text-sm ${category === value ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}
                    >
                      <span className="flex items-center gap-2">
                        {value === "water_level" ? <Waves className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
                        {value === "water_level" ? "Water level" : "Water quality"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="water-source-select">Water source</Label>
              <select
                id="water-source-select"
                value={waterSourceId}
                onChange={(event) => setWaterSourceId(event.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">Choose a water source</option>
                {sourceOptions.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name || source.sourceKey}{source.sourceType ? ` · ${source.sourceType}` : ""}
                  </option>
                ))}
              </select>
              {categoryUnavailable && (
                <p className="text-xs text-amber-700">An active sensor of this category is already attached to this source.</p>
              )}
            </div>
            {category === "water_level" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="source-h1">Reference height (m)</Label>
                  <Input id="source-h1" type="number" min="0" step="0.1" value={h1M} onChange={(e) => setH1M(e.target.value)} />
                  <p className="text-xs text-slate-500">Measured installation reference used to convert sensor depth into estimated water level.</p>
                </div>
                <div className="grid gap-1.5"><Label htmlFor="source-depth">Depth offset (m)</Label><Input id="source-depth" type="number" min="0" step="0.1" value={depthM} onChange={(e) => setDepthM(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label htmlFor="source-warning">Warning threshold (m)</Label><Input id="source-warning" type="number" min="0" step="0.1" value={warningHeightM} onChange={(e) => setWarningHeightM(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label htmlFor="source-critical">Critical threshold (m)</Label><Input id="source-critical" type="number" min="0" step="0.1" value={criticalHeightM} onChange={(e) => setCriticalHeightM(e.target.value)} /></div>
              </div>
            )}
            {category === "water_quality" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="source-ph-warn">pH warning below</Label>
                  <Input id="source-ph-warn" type="number" step="0.1" value={phWarnBelow} onChange={(event) => setPhWarnBelow(event.target.value)} placeholder="default 6.5" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="source-turbidity-warn">Turbidity warning above (NTU)</Label>
                  <Input id="source-turbidity-warn" type="number" step="0.1" value={turbWarnAbove} onChange={(event) => setTurbWarnAbove(event.target.value)} placeholder="default 5" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="source-chlorine-warn">Free chlorine warning above (mg/L)</Label>
                  <Input id="source-chlorine-warn" type="number" step="0.1" value={chlorineWarnAbove} onChange={(event) => setChlorineWarnAbove(event.target.value)} placeholder="default 2" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="source-nitrate-warn">Nitrate warning above (mg/L)</Label>
                  <Input id="source-nitrate-warn" type="number" step="0.1" value={nitrateWarnAbove} onChange={(event) => setNitrateWarnAbove(event.target.value)} placeholder="default 50" />
                </div>
                <p className="col-span-2 text-xs text-slate-500">
                  Leave thresholds blank to use the conservative defaults.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><p className="text-sm font-medium">Activated</p><p className="text-xs text-slate-500">Active sensors accept live readings.</p></div>
              <Switch checked={activated} onCheckedChange={setActivated} />
            </div>
            {isEdit && (
              <div className="grid gap-1.5">
                <Label htmlFor="source-dma">DMA</Label>
                <div className="flex gap-2">
                  <select id="source-dma" value={dmaId} onChange={(event) => setDmaId(event.target.value)} className="h-10 flex-1 rounded-lg border px-3 text-sm">
                    <option value="">Unassigned</option>
                    {dmas.filter((dma) => dma.utilityId === sensor?.utilityId).map((dma) => <option key={dma.id} value={dma.id}>{dma.name}</option>)}
                  </select>
                  <Button type="button" variant="outline" disabled={detecting} onClick={() => void detectDma()}>
                    {detecting ? "Detecting…" : "Detect"}
                  </Button>
                </div>
              </div>
            )}
          </fieldset>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!canSave || loading || saving} onClick={() => setConfirmOpen(true)}>
              {isEdit ? "Save changes" : "Register sensor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isEdit ? "Confirm sensor update" : "Confirm sensor registration"}
        description={`Save ${deviceId || "this sensor"} for ${sourceName || "the selected water source"}?`}
        confirmLabel={isEdit ? "Save changes" : "Register sensor"}
        onConfirm={() => void handleSave()}
        isLoading={saving}
      />
    </>
  )
}

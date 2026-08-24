"use client"

import type { ChangeEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Activity, ArrowLeft, Calendar, Clock, Droplets, Gauge, MapPin, Plus, Ruler, TrendingUp } from "lucide-react"
import { SensorIcon } from "@/components/icons/sensor-icon"
import { useDataStore, type SensorSnap, type TankReading } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WaterLevelTank } from "@/components/water-level/water-level-tank"
import { WaterStatusPill } from "@/components/water-level/status-pill"
import { RegisterSensorModal } from "@/components/water-level/register-sensor-modal"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import {
  READING_HISTORY_LIMIT,
  WATER_LEVEL_POLL_INTERVAL_MS,
  readStoredTankLength,
  stashTankLength,
  tankLengthFor,
} from "@/lib/water-level"

export default function WaterLevelTankDetailPage() {
  const router = useRouter()
  const params = useParams<{ tankId: string }>()
  const tankId = Array.isArray(params?.tankId) ? params.tankId[0] : params?.tankId

  const { sensors, tankReadingsByTank, fetchSensors, fetchTankReadings } = useDataStore()

  const [lengthOverride, setLengthOverride] = useState<number | null>(() =>
    tankId ? readStoredTankLength(tankId) : null
  )

  const { currentUser } = useAuthStore()
  const [registerOpen, setRegisterOpen] = useState(false)
  const canRegister = currentUser?.role === "admin" || currentUser?.role === "utility_manager"

  useEffect(() => {
    if (!tankId) return
    void fetchSensors()
    void fetchTankReadings(tankId, READING_HISTORY_LIMIT)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSensors()
        void fetchTankReadings(tankId, READING_HISTORY_LIMIT)
      }
    }, WATER_LEVEL_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [tankId, fetchSensors, fetchTankReadings])

  const tankSensors = useMemo(
    () => sensors.filter((s) => s.tankId === tankId),
    [sensors, tankId]
  )

  const { tanks } = useDataStore()

  const tank = useMemo(
    () => tanks.find((t) => t.id === tankId),
    [tanks, tankId]
  )

  const representative: SensorSnap | undefined = useMemo(() => {
    return (
      tankSensors.find((s) => s.activated && s.lastReading) ??
      tankSensors.find((s) => s.activated) ??
      tankSensors[0]
    )
  }, [tankSensors])

  const readings: TankReading[] = useMemo(
    () => tankReadingsByTank[tankId ?? ""] ?? [],
    [tankReadingsByTank, tankId]
  )

  const latest = representative?.lastReading ?? null
  const status = latest?.status ?? representative?.status ?? "inactive"
  const tankName = representative?.tankName || tankId || "Tank"
  const tankLength = representative
    ? tankLengthFor(representative, lengthOverride)
    : lengthOverride || 2

  const summary = useMemo(() => {
    const heights = readings.map((r) => r.waterLevelM)
    return {
      avg: heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 0,
      max: heights.length ? Math.max(...heights) : 0,
      min: heights.length ? Math.min(...heights) : 0,
    }
  }, [readings])

  if (!representative) {
    return (
      <div className="flex flex-col gap-6">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard/water-level")}
          className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to monitoring
        </Button>
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                <Droplets className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">No sensor registered</p>
                <p className="mt-1 text-sm text-slate-500">
                  This tank does not have a registered sensor yet.
                </p>
              </div>
              {canRegister && (
                <Button size="sm" onClick={() => setRegisterOpen(true)} className="mt-2 rounded-xl">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Register sensor
                </Button>
              )}
            </div>
            {tank?.latitude != null && tank?.longitude != null && (
              <div className="mt-6 pt-6 border-t border-slate-100 w-full max-w-md mx-auto text-left">
                <p className="text-sm font-semibold text-slate-700 mb-2">Storage Facility Coordinates</p>
                <div className="flex items-center gap-2 text-sm text-slate-600 font-mono">
                  <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
                  <span>{tank.latitude.toFixed(6)}°, {tank.longitude.toFixed(6)}°</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <RegisterSensorModal open={registerOpen} onOpenChange={setRegisterOpen} defaultTankId={tankId} />
      </div>
    )
  }

  function handleLengthChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Number.parseFloat(event.target.value)
    if (!Number.isFinite(next) || next <= 0 || !tankId) return
    const normalized = Number.parseFloat(next.toFixed(2))
    setLengthOverride(normalized)
    stashTankLength(tankId, normalized)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard/water-level")}
          className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to monitoring
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">{tankName}</h1>
          <WaterStatusPill status={status} />
        </div>
        <p className="text-sm text-slate-500">
          Detailed readings, sensor hanging length, h2 reading, and live tank level.
        </p>
        {canRegister && tankSensors.length === 0 && (
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Register sensor
          </Button>
        )}
      </div>

      {/* Visualizer + metrics */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <WaterLevelTank
          tankName={tankName}
          waterHeightM={latest?.waterLevelM ?? 0}
          tankDepthM={tankLength}
          sensorHangingM={representative.h1M ?? 0}
          sensorDepthM={latest?.depthM ?? representative.depthM ?? 0}
          status={status}
          readingCount={readings.length}
          lastReadingLabel={latest ? formatTanzaniaDateTime(latest.occurredAt) : "No readings yet"}
        />

        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <Droplets className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Current height</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(latest?.waterLevelM ?? 0).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Ruler className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Tank length</span>
                <label className="ml-auto flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={tankLength}
                    onChange={handleLengthChange}
                    className="h-8 w-20 rounded-lg px-2 text-right text-sm"
                  />
                  <strong className="text-sm font-semibold text-slate-800">m</strong>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Ruler className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor h1</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(representative.h1M ?? 0).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Gauge className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor h2</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {(latest?.depthM ?? representative.depthM ?? 0).toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Activity className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Average height</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {summary.avg.toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <TrendingUp className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Maximum height</span>
                <strong className="ml-auto font-semibold text-slate-800">
                  {summary.max.toFixed(2)}m
                </strong>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Total readings</span>
                <strong className="ml-auto font-semibold text-slate-800">{readings.length}</strong>
              </div>
              <div className="flex items-center gap-3">
                <SensorIcon className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="text-sm text-slate-500">Sensor ID</span>
                <strong className="ml-auto font-mono font-semibold text-slate-800">
                  {representative.deviceId}
                </strong>
              </div>
              {tank?.latitude != null && tank?.longitude != null && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 shrink-0 text-cyan-600" />
                  <span className="text-sm text-slate-500">Storage Facility Coordinates</span>
                  <strong className="ml-auto font-mono font-semibold text-slate-800">
                    {tank.latitude.toFixed(6)}°, {tank.longitude.toFixed(6)}°
                  </strong>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Readings table */}
      <Card className="border-slate-200/70 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-slate-800">Recent readings</h2>
          </div>
          {readings.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No readings found for this tank.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="pb-3 pr-4 font-medium">Time</th>
                    <th className="pb-3 pr-4 font-medium">Water height</th>
                    <th className="pb-3 pr-4 font-medium">Height (ft)</th>
                    <th className="pb-3 pr-4 font-medium">h1</th>
                    <th className="pb-3 pr-4 font-medium">h2</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.slice(0, 30).map((reading) => (
                    <tr key={reading.readingId} className="border-b border-slate-50 last:border-0">
                      <td className="py-3 pr-4 text-slate-600">
                        {formatTanzaniaDateTime(reading.occurredAt)}
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-800">
                        {reading.waterLevelM.toFixed(2)}m
                      </td>
                      <td className="py-3 pr-4 text-slate-500">
                        {(reading.waterLevelM * 3.28084).toFixed(2)}ft
                      </td>
                      <td className="py-3 pr-4 text-slate-500">{reading.h1M.toFixed(2)}m</td>
                      <td className="py-3 pr-4 text-slate-500">{reading.depthM.toFixed(2)}m</td>
                      <td className="py-3">
                        <WaterStatusPill status={reading.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <RegisterSensorModal open={registerOpen} onOpenChange={setRegisterOpen} defaultTankId={tankId} />
    </div>
  )
}

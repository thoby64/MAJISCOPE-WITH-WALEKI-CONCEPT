"use client"

import type { CSSProperties } from "react"
import { Activity, Droplets, Gauge, Ruler } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const STATUS_WATER_CLASS: Record<string, string> = {
  active: "from-cyan-400 to-cyan-600",
  warning: "from-amber-400 to-amber-600",
  critical: "from-rose-500 to-red-600",
  inactive: "from-slate-200 to-slate-300",
}

const STATUS_TEXT_CLASS: Record<string, string> = {
  active: "text-emerald-700 border-emerald-200 bg-emerald-50",
  warning: "text-amber-700 border-amber-200 bg-amber-50",
  critical: "text-red-700 border-red-200 bg-red-50",
  inactive: "text-slate-600 border-slate-300 bg-slate-100",
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const asNumber = (value: number | null | undefined, fallback = 0) => {
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : fallback
}
const formatMeter = (value: number | null | undefined) => `${asNumber(value).toFixed(2)}m`

interface WaterLevelTankProps {
  tankName: string
  waterHeightM: number
  tankDepthM: number
  sensorHangingM: number
  sensorDepthM: number
  status: string
  readingCount: number
  lastReadingLabel?: string
}

export function WaterLevelTank({
  tankName,
  waterHeightM,
  tankDepthM,
  sensorHangingM,
  sensorDepthM,
  status,
  readingCount,
  lastReadingLabel,
}: WaterLevelTankProps) {
  const depth = asNumber(tankDepthM)
  const height = asNumber(waterHeightM)
  const sensorHanging = asNumber(sensorHangingM)
  const sensorDepth = asNumber(sensorDepthM)
  const percent = depth > 0 ? clamp((height / depth) * 100, 0, 100) : 0
  const surfaceTop = 100 - percent
  const probeTop = depth > 0 ? clamp((sensorHanging / depth) * 100, 0, 100) : null
  const safeStatus = String(status || "inactive").toLowerCase()
  const displayStatus = safeStatus === "low" ? "warning" : safeStatus
  const waterClass = STATUS_WATER_CLASS[displayStatus] ?? STATUS_WATER_CLASS.inactive
  const statusTextClass = STATUS_TEXT_CLASS[displayStatus] ?? STATUS_TEXT_CLASS.inactive
  const markersOverlap = probeTop !== null && Math.abs(probeTop - surfaceTop) < 7
  const ticks = [100, 75, 50, 25, 0]

  return (
    <Card className="border-slate-200/70 bg-white shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Live tank level</p>
            <h4 className="mt-0.5 text-lg font-semibold text-slate-800">{tankName}</h4>
          </div>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", statusTextClass)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {safeStatus}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          {/* Tank instrument */}
          <div className="flex flex-1 items-stretch justify-center gap-3">
            {/* Scale */}
            <div className="relative w-14 shrink-0" aria-hidden="true">
              {ticks.map((tick) => (
                <div key={tick} className="absolute right-0 flex w-full -translate-y-1/2 items-center justify-end gap-1.5" style={{ top: `${100 - tick}%` }}>
                  <span className="text-[10px] text-slate-400">{depth > 0 ? formatMeter((depth * tick) / 100) : `${tick}%`}</span>
                  <span className="h-px w-3 bg-slate-300" />
                </div>
              ))}
            </div>

            {/* Tank body */}
            <div
              className="relative h-64 w-28 overflow-hidden rounded-b-xl rounded-t-lg border-2 border-slate-300 bg-slate-100"
              role="img"
              aria-label={`Water level ${percent.toFixed(0)} percent`}
            >
              <div className="absolute inset-x-0 top-0 h-1.5 rounded-b bg-slate-300" />
              {/* Empty region above surface */}
              <div className="absolute inset-x-0 top-0 bottom-[var(--surface-top)] bg-slate-100 transition-[bottom] duration-700" style={{ "--surface-top": `${surfaceTop}%` } as CSSProperties} />
              {/* Water fill */}
              <div className={cn("absolute inset-x-0 bottom-0 top-[var(--surface-top)] bg-gradient-to-b transition-[top] duration-700", waterClass)} style={{ "--surface-top": `${surfaceTop}%` } as CSSProperties}>
                <div className="absolute inset-x-0 top-0 h-1.5 rounded-b bg-white/50" />
              </div>
              {/* Sensor cable + probe at h1 */}
              {probeTop !== null && (
                <div className={cn("absolute inset-x-0 transition-[top] duration-700", markersOverlap && "opacity-80")} style={{ top: `${probeTop}%` }}>
                  <div className="mx-auto h-px w-px bg-slate-500" />
                  <div className="mx-auto h-1.5 w-3 rounded-full bg-slate-500" />
                </div>
              )}
              {/* Surface marker */}
              <div className="absolute inset-x-0 -translate-y-1/2 border-t border-dashed border-white/80" style={{ top: `${surfaceTop}%` }}>
                <span className="absolute right-0 -top-6 rounded bg-slate-800/85 px-1.5 py-0.5 text-right text-[10px] leading-tight text-white">
                  <small className="block text-[9px] opacity-70">Level</small>
                  <strong>{formatMeter(height)}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Readout */}
          <div className="flex w-full flex-col justify-center gap-3 sm:max-w-[220px]">
            <div className="flex items-center gap-2">
              <Droplets className="h-5 w-5 text-cyan-600" />
              <span className="text-xl font-bold text-slate-800">{formatMeter(height)}</span>
            </div>
            <div>
              <p className="text-xs text-slate-500">Current water height</p>
              <strong className="text-sm text-slate-700">{percent.toFixed(0)}% full</strong>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className={cn("h-full rounded-full bg-gradient-to-r transition-[width] duration-700", waterClass)} style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <Ruler className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">Tank length</p>
                <strong className="text-slate-700">{formatMeter(depth)}</strong>
              </div>
              <div>
                <Ruler className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">Sensor hanging</p>
                <strong className="text-slate-700">{formatMeter(sensorHanging)}</strong>
              </div>
              <div>
                <Gauge className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">h2 reading</p>
                <strong className="text-slate-700">{formatMeter(sensorDepth)}</strong>
              </div>
              <div>
                <Activity className="mb-0.5 h-3.5 w-3.5 text-slate-400" />
                <p className="text-slate-500">Readings</p>
                <strong className="text-slate-700">{readingCount ?? 0}</strong>
              </div>
            </div>
            {lastReadingLabel && <p className="text-[11px] text-slate-400">Last reading: {lastReadingLabel}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

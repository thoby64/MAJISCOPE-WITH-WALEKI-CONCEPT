export const WATER_LEVEL_POLL_INTERVAL_MS = 10_000
export const DEFAULT_TANK_LENGTH_M = 2
export const READING_HISTORY_LIMIT = 30

export function getTankLengthStorageKey(tankId: string) {
  return `waleki:tank-length-m:${tankId}`
}

export function readStoredTankLength(tankId: string): number | null {
  if (typeof window === "undefined") return null
  const stored = window.localStorage.getItem(getTankLengthStorageKey(tankId))
  const parsed = Number.parseFloat(stored ?? "")
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function stashTankLength(tankId: string, meters: number) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(getTankLengthStorageKey(tankId), String(meters))
}

export function tankLengthFor(
  sensor: { h1M?: number | null },
  override: number | null
): number {
  const fallback = Math.max(sensor?.h1M ?? 0, DEFAULT_TANK_LENGTH_M)
  return override && override > 0 ? override : fallback
}

export function fillPercent(waterLevelM: number, tankLengthM: number): number {
  const safe = tankLengthM > 0 ? tankLengthM : DEFAULT_TANK_LENGTH_M
  return Math.min(100, Math.max(0, (waterLevelM / safe) * 100))
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "unknown"
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000))
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

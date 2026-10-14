import { normalizeNaiveIsoAsUtc } from "@/lib/date-time"

// Polling more often than this can overwhelm the hosted API when a user has
// multiple dashboard tabs open. Live updates remain frequent without creating
// a burst of parallel requests every ten seconds.
export const WATER_LEVEL_POLL_INTERVAL_MS = 30_000
export const DEFAULT_STORAGE_FACILITY_LENGTH_M = 2
export const READING_HISTORY_LIMIT = 30
export const WATER_SOURCE_READING_HISTORY_LIMIT = 20

export function getStorageFacilityLengthStorageKey(storageFacilityId: string) {
  return `waleki:storageFacility-length-m:${storageFacilityId}`
}

export function readStoredStorageFacilityLength(storageFacilityId: string): number | null {
  if (typeof window === "undefined") return null
  const stored = window.localStorage.getItem(getStorageFacilityLengthStorageKey(storageFacilityId))
  const parsed = Number.parseFloat(stored ?? "")
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function stashStorageFacilityLength(storageFacilityId: string, meters: number) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(getStorageFacilityLengthStorageKey(storageFacilityId), String(meters))
}

export function storageFacilityLengthFor(
  sensor: { h1M?: number | null; config?: Record<string, unknown> | null },
  override: number | null
): number {
  const configH1Value = sensor?.config?.h1M ?? sensor?.config?.h1_m
  const configH1 = typeof configH1Value === "number" ? configH1Value : null
  const fallback = Math.max(sensor?.h1M ?? configH1 ?? 0, DEFAULT_STORAGE_FACILITY_LENGTH_M)
  return override && override > 0 ? override : fallback
}

export function fillPercent(waterLevelM: number, storageFacilityLengthM: number): number {
  const safe = storageFacilityLengthM > 0 ? storageFacilityLengthM : DEFAULT_STORAGE_FACILITY_LENGTH_M
  return Math.min(100, Math.max(0, (waterLevelM / safe) * 100))
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const date = new Date(normalizeNaiveIsoAsUtc(iso))
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

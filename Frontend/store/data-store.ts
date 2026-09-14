// ============================================================
// Majiscope - Data Store (Zustand)
// Fetches data from API - No mock data
// Uses global API client for backend communication
// ============================================================

import { create } from "zustand"
import { apiClient } from "@/lib/api-client"
import CONFIG from "@/lib/config"
import { transformKeys } from "@/lib/transform-data"

const REFERENCE_CACHE_TTL = 30_000
const NOTIFICATION_CACHE_TTL = 10_000
const BOOTSTRAP_CACHE_TTL = 10_000
const SENSOR_CACHE_TTL = 15_000
const TANK_CACHE_TTL = 30_000
const TANK_READING_CACHE_TTL = 5_000
const REPORTS_CACHE_TTL = 10_000

// Type imports for proper typing
import type {
  EntityStatus,
  GeoJsonBoundary,
  LeakageType,
  ReportType,
  ReportPriority,
  ReportStatus,
  UtilityServiceArea,
} from "@/lib/types"

function isAbortLikeError(error: unknown, code?: string) {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message || "")
          : ""

  return (
    code === "ABORTED" ||
    code === "RATE_LIMIT_EXCEEDED" ||
    error instanceof DOMException && error.name === "AbortError" ||
    /operation was aborted|aborterror|aborted|rate.limit.exceeded/i.test(message)
  )
}

export interface GeoJsonPolygon {
  type: "Polygon"
  coordinates: number[][][]
}

// Types
export interface Utility {
  id: string
  slug?: string | null
  name: string
  regionName?: string | null
  description: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  contactAddress?: string | null
  centerLatitude?: number | null
  centerLongitude?: number | null
  boundaryGeojson?: GeoJsonBoundary | null
  boundarySourceType?: "none" | "uploaded" | null
  boundaryStatus?: "none" | "verified" | null
  serviceAreas?: UtilityServiceArea[]
  managerId?: string | null
  managerName?: string
  status: EntityStatus
  dmasCount?: number
  reportsCount?: number
  infrastructureLayers?: UtilityInfrastructureLayer[]
  createdAt: string
  updatedAt: string
}

export interface UtilityInfrastructureLayer {
  assetType: string
  label: string
  fileName: string
  fileSize: number
  mimeType: string
  featureCount: number
  downloadUrl: string
  previewUrl: string
  uploadedAt: string
}

export function getUtilityInfrastructureAsset(utility: Utility | null | undefined, assetType: string) {
  return utility?.infrastructureLayers?.find((layer) => layer.assetType === assetType) || null
}

export type SensorCategory = "water_level" | "water_quality"

export interface SensorSnap {
  id: string
  deviceId: string
  category: SensorCategory
  tankId: string
  tankName: string | null
  utilityId: string
  dmaId: string | null
  dmaAutoAssigned?: boolean
  config: Record<string, unknown> | null
  activated: boolean
  status: string
  lastReading: SensorLastReading | null
  promotedReadings: number | null
  createdAt: string
  updatedAt: string
}

export interface SensorLastReading {
  ok: boolean
  category: SensorCategory
  readingId: string
  sensorId: string
  tankId: string
  utilityId: string
  dmaId: string | null
  status: string
  occurredAt: string
  // water level
  waterLevelM?: number | null
  h1M?: number | null
  depthM?: number | null
  // water quality
  parameters?: Record<string, number> | null
  isDuplicate: boolean
}

export interface TankReading {
  ok: boolean
  category: SensorCategory
  readingId: string
  sensorId: string
  tankId: string
  utilityId: string
  dmaId: string | null
  // water level
  waterLevelM?: number
  h1M?: number
  depthM?: number
  // water quality
  parameters?: Record<string, number>
  status: string
  occurredAt: string
  isDuplicate: boolean
}

export interface TankSnap {
  id: string
  utilityId: string
  dmaId: string | null
  sourceKey: string
  name: string | null
  latitude: number | null
  longitude: number | null
  status: string
  sensorCount: number
  activeSensorCount: number
  createdAt: string
  updatedAt: string
  deactivatedAt: string | null
}

export interface RegisterSensorInput {
  device_id: string
  tank_id: string
  category?: SensorCategory
  h1_m?: number
  depth_m?: number
  warning_height_m?: number
  critical_height_m?: number
  activated?: boolean
  dma_id?: string | null
  parameter_thresholds?: Record<string, Record<string, number>>
}

function serializeUtilityPayload(data: Partial<Utility>) {
  return {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.regionName !== undefined ? { region_name: data.regionName } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.contactPhone !== undefined ? { contact_phone: data.contactPhone } : {}),
    ...(data.contactEmail !== undefined ? { contact_email: data.contactEmail } : {}),
    ...(data.contactAddress !== undefined ? { contact_address: data.contactAddress } : {}),
    ...(data.centerLatitude !== undefined ? { center_latitude: data.centerLatitude } : {}),
    ...(data.centerLongitude !== undefined ? { center_longitude: data.centerLongitude } : {}),
    ...(data.boundaryGeojson !== undefined ? { boundary_geojson: data.boundaryGeojson } : {}),
    ...(data.boundarySourceType !== undefined ? { boundary_source_type: data.boundarySourceType } : {}),
    ...(data.boundaryStatus !== undefined ? { boundary_status: data.boundaryStatus } : {}),
    ...(data.serviceAreas !== undefined
      ? {
          service_areas: data.serviceAreas.map((area) => ({
            ...(area.id !== undefined ? { id: area.id } : {}),
            category: area.category,
            name: area.name,
            region_name: area.regionName ?? null,
            admin_area_id: area.adminAreaId ?? null,
          })),
        }
      : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  }
}

async function writeUtility(endpoint: string, method: "POST" | "PUT", data: Partial<Utility>) {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem(CONFIG.storage.tokenKey) : null
  const response = await fetch(`${CONFIG.backend.fullUrl}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(serializeUtilityPayload(data)),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload?.detail || payload?.error || `Failed to ${method === "POST" ? "create" : "update"} utility`)
  }

  return transformKeys(payload?.data || payload) as Utility
}

function entityFromResponse<T extends { id?: string }>(data: unknown): T | null {
  if (!data || typeof data !== "object") return null
  const raw = "data" in data ? (data as { data?: unknown }).data : data
  if (!raw || typeof raw !== "object") return null
  const transformed = transformKeys(raw) as T
  return transformed?.id ? transformed : null
}

function upsertEntity<T extends { id: string }>(items: T[], item: T) {
  const exists = items.some((current) => current.id === item.id)
  return exists ? items.map((current) => current.id === item.id ? item : current) : [item, ...items]
}

export interface DMA {
  id: string
  slug?: string | null
  name: string
  description: string | null
  utilityId: string
  utilityName?: string
  centerLatitude?: number | null
  centerLongitude?: number | null
  boundaryGeojson?: GeoJsonPolygon | null
  managerId?: string | null
  managerName?: string
  status: EntityStatus
  teamsCount?: number
  reportsCount?: number
  engineersCount?: number
  createdAt: string
  updatedAt: string
}

export interface Engineer {
  id: string
  name: string
  email: string
  phone: string | null
  dmaId: string
  dmaName: string
  teamId: string | null
  teamName: string | null
  status: EntityStatus
  role: string
  assignedReports: number
  createdAt: string
  updatedAt: string
}

export interface Team {
  id: string
  name: string
  dmaId: string
  dmaName: string
  utilityId?: string
  utilityName?: string
  leaderId: string | null
  leaderName: string | null
  status: EntityStatus
  memberCount: number
  activeReports: number
  createdAt: string
  updatedAt: string
}

export interface Report {
  id: string
  trackingId: string
  description: string
  latitude: number
  longitude: number
  address: string | null
  regionName?: string | null
  districtName?: string | null
  photos: string[]
  reportPhotos?: string[]
  submissionBeforePhotos?: string[]
  submissionAfterPhotos?: string[]
  priority: ReportPriority
  reportType: ReportType
  leakageType?: LeakageType | null
  status: ReportStatus
  utilityId: string | null
  utilityName: string
  dmaId: string | null
  dmaName: string
  teamId: string | null
  teamName: string | null
  teamLeaderId?: string | null
  teamLeaderName?: string | null
  assignedEngineerId: string | null
  assignedEngineerName: string | null
  reporterName: string
  reporterPhone: string
  notes: string | null
  engineerSubmissionNotes?: string | null
  teamLeaderReviewNotes?: string | null
  dmaReviewNotes?: string | null
  slaDeadline: string
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ActivityLog {
  id: string
  action: string
  userId: string
  userName: string
  userRole: string
  entity: string
  entityId: string
  details: string | null
  utilityId: string | null
  dmaId: string | null
  timestamp: string
}

export interface Notification {
  id: string
  title: string
  message: string
  type: string
  read: boolean
  link: string | null
  data?: Record<string, unknown> | null
  updatedAt?: string
  userId: string
  createdAt: string
}

function normalizeNotification(raw: Record<string, any>): Notification {
  const transformed = transformKeys(raw) as Record<string, any>

  return {
    id: String(transformed.id ?? ""),
    title: String(transformed.title ?? ""),
    message: String(transformed.message ?? ""),
    type: String(transformed.type ?? transformed.notificationType ?? "info"),
    read: Boolean(transformed.read ?? transformed.isRead ?? false),
    link: transformed.link ?? null,
    data: (transformed.data as Record<string, unknown> | null | undefined) ?? null,
    updatedAt: transformed.updatedAt ?? null,
    userId: String(transformed.userId ?? ""),
    createdAt: String(transformed.createdAt ?? new Date().toISOString()),
  }
}

export interface User {
  id: string
  email: string
  name: string
  role: string
  phone: string | null
  status: string
}

export interface DMAManager {
  id: string
  name: string
  email: string
  phone: string | null
  status: EntityStatus
  role: string
  utilityId: string
  utilityName?: string
  dmaId?: string | null
  dmaName?: string | null
  onboardingStatus?: "completed" | "pending_setup" | "expired"
  inviteExpiresAt?: string | null
  setupCompletedAt?: string | null
  password?: string // Used when creating a new manager
  createdAt: string
  updatedAt: string
}

interface DataState {
  // Data
  utilities: Utility[]
  dmas: DMA[]
  dmaManagers: DMAManager[]
  engineers: Engineer[]
  teams: Team[]
  reports: Report[]
  reportsListTotal: number | null
  logs: ActivityLog[]
  notifications: Notification[]
  sensors: SensorSnap[]
  tanks: TankSnap[]
  tankReadingsByTank: Record<string, TankReading[]>
  
  // Loading states
  isLoading: boolean
  initialized: boolean
  error: string | null

  // Fetch Actions
  initialize: () => Promise<void>
  fetchDashboardBootstrap: () => Promise<boolean>
  fetchUtilities: () => Promise<void>
  fetchDMAs: (utilityId?: string) => Promise<void>
  fetchEngineers: (dmaId?: string) => Promise<void>
  fetchTeams: (dmaId?: string) => Promise<void>
  fetchReports: (filters?: { utilityId?: string; dmaId?: string; status?: string; priority?: string; reportType?: string; search?: string; limit?: number; skip?: number }) => Promise<void>
  fetchReportsForMap: (filters?: { utilityId?: string; dmaId?: string }) => Promise<void>
  fetchLogs: (utilityId?: string, dmaId?: string) => Promise<void>
  fetchNotifications: (userId: string) => Promise<void>
  fetchSensors: () => Promise<void>
  fetchSensor: (deviceId: string) => Promise<SensorSnap>
  fetchTanks: () => Promise<void>
  fetchTankReadings: (tankId: string, limit?: number, category?: SensorCategory) => Promise<void>
  registerSensor: (data: RegisterSensorInput) => Promise<SensorSnap>
  updateSensor: (deviceId: string, data: Partial<RegisterSensorInput>) => Promise<SensorSnap>
  deleteSensor: (deviceId: string) => Promise<void>
  detectSensorDma: (tankId: string) => Promise<{ dmaId: string | null; dmaName: string | null }>
  updateTankStatus: (tankId: string, status: "active" | "deactivated") => Promise<TankSnap>
  getUnreadNotificationCount: () => number
  markNotificationRead: (id: string) => Promise<Notification | null>
  markAllNotificationsRead: () => Promise<number>
  
  // CRUD: Utilities
  addUtility: (data: Partial<Utility>) => Promise<Utility>
  updateUtility: (id: string, data: Partial<Utility>) => Promise<Utility>
  deleteUtility: (id: string) => Promise<void>
  
  // CRUD: DMAs
  addDMA: (data: Partial<DMA>) => Promise<DMA>
  updateDMA: (id: string, data: Partial<DMA>) => Promise<DMA>
  deleteDMA: (id: string) => Promise<void>
  
  // CRUD: DMA Managers
  fetchDMAManagers: () => Promise<void>
  addDMAManager: (data: Partial<DMAManager>) => Promise<void>
  updateDMAManager: (id: string, data: Partial<DMAManager>) => Promise<void>
  deleteDMAManager: (id: string) => Promise<void>
  
  // CRUD: Reports
  addReport: (data: Partial<Report>) => Promise<void>
  updateReport: (id: string, data: Partial<Report>) => Promise<void>
  deleteReport: (id: string) => Promise<void>
  
  // CRUD: Engineers
  addEngineer: (data: Partial<Engineer>) => Promise<void>
  updateEngineer: (id: string, data: Partial<Engineer>) => Promise<void>
  deleteEngineer: (id: string) => Promise<void>
  
  // CRUD: Teams
  addTeam: (data: Partial<Team>) => Promise<void>
  updateTeam: (id: string, data: Partial<Team>) => Promise<void>
  deleteTeam: (id: string) => Promise<void>
  
  // Helper functions
  getDMAsByUtility: (utilityId: string) => DMA[]
  getReportsByUtility: (utilityId: string) => Report[]
  getReportsByDMA: (dmaId: string) => Report[]
  getTeamsByDMA: (dmaId: string) => Team[]
  getEngineersByDMA: (dmaId: string) => Engineer[]
  updateReportStatus: (id: string, status: string) => Promise<void>
  assignReport: (id: string, teamId: string) => Promise<void>
}

export const useDataStore = create<DataState>((set, get) => ({
  // Initial state
  utilities: [],
  dmas: [],
  dmaManagers: [],
  engineers: [],
  teams: [],
  reports: [],
  reportsListTotal: null,
  logs: [],
  notifications: [],
  sensors: [],
  tanks: [],
  tankReadingsByTank: {},
  isLoading: false,
  initialized: false,
  error: null,

  // Initialize all data
  initialize: async () => {
    if (get().initialized) return
    set({ isLoading: true, error: null })

    try {
      const bootstrapped = await get().fetchDashboardBootstrap()

      if (bootstrapped) {
        await Promise.all([
          get().fetchEngineers(),
          get().fetchTeams(),
        ])
      } else {
        await Promise.all([
          get().fetchUtilities(),
          get().fetchDMAs(),
          get().fetchEngineers(),
          get().fetchTeams(),
          get().fetchReports(),
        ])
      }

      set({ isLoading: false, initialized: true })
    } catch (error) {
      set({ isLoading: false, error: "Failed to initialize data" })
      console.error("Initialization error:", error)
    }
  },

  // Fetch compact dashboard bootstrap data in one request.
  fetchDashboardBootstrap: async () => {
    try {
      const response = await apiClient.get<{
        utilities?: { items?: unknown[] }
        dmas?: { items?: unknown[] }
        reports?: { total?: number; map_items?: unknown[] }
        notifications?: { items?: unknown[] }
      }>("/dashboard/bootstrap", { cacheTtl: BOOTSTRAP_CACHE_TTL })

      if (!response.success || !response.data) {
        if (!isAbortLikeError(response.error, response.code)) {
          console.error("Error fetching dashboard bootstrap:", response.error)
        }
        return false
      }

      const utilities = (response.data.utilities?.items || []).map(transformKeys) as Utility[]
      const dmas = (response.data.dmas?.items || []).map(transformKeys) as DMA[]
      const reports = (response.data.reports?.map_items || []).map(transformKeys) as Report[]
      const notifications = ((response.data.notifications?.items || []) as Record<string, any>[]).map((item) =>
        normalizeNotification(item)
      )

      set({
        utilities,
        dmas,
        reports,
        reportsListTotal:
          typeof response.data.reports?.total === "number" ? response.data.reports.total : reports.length,
        notifications,
      })

      return true
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching dashboard bootstrap:", error)
      return false
    }
  },

  // Fetch utilities
  fetchUtilities: async () => {
    try {
      const response = await apiClient.get("/utilities?limit=100", { cacheTtl: REFERENCE_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ utilities: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching utilities:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching utilities:", error)
    }
  },

  // Fetch DMAs
  fetchDMAs: async (utilityId?: string) => {
    try {
      const endpoint = utilityId ? `/dmas?utility_id=${utilityId}` : "/dmas"
      const response = await apiClient.get(endpoint, { cacheTtl: REFERENCE_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ dmas: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching DMAs:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching DMAs:", error)
    }
  },

  // Fetch engineers
  fetchEngineers: async (dmaId?: string) => {
    try {
      const endpoint = dmaId ? `/engineers?dma_id=${dmaId}` : "/engineers"
      const response = await apiClient.get(endpoint, { cacheTtl: REFERENCE_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ engineers: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching engineers:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching engineers:", error)
    }
  },

  // Fetch teams
  fetchTeams: async (dmaId?: string) => {
    try {
      const endpoint = dmaId ? `/teams?dma_id=${dmaId}` : "/teams"
      const response = await apiClient.get(endpoint, { cacheTtl: REFERENCE_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ teams: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching teams:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching teams:", error)
    }
  },

  // Fetch reports
  fetchReports: async (filters?: { utilityId?: string; dmaId?: string; status?: string; priority?: string; reportType?: string; search?: string; limit?: number; skip?: number }) => {
    try {
      const params = new URLSearchParams()
      if (filters?.utilityId) params.set("utility_id", filters.utilityId)
      if (filters?.dmaId) params.set("dma_id", filters.dmaId)
      if (filters?.status) params.set("status", filters.status)
      if (filters?.priority) params.set("priority", filters.priority)
      if (filters?.reportType) params.set("report_type", filters.reportType)
      if (filters?.search) params.set("search", filters.search)
      params.set("limit", String(filters?.limit ?? 500))
      params.set("skip", String(filters?.skip ?? 0))

      const endpoint = `/reports${params.toString() ? `?${params}` : ""}`
      const response = await apiClient.get<{ total?: number; items?: unknown[] }>(endpoint, {
        cacheTtl: REPORTS_CACHE_TTL,
      })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({
          reports: transformed,
          reportsListTotal:
            typeof response.data.total === "number" ? response.data.total : transformed.length,
        })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching reports:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching reports:", error)
    }
  },

  // Load every report with GPS for the map (paginates until the API total is reached).
  fetchReportsForMap: async (filters?: { utilityId?: string; dmaId?: string }) => {
    const pageSize = 500
    const maxPages = 500

    const loadReportsForScope = async (scope?: { utilityId?: string; dmaId?: string }) => {
      const collected: Report[] = []
      let total = 0
      let skip = 0
      let page = 0

      while (page < maxPages) {
        const params = new URLSearchParams()
        if (scope?.utilityId) params.set("utility_id", scope.utilityId)
        if (scope?.dmaId) params.set("dma_id", scope.dmaId)
        params.set("has_coordinates", "true")
        params.set("limit", String(pageSize))
        params.set("skip", String(skip))

        const endpoint = `/reports?${params}`
        const response = await apiClient.get<{ total?: number; items?: unknown[] }>(endpoint)
        if (!response.success || !response.data) {
          if (!isAbortLikeError(response.error, response.code)) {
            console.error("Error fetching reports for map:", response.error)
          }
          break
        }

        if (page === 0 && typeof response.data.total === "number") {
          total = response.data.total
        }

        const batch = (response.data.items || []).map(transformKeys) as Report[]
        collected.push(...batch)

        if (batch.length < pageSize) break
        if (total > 0 && collected.length >= total) break

        skip += pageSize
        page += 1
      }

      return {
        reports: collected,
        total: total || collected.length,
      }
    }

    try {
      let result = await loadReportsForScope(filters)

      if (!filters?.utilityId && !filters?.dmaId && result.reports.length === 0) {
        const utilities = get().utilities
        if (utilities.length > 0) {
          const byId = new Map<string, Report>()
          let total = 0

          for (const utility of utilities) {
            const utilityResult = await loadReportsForScope({ utilityId: utility.id })
            total += utilityResult.total
            utilityResult.reports.forEach((report) => {
              byId.set(report.id, report)
            })
          }

          result = {
            reports: Array.from(byId.values()),
            total: total || byId.size,
          }
        }
      }

      set({
        reports: result.reports,
        reportsListTotal: result.total,
      })
    } catch (error) {
      console.error("Error fetching reports for map:", error)
    }
  },

  // Fetch logs
  fetchLogs: async (utilityId?: string, dmaId?: string) => {
    try {
      const params = new URLSearchParams()
      if (utilityId) params.set("utility_id", utilityId)
      if (dmaId) params.set("dma_id", dmaId)

      const endpoint = `/logs${params.toString() ? `?${params}` : ""}`
      const response = await apiClient.get(endpoint)
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ logs: transformed })
      } else {
        console.error("Error fetching logs:", response.error)
      }
    } catch (error) {
      console.error("Error fetching logs:", error)
    }
  },

  // Fetch notifications
  fetchNotifications: async (userId: string) => {
    try {
      const response = await apiClient.get(`/notifications?userId=${userId}`, { cacheTtl: NOTIFICATION_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map((item: Record<string, any>) => normalizeNotification(item))
        set({ notifications: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching notifications:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching notifications:", error)
    }
  },

  fetchSensors: async () => {
    try {
      const response = await apiClient.get("/sensors", { cacheTtl: SENSOR_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ sensors: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching sensors:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching sensors:", error)
    }
  },

  fetchSensor: async (deviceId: string) => {
    try {
      const response = await apiClient.get(`/sensors/${encodeURIComponent(deviceId)}`, { skipCache: true })
      if (!response.success || !response.data) throw new Error(response.error || "Failed to fetch sensor")
      const payload = (response.data as { sensor?: unknown }).sensor ?? response.data
      const sensor = transformKeys(payload) as SensorSnap
      if (!sensor.deviceId) throw new Error("The sensor response did not include a Device ID")
      set((state) => ({ sensors: upsertEntity(state.sensors, sensor) }))
      return sensor
    } catch (error) {
      // Older API deployments may not expose the single-sensor endpoint. A
      // cache-bypassing list refresh still gives the modal current database data.
      await get().fetchSensors()
      const sensor = get().sensors.find((item) => item.deviceId === deviceId)
      if (sensor) return sensor
      throw error
    }
  },

  fetchTanks: async () => {
    try {
      const response = await apiClient.get("/tanks", { cacheTtl: TANK_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys) as TankSnap[]
        set({ tanks: transformed })
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching tanks:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching tanks:", error)
    }
  },

  fetchTankReadings: async (tankId: string, limit = 30, category: SensorCategory = "water_level") => {
    try {
      const response = await apiClient.get(
        `/tanks/${tankId}/readings?limit=${limit}&category=${category}`,
        { cacheTtl: TANK_READING_CACHE_TTL }
      )
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set((state) => ({
          tankReadingsByTank: {
            ...state.tankReadingsByTank,
            [`${tankId}:${category}`]: transformed as TankReading[],
          },
        }))
      } else if (!isAbortLikeError(response.error, response.code)) {
        console.error("Error fetching tank readings:", response.error)
      }
    } catch (error) {
      if (!isAbortLikeError(error)) console.error("Error fetching tank readings:", error)
    }
  },

  registerSensor: async (data: RegisterSensorInput) => {
    try {
      const response = await apiClient.post("/sensors", data, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to register sensor")
      const created = transformKeys(response.data || {}) as SensorSnap
      apiClient.invalidateCache("/sensors")
      set((state) => ({ sensors: upsertEntity(state.sensors, created) }))
      void get().fetchTanks()
      return created
    } catch (error) {
      console.error("Error registering sensor:", error)
      throw error
    }
  },

  updateSensor: async (deviceId: string, data: Partial<RegisterSensorInput>) => {
    try {
      const response = await apiClient.patch(`/sensors/${deviceId}`, data, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to update sensor")
      const updated = transformKeys(response.data || {}) as SensorSnap
      apiClient.invalidateCache("/sensors")
      set((state) => ({ sensors: upsertEntity(state.sensors, updated) }))
      void get().fetchTanks()
      return updated
    } catch (error) {
      console.error("Error updating sensor:", error)
      throw error
    }
  },

  deleteSensor: async (deviceId: string) => {
    try {
      const response = await apiClient.delete(`/sensors/${deviceId}`, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to delete sensor")
      apiClient.invalidateCache("/sensors")
      set((state) => ({ sensors: state.sensors.filter((s) => s.deviceId !== deviceId) }))
      void get().fetchTanks()
    } catch (error) {
      console.error("Error deleting sensor:", error)
      throw error
    }
  },

  detectSensorDma: async (tankId: string) => {
    try {
      const response = await apiClient.get(`/tanks/${tankId}/detect-dma`, { skipCache: true })
      if (response.success && response.data) {
        const data = transformKeys(response.data) as { dmaId: string | null; dmaName: string | null }
        return { dmaId: data.dmaId ?? null, dmaName: data.dmaName ?? null }
      }
      return { dmaId: null, dmaName: null }
    } catch (error) {
      console.error("Error detecting tank DMA:", error)
      return { dmaId: null, dmaName: null }
    }
  },

  updateTankStatus: async (tankId: string, status: "active" | "deactivated") => {
    try {
      const response = await apiClient.patch(`/tanks/${tankId}`, { status }, { skipCache: true })
      if (!response.success) throw new Error(response.error || "Failed to update tank status")
      const updated = transformKeys(response.data || {}) as TankSnap
      set((state) => ({ tanks: upsertEntity(state.tanks, updated) }))
      apiClient.invalidateCache("/tanks")
      void get().fetchSensors()
      return updated
    } catch (error) {
      console.error("Error updating tank status:", error)
      throw error
    }
  },

  // Get unread notification count
  getUnreadNotificationCount: () => {
    return get().notifications.filter((n) => !n.read).length
  },

  markNotificationRead: async (id: string) => {
    try {
      const response = await apiClient.post(`/notifications/${id}/mark-as-read`, {})
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to mark notification as read")
      }

      const transformed = normalizeNotification(response.data as Record<string, any>)
      apiClient.invalidateCache("/notifications")
      set((state) => ({
        notifications: state.notifications.map((notification) =>
          notification.id === id ? transformed : notification
        ),
      }))
      return transformed
    } catch (error) {
      console.error("Error marking notification as read:", error)
      return null
    }
  },

  markAllNotificationsRead: async () => {
    try {
      const response = await apiClient.post("/notifications/mark-all-read", {})
      if (!response.success) {
        throw new Error(response.error || "Failed to mark all notifications as read")
      }

      set((state) => ({
        notifications: state.notifications.map((notification) => ({
          ...notification,
          read: true,
        })),
      }))
      apiClient.invalidateCache("/notifications")

      return Number((response.data as { updated?: number } | undefined)?.updated || 0)
    } catch (error) {
      console.error("Error marking all notifications as read:", error)
      return 0
    }
  },

  // CRUD: Utilities
  addUtility: async (data: Partial<Utility>) => {
    try {
      const createdUtility = await writeUtility("/utilities", "POST", data)
      apiClient.invalidateCache()
      set((state) => ({
        utilities: upsertEntity(state.utilities, createdUtility),
      }))
      return createdUtility
    } catch (error) {
      console.error("Error creating utility:", error)
      throw error
    }
  },

  updateUtility: async (id: string, data: Partial<Utility>) => {
    try {
      const updatedUtility = await writeUtility(`/utilities/${id}`, "PUT", data)
      apiClient.invalidateCache()
      set((state) => ({
        utilities: upsertEntity(state.utilities, updatedUtility),
      }))
      return updatedUtility
    } catch (error) {
      console.error("Error updating utility:", error)
      throw error
    }
  },

  deleteUtility: async (id: string) => {
    try {
      const response = await apiClient.delete(`/utilities/${id}`)
      if (!response.success) throw new Error(response.error || "Failed to delete utility")
      apiClient.invalidateCache("/utilities")
      apiClient.invalidateCache("/dmas")
      set((state) => ({
        utilities: state.utilities.filter((utility) => utility.id !== id),
        dmas: state.dmas.filter((dma) => dma.utilityId !== id),
        reports: state.reports.filter((report) => report.utilityId !== id),
      }))
    } catch (error) {
      console.error("Error deleting utility:", error)
      throw error
    }
  },

  // CRUD: DMAs
  addDMA: async (data: Partial<DMA>) => {
    try {
      const response = await apiClient.post("/dmas", data)
      if (!response.success) throw new Error(response.error || "Failed to create DMA")
      const createdDMA = transformKeys(response.data || {}) as DMA
      apiClient.invalidateCache("/dmas")
      apiClient.invalidateCache("/utilities")
      set((state) => ({
        dmas: upsertEntity(state.dmas, createdDMA),
      }))
      return createdDMA
    } catch (error) {
      console.error("Error creating DMA:", error)
      throw error
    }
  },

  updateDMA: async (id: string, data: Partial<DMA>) => {
    try {
      const response = await apiClient.put(`/dmas/${id}`, data)
      if (!response.success) throw new Error(response.error || "Failed to update DMA")
      const updatedDMA = transformKeys(response.data || {}) as DMA
      apiClient.invalidateCache("/dmas")
      apiClient.invalidateCache("/utilities")
      set((state) => ({
        dmas: upsertEntity(state.dmas, updatedDMA),
      }))
      return updatedDMA
    } catch (error) {
      console.error("Error updating DMA:", error)
      throw error
    }
  },

  deleteDMA: async (id: string) => {
    try {
      const response = await apiClient.delete(`/dmas/${id}`)
      if (!response.success) throw new Error(response.error || "Failed to delete DMA")
      apiClient.invalidateCache("/dmas")
      apiClient.invalidateCache("/utilities")
      set((state) => ({
        dmas: state.dmas.filter((dma) => dma.id !== id),
        teams: state.teams.filter((team) => team.dmaId !== id),
        engineers: state.engineers.filter((engineer) => engineer.dmaId !== id),
        reports: state.reports.filter((report) => report.dmaId !== id),
      }))
    } catch (error) {
      console.error("Error deleting DMA:", error)
      throw error
    }
  },

  // Fetch DMA Managers
  fetchDMAManagers: async () => {
    try {
      const response = await apiClient.get("/dma-managers", { cacheTtl: REFERENCE_CACHE_TTL })
      if (response.success && response.data) {
        const transformed = (response.data.items || []).map(transformKeys)
        set({ dmaManagers: transformed })
      } else {
        console.error("Error fetching DMA managers:", response.error)
      }
    } catch (error) {
      console.error("Error fetching DMA managers:", error)
    }
  },

  // CRUD: DMA Managers
  addDMAManager: async (data: Partial<DMAManager>) => {
    try {
      const response = await apiClient.post("/dma-managers", data)
      if (!response.success) throw new Error(response.error || "Failed to create DMA manager")
      apiClient.invalidateCache("/dma-managers")
      apiClient.invalidateCache("/dmas")
      const createdManager = entityFromResponse<DMAManager>(response.data)
      if (createdManager) {
        set((state) => ({
          dmaManagers: upsertEntity(state.dmaManagers, createdManager),
        }))
      } else {
        await get().fetchDMAManagers()
      }
    } catch (error) {
      console.error("Error creating DMA manager:", error)
      throw error
    }
  },

  updateDMAManager: async (id: string, data: Partial<DMAManager>) => {
    try {
      const response = await apiClient.put(`/dma-managers/${id}`, data)
      if (!response.success) {
        throw new Error(response.error || "Failed to update DMA manager")
      }
      apiClient.invalidateCache("/dma-managers")
      apiClient.invalidateCache("/dmas")
      const updatedManager = entityFromResponse<DMAManager>(response.data)
      if (updatedManager) {
        set((state) => ({
          dmaManagers: upsertEntity(state.dmaManagers, updatedManager),
        }))
      } else {
        await get().fetchDMAManagers()
      }
    } catch (error) {
      console.error("Error updating DMA manager:", error)
      throw error
    }
  },

  deleteDMAManager: async (id: string) => {
    try {
      const response = await apiClient.delete(`/dma-managers/${id}`)
      if (!response.success) throw new Error(response.error || "Failed to delete DMA manager")
      apiClient.invalidateCache("/dma-managers")
      apiClient.invalidateCache("/dmas")
      set((state) => ({
        dmaManagers: state.dmaManagers.filter((manager) => manager.id !== id),
        dmas: state.dmas.map((dma) => dma.managerId === id ? { ...dma, managerId: null, managerName: undefined } : dma),
      }))
    } catch (error) {
      console.error("Error deleting DMA manager:", error)
      throw error
    }
  },

  // CRUD: Reports
  addReport: async (data: Partial<Report>) => {
    try {
      const response = await apiClient.post("/reports", data)
      if (!response.success) throw new Error(response.error || "Failed to create report")
      apiClient.invalidateCache("/reports")
      const createdReport = entityFromResponse<Report>(response.data)
      if (createdReport) {
        set((state) => ({
          reports: upsertEntity(state.reports, createdReport),
          reportsListTotal: state.reportsListTotal === null ? null : state.reportsListTotal + 1,
        }))
      } else {
        await get().fetchReports()
      }
    } catch (error) {
      console.error("Error creating report:", error)
      throw error
    }
  },

  updateReport: async (id: string, data: Partial<Report>) => {
    try {
      const response = await apiClient.put(`/reports/${id}`, data)
      if (!response.success) throw new Error(response.error || "Failed to update report")
      apiClient.invalidateCache("/reports")
      const updatedReport = entityFromResponse<Report>(response.data)
      if (updatedReport) {
        set((state) => ({
          reports: upsertEntity(state.reports, updatedReport),
        }))
      } else {
        set((state) => ({
          reports: state.reports.map((report) => report.id === id ? { ...report, ...data } : report),
        }))
      }
    } catch (error) {
      console.error("Error updating report:", error)
      throw error
    }
  },

  deleteReport: async (id: string) => {
    try {
      const response = await apiClient.delete(`/reports/${id}`)
      if (!response.success) throw new Error(response.error || "Failed to delete report")
      apiClient.invalidateCache("/reports")
      set((state) => ({
        reports: state.reports.filter((report) => report.id !== id),
        reportsListTotal: state.reportsListTotal === null ? null : Math.max(0, state.reportsListTotal - 1),
      }))
    } catch (error) {
      console.error("Error deleting report:", error)
      throw error
    }
  },

  // CRUD: Engineers
  addEngineer: async (data: Partial<Engineer>) => {
    try {
      const response = await apiClient.post("/engineers", data)
      if (!response.success) throw new Error(response.error || "Failed to create engineer")
      apiClient.invalidateCache("/engineers")
      const createdEngineer = entityFromResponse<Engineer>(response.data)
      if (createdEngineer) {
        set((state) => ({
          engineers: upsertEntity(state.engineers, createdEngineer),
        }))
      } else {
        await get().fetchEngineers()
      }
    } catch (error) {
      console.error("Error creating engineer:", error)
      throw error
    }
  },

  updateEngineer: async (id: string, data: Partial<Engineer>) => {
    try {
      const response = await apiClient.put(`/engineers/${id}`, data)
      if (!response.success) throw new Error(response.error || "Failed to update engineer")
      apiClient.invalidateCache("/engineers")
      const updatedEngineer = entityFromResponse<Engineer>(response.data)
      if (updatedEngineer) {
        set((state) => ({
          engineers: upsertEntity(state.engineers, updatedEngineer),
        }))
      } else {
        set((state) => ({
          engineers: state.engineers.map((engineer) => engineer.id === id ? { ...engineer, ...data } : engineer),
        }))
      }
    } catch (error) {
      console.error("Error updating engineer:", error)
      throw error
    }
  },

  deleteEngineer: async (id: string) => {
    try {
      const response = await apiClient.delete(`/engineers/${id}`)
      if (!response.success) throw new Error(response.error || "Failed to delete engineer")
      apiClient.invalidateCache("/engineers")
      set((state) => ({
        engineers: state.engineers.filter((engineer) => engineer.id !== id),
      }))
    } catch (error) {
      console.error("Error deleting engineer:", error)
      throw error
    }
  },

  // CRUD: Teams
  addTeam: async (data: Partial<Team>) => {
    try {
      const response = await apiClient.post("/teams", data)
      if (!response.success) throw new Error(response.error || "Failed to create team")
      apiClient.invalidateCache("/teams")
      const createdTeam = entityFromResponse<Team>(response.data)
      if (createdTeam) {
        set((state) => ({
          teams: upsertEntity(state.teams, createdTeam),
        }))
      } else {
        await get().fetchTeams()
      }
    } catch (error) {
      console.error("Error creating team:", error)
      throw error
    }
  },

  updateTeam: async (id: string, data: Partial<Team>) => {
    try {
      const response = await apiClient.put(`/teams/${id}`, data)
      if (!response.success) throw new Error(response.error || "Failed to update team")
      apiClient.invalidateCache("/teams")
      const updatedTeam = entityFromResponse<Team>(response.data)
      if (updatedTeam) {
        set((state) => ({
          teams: upsertEntity(state.teams, updatedTeam),
        }))
      } else {
        set((state) => ({
          teams: state.teams.map((team) => team.id === id ? { ...team, ...data } : team),
        }))
      }
    } catch (error) {
      console.error("Error updating team:", error)
      throw error
    }
  },

  deleteTeam: async (id: string) => {
    try {
      const response = await apiClient.delete(`/teams/${id}`)
      if (!response.success) throw new Error(response.error || "Failed to delete team")
      apiClient.invalidateCache("/teams")
      set((state) => ({
        teams: state.teams.filter((team) => team.id !== id),
        engineers: state.engineers.map((engineer) => engineer.teamId === id ? { ...engineer, teamId: null, teamName: null } : engineer),
        reports: state.reports.map((report) => report.teamId === id ? { ...report, teamId: null, teamName: null } : report),
      }))
    } catch (error) {
      console.error("Error deleting team:", error)
      throw error
    }
  },

  // Helper functions
  getDMAsByUtility: (utilityId: string) => {
    return get().dmas.filter((d) => d.utilityId === utilityId)
  },

  getReportsByUtility: (utilityId: string) => {
    return get().reports.filter((r) => r.utilityId === utilityId)
  },

  getReportsByDMA: (dmaId: string) => {
    return get().reports.filter((r) => r.dmaId === dmaId)
  },

  getTeamsByDMA: (dmaId: string) => {
    return get().teams.filter((t) => t.dmaId === dmaId)
  },

  getEngineersByDMA: (dmaId: string) => {
    return get().engineers.filter((e) => e.dmaId === dmaId)
  },

  updateReportStatus: async (id: string, status: string) => {
    try {
      const response = await apiClient.put(`/reports/${id}`, { status })
      if (!response.success) throw new Error(response.error || "Failed to update report status")
      apiClient.invalidateCache("/reports")
      const updatedReport = entityFromResponse<Report>(response.data)
      set((state) => ({
        reports: state.reports.map((report) =>
          report.id === id ? (updatedReport || { ...report, status: status as ReportStatus }) : report
        ),
      }))
    } catch (error) {
      console.error("Error updating report status:", error)
      throw error
    }
  },

  assignReport: async (id: string, teamId: string) => {
    try {
      const response = await apiClient.put(`/reports/${id}/assign`, {
        team_id: teamId,
      })
      if (!response.success) throw new Error(response.error || "Failed to assign report")
      apiClient.invalidateCache("/reports")
      const updatedReport = entityFromResponse<Report>(response.data)
      const team = get().teams.find((item) => item.id === teamId)
      set((state) => ({
        reports: state.reports.map((report) =>
          report.id === id
            ? (updatedReport || { ...report, teamId, teamName: team?.name ?? report.teamName })
            : report
        ),
      }))
    } catch (error) {
      console.error("Error assigning report:", error)
      throw error
    }
  },
}))

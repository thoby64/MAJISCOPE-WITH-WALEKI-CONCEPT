// ============================================================
// Majiscope - TypeScript Type Definitions
// All entity interfaces and enums for the system
// ============================================================

// ---------- Enums ----------

export type UserRole = "admin" | "utility_manager" | "dma_manager" | "user"

export type EntityStatus = "active" | "inactive"

export type ReportStatus =
  | "new"
  | "assigned"
  | "in_progress"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "closed"

export type ReportPriority = "low" | "medium" | "high" | "critical"
export type ReportType = "leakage" | "non_leakage"
export type LeakageType =
  | "ground_leakage"
  | "pipe_burst"
  | "meter_leakage"
  | "valve_leakage"
  | "overflow"
  | "unknown"

export type NotificationType = "info" | "warning" | "success" | "error"

// ---------- Core Entities ----------

export interface User {
  id: string
  email: string
  password: string // Mock only - never store plaintext in production
  name: string
  role: UserRole
  utilityId?: string
  dmaId?: string
  avatar?: string
  phone?: string
  status: EntityStatus
  createdAt: string
}

export interface Utility {
  id: string
  slug?: string | null
  name: string
  regionName?: string | null
  description: string
  managerId: string
  managerName: string
  centerLatitude?: number | null
  centerLongitude?: number | null
  boundaryGeojson?: GeoJsonBoundary | null
  boundarySourceType?: "none" | "uploaded" | null
  boundaryStatus?: "none" | "verified" | null
  serviceAreas?: UtilityServiceArea[]
  status: EntityStatus
  dmasCount: number
  createdAt: string
}

export interface GeoJsonPolygon {
  type: "Polygon"
  coordinates: number[][][]
}

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon"
  coordinates: number[][][][]
}

export type GeoJsonBoundary = GeoJsonPolygon | GeoJsonMultiPolygon

export type UtilityServiceAreaCategory =
  | "region"
  | "district"
  | "city"
  | "town"
  | "ward"
  | "village"
  | "custom_area"
  | "infrastructure_corridor"

export interface UtilityServiceArea {
  id?: string
  utilityId?: string
  category: UtilityServiceAreaCategory
  name: string
  regionName?: string | null
  adminAreaId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface DMA {
  id: string
  slug?: string | null
  name: string
  utilityId: string
  utilityName: string
  centerLatitude?: number
  centerLongitude?: number
  boundaryGeojson?: GeoJsonPolygon | null
  managerId: string
  managerName: string
  status: EntityStatus
  teamsCount: number
  createdAt: string
}

export interface Engineer {
  id: string
  name: string
  email: string
  phone: string
  dmaId: string
  teamId?: string
  teamName?: string
  status: EntityStatus
  role: "engineer" | "team_leader"
  assignedReports: number
  createdAt: string
}

export interface Team {
  id: string
  name: string
  dmaId: string
  leaderId: string
  leaderName: string
  engineerIds: string[]
  memberCount: number
  status: EntityStatus
  activeReports: number
  createdAt: string
}

export interface Report {
  id: string
  trackingId: string
  description: string
  latitude: number
  longitude: number
  address: string
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
  teamId?: string
  teamName?: string
  teamLeaderId?: string
  teamLeaderName?: string
  assignedEngineerId?: string
  assignedEngineerName?: string
  reporterName: string
  reporterPhone: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  slaDeadline: string
  notes?: string
  engineerSubmissionNotes?: string
  teamLeaderReviewNotes?: string
  dmaReviewNotes?: string
}

export interface ActivityLog {
  id: string
  action: string
  userId: string
  userName: string
  userRole: UserRole
  entity: string
  entityId: string
  timestamp: string
  details: string
  utilityId?: string
  dmaId?: string
}

export interface Notification {
  id: string
  title: string
  message: string
  type: NotificationType
  read: boolean
  createdAt: string
  link?: string
}

// ---------- Store Types ----------

export interface AuthState {
  currentUser: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => boolean
  logout: () => void
  clearError: () => void
}

export interface DataState {
  utilities: Utility[]
  dmas: DMA[]
  engineers: Engineer[]
  teams: Team[]
  reports: Report[]
  logs: ActivityLog[]
  notifications: Notification[]

  // Utility CRUD
  addUtility: (utility: Omit<Utility, "id" | "createdAt" | "dmasCount">) => void
  updateUtility: (id: string, data: Partial<Utility>) => void
  deleteUtility: (id: string) => void

  // DMA CRUD
  addDMA: (dma: Omit<DMA, "id" | "createdAt" | "teamsCount">) => void
  updateDMA: (id: string, data: Partial<DMA>) => void
  deleteDMA: (id: string) => void

  // Engineer CRUD
  addEngineer: (engineer: Omit<Engineer, "id" | "createdAt" | "assignedReports">) => void
  updateEngineer: (id: string, data: Partial<Engineer>) => void
  deleteEngineer: (id: string) => void

  // Team CRUD
  addTeam: (team: Omit<Team, "id" | "createdAt" | "activeReports" | "memberCount">) => void
  updateTeam: (id: string, data: Partial<Team>) => void
  deleteTeam: (id: string) => void

  // Report actions
  updateReportStatus: (id: string, status: ReportStatus) => void
  assignReport: (reportId: string, teamId: string) => void

  // Notification actions
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void

  // Filtered getters
  getDMAsByUtility: (utilityId: string) => DMA[]
  getEngineersByDMA: (dmaId: string) => Engineer[]
  getTeamsByDMA: (dmaId: string) => Team[]
  getReportsByUtility: (utilityId: string) => Report[]
  getReportsByDMA: (dmaId: string) => Report[]
  getLogsByUtility: (utilityId: string) => ActivityLog[]
  getUnreadNotificationCount: () => number
}

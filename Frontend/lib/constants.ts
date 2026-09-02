// ============================================================
// Majiscope - Constants & Configuration
// Navigation config, role permissions, status mappings
// ============================================================

import {
  LayoutDashboard,
  MapPin,
  Users,
  UserCog,
  FileText,
  Bell,
  BarChart3,
  ScrollText,
  Route,
  FileChartColumn,
  Droplets,
  Gauge,
} from "lucide-react"
import type { ComponentType } from "react"
import { HydraulicPumpIcon } from "@/components/icons/hydraulic-pump-icon"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { InfrastructureUploadIcon } from "@/components/icons/infrastructure-upload-icon"
import { SensorIcon } from "@/components/icons/sensor-icon"
import type { UserRole, ReportStatus, ReportPriority, EntityStatus, LeakageType } from "./types"
import { PALETTE } from "./palette"

// ---------- Navigation ----------

export interface NavItem {
  title: string
  href: string
  icon: ComponentType<{ className?: string }>
  roles: UserRole[] // which roles can see this item
  badge?: number
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
  {
    title: "Utilities",
    href: "/dashboard/utilities",
    icon: WaterUtilityIcon,
    roles: ["admin"],
  },
  {
    title: "Infrastructure Upload",
    href: "/dashboard/utility-infrastructure",
    icon: InfrastructureUploadIcon,
    roles: ["admin", "utility_manager"],
  },
  {
    title: "Run Hydraulic Model",
    href: "/dashboard/hydraulic-model",
    icon: HydraulicPumpIcon,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
  {
    title: "Hydraulic Model Scenarios",
    href: "/dashboard/hydraulic-reports",
    icon: FileChartColumn,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
  {
    title: "Sensor Data Monitoring",
    href: "/dashboard/sensor-data",
    icon: Droplets,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
  {
    title: "Sensor Management",
    href: "/dashboard/sensors",
    icon: SensorIcon,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
  {
    title: "Utility Managers",
    href: "/dashboard/managers",
    icon: UserCog,
    roles: ["admin"],
  },
  {
    title: "DMAs",
    href: "/dashboard/dmas",
    icon: MapPin,
    roles: ["admin", "utility_manager"],
  },
  {
    title: "DMA Managers",
    href: "/dashboard/dma-managers",
    icon: UserCog,
    roles: ["admin", "utility_manager"],
  },
  {
    title: "Engineers",
    href: "/dashboard/engineers",
    icon: Users,
    roles: ["dma_manager", "utility_manager"],
  },
  {
    title: "Teams",
    href: "/dashboard/teams",
    icon: UserCog,
    roles: ["dma_manager"],
  },
  {
    title: "Team Leaders",
    href: "/dashboard/team-leaders",
    icon: UserCog,
    roles: ["dma_manager"],
  },
  {
    title: "Reports",
    href: "/dashboard/reports",
    icon: FileText,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
  {
    title: "Location Routing",
    href: "/dashboard/location-routing",
    icon: Route,
    roles: ["admin"],
  },
  {
    title: "Notifications",
    href: "/dashboard/notifications",
    icon: Bell,
    roles: ["admin", "utility_manager", "dma_manager"],
  },
  {
    title: "Analytics",
    href: "/dashboard/analytics",
    icon: BarChart3,
    roles: ["admin", "utility_manager"],
  },
  {
    title: "Activity Logs",
    href: "/dashboard/logs",
    icon: ScrollText,
    roles: ["admin"],
  },
]

// ---------- Role Labels ----------

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "System Administrator",
  utility_manager: "Utility Manager",
  dma_manager: "DMA Manager",
  user: "Administrator",
}

export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  utility_manager: "Utility Mgr",
  dma_manager: "DMA Mgr",
  user: "Admin",
}

// Role badge gradients — aligned to the palette: admin gets the cyan/sky
// brand accent, utility_manager uses the shared blue chart token (categorical),
// everything else stays neutral slate. Gradient + white text stays readable in
// both themes without hardcoded hues.
export const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  admin: "from-cyan-500 to-cyan-700",
  utility_manager: "from-blue-500 to-blue-700",
  dma_manager: "from-slate-500 to-slate-600",
  user: "from-slate-600 to-slate-700",
}

export function getRoleBadgeClass(role: string): string {
  return ROLE_BADGE_CLASSES[role as UserRole] ?? "from-slate-600 to-slate-700"
}

// ---------- Status Configurations ----------

export const REPORT_STATUS_CONFIG: Record<
  ReportStatus,
  { label: string; color: string; bgColor: string }
> = {
  new: {
    label: "New",
    color: "text-cyan-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.accent,
  },
  assigned: {
    label: "Assigned",
    color: "text-cyan-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.accent,
  },
  in_progress: {
    label: "In Progress",
    color: "text-cyan-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.accent,
  },
  pending_approval: {
    label: "Awaiting DMA Approval",
    color: "text-cyan-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.accent,
  },
  approved: {
    label: "Approved",
    color: "text-emerald-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.success,
  },
  rejected: {
    label: "Rejected",
    color: "text-red-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.danger,
  },
  closed: {
    label: "Closed",
    color: "text-slate-600",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.neutral,
  },
}

export const PRIORITY_CONFIG: Record<
  ReportPriority,
  { label: string; color: string; bgColor: string }
> = {
  low: {
    label: "Low",
    color: "text-sky-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.accent,
  },
  medium: {
    label: "Moderate",
    color: "text-amber-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.warning,
  },
  high: {
    label: "High",
    color: "text-red-700",
    bgColor: PALETTE.STATUS_BADGE_CLASSES.danger,
  },
  critical: {
    label: "Critical",
    color: "text-red-900",
    bgColor: "bg-red-100 border-red-300",
  },
}

export const LEAKAGE_TYPE_CONFIG: Record<
  LeakageType,
  { label: string; color: string }
> = {
  ground_leakage: {
    label: "Ground Leakage",
    color: PALETTE.chart.chart1,
  },
  pipe_burst: { label: "Pipe Burst", color: PALETTE.chart.chart4 },
  meter_leakage: {
    label: "Meter Leakage",
    color: PALETTE.chart.chart5,
  },
  valve_leakage: {
    label: "Valve Leakage",
    color: PALETTE.chart.chart3,
  },
  overflow: { label: "Overflow", color: PALETTE.chart.chart2 },
  unknown: { label: "I don't know", color: PALETTE.semantic.neutral.base },
}

export const ENTITY_STATUS_CONFIG: Record<
  EntityStatus,
  { label: string; color: string; bgColor: string }
> = {
  active: {
    label: "Active",
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-200",
  },
  inactive: { label: "Inactive", color: "text-gray-700", bgColor: "bg-gray-100 border-gray-300" },
}

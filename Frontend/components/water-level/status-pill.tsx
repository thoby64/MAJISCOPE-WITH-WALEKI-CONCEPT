"use client"

import { cn } from "@/lib/utils"

type WaterStatus = "active" | "warning" | "critical" | "inactive"

const WATER_STATUS_CONFIG: Record<WaterStatus, { label: string; color: string; bgColor: string }> = {
  active: { label: "Active", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200" },
  warning: { label: "Warning", color: "text-amber-700", bgColor: "bg-amber-50 border-amber-200" },
  critical: { label: "Critical", color: "text-red-700", bgColor: "bg-red-50 border-red-200" },
  inactive: { label: "Inactive", color: "text-slate-600", bgColor: "bg-slate-100 border-slate-300" },
}

interface WaterStatusPillProps {
  status: string
  className?: string
}

export function WaterStatusPill({ status, className }: WaterStatusPillProps) {
  const config = WATER_STATUS_CONFIG[status as WaterStatus] ?? WATER_STATUS_CONFIG.inactive
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.color,
        config.bgColor,
        className
      )}
    >
      {config.label}
    </span>
  )
}

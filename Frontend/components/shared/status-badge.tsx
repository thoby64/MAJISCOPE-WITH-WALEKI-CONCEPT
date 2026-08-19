import { cn } from "@/lib/utils"
import {
  REPORT_STATUS_CONFIG,
  PRIORITY_CONFIG,
  ENTITY_STATUS_CONFIG,
} from "@/lib/constants"
import type { ReportStatus, ReportPriority, EntityStatus } from "@/lib/types"

interface StatusBadgeProps {
  status: ReportStatus
  className?: string
}

export function ReportStatusBadge({ status, className }: StatusBadgeProps) {
  const config = REPORT_STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.bgColor,
        config.color,
        className
      )}
    >
      {config.label}
    </span>
  )
}

interface PriorityBadgeProps {
  priority: ReportPriority
  className?: string
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.bgColor,
        config.color,
        className
      )}
    >
      {config.label}
    </span>
  )
}

interface EntityStatusBadgeProps {
  status: EntityStatus
  className?: string
}

export function EntityStatusBadge({ status, className }: EntityStatusBadgeProps) {
  const config = ENTITY_STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.bgColor,
        config.color,
        className
      )}
    >
      {config.label}
    </span>
  )
}

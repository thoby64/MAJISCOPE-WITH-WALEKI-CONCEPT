import {
  CircleAlert,
  CircleHelp,
  Droplets,
  Gauge,
  Tag,
  Waves,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { LEAKAGE_TYPE_CONFIG } from "@/lib/constants"
import type { LeakageType } from "@/lib/types"
import { PALETTE } from "@/lib/palette"

const LEAKAGE_TYPE_ICONS: Partial<Record<LeakageType, LucideIcon>> = {
  ground_leakage: Droplets,
  pipe_burst: CircleAlert,
  meter_leakage: Gauge,
  valve_leakage: Wrench,
  overflow: Waves,
  unknown: CircleHelp,
}

const formatLeakageType = (type: string) =>
  type
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")

export function LeakageTypeBadge({ type }: { type?: LeakageType | string | null }) {
  const normalizedType = type || "unknown"
  const knownType = normalizedType as LeakageType
  const config = LEAKAGE_TYPE_CONFIG[knownType]
  const Icon = LEAKAGE_TYPE_ICONS[knownType] || Tag
  const color = config?.color || PALETTE.semantic.neutral.base
  const label = config?.label || formatLeakageType(normalizedType)

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none"
      style={{
        borderColor: `${color}55`,
        backgroundColor: `${color}14`,
        color,
      }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

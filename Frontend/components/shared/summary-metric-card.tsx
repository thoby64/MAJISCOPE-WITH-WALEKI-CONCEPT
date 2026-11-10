import type { ComponentType } from "react"
import { cn } from "@/lib/utils"

export type SummaryMetricTone = "slate" | "blue" | "amber" | "red"
type SummaryMetricIcon = ComponentType<{ className?: string; strokeWidth?: number }>

const toneClasses: Record<SummaryMetricTone, string> = {
  slate: "content-metric-card--slate",
  blue: "content-metric-card--blue",
  amber: "content-metric-card--amber",
  red: "content-metric-card--red",
}

export function SummaryMetricCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
  className,
}: {
  label: string
  value: number | string
  icon: SummaryMetricIcon
  tone?: SummaryMetricTone
  className?: string
}) {
  return (
    <article className={cn("content-metric-card", toneClasses[tone], className)}>
      <span className="content-metric-card__accent" aria-hidden="true" />
      <div className="content-metric-card__copy">
        <p className="content-metric-card__label">{label}</p>
        <p className="content-metric-card__value">{typeof value === "number" ? value.toLocaleString() : value}</p>
      </div>
      <span className="content-metric-card__icon" aria-hidden="true">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
      </span>
    </article>
  )
}

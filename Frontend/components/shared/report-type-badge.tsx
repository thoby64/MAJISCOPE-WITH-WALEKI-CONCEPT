import { ClipboardList, Droplets } from "lucide-react"
import type { ReportType } from "@/lib/types"

const REPORT_TYPE_META = {
  leakage: {
    label: "Leakage",
    Icon: Droplets,
    className: "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200",
  },
  non_leakage: {
    label: "Non-leakage",
    Icon: ClipboardList,
    className: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  },
} as const

export function ReportTypeBadge({ type }: { type?: ReportType | string | null }) {
  const normalized = type === "non_leakage" ? "non_leakage" : "leakage"
  const { label, Icon, className } = REPORT_TYPE_META[normalized]

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none ${className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

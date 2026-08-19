"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { getUtilityInfrastructureAsset, useDataStore } from "@/store/data-store"
import { OperationsMap } from "@/components/maps/operations-map"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatTanzaniaDate } from "@/lib/date-time"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  ClipboardCheck,
  Flame,
  Gauge,
  Layers3,
  Loader2,
  MapPinned,
  Route,
  ShieldAlert,
  Users,
} from "lucide-react"

type DateFilter = "all" | "today" | "7d" | "30d" | "90d"
type OverlayTone = "slate" | "blue" | "amber" | "emerald" | "rose"
type OverlayTheme = "light" | "dark"

type BreakdownMetric = {
  key: string
  name: string
  value: number
}

const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
]

const RESOLVED_STATUSES = new Set(["approved", "closed"])
const HOTSPOT_CELL_SIZE = 0.004

const TONE_STYLES: Record<
  OverlayTone,
  {
    shell: Record<OverlayTheme, string>
    icon: Record<OverlayTheme, string>
    chip: string
    progress: string
  }
> = {
  slate: {
    shell: {
      dark: "border-white/12 bg-slate-950/78 text-white",
      light: "border-slate-200/85 bg-white/90 text-slate-900",
    },
    icon: {
      dark: "bg-white/10 text-white shadow-slate-950/20",
      light: "bg-slate-900 text-white shadow-slate-900/20",
    },
    chip: "bg-slate-100 text-slate-700",
    progress: "bg-slate-700",
  },
  blue: {
    shell: {
      dark: "border-cyan-400/20 bg-slate-950/78 text-white",
      light: "border-cyan-200/80 bg-white/90 text-slate-900",
    },
    icon: {
      dark: "bg-cyan-500/18 text-cyan-100 shadow-cyan-900/20",
      light: "bg-cyan-600 text-white shadow-cyan-600/20",
    },
    chip: "bg-cyan-50 text-cyan-700",
    progress: "bg-cyan-600",
  },
  amber: {
    shell: {
      dark: "border-amber-400/20 bg-slate-950/78 text-white",
      light: "border-amber-200/80 bg-white/90 text-slate-900",
    },
    icon: {
      dark: "bg-amber-500/18 text-amber-100 shadow-amber-900/20",
      light: "bg-amber-500 text-white shadow-amber-500/20",
    },
    chip: "bg-amber-50 text-amber-700",
    progress: "bg-amber-500",
  },
  emerald: {
    shell: {
      dark: "border-emerald-400/20 bg-slate-950/78 text-white",
      light: "border-emerald-200/80 bg-white/90 text-slate-900",
    },
    icon: {
      dark: "bg-emerald-500/18 text-emerald-100 shadow-emerald-900/20",
      light: "bg-emerald-600 text-white shadow-emerald-600/20",
    },
    chip: "bg-emerald-50 text-emerald-700",
    progress: "bg-emerald-600",
  },
  rose: {
    shell: {
      dark: "border-rose-400/20 bg-slate-950/78 text-white",
      light: "border-rose-200/80 bg-white/90 text-slate-900",
    },
    icon: {
      dark: "bg-rose-500/18 text-rose-100 shadow-rose-900/20",
      light: "bg-rose-600 text-white shadow-rose-600/20",
    },
    chip: "bg-rose-50 text-rose-700",
    progress: "bg-rose-600",
  },
}

function hasUsableCoordinates(report: { latitude: number; longitude: number }) {
  return (
    Number.isFinite(report.latitude) &&
    Number.isFinite(report.longitude) &&
    !(report.latitude === 0 && report.longitude === 0)
  )
}

function passesDateFilter(dateValue: string | undefined, filter: DateFilter) {
  if (filter === "all") return true
  if (!dateValue) return false

  const created = new Date(dateValue)
  if (Number.isNaN(created.getTime())) return false

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffMs = now.getTime() - created.getTime()
  const diffDays = diffMs / 86_400_000

  switch (filter) {
    case "today":
      return created >= startOfToday
    case "7d":
      return diffDays <= 7
    case "30d":
      return diffDays <= 30
    case "90d":
      return diffDays <= 90
    default:
      return true
  }
}

function isOpenReport(status: string) {
  return !RESOLVED_STATUSES.has(status) && status !== "rejected"
}

function isHighSeverity(priority?: string | null) {
  return priority === "high" || priority === "critical"
}

function truncateLabel(value: string, maxLength = 22) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

function findDominantItem(items: BreakdownMetric[]) {
  return [...items].sort((left, right) => right.value - left.value)[0] ?? null
}

function formatCompactValue(value: number, suffix = "") {
  return `${value.toLocaleString()}${suffix}`
}

function getReportDisplayName(report: {
  trackingId?: string | null
  description?: string | null
  address?: string | null
}) {
  const primary = report.trackingId?.trim()
  const secondary = report.description?.trim() || report.address?.trim() || "Leak report"
  return primary ? `${primary} · ${secondary}` : secondary
}

function ProgressList({
  items,
  tone = "blue",
  emptyMessage,
}: {
  items: BreakdownMetric[]
  tone?: OverlayTone
  emptyMessage: string
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0)

  if (!items.length) {
    return <p className="text-sm text-slate-500">{emptyMessage}</p>
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const width = maxValue > 0 ? Math.max((item.value / maxValue) * 100, 8) : 0
        return (
          <div key={item.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700">{item.name}</span>
              <span className="text-sm font-semibold text-slate-900">{item.value.toLocaleString()}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-[width]", TONE_STYLES[tone].progress)}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DetailRow({
  label,
  value,
  tone = "slate",
}: {
  label: string
  value: ReactNode
  tone?: OverlayTone
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", TONE_STYLES[tone].chip)}>
        {value}
      </span>
    </div>
  )
}

function OverlayButton({
  icon: Icon,
  label,
  value,
  caption,
  tone = "slate",
  side = "right",
  align = "start",
  theme = "dark",
  children,
  className,
}: {
  icon: typeof MapPinned
  label: string
  value: ReactNode
  caption?: string
  tone?: OverlayTone
  side?: "left" | "right" | "bottom" | "top"
  align?: "start" | "center" | "end"
  theme?: OverlayTheme
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toneStyle = TONE_STYLES[tone]

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  const openPreview = () => {
    clearCloseTimeout()
    setOpen(true)
  }

  const closePreview = () => {
    clearCloseTimeout()
    closeTimeoutRef.current = setTimeout(() => {
      if (!pinned) {
        setOpen(false)
      }
    }, 120)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        clearCloseTimeout()
        setOpen(nextOpen)
        if (!nextOpen) {
          setPinned(false)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={openPreview}
          onMouseLeave={closePreview}
          onClick={() => {
            clearCloseTimeout()
            setPinned((current) => {
              const nextPinned = !current
              setOpen(nextPinned || !open)
              return nextPinned
            })
          }}
          className={cn(
            "group pointer-events-auto w-full rounded-[24px] border px-3 py-3 text-left shadow-[0_18px_45px_-26px_rgba(15,23,42,0.45)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-30px_rgba(15,23,42,0.5)]",
            toneStyle.shell[theme],
            className
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-lg transition-transform duration-300 group-hover:scale-[1.03]",
                toneStyle.icon[theme]
              )}
            >
              <Icon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", theme === "dark" ? "text-white/58" : "text-slate-500")}>
                {label}
              </p>
              <p className={cn("mt-1 truncate text-lg font-semibold tracking-tight", theme === "dark" ? "text-white" : "text-slate-950")}>
                {value}
              </p>
              {caption ? (
                <p className={cn("mt-1 text-xs", theme === "dark" ? "text-white/72" : "text-slate-500")}>
                  {caption}
                </p>
              ) : null}
            </div>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={14}
        onMouseEnter={openPreview}
        onMouseLeave={closePreview}
        className="z-[3500] w-[min(27rem,calc(100vw-2rem))] rounded-[28px] border border-slate-200/90 bg-white/96 p-0 shadow-[0_38px_120px_-40px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

function PopupShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-cyan-50/40 px-5 py-4">
        <p className="text-base font-semibold text-slate-950">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <ScrollArea className="max-h-[min(68vh,32rem)]">
        <div className="px-5 py-4">{children}</div>
      </ScrollArea>
    </div>
  )
}

export default function MapPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const {
    utilities,
    dmas,
    reports,
    teams,
    engineers,
    fetchUtilities,
    fetchDMAs,
    fetchTeams,
    fetchEngineers,
    fetchReportsForMap,
    reportsListTotal,
  } = useDataStore()

  const [loading, setLoading] = useState(true)
  const [basemap, setBasemap] = useState<"street" | "satellite">("satellite")
  const [dateFilter, setDateFilter] = useState<DateFilter>("all")
  const [selectedUtilityId, setSelectedUtilityId] = useState("all")
  const [selectedDMAId, setSelectedDMAId] = useState("all")

  const isAdmin = currentUser?.role === "admin"
  const isUtility = currentUser?.role === "utility_manager"
  const isDMA = currentUser?.role === "dma_manager"

  useEffect(() => {
    async function loadData() {
      if (!currentUser) return

      setLoading(true)
      try {
        await Promise.all([
          fetchUtilities(),
          fetchDMAs(isUtility ? currentUser.utilityId ?? undefined : undefined),
          fetchTeams(isDMA ? currentUser.dmaId ?? undefined : undefined),
          fetchEngineers(isDMA ? currentUser.dmaId ?? undefined : undefined),
          fetchReportsForMap(
            isDMA
              ? { dmaId: currentUser.dmaId ?? "" }
              : isUtility
                ? { utilityId: currentUser.utilityId ?? "" }
                : undefined
          ),
        ])
      } finally {
        setLoading(false)
      }
    }

    void loadData()
  }, [
    currentUser,
    fetchDMAs,
    fetchEngineers,
    fetchReportsForMap,
    fetchTeams,
    fetchUtilities,
    isDMA,
    isUtility,
  ])

  const currentDMA = useMemo(
    () => dmas.find((dma) => dma.id === currentUser?.dmaId) ?? null,
    [currentUser?.dmaId, dmas]
  )

  useEffect(() => {
    if (isUtility && currentUser?.utilityId) {
      setSelectedUtilityId(currentUser.utilityId)
    }
  }, [currentUser?.utilityId, isUtility])

  useEffect(() => {
    if (isDMA && currentUser?.dmaId) {
      setSelectedDMAId(currentUser.dmaId)
      if (currentDMA?.utilityId) {
        setSelectedUtilityId(currentDMA.utilityId)
      }
    }
  }, [currentDMA?.utilityId, currentUser?.dmaId, isDMA])

  const visibleUtilities = useMemo(() => {
    if (isUtility && currentUser?.utilityId) {
      return utilities.filter((utility) => utility.id === currentUser.utilityId)
    }

    if (isDMA && currentDMA?.utilityId) {
      return utilities.filter((utility) => utility.id === currentDMA.utilityId)
    }

    return utilities
  }, [currentDMA?.utilityId, currentUser?.utilityId, isDMA, isUtility, utilities])

  const visibleDMAs = useMemo(() => {
    const base = isDMA && currentUser?.dmaId ? dmas.filter((dma) => dma.id === currentUser.dmaId) : dmas

    if (selectedUtilityId === "all") {
      return base
    }

    return base.filter((dma) => dma.utilityId === selectedUtilityId)
  }, [currentUser?.dmaId, dmas, isDMA, selectedUtilityId])

  useEffect(() => {
    if (selectedDMAId !== "all" && !visibleDMAs.some((dma) => dma.id === selectedDMAId)) {
      setSelectedDMAId("all")
    }
  }, [selectedDMAId, visibleDMAs])

  const scopedReports = useMemo(() => {
    if (!currentUser) return []
    if (isAdmin) return reports
    if (isUtility && currentUser.utilityId) {
      return reports.filter((report) => report.utilityId === currentUser.utilityId)
    }
    if (isDMA && currentUser.dmaId) {
      return reports.filter((report) => report.dmaId === currentUser.dmaId)
    }
    return []
  }, [currentUser, isAdmin, isDMA, isUtility, reports])

  const filteredReports = useMemo(() => {
    return scopedReports.filter((report) => {
      const matchesDate = passesDateFilter(report.createdAt, dateFilter)
      const matchesUtility = selectedUtilityId === "all" ? true : report.utilityId === selectedUtilityId
      const matchesDMA = selectedDMAId === "all" ? true : report.dmaId === selectedDMAId
      return matchesDate && matchesUtility && matchesDMA
    })
  }, [dateFilter, scopedReports, selectedDMAId, selectedUtilityId])

  // Map shows every loaded report with GPS in scope (date filter does not hide dots).
  const mapReports = useMemo(
    () =>
      scopedReports.filter((report) => {
        const matchesUtility = selectedUtilityId === "all" ? true : report.utilityId === selectedUtilityId
        const matchesDMA = selectedDMAId === "all" ? true : report.dmaId === selectedDMAId
        return matchesUtility && matchesDMA && hasUsableCoordinates(report)
      }),
    [scopedReports, selectedDMAId, selectedUtilityId]
  )

  const reportsWithCoordinates = useMemo(
    () => filteredReports.filter(hasUsableCoordinates),
    [filteredReports]
  )

  const scopedDMAs = useMemo(() => {
    let base = dmas

    if (isUtility && currentUser?.utilityId) {
      base = base.filter((dma) => dma.utilityId === currentUser.utilityId)
    } else if (isDMA && currentUser?.dmaId) {
      base = base.filter((dma) => dma.id === currentUser.dmaId)
    }

    if (selectedUtilityId !== "all") {
      base = base.filter((dma) => dma.utilityId === selectedUtilityId)
    }

    if (selectedDMAId !== "all") {
      base = base.filter((dma) => dma.id === selectedDMAId)
    }

    return base
  }, [currentUser?.dmaId, currentUser?.utilityId, dmas, isDMA, isUtility, selectedDMAId, selectedUtilityId])

  const scopedTeams = useMemo(() => {
    let base = teams

    if (isDMA && currentUser?.dmaId) {
      base = base.filter((team) => team.dmaId === currentUser.dmaId)
    } else if (isUtility && currentUser?.utilityId) {
      base = base.filter((team) => team.utilityId === currentUser.utilityId)
    }

    if (selectedUtilityId !== "all") {
      base = base.filter((team) => team.utilityId === selectedUtilityId)
    }

    if (selectedDMAId !== "all") {
      base = base.filter((team) => team.dmaId === selectedDMAId)
    }

    return base
  }, [currentUser?.dmaId, currentUser?.utilityId, isDMA, isUtility, selectedDMAId, selectedUtilityId, teams])

  const scopedEngineers = useMemo(() => {
    const visibleDMAIds = new Set(scopedDMAs.map((dma) => dma.id))
    return engineers.filter((engineer) => visibleDMAIds.has(engineer.dmaId))
  }, [engineers, scopedDMAs])

  const activeUtilityId = useMemo(() => {
    if (selectedUtilityId !== "all") return selectedUtilityId
    if (isUtility) return currentUser?.utilityId ?? null
    return currentDMA?.utilityId ?? null
  }, [currentDMA?.utilityId, currentUser?.utilityId, isUtility, selectedUtilityId])

  const activeUtility = useMemo(
    () => utilities.find((utility) => utility.id === activeUtilityId) ?? null,
    [activeUtilityId, utilities]
  )

  const activeDMA = useMemo(
    () => dmas.find((dma) => dma.id === selectedDMAId) ?? null,
    [dmas, selectedDMAId]
  )

  const activeNetworkPreviewUrl = useMemo(() => {
    const pipeNetwork = getUtilityInfrastructureAsset(activeUtility, "pipe_network")
    if (!pipeNetwork?.previewUrl) return null
    if (isDMA || !activeDMA?.id || !activeDMA.boundaryGeojson) return pipeNetwork.previewUrl

    const separator = pipeNetwork.previewUrl.includes("?") ? "&" : "?"
    return `${pipeNetwork.previewUrl}${separator}dma_id=${encodeURIComponent(activeDMA.id)}`
  }, [activeDMA?.boundaryGeojson, activeDMA?.id, activeUtility, isDMA])

  const mapCenter = useMemo<[number, number] | null>(() => {
    if (
      activeDMA &&
      Number.isFinite(activeDMA.centerLatitude) &&
      Number.isFinite(activeDMA.centerLongitude)
    ) {
      return [Number(activeDMA.centerLatitude), Number(activeDMA.centerLongitude)]
    }

    if (
      activeUtility &&
      Number.isFinite(activeUtility.centerLatitude) &&
      Number.isFinite(activeUtility.centerLongitude)
    ) {
      return [Number(activeUtility.centerLatitude), Number(activeUtility.centerLongitude)]
    }

    return null
  }, [activeDMA, activeUtility])

  const openReportsCount = useMemo(
    () => filteredReports.filter((report) => isOpenReport(report.status)).length,
    [filteredReports]
  )
  const pendingApprovalsCount = useMemo(
    () => filteredReports.filter((report) => report.status === "pending_approval").length,
    [filteredReports]
  )
  const highSeverityCount = useMemo(
    () => filteredReports.filter((report) => isHighSeverity(report.priority)).length,
    [filteredReports]
  )
  const overdueCount = useMemo(() => {
    const now = Date.now()
    return filteredReports.filter((report) => {
      if (!isOpenReport(report.status) || !report.slaDeadline) return false
      return new Date(report.slaDeadline).getTime() < now
    }).length
  }, [filteredReports])
  const resolvedCount = useMemo(
    () => filteredReports.filter((report) => RESOLVED_STATUSES.has(report.status)).length,
    [filteredReports]
  )
  const unassignedCount = useMemo(
    () => filteredReports.filter((report) => !report.teamId && isOpenReport(report.status)).length,
    [filteredReports]
  )
  const activeFieldCount = useMemo(
    () =>
      filteredReports.filter((report) =>
        ["assigned", "in_progress", "pending_approval"].includes(report.status)
      ).length,
    [filteredReports]
  )
  const resolutionRate = filteredReports.length > 0 ? Math.round((resolvedCount / filteredReports.length) * 100) : 0
  const reportsWithoutCoordinatesCount = scopedReports.length - mapReports.length
  const allMapReportsLoaded = reportsListTotal === null || reports.length >= reportsListTotal

  const severityMixData = useMemo(
    () =>
      [
        { key: "low", name: "Low", value: filteredReports.filter((report) => report.priority === "low").length },
        {
          key: "medium",
          name: "Moderate",
          value: filteredReports.filter((report) => report.priority === "medium").length,
        },
        { key: "high", name: "High", value: filteredReports.filter((report) => report.priority === "high").length },
        {
          key: "critical",
          name: "Critical",
          value: filteredReports.filter((report) => report.priority === "critical").length,
        },
      ].filter((item) => item.value > 0),
    [filteredReports]
  )

  const workflowStageData = useMemo(
    () =>
      [
        { key: "new", name: "New intake", value: filteredReports.filter((report) => report.status === "new").length },
        {
          key: "assigned",
          name: "Assigned",
          value: filteredReports.filter((report) => report.status === "assigned").length,
        },
        {
          key: "in_progress",
          name: "In progress",
          value: filteredReports.filter((report) => report.status === "in_progress").length,
        },
        {
          key: "pending_approval",
          name: "Awaiting DMA",
          value: filteredReports.filter((report) => report.status === "pending_approval").length,
        },
        {
          key: "approved",
          name: "Resolved",
          value: filteredReports.filter((report) => RESOLVED_STATUSES.has(report.status)).length,
        },
        {
          key: "rejected",
          name: "Rework",
          value: filteredReports.filter((report) => report.status === "rejected").length,
        },
      ].filter((item) => item.value > 0),
    [filteredReports]
  )

  const ownershipBreakdown = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string
        name: string
        value: number
        open: number
        resolved: number
        pending: number
      }
    >()

    filteredReports.forEach((report) => {
      const key = isDMA
        ? report.teamId || "unassigned-team"
        : isUtility
          ? report.dmaId || "unassigned-dma"
          : report.utilityId || "unassigned-utility"
      const name = isDMA
        ? report.teamName || "Unassigned team"
        : isUtility
          ? report.dmaName || "Unassigned DMA"
          : report.utilityName || "Unassigned utility"

      const current = groups.get(key) ?? {
        key,
        name,
        value: 0,
        open: 0,
        resolved: 0,
        pending: 0,
      }

      current.value += 1
      current.open += isOpenReport(report.status) ? 1 : 0
      current.resolved += RESOLVED_STATUSES.has(report.status) ? 1 : 0
      current.pending += report.status === "pending_approval" ? 1 : 0
      groups.set(key, current)
    })

    return Array.from(groups.values())
      .sort((left, right) => {
        if (right.open !== left.open) return right.open - left.open
        return right.value - left.value
      })
      .slice(0, 6)
  }, [filteredReports, isDMA, isUtility])

  const pendingReportsForResponsibility = useMemo(
    () =>
      filteredReports
        .filter((report) => report.status === "pending_approval")
        .sort((left, right) => {
          return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        })
        .slice(0, 12),
    [filteredReports]
  )

  const hotspotWatch = useMemo(() => {
    const buckets = new Map<
      string,
      {
        count: number
        openCount: number
        highSeverity: number
        latestUpdate: string
        address: string
        scopeName: string
        latitude: number
        longitude: number
      }
    >()

    filteredReports
      .filter((report) => Number.isFinite(report.latitude) && Number.isFinite(report.longitude))
      .forEach((report) => {
        const latBucket = Math.round(report.latitude / HOTSPOT_CELL_SIZE)
        const lngBucket = Math.round(report.longitude / HOTSPOT_CELL_SIZE)
        const key = `${latBucket}:${lngBucket}`
        const existing = buckets.get(key)
        const next = existing ?? {
          count: 0,
          openCount: 0,
          highSeverity: 0,
          latestUpdate: report.updatedAt,
          address: report.address || report.description,
          scopeName: report.dmaName || report.utilityName,
          latitude: report.latitude,
          longitude: report.longitude,
        }

        next.count += 1
        next.openCount += isOpenReport(report.status) ? 1 : 0
        next.highSeverity += isHighSeverity(report.priority) ? 1 : 0

        if (new Date(report.updatedAt).getTime() > new Date(next.latestUpdate).getTime()) {
          next.latestUpdate = report.updatedAt
          next.address = report.address || report.description
          next.scopeName = report.dmaName || report.utilityName
        }

        buckets.set(key, next)
      })

    return Array.from(buckets.values())
      .filter((bucket) => bucket.count > 1 || bucket.highSeverity > 0)
      .sort((left, right) => {
        if (right.highSeverity !== left.highSeverity) return right.highSeverity - left.highSeverity
        if (right.openCount !== left.openCount) return right.openCount - left.openCount
        return right.count - left.count
      })
      .slice(0, 6)
  }, [filteredReports])

  const teamWorkload = useMemo(() => {
    if (!isDMA) return []

    return scopedTeams
      .map((team) => {
        const teamReports = filteredReports.filter((report) => report.teamId === team.id)
        const openWork = teamReports.filter((report) => isOpenReport(report.status))
        const overdue = openWork.filter(
          (report) => report.slaDeadline && new Date(report.slaDeadline).getTime() < Date.now()
        ).length
        const awaitingReview = teamReports.filter((report) => report.status === "pending_approval").length
        const activeMembers = scopedEngineers.filter(
          (engineer) => engineer.teamId === team.id && engineer.status === "active"
        ).length
        const loadPerMember = activeMembers > 0 ? openWork.length / activeMembers : openWork.length

        return {
          id: team.id,
          name: team.name,
          leaderName: team.leaderName || "Unassigned",
          openWork: openWork.length,
          overdue,
          awaitingReview,
          activeMembers,
          loadPerMember,
        }
      })
      .sort((left, right) => {
        if (right.overdue !== left.overdue) return right.overdue - left.overdue
        if (right.openWork !== left.openWork) return right.openWork - left.openWork
        return right.awaitingReview - left.awaitingReview
      })
      .slice(0, 5)
  }, [filteredReports, isDMA, scopedEngineers, scopedTeams])

  const dmaWatchlist = useMemo(() => {
    if (!isUtility) return []

    return scopedDMAs
      .map((dma) => {
        const dmaReports = filteredReports.filter((report) => report.dmaId === dma.id)
        const openWork = dmaReports.filter((report) => isOpenReport(report.status))
        const overdue = openWork.filter(
          (report) => report.slaDeadline && new Date(report.slaDeadline).getTime() < Date.now()
        ).length
        const awaitingReview = dmaReports.filter((report) => report.status === "pending_approval").length
        const activeTeams = scopedTeams.filter((team) => team.dmaId === dma.id && team.status === "active").length
        const activeEngineers = scopedEngineers.filter(
          (engineer) => engineer.dmaId === dma.id && engineer.status === "active"
        ).length

        return {
          id: dma.id,
          name: dma.name,
          openWork: openWork.length,
          overdue,
          awaitingReview,
          activeTeams,
          activeEngineers,
        }
      })
      .sort((left, right) => {
        if (right.overdue !== left.overdue) return right.overdue - left.overdue
        if (right.openWork !== left.openWork) return right.openWork - left.openWork
        return right.awaitingReview - left.awaitingReview
      })
      .slice(0, 5)
  }, [filteredReports, isUtility, scopedDMAs, scopedEngineers, scopedTeams])

  const utilityWatchlist = useMemo(() => {
    if (isDMA || isUtility) return []

    return utilities
      .map((utility) => {
        const utilityReports = filteredReports.filter((report) => report.utilityId === utility.id)
        const openWork = utilityReports.filter((report) => isOpenReport(report.status))
        const overdue = openWork.filter(
          (report) => report.slaDeadline && new Date(report.slaDeadline).getTime() < Date.now()
        ).length
        const awaitingReview = utilityReports.filter((report) => report.status === "pending_approval").length
        const utilityDMAs = dmas.filter((dma) => dma.utilityId === utility.id).length

        return {
          id: utility.id,
          name: utility.name,
          openWork: openWork.length,
          overdue,
          awaitingReview,
          utilityDMAs,
        }
      })
      .filter((item) => item.openWork > 0 || item.awaitingReview > 0 || item.overdue > 0)
      .sort((left, right) => {
        if (right.overdue !== left.overdue) return right.overdue - left.overdue
        if (right.openWork !== left.openWork) return right.openWork - left.openWork
        return right.awaitingReview - left.awaitingReview
      })
      .slice(0, 5)
  }, [dmas, filteredReports, isDMA, isUtility, utilities])

  const scopeLabel = activeDMA?.name || activeUtility?.name || "National operations view"
  const scopeLevelLabel = isDMA ? "DMA operations zone" : isUtility ? "Utility operations zone" : "National operations zone"
  const dateFilterLabel = DATE_FILTERS.find((filter) => filter.value === dateFilter)?.label ?? "Last 30 days"
  const mapFitKey = useMemo(
    () =>
      [
        selectedUtilityId,
        selectedDMAId,
        activeDMA?.id ?? "no-dma",
        activeUtility?.id ?? "no-utility",
      ].join("|"),
    [activeDMA?.id, activeUtility?.id, selectedDMAId, selectedUtilityId]
  )

  if (loading && !reports.length) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading live map...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="relative z-30 rounded-[28px] border border-slate-200/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">
              <MapPinned className="h-4 w-4" />
              Dedicated map view
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Leak Monitoring Map</h1>
            <p className="mt-2 text-sm text-slate-600">
              {scopeLabel} · {mapReports.length.toLocaleString()} leak
              {mapReports.length === 1 ? "" : "s"} with GPS on the map
              {allMapReportsLoaded ? "" : ` (loading… ${reports.length.toLocaleString()} fetched so far)`}
              {dateFilter !== "all"
                ? ` · ${reportsWithCoordinates.length.toLocaleString()} in ${dateFilterLabel.toLowerCase()}`
                : ""}
              {reportsWithoutCoordinatesCount > 0
                ? ` · ${reportsWithoutCoordinatesCount.toLocaleString()} in scope without GPS`
                : ""}
            </p>
            {!allMapReportsLoaded ? (
              <p className="mt-1 text-xs text-amber-700">
                Still loading report pages from the server. All reports with coordinates in your access scope will
                appear when loading finishes.
              </p>
            ) : null}
          </div>

          <div className="relative z-30 grid gap-2 md:grid-cols-2 xl:grid-cols-[140px_170px_170px_auto] xl:items-center">
            <Select value={dateFilter} onValueChange={(value) => setDateFilter(value as DateFilter)}>
              <SelectTrigger className="h-10 rounded-2xl border-slate-200 bg-white/90 px-3 text-sm">
                <SelectValue placeholder="Date filter" />
              </SelectTrigger>
              <SelectContent className="z-[5000]">
                {DATE_FILTERS.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedUtilityId}
              onValueChange={setSelectedUtilityId}
              disabled={!isAdmin || !visibleUtilities.length}
            >
              <SelectTrigger className="h-10 rounded-2xl border-slate-200 bg-white/90 px-3 text-sm">
                <SelectValue placeholder="Utility / Region" />
              </SelectTrigger>
              <SelectContent className="z-[5000]">
                <SelectItem value="all">All utilities</SelectItem>
                {visibleUtilities.map((utility) => (
                  <SelectItem key={utility.id} value={utility.id}>
                    {utility.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedDMAId} onValueChange={setSelectedDMAId} disabled={isDMA || !visibleDMAs.length}>
              <SelectTrigger className="h-10 rounded-2xl border-slate-200 bg-white/90 px-3 text-sm">
                <SelectValue placeholder="DMA / District" />
              </SelectTrigger>
              <SelectContent className="z-[5000]">
                <SelectItem value="all">All DMAs</SelectItem>
                {visibleDMAs.map((dma) => (
                  <SelectItem key={dma.id} value={dma.id}>
                    {dma.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-2xl border-slate-200 bg-white/90 px-4 text-sm text-slate-700 hover:bg-slate-50 xl:justify-self-end"
              onClick={() => {
                setDateFilter("all")
                setSelectedUtilityId(
                  isUtility
                    ? currentUser?.utilityId ?? "all"
                    : isDMA
                      ? currentDMA?.utilityId ?? "all"
                      : "all"
                )
                setSelectedDMAId(isDMA ? currentUser?.dmaId ?? "all" : "all")
              }}
            >
              Reset view
            </Button>
          </div>
        </div>
      </section>

      <div className="relative z-0">
        <OperationsMap
          reports={mapReports.map((report) => ({
            id: report.id,
            trackingId: report.trackingId,
            description: report.description,
            latitude: report.latitude,
            longitude: report.longitude,
            status: report.status,
            priority: report.priority,
            dmaName: report.dmaName,
            utilityName: report.utilityName,
            regionName: report.regionName,
            districtName: report.districtName,
            address: report.address,
            reporterName: report.reporterName,
          }))}
          center={mapCenter}
          boundaryGeojson={activeDMA?.boundaryGeojson ?? null}
          networkPreviewUrl={activeNetworkPreviewUrl}
          networkFileName={getUtilityInfrastructureAsset(activeUtility, "pipe_network")?.fileName}
          title={scopeLabel}
          description="Live leakage coverage for the selected operational area."
          basemap={basemap}
          onBasemapChange={setBasemap}
          onReportSelect={(reportId) => router.push(`/dashboard/reports/${reportId}`)}
          chromeMode="command-center"
          boundsFitKey={mapFitKey}
        />
      </div>
    </div>
  )
}

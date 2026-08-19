"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useDataStore } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { ArrowLeft, GitBranch, MapPin, Pencil, Users, FileText } from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"

interface DMADetailPageProps {
  dmaId: string
}

export default function DMADetailPage({ dmaId }: DMADetailPageProps) {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { dmas, teams, fetchDMAs, fetchTeams } = useDataStore()

  const isUtility = currentUser?.role === "utility_manager"
  const canEdit = isUtility

  useEffect(() => {
    void fetchDMAs()
    void fetchTeams()
  }, [fetchDMAs, fetchTeams])

  const dma = useMemo(
    () => dmas.find((item) => item.id === dmaId || item.slug === dmaId) ?? null,
    [dmaId, dmas]
  )

  const scopedTeams = useMemo(
    () => teams.filter((team) => team.dmaId === dma?.id),
    [dma?.id, teams]
  )

  if (!dma) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                <MapPin className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">DMA not found</p>
                <p className="mt-1 text-sm text-slate-500">This District Meter Area may have been removed.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push("/dashboard/dmas")}
                className="mt-2 rounded-xl"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to DMAs
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            onClick={() => router.push("/dashboard/dmas")}
            className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to DMAs
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800">{dma.name}</h1>
            <EntityStatusBadge status={dma.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">{dma.utilityName || "Unassigned utility"}</p>
        </div>
        {canEdit && (
          <Button
            onClick={() => router.push(`/dashboard/dmas/${dma.slug || dma.id}/edit`)}
            className="h-10 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-600 hover:to-blue-700"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit DMA
          </Button>
        )}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
                <WaterUtilityIcon className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Utility</p>
                <p className="truncate font-semibold text-slate-800">{dma.utilityName || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                <Users className="h-5 w-5 text-slate-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Manager</p>
                <p className="truncate font-semibold text-slate-800">{dma.managerName || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
                <GitBranch className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Teams</p>
                <p className="font-semibold text-slate-800">{scopedTeams.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
                <FileText className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Reports</p>
                <p className="font-semibold text-slate-800">{dma.reportsCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Description */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-slate-800">About this DMA</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              {dma.description || "No description provided for this District Meter Area."}
            </p>
            <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">Center latitude</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">
                  {dma.centerLatitude != null ? dma.centerLatitude.toFixed(6) : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Center longitude</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">
                  {dma.centerLongitude != null ? dma.centerLongitude.toFixed(6) : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Created</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">
                  {formatTanzaniaDateTime(dma.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Last updated</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">
                  {formatTanzaniaDateTime(dma.updatedAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Teams */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-slate-800">Teams in this DMA</h2>
            {scopedTeams.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No teams assigned to this DMA yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-slate-100">
                {scopedTeams.map((team) => (
                  <li key={team.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{team.name}</p>
                      <p className="truncate text-xs text-slate-500">{team.leaderName ? `Team leader: ${team.leaderName}` : "No leader"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {team.memberCount}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

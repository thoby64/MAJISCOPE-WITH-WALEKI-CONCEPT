"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useDataStore } from "@/store/data-store"
import { useAuthStore } from "@/store/auth-store"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { ArrowLeft, FileText, Mail, MapPin, Pencil, Phone, Users } from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { InfrastructureUploadIcon } from "@/components/icons/infrastructure-upload-icon"

interface UtilityDetailPageProps {
  utilityId: string
}

export default function UtilityDetailPage({ utilityId }: UtilityDetailPageProps) {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { utilities, dmas, fetchUtilities, fetchDMAs } = useDataStore()

  const isAdmin = currentUser?.role === "admin"
  const isUtilityManager = currentUser?.role === "utility_manager"
  const canEdit = isAdmin || isUtilityManager

  useEffect(() => {
    void fetchUtilities()
    void fetchDMAs()
  }, [fetchDMAs, fetchUtilities])

  const utility = useMemo(
    () => utilities.find((item) => item.id === utilityId || item.slug === utilityId) ?? null,
    [utilityId, utilities]
  )

  const scopedDMAs = useMemo(
    () => dmas.filter((dma) => dma.utilityId === utility?.id),
    [dmas, utility?.id]
  )

  if (!utility) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                <WaterUtilityIcon className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Utility not found</p>
                <p className="mt-1 text-sm text-slate-500">This utility may have been removed.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push("/dashboard/utilities")}
                className="mt-2 rounded-xl"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Utilities
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
            onClick={() => router.push("/dashboard/utilities")}
            className="mb-1 -ml-2 h-8 rounded-lg px-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Utilities
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800">{utility.name}</h1>
            <EntityStatusBadge status={utility.status} />
          </div>
          {utility.regionName && (
            <p className="mt-1 text-sm text-slate-500">{utility.regionName}</p>
          )}
        </div>
        {canEdit && (
          <Button
            onClick={() => router.push(`/dashboard/utilities/${utility.slug || utility.id}/edit`)}
            className="h-10 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-600 hover:to-blue-700"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit Utility
          </Button>
        )}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
                <Users className="h-5 w-5 text-cyan-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Manager</p>
                <p className="truncate font-semibold text-slate-800">{utility.managerName || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                <MapPin className="h-5 w-5 text-slate-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">DMAs</p>
                <p className="font-semibold text-slate-800">{scopedDMAs.length}</p>
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
                <p className="font-semibold text-slate-800">{utility.reportsCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* About */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-slate-800">About this utility</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              {utility.description || "No description provided for this utility."}
            </p>

            {(utility.contactPhone || utility.contactEmail || utility.contactAddress) && (
              <div className="mt-6 flex flex-col gap-3 text-sm text-slate-600">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Public contacts
                </p>
                {utility.contactPhone ? (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>{utility.contactPhone}</span>
                  </div>
                ) : null}
                {utility.contactEmail ? (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="break-all">{utility.contactEmail}</span>
                  </div>
                ) : null}
                {utility.contactAddress ? (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="break-words">{utility.contactAddress}</span>
                  </div>
                ) : null}
              </div>
            )}

            <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-500">Created</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">
                  {formatTanzaniaDateTime(utility.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Last updated</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">
                  {formatTanzaniaDateTime(utility.updatedAt)}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <InfrastructureUploadIcon className="h-4 w-4 shrink-0 text-cyan-600" />
                <span className="truncate text-xs font-medium text-slate-600">Infrastructure assets</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push("/dashboard/utility-infrastructure")}
                className="h-7 rounded-md px-2.5 text-xs font-medium text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
              >
                Manage
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* DMAs */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">DMAs under this utility</h2>
              {scopedDMAs.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => router.push("/dashboard/dmas")}
                  className="h-7 rounded-md px-2 text-xs font-medium text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
                >
                  View all
                </Button>
              )}
            </div>
            {scopedDMAs.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No DMAs linked to this utility yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-slate-100">
                {scopedDMAs.map((dma) => (
                  <li key={dma.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{dma.name}</p>
                      <p className="truncate text-xs text-slate-500">{dma.managerName ? `DMA manager: ${dma.managerName}` : "No manager"}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/dashboard/dmas/${dma.slug || dma.id}`)}
                      className="h-7 shrink-0 rounded-md px-2 text-xs font-medium text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800"
                    >
                      View
                    </Button>
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

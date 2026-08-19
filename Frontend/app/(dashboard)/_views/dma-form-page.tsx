"use client"

import { useEffect, useMemo, useState, type ChangeEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DMALocationPicker } from "@/components/maps/dma-location-picker"
import type { EntityStatus, GeoJsonPolygon } from "@/lib/types"
import { toast } from "sonner"
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"

interface DMAFormPageProps {
  mode: "create" | "edit"
  dmaId?: string
}

type BoundaryPointFormValue = {
  id: string
  latitude: string
  longitude: string
}

type BoundaryPointCoordinate = {
  latitude: number
  longitude: number
}

type BoundaryExtractionResponse = {
  center?: BoundaryPointCoordinate
  boundaryPoints?: BoundaryPointCoordinate[]
  source?: {
    fileName?: string
    layerName?: string
    geometryType?: string
    pointCount?: number
  }
  error?: string
}

function createBoundaryPoint(latitude = "", longitude = ""): BoundaryPointFormValue {
  const fallbackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackId,
    latitude,
    longitude,
  }
}

function extractBoundaryPoints(boundaryGeojson?: GeoJsonPolygon | null): BoundaryPointFormValue[] {
  const ring = boundaryGeojson?.coordinates?.[0]
  if (!Array.isArray(ring) || !ring.length) return []

  const normalizedRing =
    ring.length > 1 &&
    ring[0]?.[0] === ring[ring.length - 1]?.[0] &&
    ring[0]?.[1] === ring[ring.length - 1]?.[1]
      ? ring.slice(0, -1)
      : ring

  return normalizedRing
    .filter((point): point is number[] => Array.isArray(point) && point.length >= 2)
    .map((point) => createBoundaryPoint(String(point[1]), String(point[0])))
}

function parseBoundaryPointsForMap(points: BoundaryPointFormValue[]): BoundaryPointCoordinate[] {
  return points.flatMap((point) => {
    const latitude = Number(point.latitude)
    const longitude = Number(point.longitude)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return []
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return []
    }

    return [{ latitude, longitude }]
  })
}

export default function DMAFormPage({ mode, dmaId }: DMAFormPageProps) {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { dmas, utilities, fetchDMAs, fetchUtilities, addDMA, updateDMA } = useDataStore()

  const [loading, setLoading] = useState(true)
  const [formName, setFormName] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formStatus, setFormStatus] = useState<EntityStatus>("active")
  const [formCenterLatitude, setFormCenterLatitude] = useState("")
  const [formCenterLongitude, setFormCenterLongitude] = useState("")
  const [formBoundaryPoints, setFormBoundaryPoints] = useState<BoundaryPointFormValue[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isExtractingBoundary, setIsExtractingBoundary] = useState(false)

  const isUtility = currentUser?.role === "utility_manager"
  const utilityFromList = currentUser?.utilityId ? utilities.find((u) => u.id === currentUser.utilityId) : null
  const utilityByManager = isUtility ? utilities.find((u) => u.managerId === currentUser?.id) : null
  const resolvedUtilityId = currentUser?.utilityId || utilityByManager?.id || null
  const utilityName = currentUser?.utilityName || utilityFromList?.name || utilityByManager?.name || ""

  const editingDMA = useMemo(
    () => (
      mode === "edit" && dmaId
        ? dmas.find((dma) => dma.id === dmaId || dma.slug === dmaId) ?? null
        : null
    ),
    [dmaId, dmas, mode],
  )

  useEffect(() => {
    async function load() {
      setLoading(true)
      await Promise.all([fetchUtilities(), fetchDMAs()])
      setLoading(false)
    }

    void load()
  }, [fetchDMAs, fetchUtilities])

  useEffect(() => {
    if (mode === "edit") {
      if (!editingDMA) return
      if (editingDMA.slug && dmaId !== editingDMA.slug) {
        router.replace(`/dashboard/dmas/${editingDMA.slug}/edit`)
      }
      setFormName(editingDMA.name)
      setFormDescription(editingDMA.description || "")
      setFormStatus(editingDMA.status)
      setFormCenterLatitude(editingDMA.centerLatitude != null ? String(editingDMA.centerLatitude) : "")
      setFormCenterLongitude(editingDMA.centerLongitude != null ? String(editingDMA.centerLongitude) : "")
      setFormBoundaryPoints(extractBoundaryPoints(editingDMA.boundaryGeojson))
      return
    }

    setFormName("")
    setFormDescription("")
    setFormStatus("active")
    setFormCenterLatitude("")
    setFormCenterLongitude("")
    setFormBoundaryPoints([])
  }, [dmaId, editingDMA, mode, router])

  const boundaryPointsForMap = useMemo(
    () => parseBoundaryPointsForMap(formBoundaryPoints),
    [formBoundaryPoints]
  )

  async function handleSubmit() {
    if (!formName.trim()) {
      toast.error("DMA name is required")
      return
    }

    if (!resolvedUtilityId) {
      toast.error("Utility context is missing for this DMA")
      return
    }

    const hasLatitude = formCenterLatitude.trim() !== ""
    const hasLongitude = formCenterLongitude.trim() !== ""

    if (hasLatitude !== hasLongitude) {
      toast.error("Please provide both latitude and longitude for the DMA center")
      return
    }

    const parsedLatitude = hasLatitude ? Number(formCenterLatitude) : null
    const parsedLongitude = hasLongitude ? Number(formCenterLongitude) : null

    if (parsedLatitude !== null && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90)) {
      toast.error("Latitude must be a valid number between -90 and 90")
      return
    }

    if (parsedLongitude !== null && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180)) {
      toast.error("Longitude must be a valid number between -180 and 180")
      return
    }

    const hasAnyBoundaryInput = formBoundaryPoints.some(
      (point) => point.latitude.trim() !== "" || point.longitude.trim() !== ""
    )

    const normalizedBoundaryPoints: BoundaryPointCoordinate[] = []
    for (const point of formBoundaryPoints) {
      const hasPointLatitude = point.latitude.trim() !== ""
      const hasPointLongitude = point.longitude.trim() !== ""

      if (!hasPointLatitude && !hasPointLongitude) {
        continue
      }

      if (hasPointLatitude !== hasPointLongitude) {
        toast.error("Each DMA boundary point requires both latitude and longitude")
        return
      }

      const latitude = Number(point.latitude)
      const longitude = Number(point.longitude)

      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        toast.error("Each DMA boundary latitude must be a valid number between -90 and 90")
        return
      }

      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        toast.error("Each DMA boundary longitude must be a valid number between -180 and 180")
        return
      }

      normalizedBoundaryPoints.push({ latitude, longitude })
    }

    if (hasAnyBoundaryInput && normalizedBoundaryPoints.length < 3) {
      toast.error("DMA boundary requires at least three complete coordinate points")
      return
    }

    setIsSubmitting(true)

    try {
      const boundaryGeojson =
        normalizedBoundaryPoints.length > 0
          ? {
              type: "Polygon" as const,
              coordinates: [
                normalizedBoundaryPoints.map((point) => [point.longitude, point.latitude]),
              ],
            }
          : null

      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        utilityId: resolvedUtilityId,
        utilityName: utilityName || "",
        centerLatitude: parsedLatitude,
        centerLongitude: parsedLongitude,
        boundaryGeojson,
        status: formStatus,
      }

      if (mode === "edit" && editingDMA) {
        const savedDMA = await updateDMA(editingDMA.id, payload)
        toast.success("DMA updated successfully")
        router.replace(`/dashboard/dmas/${savedDMA.slug || savedDMA.id}/edit`)
      } else {
        const savedDMA = await addDMA(payload)
        toast.success("DMA created successfully")
        router.push(`/dashboard/dmas/${savedDMA.slug || savedDMA.id}/edit`)
      }
    } catch {
      toast.error(mode === "edit" ? "Failed to update DMA" : "Failed to create DMA")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleBoundaryFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""

    if (!file) return

    setIsExtractingBoundary(true)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/dma-boundary/extract", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as BoundaryExtractionResponse

      if (!response.ok) {
        throw new Error(payload.error || "Failed to extract DMA boundary geometry")
      }

      if (!payload.center || !Array.isArray(payload.boundaryPoints) || payload.boundaryPoints.length < 3) {
        throw new Error("The uploaded file did not contain enough boundary points.")
      }

      setFormCenterLatitude(payload.center.latitude.toFixed(6))
      setFormCenterLongitude(payload.center.longitude.toFixed(6))
      setFormBoundaryPoints(
        payload.boundaryPoints.map((point) =>
          createBoundaryPoint(point.latitude.toFixed(6), point.longitude.toFixed(6))
        )
      )

      const pointCount = payload.source?.pointCount ?? payload.boundaryPoints.length
      toast.success(`Boundary extracted from ${file.name} with ${pointCount.toLocaleString()} points.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to extract DMA boundary geometry")
    } finally {
      setIsExtractingBoundary(false)
    }
  }

  if (!isUtility) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/dashboard/dmas">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to DMAs
            </Link>
          </Button>
        </div>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                <MapPin className="h-8 w-8 text-slate-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
                <p className="text-sm text-slate-500 mt-1">Only Utility Managers can create or edit DMAs.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/dashboard/dmas">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to DMAs
            </Link>
          </Button>
        </div>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center text-slate-500">Loading DMA form...</CardContent>
        </Card>
      </div>
    )
  }

  if (mode === "edit" && !editingDMA) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/dashboard/dmas">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to DMAs
            </Link>
          </Button>
        </div>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold text-slate-800">DMA not found</p>
            <p className="mt-2 text-sm text-slate-500">The DMA you are trying to edit could not be loaded.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/dashboard/dmas">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to DMAs
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              {mode === "edit" ? <Pencil className="h-7 w-7 text-emerald-600" /> : <Plus className="h-7 w-7 text-emerald-600" />}
              {mode === "edit" ? "Edit DMA" : "Create DMA"}
            </h1>
            <p className="text-slate-500 mt-1">
              {mode === "edit"
                ? "Update the DMA details, map center, boundary geometry, and visibility information."
                : "Create a new District Meter Area with a precise dashboard center and a clear spatial boundary."}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/dashboard/dmas">Cancel</Link>
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
          >
            {mode === "edit" ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
            {mode === "edit" ? "Save Changes" : "Create DMA"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="dma-name" className="text-sm font-medium text-slate-700">DMA Name</Label>
              <Input
                id="dma-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Old Moshi Road DMA"
                className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-emerald-400 focus:ring-emerald-400/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Utility</Label>
              <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <WaterUtilityIcon className="h-4 w-4 text-emerald-600" />
                  <span className="font-semibold text-emerald-700">{utilityName}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="dma-description" className="text-sm font-medium text-slate-700">Description</Label>
              <Textarea
                id="dma-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe the service area covered by this DMA."
                rows={4}
                className="resize-none rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-emerald-400 focus:ring-emerald-400/20"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="dma-latitude" className="text-sm font-medium text-slate-700">Center Latitude</Label>
                <Input
                  id="dma-latitude"
                  type="number"
                  step="0.000001"
                  value={formCenterLatitude}
                  onChange={(e) => setFormCenterLatitude(e.target.value)}
                  placeholder="-3.386000"
                  className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-emerald-400 focus:ring-emerald-400/20"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="dma-longitude" className="text-sm font-medium text-slate-700">Center Longitude</Label>
                <Input
                  id="dma-longitude"
                  type="number"
                  step="0.000001"
                  value={formCenterLongitude}
                  onChange={(e) => setFormCenterLongitude(e.target.value)}
                  placeholder="36.717000"
                  className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-emerald-400 focus:ring-emerald-400/20"
                />
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-slate-700">DMA Boundary Geometry</Label>
                  <p className="text-xs text-slate-500">
                    If you already have a boundary file, upload it here and the system will extract the boundary points and center automatically.
                  </p>
                  <p className="text-xs text-slate-500">
                    If you do not have a file, use the map controls on the top right to set the DMA center and capture boundary points manually.
                  </p>
                  <p className="text-xs text-slate-500">
                    Supported upload formats: GeoPackage (.gpkg), GeoJSON (.geojson), or JSON (.json).
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="dma-boundary-file"
                    type="file"
                    accept=".gpkg,.geojson,.json"
                    className="hidden"
                    onChange={handleBoundaryFileUpload}
                    disabled={isExtractingBoundary}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={isExtractingBoundary}
                    onClick={() => document.getElementById("dma-boundary-file")?.click()}
                  >
                    {isExtractingBoundary ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {isExtractingBoundary ? "Extracting..." : "Upload Boundary File"}
                  </Button>
                </div>
              </div>

              {formBoundaryPoints.length ? (
                <div className="space-y-3">
                  {formBoundaryPoints.map((point, index) => (
                    <div
                      key={point.id}
                      className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 md:grid-cols-[minmax(0,0.85fr)_minmax(0,0.85fr)_auto]"
                    >
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`boundary-latitude-${point.id}`} className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Point {index + 1} Latitude
                        </Label>
                        <Input
                          id={`boundary-latitude-${point.id}`}
                          type="number"
                          step="0.000001"
                          value={point.latitude}
                          onChange={(event) =>
                            setFormBoundaryPoints((current) =>
                              current.map((entry) =>
                                entry.id === point.id ? { ...entry, latitude: event.target.value } : entry
                              )
                            )
                          }
                          placeholder="-6.812345"
                          className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`boundary-longitude-${point.id}`} className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Point {index + 1} Longitude
                        </Label>
                        <Input
                          id={`boundary-longitude-${point.id}`}
                          type="number"
                          step="0.000001"
                          value={point.longitude}
                          onChange={(event) =>
                            setFormBoundaryPoints((current) =>
                              current.map((entry) =>
                                entry.id === point.id ? { ...entry, longitude: event.target.value } : entry
                              )
                            )
                          }
                          placeholder="39.287654"
                          className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
                        />
                      </div>

                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() =>
                            setFormBoundaryPoints((current) => current.filter((entry) => entry.id !== point.id))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-500">
                  No DMA boundary points added yet. Use the button above or click directly on the map in boundary mode.
                </div>
              )}
            </div>

          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-5">
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium text-slate-700">DMA Status</Label>
                <Select value={formStatus} onValueChange={(value) => setFormStatus(value as EntityStatus)}>
                  <SelectTrigger className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
                    <SelectItem value="active" className="rounded-lg">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Active
                      </div>
                    </SelectItem>
                    <SelectItem value="inactive" className="rounded-lg">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-slate-400" />
                        Inactive
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <DMALocationPicker
            centerValue={{
              latitude: formCenterLatitude.trim() ? Number(formCenterLatitude) : null,
              longitude: formCenterLongitude.trim() ? Number(formCenterLongitude) : null,
            }}
            boundaryPoints={boundaryPointsForMap}
            onCenterChange={({ latitude, longitude }) => {
              setFormCenterLatitude(latitude.toFixed(6))
              setFormCenterLongitude(longitude.toFixed(6))
            }}
            onBoundaryChange={(nextBoundaryPoints) => {
              setFormBoundaryPoints(
                nextBoundaryPoints.map((point) =>
                  createBoundaryPoint(point.latitude.toFixed(6), point.longitude.toFixed(6))
                )
              )
            }}
          />

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="space-y-2 p-5 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">Map Guidance</p>
              <p>Use the `DMA Center` button to capture the center point used by dashboards and operational centering.</p>
              <p>Use the `DMA Boundaries` button to place multiple boundary points and watch the polygon form directly on the map.</p>
              <p>The coordinate fields stay editable, so you can refine center and boundary values manually at any time.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

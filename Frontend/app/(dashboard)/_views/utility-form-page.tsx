"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
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
import { UtilityLocationPicker } from "@/components/maps/utility-location-picker"
import type { EntityStatus, GeoJsonBoundary, UtilityServiceAreaCategory } from "@/lib/types"
import { toast } from "sonner"
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Save,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react"

interface UtilityFormPageProps {
  mode: "create" | "edit"
  utilityId?: string
}

type ServiceAreaFormValue = {
  id: string
  category: UtilityServiceAreaCategory
  name: string
  regionName: string
}

type BoundaryExtractionResponse = {
  boundaryGeojson?: GeoJsonBoundary
  source?: {
    fileName?: string
    layerName?: string
    geometryType?: string
    pointCount?: number
    polygonCount?: number
  }
  error?: string
}

const TANZANIA_REGIONS = [
  "Arusha",
  "Dar es Salaam",
  "Dodoma",
  "Geita",
  "Iringa",
  "Kagera",
  "Katavi",
  "Kigoma",
  "Kilimanjaro",
  "Lindi",
  "Manyara",
  "Mara",
  "Mbeya",
  "Morogoro",
  "Mtwara",
  "Mwanza",
  "Njombe",
  "Pemba North",
  "Pemba South",
  "Pwani",
  "Rukwa",
  "Ruvuma",
  "Shinyanga",
  "Simiyu",
  "Singida",
  "Songwe",
  "Tabora",
  "Tanga",
  "Unguja North",
  "Unguja South",
]

const SERVICE_AREA_CATEGORIES: Array<{ value: UtilityServiceAreaCategory; label: string; description: string }> = [
  { value: "region", label: "Region", description: "A whole administrative region served by the utility." },
  { value: "district", label: "District", description: "An official district inside the selected region." },
  { value: "city", label: "City", description: "A named city or municipal service area." },
  { value: "town", label: "Town", description: "A named town served by the utility." },
  { value: "ward", label: "Ward", description: "A ward-level official area of service." },
  { value: "village", label: "Village", description: "A village-level official area of service." },
  { value: "custom_area", label: "Custom Area", description: "A locally known service area name." },
  { value: "infrastructure_corridor", label: "Infrastructure Corridor", description: "A served corridor such as a trunk main or road corridor." },
]

function createServiceArea(
  category: UtilityServiceAreaCategory = "district",
  name = "",
  regionName = ""
): ServiceAreaFormValue {
  const fallbackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackId,
    category,
    name,
    regionName,
  }
}

function getServiceAreaPlaceholder(category: UtilityServiceAreaCategory) {
  const label = SERVICE_AREA_CATEGORIES.find((entry) => entry.value === category)?.label ?? "Area"

  switch (category) {
    case "region":
      return "e.g. Dodoma Region"
    case "district":
      return "e.g. Dodoma Urban District"
    case "city":
      return "e.g. Dodoma City"
    case "town":
      return "e.g. Usa River Town"
    case "ward":
      return "e.g. Makole Ward"
    case "village":
      return "e.g. Nzuguni Village"
    case "custom_area":
      return "e.g. Central Service Area"
    case "infrastructure_corridor":
      return "e.g. Morogoro Road Corridor"
    default:
      return `e.g. ${label} name`
  }
}

export default function UtilityFormPage({ mode, utilityId }: UtilityFormPageProps) {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { utilities, fetchUtilities, addUtility, updateUtility } = useDataStore()
  const hydratedFormKeyRef = useRef<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [formName, setFormName] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formRegionName, setFormRegionName] = useState("")
  const [formContactPhone, setFormContactPhone] = useState("")
  const [formContactEmail, setFormContactEmail] = useState("")
  const [formContactAddress, setFormContactAddress] = useState("")
  const [formCenterLatitude, setFormCenterLatitude] = useState("")
  const [formCenterLongitude, setFormCenterLongitude] = useState("")
  const [formBoundaryGeojson, setFormBoundaryGeojson] = useState<GeoJsonBoundary | null>(null)
  const [formServiceAreas, setFormServiceAreas] = useState<ServiceAreaFormValue[]>([])
  const [formStatus, setFormStatus] = useState<EntityStatus>("active")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isExtractingBoundary, setIsExtractingBoundary] = useState(false)

  const isAdmin = currentUser?.role === "admin"
  const isUtilityManager = currentUser?.role === "utility_manager"

  const editingUtility = useMemo(
    () => (
      mode === "edit" && utilityId
        ? utilities.find((utility) => utility.id === utilityId || utility.slug === utilityId) ?? null
        : null
    ),
    [mode, utilities, utilityId]
  )

  useEffect(() => {
    async function load() {
      setLoading(true)
      await fetchUtilities()
      setLoading(false)
    }

    void load()
  }, [fetchUtilities])

  useEffect(() => {
    if (mode === "edit") {
      if (!editingUtility) return
      if (editingUtility.slug && utilityId !== editingUtility.slug) {
        router.replace(`/dashboard/utilities/${editingUtility.slug}/edit`)
      }
      const formKey = `edit:${editingUtility.id}`
      if (hydratedFormKeyRef.current === formKey) return
      hydratedFormKeyRef.current = formKey

      setFormName(editingUtility.name)
      setFormDescription(editingUtility.description || "")
      setFormRegionName(editingUtility.regionName || "")
      setFormContactPhone(editingUtility.contactPhone || "")
      setFormContactEmail(editingUtility.contactEmail || "")
      setFormContactAddress(editingUtility.contactAddress || "")
      setFormCenterLatitude(editingUtility.centerLatitude != null ? String(editingUtility.centerLatitude) : "")
      setFormCenterLongitude(editingUtility.centerLongitude != null ? String(editingUtility.centerLongitude) : "")
      setFormBoundaryGeojson(editingUtility.boundaryGeojson ?? null)
      setFormServiceAreas(
        editingUtility.serviceAreas?.length
          ? editingUtility.serviceAreas.map((area) =>
              createServiceArea(area.category, area.name, area.regionName || editingUtility.regionName || "")
            )
          : []
      )
      setFormStatus(editingUtility.status)
      return
    }

    if (hydratedFormKeyRef.current === "create") return
    hydratedFormKeyRef.current = "create"

    setFormName("")
    setFormDescription("")
    setFormRegionName("")
    setFormContactPhone("")
    setFormContactEmail("")
    setFormContactAddress("")
    setFormCenterLatitude("")
    setFormCenterLongitude("")
    setFormBoundaryGeojson(null)
    setFormServiceAreas([])
    setFormStatus("active")
  }, [editingUtility, mode, router, utilityId])

  async function handleSubmit() {
    if (!formName.trim()) {
      toast.error("Utility name is required")
      return
    }

    if (mode === "create" && !isAdmin) {
      toast.error("Only admins can create utilities")
      return
    }

    const hasLatitude = formCenterLatitude.trim() !== ""
    const hasLongitude = formCenterLongitude.trim() !== ""

    if (!hasLatitude || !hasLongitude) {
      toast.error("Utility center point is required. Set the primary operational city or service center on the map.")
      return
    }

    if (hasLatitude !== hasLongitude) {
      toast.error("Please provide both latitude and longitude for the utility center")
      return
    }

    const parsedLatitude = hasLatitude ? Number(formCenterLatitude) : null
    const parsedLongitude = hasLongitude ? Number(formCenterLongitude) : null

    if (parsedLatitude !== null && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90)) {
      toast.error("Utility center latitude must be a valid number between -90 and 90")
      return
    }

    if (parsedLongitude !== null && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180)) {
      toast.error("Utility center longitude must be a valid number between -180 and 180")
      return
    }

    const serviceAreas = formServiceAreas
      .map((area) => ({
        category: area.category,
        name: area.name.trim(),
        regionName: formRegionName.trim() || null,
        adminAreaId: null,
      }))
      .filter((area) => area.name)

    if (serviceAreas.length > 0 && !formRegionName.trim()) {
      toast.error("Select the utility region before adding official areas of service")
      return
    }

    if (serviceAreas.length !== formServiceAreas.filter((area) => area.name.trim() || area.regionName.trim()).length) {
      toast.error("Each official area of service requires an area name")
      return
    }

    const payload = {
      name: formName.trim(),
      regionName: formRegionName.trim() || undefined,
      description: formDescription.trim() || null,
      contactPhone: formContactPhone.trim() || undefined,
      contactEmail: formContactEmail.trim() || undefined,
      contactAddress: formContactAddress.trim() || undefined,
      centerLatitude: parsedLatitude,
      centerLongitude: parsedLongitude,
      boundaryGeojson: formBoundaryGeojson,
      boundarySourceType: formBoundaryGeojson ? "uploaded" as const : "none" as const,
      boundaryStatus: formBoundaryGeojson ? "verified" as const : "none" as const,
      serviceAreas,
      status: formStatus,
    }

    setIsSubmitting(true)
    try {
      const savedUtility =
        mode === "edit" && editingUtility
          ? await updateUtility(editingUtility.id, payload)
          : await addUtility(payload)

      if (formBoundaryGeojson && !savedUtility.boundaryGeojson) {
        throw new Error("The utility was saved, but the backend did not persist the uploaded boundary geometry.")
      }

      if (!formBoundaryGeojson && savedUtility.boundaryGeojson) {
        throw new Error("The utility was saved, but the backend did not delete the cleared boundary geometry.")
      }

      if (
        parsedLatitude !== null &&
        parsedLongitude !== null &&
        (savedUtility.centerLatitude == null || savedUtility.centerLongitude == null)
      ) {
        throw new Error("The utility was saved, but the backend did not persist the utility center point.")
      }

      if (mode === "edit" && editingUtility) {
        toast.success("Utility updated successfully")
        router.replace(`/dashboard/utilities/${savedUtility.slug || savedUtility.id}/edit`)
      } else {
        toast.success("Utility created successfully")
        router.push(`/dashboard/utilities/${savedUtility.slug || savedUtility.id}/edit`)
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : mode === "edit"
            ? "Failed to update utility"
            : "Failed to create utility"
      )
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

      const response = await fetch("/api/utility-boundary/extract", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as BoundaryExtractionResponse

      if (!response.ok) {
        throw new Error(payload.error || "Failed to extract utility boundary geometry")
      }

      if (!payload.boundaryGeojson) {
        throw new Error("The uploaded file did not contain a usable utility service boundary.")
      }

      setFormBoundaryGeojson(payload.boundaryGeojson)

      const pointCount = payload.source?.pointCount ?? 0
      const polygonCount = payload.source?.polygonCount ?? (payload.boundaryGeojson.type === "MultiPolygon" ? payload.boundaryGeojson.coordinates.length : 1)
      toast.success(
        `Utility boundary extracted from ${file.name} with ${polygonCount.toLocaleString()} service area polygon${polygonCount === 1 ? "" : "s"} and ${pointCount.toLocaleString()} points. Check the primary city point and edit it if needed.`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to extract utility boundary geometry")
    } finally {
      setIsExtractingBoundary(false)
    }
  }

  if (!isAdmin && !isUtilityManager) {
    return (
      <div className="flex flex-col gap-6">
        <Button asChild variant="outline" className="w-fit rounded-xl">
          <Link href="/dashboard/utilities">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Utilities
          </Link>
        </Button>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold text-slate-800">Access Restricted</p>
            <p className="mt-2 text-sm text-slate-500">Only admins and utility managers can edit utility details.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (mode === "create" && !isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <Button asChild variant="outline" className="w-fit rounded-xl">
          <Link href="/dashboard/utilities">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Utilities
          </Link>
        </Button>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold text-slate-800">Admin Action Required</p>
            <p className="mt-2 text-sm text-slate-500">Only admins can create a new utility.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Button asChild variant="outline" className="w-fit rounded-xl">
          <Link href="/dashboard/utilities">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Utilities
          </Link>
        </Button>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center text-slate-500">Loading utility form...</CardContent>
        </Card>
      </div>
    )
  }

  if (mode === "edit" && !editingUtility) {
    return (
      <div className="flex flex-col gap-6">
        <Button asChild variant="outline" className="w-fit rounded-xl">
          <Link href="/dashboard/utilities">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Utilities
          </Link>
        </Button>
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="py-16 text-center">
            <p className="text-lg font-semibold text-slate-800">Utility not found</p>
            <p className="mt-2 text-sm text-slate-500">The utility you are trying to edit could not be loaded.</p>
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
            <Link href="/dashboard/utilities">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Utilities
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
              {mode === "edit" ? <Pencil className="h-7 w-7 text-sky-600" /> : <Plus className="h-7 w-7 text-sky-600" />}
              {mode === "edit" ? "Edit Utility" : "Create Utility"}
            </h1>
            <p className="mt-1 text-slate-500">
              {mode === "edit"
                ? "Update utility details, public contacts, service center, and boundary geometry."
                : "Create a utility with public contacts, a service center, and a reusable boundary geometry."}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/dashboard/utilities">Cancel</Link>
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 hover:from-cyan-600 hover:to-blue-700"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : mode === "edit" ? (
              <Save className="mr-2 h-4 w-4" />
            ) : null}
            {mode === "edit" ? "Save Changes" : "Create Utility"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="utility-name" className="text-sm font-medium text-slate-700">Utility Name</Label>
              <Input
                id="utility-name"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                placeholder="e.g., DAWASA"
                className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-slate-700">Region Authority</Label>
              <Select value={formRegionName || "__none__"} onValueChange={(value) => setFormRegionName(value === "__none__" ? "" : value)}>
                <SelectTrigger className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80">
                  <SelectValue placeholder="Select utility region" />
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
                  <SelectItem value="__none__" className="rounded-lg">No region selected yet</SelectItem>
                  {TANZANIA_REGIONS.map((region) => (
                    <SelectItem key={region} value={region} className="rounded-lg">
                      {region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="utility-description" className="text-sm font-medium text-slate-700">Description</Label>
              <Textarea
                id="utility-description"
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                placeholder="Briefly describe this utility and its service area."
                rows={4}
                className="resize-none rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="utility-phone" className="text-sm font-medium text-slate-700">Public Contact Phone</Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="utility-phone"
                    value={formContactPhone}
                    onChange={(event) => setFormContactPhone(event.target.value)}
                    placeholder="e.g. +255712345678"
                    className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 pl-10 focus:border-cyan-400 focus:ring-cyan-400/20"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="utility-email" className="text-sm font-medium text-slate-700">Public Contact Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="utility-email"
                    type="email"
                    value={formContactEmail}
                    onChange={(event) => setFormContactEmail(event.target.value)}
                    placeholder="e.g. support@utility.co.tz"
                    className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 pl-10 focus:border-cyan-400 focus:ring-cyan-400/20"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="utility-contact-address" className="text-sm font-medium text-slate-700">Public Contact Address</Label>
              <Textarea
                id="utility-contact-address"
                value={formContactAddress}
                onChange={(event) => setFormContactAddress(event.target.value)}
                placeholder="Office address to show in public emergency contacts."
                rows={3}
                className="resize-none rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="utility-center-latitude" className="text-sm font-medium text-slate-700">Center Latitude <span className="text-rose-500">*</span></Label>
                <Input
                  id="utility-center-latitude"
                  type="number"
                  step="0.000001"
                  value={formCenterLatitude}
                  onChange={(event) => setFormCenterLatitude(event.target.value)}
                  placeholder="-6.173056"
                  className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="utility-center-longitude" className="text-sm font-medium text-slate-700">Center Longitude <span className="text-rose-500">*</span></Label>
                <Input
                  id="utility-center-longitude"
                  type="number"
                  step="0.000001"
                  value={formCenterLongitude}
                  onChange={(event) => setFormCenterLongitude(event.target.value)}
                  placeholder="35.741944"
                  className="h-12 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-slate-500">
              The center point represents the utility's primary operational city and is shown as the utility dot on the admin dashboard map.
            </p>

            <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-slate-700">Official Areas of Service</Label>
                  <p className="text-xs text-slate-500">
                    Add the named areas officially served by this utility. They are kept under the selected utility region only.
                  </p>
                  <p className="text-xs text-slate-500">
                    Selected region: <span className="font-medium text-slate-700">{formRegionName || "Select a region above first"}</span>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 rounded-xl"
                  onClick={() => setFormServiceAreas((current) => [...current, createServiceArea("district", "", formRegionName)])}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Area
                </Button>
              </div>

              {formServiceAreas.length ? (
                <div className="space-y-3">
                  {formServiceAreas.map((area) => (
                    <div
                      key={area.id}
                      className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 md:grid-cols-[minmax(160px,0.75fr)_minmax(0,1fr)_minmax(0,0.85fr)_auto]"
                    >
                      <div className="flex flex-col gap-2">
                        <Label className="text-xs font-medium uppercase tracking-wide text-slate-500">Category</Label>
                        <Select
                          value={area.category}
                          onValueChange={(value) =>
                            setFormServiceAreas((current) =>
                              current.map((entry) =>
                                entry.id === area.id
                                  ? { ...entry, category: value as UtilityServiceAreaCategory }
                                  : entry
                              )
                            )
                          }
                        >
                          <SelectTrigger className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl shadow-lg shadow-slate-200/50">
                            {SERVICE_AREA_CATEGORIES.map((category) => (
                              <SelectItem key={category.value} value={category.value} className="rounded-lg">
                                {category.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label className="text-xs font-medium uppercase tracking-wide text-slate-500">Area Name</Label>
                        <Input
                          value={area.name}
                          onChange={(event) =>
                            setFormServiceAreas((current) =>
                              current.map((entry) =>
                                entry.id === area.id ? { ...entry, name: event.target.value } : entry
                              )
                            )
                          }
                          placeholder={getServiceAreaPlaceholder(area.category)}
                          className="h-11 rounded-xl border-slate-200/80 bg-slate-50/80 focus:border-cyan-400 focus:ring-cyan-400/20"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label className="text-xs font-medium uppercase tracking-wide text-slate-500">Region</Label>
                        <div className="flex h-11 items-center rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 text-sm text-slate-700">
                          {formRegionName || "Select region above"}
                        </div>
                      </div>

                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => setFormServiceAreas((current) => current.filter((entry) => entry.id !== area.id))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-500">
                  No official service areas added yet. Add at least the main served area when this information is available.
                </div>
              )}
            </div>

          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-5">
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium text-slate-700">Utility Status</Label>
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

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cyan-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Utility Spatial Preview</p>
                  <p className="text-xs text-slate-500">Click the map to set the utility center and preview uploaded service boundaries.</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <UtilityLocationPicker
                  centerValue={{
                    latitude: formCenterLatitude.trim() ? Number(formCenterLatitude) : null,
                    longitude: formCenterLongitude.trim() ? Number(formCenterLongitude) : null,
                  }}
                  boundaryGeojson={formBoundaryGeojson}
                  onCenterChange={({ latitude, longitude }) => {
                    setFormCenterLatitude(latitude.toFixed(6))
                    setFormCenterLongitude(longitude.toFixed(6))
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-slate-700">Utility Boundary Geometry</Label>
                  <p className="text-xs text-slate-500">
                    Upload an optional GIS boundary file when the utility has official service polygons.
                  </p>
                  <p className="text-xs text-slate-500">
                    Supported upload formats: GeoPackage (.gpkg), GeoJSON (.geojson), or JSON (.json). Files may contain one or many polygons.
                  </p>
                </div>
                <Input
                  id="utility-boundary-file"
                  type="file"
                  accept=".gpkg,.geojson,.json"
                  className="hidden"
                  onChange={handleBoundaryFileUpload}
                  disabled={isExtractingBoundary}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={isExtractingBoundary}
                    onClick={() => document.getElementById("utility-boundary-file")?.click()}
                  >
                    {isExtractingBoundary ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {isExtractingBoundary ? "Extracting..." : "Upload Boundary File"}
                  </Button>
                  {formBoundaryGeojson ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => setFormBoundaryGeojson(null)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear Boundary
                    </Button>
                  ) : null}
                </div>
              </div>

              {formBoundaryGeojson ? (
                <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 px-4 py-5 text-sm text-cyan-900">
                  Uploaded utility boundary is ready for preview. Save the utility to use it for dashboard hierarchy and report routing.
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-500">
                  No utility boundary uploaded. The system will use the center point as a fallback marker, and admins can still route reports manually when needed.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

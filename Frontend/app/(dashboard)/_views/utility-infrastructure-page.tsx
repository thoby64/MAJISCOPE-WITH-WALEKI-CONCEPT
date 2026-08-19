"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { Download, Loader2, Trash2, Upload } from "lucide-react"
import { InfrastructureIcon } from "@/components/icons/infrastructure-icon"
import { toast } from "sonner"
import { useAuthStore } from "@/store/auth-store"
import { getUtilityInfrastructureAsset, useDataStore, type Utility } from "@/store/data-store"
import { usePageAccess } from "@/hooks/use-page-access"
import CONFIG from "@/lib/config"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { UtilityPipeNetworkMap } from "@/components/maps/utility-pipe-network-map"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const ASSETS = [
  {
    type: "pipe_network",
    label: "Water pipes",
    description: "Polyline pipe network map used by the dashboard pipe overlay.",
    color: "from-sky-500 to-cyan-600",
  },
  {
    type: "valves",
    label: "Valves",
    description: "Point valve assets from the utility GIS export.",
    color: "from-rose-500 to-red-600",
  },
  {
    type: "water_sources",
    label: "Water sources",
    description: "Point source assets such as wells, boreholes, or intakes.",
    color: "from-cyan-500 to-blue-600",
  },
  {
    type: "storage_facilities",
    label: "Storage facilities",
    description: "Point tank and reservoir storage facility assets.",
    color: "from-amber-500 to-orange-600",
  },
  {
    type: "bulk_meters",
    label: "Bulk meters",
    description: "Point bulk meter assets used for utility infrastructure visibility.",
    color: "from-sky-500 to-cyan-600",
  },
] as const

type AssetType = (typeof ASSETS)[number]["type"]

function getAssetFile(utility: Utility | null, assetType: AssetType) {
  if (!utility) return null

  const layer = getUtilityInfrastructureAsset(utility, assetType)
  return layer
    ? {
        fileName: layer.fileName,
        fileSize: layer.fileSize,
        previewUrl: layer.previewUrl,
        downloadUrl: layer.downloadUrl,
        uploadedAt: layer.uploadedAt,
        featureCount: layer.featureCount,
      }
    : null
}

export default function UtilityInfrastructurePage() {
  usePageAccess()

  const { currentUser } = useAuthStore()
  const { utilities, fetchUtilities } = useDataStore()
  const [selectedUtilityId, setSelectedUtilityId] = useState<string>("")
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType>("pipe_network")
  const [uploadTarget, setUploadTarget] = useState<AssetType | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const isAdmin = currentUser?.role === "admin"
  const isUtilityManager = currentUser?.role === "utility_manager"

  useEffect(() => {
    void fetchUtilities()
  }, [fetchUtilities])

  const scopedUtilities = useMemo(() => {
    if (isUtilityManager) return utilities.filter((utility) => utility.id === currentUser?.utilityId)
    return utilities
  }, [currentUser?.utilityId, isUtilityManager, utilities])

  useEffect(() => {
    if (!selectedUtilityId && scopedUtilities[0]?.id) {
      setSelectedUtilityId(scopedUtilities[0].id)
    }
  }, [scopedUtilities, selectedUtilityId])

  const selectedUtility = scopedUtilities.find((utility) => utility.id === selectedUtilityId) || null
  const selectedAsset = ASSETS.find((asset) => asset.type === selectedAssetType) || ASSETS[0]
  const selectedAssetFile = getAssetFile(selectedUtility, selectedAssetType)

  if (!isAdmin && !isUtilityManager) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="p-8 text-center">
            <p className="text-lg font-semibold text-slate-900">Access restricted</p>
            <p className="mt-1 text-sm text-slate-500">Only admins and utility managers can upload utility infrastructure.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  function requestUpload(assetType: AssetType) {
    if (!selectedUtility) return
    setSelectedAssetType(assetType)
    setUploadTarget(assetType)
    uploadInputRef.current?.click()
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const assetType = uploadTarget
    event.target.value = ""

    if (!file || !assetType || !selectedUtility) return

    const token = localStorage.getItem(CONFIG.storage.tokenKey)
    if (!token) {
      toast.error("You are not authenticated.")
      return
    }

    if (!file.name.toLowerCase().endsWith(".gpkg")) {
      toast.error("Upload a single GeoPackage (.gpkg) file for infrastructure assets.")
      setUploadTarget(null)
      return
    }

    const formData = new FormData()
    formData.append("file", file)
    const asset = ASSETS.find((item) => item.type === assetType) || ASSETS[0]
    const busy = `${selectedUtility.id}:${assetType}`
    setBusyKey(busy)
    const toastId = toast.loading(`Uploading ${asset.label.toLowerCase()} ...`)

    const endpoint = `/utilities/${selectedUtility.id}/infrastructure/${assetType}`

    try {
      const response = await fetch(`${CONFIG.backend.fullUrl}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.dismiss(toastId)
        toast.error(payload.detail || payload.error || `Failed to upload ${asset.label.toLowerCase()}`)
        return
      }

      const summary = payload.ingest_summary || payload.ingestSummary
      const ready = Number(summary?.previewable_features || summary?.previewableFeatures || 0)
      toast.dismiss(toastId)
      toast.success(
        ready > 0
          ? `${asset.label} uploaded with ${ready.toLocaleString()} previewable feature${ready === 1 ? "" : "s"}.`
          : `${asset.label} uploaded successfully.`
      )
      await fetchUtilities()
    } catch (error) {
      toast.dismiss(toastId)
      console.error("Error uploading utility infrastructure:", error)
      toast.error(`Failed to upload ${asset.label.toLowerCase()}`)
    } finally {
      setBusyKey(null)
      setUploadTarget(null)
    }
  }

  async function handleDownload(assetType: AssetType) {
    if (!selectedUtility) return
    const assetFile = getAssetFile(selectedUtility, assetType)
    if (!assetFile?.downloadUrl) return

    const token = localStorage.getItem(CONFIG.storage.tokenKey)
    if (!token) {
      toast.error("You are not authenticated.")
      return
    }

    const busy = `${selectedUtility.id}:${assetType}`
    setBusyKey(busy)
    try {
      const response = await fetch(`${CONFIG.backend.baseUrl}${assetFile.downloadUrl}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        toast.error(payload.detail || payload.error || "Failed to download infrastructure file")
        return
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = assetFile.fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Error downloading utility infrastructure:", error)
      toast.error("Failed to download infrastructure file")
    } finally {
      setBusyKey(null)
    }
  }

  async function handleRemove(assetType: AssetType) {
    if (!selectedUtility) return
    const token = localStorage.getItem(CONFIG.storage.tokenKey)
    if (!token) {
      toast.error("You are not authenticated.")
      return
    }

    const asset = ASSETS.find((item) => item.type === assetType) || ASSETS[0]
    const endpoint = `/utilities/${selectedUtility.id}/infrastructure/${assetType}`
    const busy = `${selectedUtility.id}:${assetType}`
    setBusyKey(busy)

    try {
      const response = await fetch(`${CONFIG.backend.fullUrl}${endpoint}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(payload.detail || payload.error || `Failed to remove ${asset.label.toLowerCase()}`)
        return
      }
      toast.success(`${asset.label} removed successfully.`)
      await fetchUtilities()
    } catch (error) {
      console.error("Error removing utility infrastructure:", error)
      toast.error(`Failed to remove ${asset.label.toLowerCase()}`)
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Utility Infrastructure Upload</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-300">
            Upload utility GIS assets individually so the dashboard can display pipes, valves, water sources, storage facilities, and bulk meters as separate map layers.
          </p>
        </div>
        <div className="w-full md:w-80">
          <Select value={selectedUtilityId} onValueChange={setSelectedUtilityId}>
            <SelectTrigger className="h-11 rounded-xl border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
              <SelectValue placeholder="Select utility" />
            </SelectTrigger>
            <SelectContent>
              {scopedUtilities.map((utility) => (
                <SelectItem key={utility.id} value={utility.id}>
                  {utility.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid h-[calc(100dvh-18rem)] min-h-[430px] max-h-[540px] grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-50/60 p-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/30">
          <div className="h-full space-y-3 overflow-y-auto pr-1">
            {ASSETS.map((asset) => {
            const file = getAssetFile(selectedUtility, asset.type)
            const busy = busyKey === `${selectedUtility?.id}:${asset.type}`
            const selected = selectedAssetType === asset.type

            return (
              <div
                key={asset.type}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedAssetType(asset.type)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    setSelectedAssetType(asset.type)
                  }
                }}
                className={cn(
                  "w-full cursor-pointer rounded-2xl border p-3 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                  selected
                    ? "border-sky-400 bg-sky-50/80 shadow-sky-500/10 dark:border-sky-500/70 dark:bg-sky-950/35"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                )}
              >
                <div className="flex items-start gap-3">
                  <InfrastructureIcon assetType={asset.type} className="mt-0.5 h-6 w-6 shrink-0 text-sky-600 dark:text-sky-300" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{asset.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{asset.description}</p>
                      </div>
                    </div>
                    {file ? (
                      <div className="mt-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300">
                        <p>{file.uploadedAt ? `Updated ${formatTanzaniaDateTime(file.uploadedAt)}` : "Uploaded"}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs font-medium text-slate-400">No file uploaded yet.</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          requestUpload(asset.type)
                        }}
                        disabled={!selectedUtility || busy}
                        className="h-8 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                      >
                        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                        {file ? "Replace" : "Upload"}
                      </Button>
                      {file ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleDownload(asset.type)
                            }}
                            disabled={busy}
                            className="h-8 rounded-lg"
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Download
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleRemove(asset.type)
                            }}
                            disabled={busy}
                            className="h-8 rounded-lg border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Remove
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )
            })}
          </div>
        </div>

        <div className="h-full min-h-0 min-w-0">
          <UtilityPipeNetworkMap
            utilityId={selectedUtility?.id || ""}
            previewUrl={selectedAssetFile?.previewUrl || null}
            fileName={selectedAssetFile?.fileName || null}
            assetType={selectedAsset.type}
            mapHeightClassName="min-h-0 flex-1"
            fallbackCenter={
              selectedUtility?.centerLatitude != null && selectedUtility?.centerLongitude != null
                ? [selectedUtility.centerLatitude, selectedUtility.centerLongitude]
                : null
            }
            title={`${selectedAsset.label} Preview`}
            emptyMessage={`Upload one GeoPackage (.gpkg) file containing ${selectedAsset.label.toLowerCase()} geometry and attributes to preview this utility layer.`}
          />
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        accept=".gpkg"
        onChange={handleUpload}
      />
    </div>
  )
}

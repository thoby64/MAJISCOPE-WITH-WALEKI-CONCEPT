"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { AlertTriangle, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { usePageAccess } from "@/hooks/use-page-access"
import { HYDRAULIC_LAUNCH_STORAGE_KEY } from "@/lib/hydraulic-workspace"

function prepareEmbeddedUrl(value: string, theme: "light" | "dark") {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported hydraulic workspace URL.")
  }
  url.searchParams.set("embedded", "1")
  url.searchParams.set("theme", theme)
  return url
}

export default function HydraulicWorkspacePage() {
  usePageAccess()

  const router = useRouter()
  const { setOpen, setOpenMobile } = useSidebar()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const sidebarInitializedRef = useRef(false)
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"
  const [launchUrl, setLaunchUrl] = useState<URL | null>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (sidebarInitializedRef.current) return
    sidebarInitializedRef.current = true
    setOpen(false)
    setOpenMobile(false)
  }, [setOpen, setOpenMobile])

  useEffect(() => {
    const storedUrl = window.sessionStorage.getItem(HYDRAULIC_LAUNCH_STORAGE_KEY)
    if (!storedUrl) {
      setError("This model session is unavailable or has expired. Prepare the hydraulic model again.")
      setLoading(false)
      return
    }

    try {
      setLaunchUrl(prepareEmbeddedUrl(storedUrl, theme))
    } catch {
      setError("The prepared hydraulic workspace URL is invalid.")
      setLoading(false)
    }
  }, [])

  const workspaceOrigin = useMemo(() => launchUrl?.origin ?? null, [launchUrl])

  useEffect(() => {
    if (!frameReady || !launchUrl || !iframeRef.current?.contentWindow) return
    iframeRef.current.contentWindow.postMessage(
      { type: "majiscope:theme", theme },
      launchUrl.origin
    )
  }, [frameReady, launchUrl, theme])

  useEffect(() => {
    function handleWorkspaceMessage(event: MessageEvent) {
      if (!workspaceOrigin || event.origin !== workspaceOrigin) return
      if (event.data?.type !== "hydraulic:return") return

      window.sessionStorage.removeItem(HYDRAULIC_LAUNCH_STORAGE_KEY)
      router.push("/dashboard")
    }

    window.addEventListener("message", handleWorkspaceMessage)
    return () => window.removeEventListener("message", handleWorkspaceMessage)
  }, [router, workspaceOrigin])

  function handleFrameLoad() {
    setLoading(false)
    setFrameReady(true)
  }

  if (error) {
    return (
      <div className="flex h-[calc(100svh-3.5rem)] items-center justify-center p-6">
        <div className="max-w-lg rounded-lg border border-amber-200 bg-white p-8 text-center shadow-sm dark:border-amber-500/30 dark:bg-slate-900">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
          <h1 className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">
            Hydraulic workspace unavailable
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{error}</p>
          <Button className="mt-5" onClick={() => router.push("/dashboard/hydraulic-model")}>Prepare Model</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-[calc(100svh-3.5rem)] w-full overflow-hidden bg-slate-100 dark:bg-slate-950">
      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
            Opening hydraulic model workspace...
          </div>
        </div>
      ) : null}

      {launchUrl ? (
        <iframe
          ref={iframeRef}
          title="Hydraulic Model Workspace"
          src={launchUrl.toString()}
          className="h-full w-full border-0"
          onLoad={handleFrameLoad}
          referrerPolicy="no-referrer"
          allow="fullscreen"
        />
      ) : null}
    </div>
  )
}

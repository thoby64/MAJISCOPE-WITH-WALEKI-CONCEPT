"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTheme } from "next-themes"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { CONFIG } from "@/lib/config"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ROLE_LABELS } from "@/lib/constants"
import { transformKeys } from "@/lib/transform-data"
import {
  NotificationRefreshSeconds,
  loadWebUiPreferences,
  resetWebUiPreferences,
  saveWebUiPreferences,
} from "@/lib/user-preferences"
import {
  Bell,
  CircleHelp,
  ExternalLink,
  Loader2,
  Mail,
  MonitorCog,
  Moon,
  RefreshCcw,
  Server,
  ShieldCheck,
  Sun,
  TriangleAlert,
  UserCircle2,
} from "lucide-react"

interface UserRecord {
  id: string
  name: string
  email: string
  phone?: string
  status: string
  role?: string
  utilityId?: string
  dmaId?: string
}

export default function SettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { currentUser } = useAuthStore()
  const { utilities, dmas } = useDataStore()
  const { resolvedTheme, setTheme } = useTheme()
  const [userRecord, setUserRecord] = useState<UserRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [uiPreferences, setUiPreferences] = useState(() => loadWebUiPreferences())
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)

  const section = searchParams.get("section") || "preferences"
  const hasToken = typeof window !== "undefined" ? Boolean(localStorage.getItem(CONFIG.storage.tokenKey)) : false

  const accessScopeSummary = useMemo(() => {
    if (currentUser?.role === "admin") return "Full national access across utilities, DMAs, teams, and reports."
    if (currentUser?.role === "utility_manager") return "Scoped to one utility and the DMAs, teams, and reports inside it."
    if (currentUser?.role === "dma_manager") return "Scoped to one DMA and the operational teams and reports inside it."
    return "Current session scope unavailable."
  }, [currentUser?.role])

  useEffect(() => {
    void fetchUserRecord()
  }, [currentUser?.id, currentUser?.role])

  async function fetchUserRecord() {
    if (!currentUser?.id) return

    setLoading(true)
    try {
      let endpoint = ""
      if (currentUser.role === "utility_manager") endpoint = `${CONFIG.backend.fullUrl}/utility-managers/${currentUser.id}`
      else if (currentUser.role === "dma_manager") endpoint = `${CONFIG.backend.fullUrl}/dma-managers/${currentUser.id}`
      else if (currentUser.role === "admin") endpoint = `${CONFIG.backend.fullUrl}/users/${currentUser.id}`

      if (!endpoint) return

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          "Content-Type": "application/json",
        },
      })

      if (response.ok) {
        const data = await response.json()
        setUserRecord(transformKeys(data))
      }
    } catch (error) {
      console.error("Error fetching user settings record:", error)
    } finally {
      setLoading(false)
    }
  }

  const getUtilityName = (utilityId: string) => utilities.find((utility) => utility.id === utilityId)?.name || utilityId
  const getDMAName = (dmaId: string) => dmas.find((dma) => dma.id === dmaId)?.name || dmaId

  const goToSection = (nextSection: string) => {
    router.push(`/dashboard/settings?section=${nextSection}`)
  }

  const updateUiPreferences = (nextPreferences: Partial<typeof uiPreferences>) => {
    setUiPreferences(saveWebUiPreferences(nextPreferences))
  }

  const handleRefreshPreference = (seconds: NotificationRefreshSeconds) => {
    updateUiPreferences({ notificationRefreshSeconds: seconds })
  }

  const handleResetPreferences = () => {
    setTheme("light")
    setUiPreferences(resetWebUiPreferences())
  }

  const pageDescription =
    section === "help"
      ? "Get support, understand the workflow, and jump to the places that unblock your day."
      : "Adjust how this browser session behaves and what appears in your dashboard shell."

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings & Help"
        description={pageDescription}
      />

      <div className="flex flex-wrap gap-3">
        <Button
          variant={section === "preferences" ? "default" : "outline"}
          className="rounded-full"
          onClick={() => goToSection("preferences")}
        >
          <MonitorCog className="mr-2 h-4 w-4" />
          Preferences
        </Button>
        <Button
          variant={section === "help" ? "default" : "outline"}
          className="rounded-full"
          onClick={() => goToSection("help")}
        >
          <CircleHelp className="mr-2 h-4 w-4" />
          Help
        </Button>
        <Button variant="outline" className="rounded-full" onClick={() => router.push("/dashboard/profile")}>
          <UserCircle2 className="mr-2 h-4 w-4" />
          Open Profile
        </Button>
        <Button variant="outline" className="rounded-full" onClick={() => router.push("/dashboard/notifications")}>
          <Bell className="mr-2 h-4 w-4" />
          Notifications
        </Button>
      </div>

      {section === "preferences" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-4">
            <Card className="border-cyan-300 shadow-cyan-100/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MonitorCog className="h-4 w-4 text-cyan-600" />
                  Workspace Preferences
                </CardTitle>
                <CardDescription className="text-xs">
                  These controls change how the shared dashboard shell behaves for this browser session.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="text-sm font-semibold text-foreground">Theme mode</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Switch between light and dark viewing modes for the dashboard shell.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      variant={resolvedTheme !== "dark" ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => setTheme("light")}
                    >
                      <Sun className="mr-2 h-4 w-4" />
                      Light
                    </Button>
                    <Button
                      variant={resolvedTheme === "dark" ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => setTheme("dark")}
                    >
                      <Moon className="mr-2 h-4 w-4" />
                      Dark
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-sm font-semibold text-foreground">Notification refresh interval</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose how often the top bar checks for new notifications while this dashboard stays open.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {[30, 60, 120].map((seconds) => (
                      <Button
                        key={seconds}
                        variant={uiPreferences.notificationRefreshSeconds === seconds ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => handleRefreshPreference(seconds as NotificationRefreshSeconds)}
                      >
                        {seconds === 30 ? "30 sec" : seconds === 60 ? "1 min" : "2 min"}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-sm font-semibold text-foreground">Header quick stats</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Show or hide the resolved, pending, and efficiency summary in the top navigation bar.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      variant={uiPreferences.showHeaderStats ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => updateUiPreferences({ showHeaderStats: true })}
                    >
                      Show stats
                    </Button>
                    <Button
                      variant={!uiPreferences.showHeaderStats ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => updateUiPreferences({ showHeaderStats: false })}
                    >
                      Hide stats
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" className="rounded-full" onClick={handleResetPreferences}>
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Reset to recommended
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCircle2 className="h-4 w-4 text-blue-600" />
                  Account Snapshot
                </CardTitle>
                <CardDescription className="text-xs">
                  Your active account details and assignment scope from the live backend.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                ) : userRecord ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label>Full Name</Label>
                        <Input value={userRecord.name ?? ""} readOnly />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Email</Label>
                        <Input value={userRecord.email ?? ""} readOnly />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label>Phone</Label>
                        <Input value={userRecord.phone ?? "Not provided"} readOnly />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Status</Label>
                        <Badge variant={userRecord.status === "active" ? "default" : "secondary"} className="w-fit text-xs">
                          {userRecord.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                      <p className="text-sm font-semibold text-foreground">Access scope</p>
                      <p className="mt-2 text-sm text-muted-foreground">{accessScopeSummary}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {userRecord.utilityId ? (
                        <div className="flex flex-col gap-2">
                          <Label>Assigned Utility</Label>
                          <Input value={getUtilityName(userRecord.utilityId)} readOnly />
                        </div>
                      ) : null}
                      {userRecord.dmaId ? (
                        <div className="flex flex-col gap-2">
                          <Label>Assigned DMA</Label>
                          <Input value={getDMAName(userRecord.dmaId)} readOnly />
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    Your account details are not available yet in this session.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Session Context
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Session role</p>
                    <Badge variant="secondary" className="mt-2 w-fit text-xs">
                      {currentUser ? ROLE_LABELS[currentUser.role] : "Unknown"}
                    </Badge>
                  </div>
                  <div className="rounded-2xl border border-border/70 p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">JWT token</p>
                    <Badge variant={hasToken ? "default" : "secondary"} className="mt-2 w-fit text-xs">
                      {hasToken ? "Present" : "Missing"}
                    </Badge>
                  </div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                  Notification polling currently runs every{" "}
                  <span className="font-semibold text-foreground">{uiPreferences.notificationRefreshSeconds}</span> seconds and
                  header stats are{" "}
                  <span className="font-semibold text-foreground">
                    {uiPreferences.showHeaderStats ? "visible" : "hidden"}
                  </span>
                  .
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="h-4 w-4 text-blue-600" />
                  Technical Session Details
                </CardTitle>
                <CardDescription className="text-xs">
                  Open this only when you need backend or deployment context for troubleshooting.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setShowTechnicalDetails((value) => !value)}
                >
                  <Server className="mr-2 h-4 w-4" />
                  {showTechnicalDetails ? "Hide technical details" : "Show technical details"}
                </Button>
                {showTechnicalDetails ? (
                  <>
                    <div className="rounded-2xl border border-border/70 p-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Backend API URL</p>
                      <p className="mt-2 break-all text-sm font-medium text-foreground">{CONFIG.backend.fullUrl}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={CONFIG.backend.usingFallbackBaseUrl ? "secondary" : "default"} className="text-xs">
                        {CONFIG.backend.usingFallbackBaseUrl ? "Using fallback backend URL" : "Environment URL configured"}
                      </Badge>
                      <Badge variant={CONFIG.backend.isLoopbackBaseUrl ? "secondary" : "default"} className="text-xs">
                        {CONFIG.backend.isLoopbackBaseUrl ? "Loopback / localhost" : "LAN / deployed backend"}
                      </Badge>
                    </div>
                    {CONFIG.backend.usingFallbackBaseUrl || CONFIG.backend.isLoopbackBaseUrl ? (
                      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                        <p className="text-sm text-amber-900">
                          This session is still using a local-style backend target. That is fine for development, but shared production use should point to a deployed backend URL.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Hidden by default so the settings page stays focused on actual user controls.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col gap-4">
            <Card className="border-amber-300 shadow-amber-100/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CircleHelp className="h-4 w-4 text-amber-600" />
                  Help Center
                </CardTitle>
                <CardDescription className="text-xs">
                  Find the right next step quickly when you are checking assignments, approvals, or account access.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-sm font-semibold text-foreground">Need to check assignments or approvals?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Open the live notification stream or jump straight to the report queue.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button variant="outline" className="rounded-full" onClick={() => router.push("/dashboard/notifications")}>
                      <Bell className="mr-2 h-4 w-4" />
                      Notification Center
                    </Button>
                    <Button variant="outline" className="rounded-full" onClick={() => router.push("/dashboard/reports")}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open Report Queue
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 p-4">
                  <p className="text-sm font-semibold text-foreground">Account recovery</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    If sign-in stops working, use the password reset flow or contact your system administrator.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button variant="outline" className="rounded-full" onClick={() => router.push("/reset-password")}>
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Reset Password
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          window.location.href = `mailto:support@majiscope.app?subject=MajiScope Support Request`
                        }
                      }}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Email Support
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Workflow Guidance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="font-semibold text-foreground">When a report seems stuck</p>
                  <p className="mt-2">
                    Check the notification center first, then open the report queue to confirm whether it is waiting for assignment, field resolution, team leader review, or DMA approval.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="font-semibold text-foreground">When a teammate cannot access work</p>
                  <p className="mt-2">
                    Confirm their role, utility, DMA, and account status on the assignment pages before escalating it as a system issue.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4 text-blue-600" />
                  Contact And Escalation
                </CardTitle>
                <CardDescription className="text-xs">
                  Use this when the workflow itself is blocked or a teammate cannot complete their next action.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <p className="font-semibold text-foreground">Before you escalate</p>
                  <p className="mt-2">
                    Check the notification center, confirm the user role and assignment scope, and review the report status before raising it as a platform issue.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.location.href = `mailto:support@majiscope.app?subject=MajiScope Support Request`
                      }
                    }}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Contact Support
                  </Button>
                  <Button variant="outline" className="rounded-full" onClick={() => router.push("/dashboard/notifications")}>
                    <Bell className="mr-2 h-4 w-4" />
                    Open Notifications
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Governance Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>MajiScope uses role-scoped access. Utilities should not operate outside their own hierarchy, and DMA actions should stay inside their assigned utility structure.</p>
                <p>Use the admin and manager assignment pages to resolve inactive accounts, missing leaders, or unassigned operational areas before those become field blockers.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { resolveApiBaseUrl } from "@/lib/config"
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { BrandWordmark } from "@/components/shared/brand-wordmark"

interface InviteValidation {
  valid: boolean
  message: string
  account_type?: string
  email?: string
  role?: string
  utility_name?: string
  team_name?: string
  dma_name?: string
  expires_at?: string
}

function SetupAccountPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const apiOriginParam = searchParams.get("api_origin") ?? searchParams.get("api") ?? ""
  const apiBaseUrl = resolveApiBaseUrl(apiOriginParam)
  const mobileAppDownloadUrl = (process.env.NEXT_PUBLIC_MOBILE_APP_DOWNLOAD_URL || "").trim()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [invite, setInvite] = useState<InviteValidation | null>(null)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  useEffect(() => {
    const validateInvite = async () => {
      if (!token) {
        setInvite({ valid: false, message: "Invite token is missing from this link." })
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`${apiBaseUrl}/auth/invitations/validate?token=${encodeURIComponent(token)}`)
        const data = await response.json().catch(() => ({ valid: false, message: "Unable to validate invite." }))
        setInvite(data as InviteValidation)
      } catch (error) {
        console.error("Error validating invite:", error)
        setInvite({ valid: false, message: "Unable to validate invite right now. Please try again shortly." })
      } finally {
        setLoading(false)
      }
    }

    void validateInvite()
  }, [apiBaseUrl, token])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!invite?.valid) return
    if (!name.trim()) return toast.error("Full name is required")
    if (!password.trim() || password.trim().length < 8) return toast.error("Password must be at least 8 characters")
    if (password !== confirmPassword) return toast.error("Passwords do not match")

    try {
      setSubmitting(true)
      const response = await fetch(`${apiBaseUrl}/auth/invitations/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: name.trim(),
          phone: phone.trim() || null,
          password,
          confirm_password: confirmPassword,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error((data as { detail?: string; error?: string }).detail || (data as { detail?: string; error?: string }).error || "Failed to complete account setup")
        return
      }

      toast.success("Account setup completed. You can now sign in.")
      setCompleted(true)
    } catch (error) {
      console.error("Error completing invite:", error)
      toast.error("Failed to complete account setup")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <Card className="relative z-10 w-full max-w-xl border-white/10 bg-white/95 shadow-2xl">
        <CardContent className="p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600">
              <CheckCircle2 className="h-7 w-7 text-white" />
            </div>
            <div className="mb-3 flex justify-center">
              <div className="rounded-2xl bg-slate-950 px-4 py-3 shadow-lg shadow-slate-950/15">
                <BrandWordmark size="md" theme="dark" centered />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Complete your setup</h1>
            <p className="mt-2 text-sm text-slate-500">Finish your profile and create your password to activate this account.</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : !invite?.valid ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{invite?.message || "This invitation is not valid."}</AlertDescription>
            </Alert>
          ) : completed ? (
            <div className="space-y-5">
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500">
                  <CheckCircle2 className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-slate-900">Thank you, your account is ready</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Use <span className="font-medium text-slate-900">{invite.email}</span> and the password you just created to sign in to the Majiscope mobile app.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-800">What to do next</p>
                <p className="mt-2">1. Open the Majiscope mobile app.</p>
                <p className="mt-1">2. Sign in with this email and your new password.</p>
                <p className="mt-1">3. Start working from your team dashboard.</p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                {mobileAppDownloadUrl ? (
                  <Button
                    type="button"
                    onClick={() => window.open(mobileAppDownloadUrl, "_blank", "noopener,noreferrer")}
                    className="h-11 flex-1 bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700"
                  >
                    <Smartphone className="mr-2 h-4 w-4" />
                    Download Mobile App
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => router.push("/login")} className="h-11 flex-1">
                  Go to Web Sign In
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>

              {!mobileAppDownloadUrl ? (
                <p className="text-center text-xs text-slate-400">
                  Add <code>NEXT_PUBLIC_MOBILE_APP_DOWNLOAD_URL</code> in the frontend environment to show the app download button here.
                </p>
              ) : null}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
                  <p className="font-medium text-slate-800">{invite.email}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Account Type</p>
                  <p className="font-medium capitalize text-slate-800">{(invite.role || "").replace("_", " ")}</p>
                </div>
                {invite.utility_name ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Utility</p>
                    <p className="font-medium text-slate-800">{invite.utility_name}</p>
                  </div>
                ) : null}
                {invite.dma_name ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">DMA</p>
                    <p className="font-medium text-slate-800">{invite.dma_name}</p>
                  </div>
                ) : null}
                {invite.team_name ? (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Team</p>
                    <p className="font-medium text-slate-800">{invite.team_name}</p>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="full-name">Full Name</Label>
                <Input id="full-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your full name" />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Enter your phone number" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a password" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" />
                </div>
              </div>

              <Button type="submit" disabled={submitting} className="h-11 w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700">
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Complete Account Setup
              </Button>

              <p className="text-center text-xs text-slate-400">
                Secure verification via {apiBaseUrl.replace(/\/api$/, "")}
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SetupAccountFallback() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 px-4 py-10">
      <Card className="relative z-10 w-full max-w-xl border-white/10 bg-white/95 shadow-2xl">
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    </div>
  )
}

export default function SetupAccountPage() {
  return (
    <Suspense fallback={<SetupAccountFallback />}>
      <SetupAccountPageContent />
    </Suspense>
  )
}

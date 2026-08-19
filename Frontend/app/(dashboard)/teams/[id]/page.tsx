"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { CONFIG } from "@/lib/config"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EntityStatusBadge } from "@/components/shared/status-badge"
import { ArrowLeft, Crown, Loader2, Mail, Phone, Plus, Users } from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"
import { toast } from "sonner"

interface TeamMember {
  id: string
  name: string
  email: string
  phone: string | null
  role: string
  status: string
  team_id?: string | null
}

interface TeamDetails {
  id: string
  slug?: string | null
  name: string
  description: string | null
  dma_id: string
  dma_name?: string
  leader_id: string | null
  leader?: TeamMember | null
  status: string
  engineers: TeamMember[]
}

export default function TeamMembersPage() {
  const params = useParams<{ id?: string; teamId?: string }>()
  const pathname = usePathname()
  const router = useRouter()
  const teamId = params?.teamId || params?.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [team, setTeam] = useState<TeamDetails | null>(null)
  const [eligibleEngineers, setEligibleEngineers] = useState<TeamMember[]>([])
  const [selectedEngineerIds, setSelectedEngineerIds] = useState<string[]>([])

  const loadData = async () => {
    if (!teamId) return
    try {
      setLoading(true)
      const response = await fetch(`${CONFIG.backend.fullUrl}/teams/${teamId}/members`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
      })
      if (!response.ok) {
        toast.error("Failed to load team details")
        return
      }
      const data = await response.json()
      setTeam(data.team)
      const canonicalId = data.team?.slug || data.team?.id
      if (canonicalId && pathname !== `/dashboard/teams/${canonicalId}`) {
        router.replace(`/dashboard/teams/${canonicalId}`)
      }
      setEligibleEngineers(data.eligibleEngineers || [])
      setSelectedEngineerIds(data.currentMemberIds || [])
    } catch (error) {
      console.error("Error loading team details:", error)
      toast.error("Failed to load team details")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [teamId])

  const availableToAdd = useMemo(
    () => eligibleEngineers.filter((engineer) => !selectedEngineerIds.includes(engineer.id)),
    [eligibleEngineers, selectedEngineerIds]
  )

  const handleToggleEngineer = (engineerId: string, checked: boolean) => {
    setSelectedEngineerIds((current) =>
      checked ? [...current, engineerId] : current.filter((id) => id !== engineerId)
    )
  }

  const handleSaveMembers = async () => {
    if (!teamId || !team) return
    try {
      setSaving(true)
      const currentMemberIds = new Set((team.engineers || []).map((engineer) => engineer.id))
      const nextMemberIds = new Set(selectedEngineerIds)

      const toAdd = [...nextMemberIds].filter((id) => !currentMemberIds.has(id))
      const toRemove = [...currentMemberIds].filter((id) => !nextMemberIds.has(id))

      if (toAdd.length > 0) {
        const addResponse = await fetch(`${CONFIG.backend.fullUrl}/teams/${teamId}/members`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ engineerIds: toAdd }),
        })
        if (!addResponse.ok) {
          const data = await addResponse.json().catch(() => ({}))
          toast.error((data as any).detail || "Failed to add team members")
          return
        }
      }

      if (toRemove.length > 0) {
        const removeResponse = await fetch(
          `${CONFIG.backend.fullUrl}/teams/${teamId}/members?engineerIds=${toRemove.join(",")}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
          }
        )
        if (!removeResponse.ok) {
          const data = await removeResponse.json().catch(() => ({}))
          toast.error((data as any).detail || "Failed to remove team members")
          return
        }
      }

      toast.success("Team members updated successfully")
      await loadData()
    } catch (error) {
      console.error("Error saving team members:", error)
      toast.error("Failed to save team members")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    )
  }

  if (!team) {
    return (
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="py-16 text-center">
          <p className="text-lg font-semibold text-slate-800">Team not found</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => router.push("/dashboard/teams")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{team.name}</h1>
            <p className="mt-1 text-sm text-slate-500">Manage members directly inside {team.dma_name || "this DMA"}.</p>
          </div>
        </div>
        <EntityStatusBadge status={team.status as any} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20 md:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-sky-600 shadow-lg shadow-cyan-500/20">
                <Users className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-slate-800">Current Team Members</p>
                <p className="text-sm text-slate-500">{team.engineers.length} assigned</p>
              </div>
            </div>
            <div className="space-y-3">
              {team.engineers.length === 0 ? (
                <p className="text-sm text-slate-500">No engineers assigned yet.</p>
              ) : (
                team.engineers.map((engineer) => (
                  <div key={engineer.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <p className="font-medium text-slate-800">{engineer.name}</p>
                      <p className="text-xs text-slate-500">{engineer.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {engineer.role === "team_leader" && (
                        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Leader</span>
                      )}
                      <EntityStatusBadge status={engineer.status as any} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
                <Crown className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-slate-800">Team Leader</p>
                <p className="text-sm text-slate-500">{team.leader?.name || "Not assigned"}</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600">
                <WaterUtilityIcon className="h-4 w-4 text-cyan-600" />
                <span>{team.dma_name || "DMA not set"}</span>
              </div>
              {team.leader?.email && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Mail className="h-4 w-4 text-blue-600" />
                  <span>{team.leader.email}</span>
                </div>
              )}
              {team.leader?.phone && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="h-4 w-4 text-green-600" />
                  <span>{team.leader.phone}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-500/20">
              <Plus className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">Eligible Engineers In This DMA</p>
              <p className="text-sm text-slate-500">Select who should belong to this team.</p>
            </div>
          </div>
          <div className="space-y-3">
            {eligibleEngineers.length === 0 ? (
              <p className="text-sm text-slate-500">No eligible engineers found in this DMA.</p>
            ) : (
              eligibleEngineers.map((engineer) => {
                const checked = selectedEngineerIds.includes(engineer.id)
                return (
                  <label key={engineer.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center gap-3">
                      <Checkbox checked={checked} onCheckedChange={(value) => handleToggleEngineer(engineer.id, Boolean(value))} />
                      <div>
                        <p className="font-medium text-slate-800">{engineer.name}</p>
                        <p className="text-xs text-slate-500">{engineer.email}</p>
                      </div>
                    </div>
                    <EntityStatusBadge status={engineer.status as any} />
                  </label>
                )
              })
            )}
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={handleSaveMembers} disabled={saving} className="bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700">
              {saving ? "Saving..." : "Save Team Members"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

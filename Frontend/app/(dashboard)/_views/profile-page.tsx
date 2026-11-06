"use client"

import { useState, useEffect } from "react"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { CONFIG } from "@/lib/config"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ROLE_LABELS } from "@/lib/constants"
import { transformKeys } from "@/lib/transform-data"
import { 
  Loader2, 
  Mail, 
  Phone, 
  User, 
  Shield, 
  MapPin,
  CheckCircle,
  AlertCircle,
  Save
} from "lucide-react"
import { WaterUtilityIcon } from "@/components/icons/water-utility-icon"

interface UserRecord {
  id: string
  name: string
  email: string
  phone?: string
  status: string
  role?: string
  utilityId?: string
  utilityName?: string
  dmaId?: string
  dmaName?: string
  createdAt?: string
}

export default function ProfilePage() {
  const { currentUser } = useAuthStore()
  const { utilities, dmas } = useDataStore()
  const [userRecord, setUserRecord] = useState<UserRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editData, setEditData] = useState({ name: "", phone: "" })

  useEffect(() => {
    fetchUserRecord()
  }, [currentUser?.id, currentUser?.role])

  async function fetchUserRecord() {
    if (!currentUser?.id) return
    
    setLoading(true)
    try {
      let endpoint = ""
      
      if (currentUser.role === "utility_manager") {
        endpoint = `${CONFIG.backend.fullUrl}/utility-managers/${currentUser.id}`
      } else if (currentUser.role === "dma_manager") {
        endpoint = `${CONFIG.backend.fullUrl}/dma-managers/${currentUser.id}`
      } else if (currentUser.role === "admin") {
        endpoint = `${CONFIG.backend.fullUrl}/users/${currentUser.id}`
      }

      if (!endpoint) {
        setLoading(false)
        return
      }

      const response = await fetch(endpoint, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
          "Content-Type": "application/json"
        }
      })

      if (response.ok) {
        const data = await response.json()
        const transformed = transformKeys(data)
        setUserRecord(transformed)
        setEditData({
          name: transformed.name || "",
          phone: transformed.phone || ""
        })
      }
    } catch (error) {
      console.error("Error fetching user record:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!currentUser?.id) return
    
    setIsSaving(true)
    try {
      let endpoint = ""
      
      if (currentUser.role === "utility_manager") {
        endpoint = `${CONFIG.backend.fullUrl}/utility-managers/${currentUser.id}`
      } else if (currentUser.role === "dma_manager") {
        endpoint = `${CONFIG.backend.fullUrl}/dma-managers/${currentUser.id}`
      } else if (currentUser.role === "admin") {
        endpoint = `${CONFIG.backend.fullUrl}/users/${currentUser.id}`
      }

      if (!endpoint) return

      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem('access_token')}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: editData.name,
          phone: editData.phone
        })
      })

      if (response.ok) {
        const data = await response.json()
        const transformed = transformKeys(data)
        setUserRecord(transformed)
        setIsEditing(false)
      }
    } catch (error) {
      console.error("Error saving user record:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const getUtilityName = (utilityId: string) => {
    return utilities.find(u => u.id === utilityId)?.name || utilityId
  }

  const getDMAName = (dmaId: string) => {
    return dmas.find(d => d.id === dmaId)?.name || dmaId
  }

  const initials = currentUser?.name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase() || "?"

  return (
    <div className="flex flex-col gap-8 pb-8">
      <PageHeader
        title="My Profile"
        description="Manage your personal account information and credentials"
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : userRecord ? (
        <>
          {/* Profile Header Card */}
          <Card className="overflow-hidden border border-border/70 bg-card shadow-sm">
            <CardContent className="p-8">
              <div className="flex flex-col items-center text-center sm:flex-row sm:text-left gap-6">
                {/* Avatar */}
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-sm">
                  {initials}
                </div>

                {/* User Info */}
                <div className="flex-1">
                  <h1 className="mb-2 text-2xl font-bold text-foreground">{currentUser?.name}</h1>
                  <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                    <Badge className="bg-primary px-3 py-1 text-primary-foreground">
                      {ROLE_LABELS[currentUser?.role || "user"]}
                    </Badge>
                    <Badge variant={userRecord.status === "active" ? "default" : "secondary"} className="px-3 py-1">
                      {userRecord.status === "active" ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Active
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Inactive
                        </div>
                      )}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main Profile Information */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Editable Fields */}
            <Card className="lg:col-span-2 border-border bg-card shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="border-b border-border bg-secondary/55">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <User className="h-5 w-5 text-primary" />
                    Personal Information
                  </CardTitle>
                  {!isEditing && (
                    <Button
                      onClick={() => setIsEditing(true)}
                      size="sm"
                      variant="outline"
                      className="border-border text-primary hover:bg-secondary"
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-6">
                  {/* Full Name */}
                  <div className="flex flex-col gap-2">
                    <Label className="text-sm font-semibold text-foreground">Full Name</Label>
                    {isEditing ? (
                      <Input
                        value={editData.name}
                        onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                        className="border-border bg-secondary focus-visible:border-primary focus-visible:ring-primary/15"
                      />
                    ) : (
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary p-3">
                        <User className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-foreground">{userRecord.name}</span>
                      </div>
                    )}
                  </div>

                  {/* Phone Number */}
                  <div className="flex flex-col gap-2">
                    <Label className="text-sm font-semibold text-foreground">Phone Number</Label>
                    {isEditing ? (
                      <Input
                        value={editData.phone}
                        onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                        placeholder="Enter phone number"
                        className="border-border bg-secondary focus-visible:border-primary focus-visible:ring-primary/15"
                      />
                    ) : (
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary p-3">
                        <Phone className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-foreground">{userRecord.phone || "Not provided"}</span>
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="flex gap-3 border-t border-border pt-4">
                      <Button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="mr-2 h-4 w-4" />
                            Save Changes
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          setIsEditing(false)
                          setEditData({
                            name: userRecord.name || "",
                            phone: userRecord.phone || ""
                          })
                        }}
                        variant="outline"
                        className="flex-1 border-border"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Account Details (Read-only) */}
            <Card className="border-border bg-card shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="border-b border-border bg-secondary/55">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Shield className="h-5 w-5 text-primary" />
                  Account Details
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {/* Email */}
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email Address</Label>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary p-3">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <span className="truncate text-sm font-medium text-foreground">{userRecord.email}</span>
                  </div>
                </div>

                {/* Role */}
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</Label>
                  <Badge className="w-fit bg-primary text-primary-foreground">
                    {ROLE_LABELS[currentUser?.role || "user"]}
                  </Badge>
                </div>

                {/* Status */}
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</Label>
                  <Badge variant={userRecord.status === "active" ? "default" : "secondary"} className="w-fit">
                    {userRecord.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Assignment Information */}
          {(userRecord.utilityId || userRecord.dmaId) && (
            <Card className="border-border bg-card shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="border-b border-border bg-secondary/55">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MapPin className="h-5 w-5 text-primary" />
                  Organizational Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {userRecord.utilityId && (
                    <div className="flex flex-col gap-2">
                      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <WaterUtilityIcon className="h-4 w-4 text-primary" />
                        Assigned Utility
                      </Label>
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary p-3">
                        <span className="font-medium text-foreground">{getUtilityName(userRecord.utilityId)}</span>
                      </div>
                    </div>
                  )}
                  {userRecord.dmaId && (
                    <div className="flex flex-col gap-2">
                      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <WaterUtilityIcon className="h-4 w-4 text-primary" />
                        Assigned DMA
                      </Label>
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary p-3">
                        <span className="font-medium text-foreground">{getDMAName(userRecord.dmaId)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="border-slate-200">
          <CardContent className="p-8 text-center">
            <p className="text-slate-500">No profile data available</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

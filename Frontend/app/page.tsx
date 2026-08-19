"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"

export default function RootPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) {
      if (isAuthenticated) {
        router.replace("/dashboard")
      } else {
        router.replace("/login")
      }
    }
  }, [hydrated, isAuthenticated, router])

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-cyan-200/30 border-t-cyan-200" />
      </div>
      <p className="mt-4 text-sm text-blue-200/60">Loading MajiScope...</p>
    </div>
  )
}

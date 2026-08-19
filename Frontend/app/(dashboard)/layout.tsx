"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { TopNavbar } from "@/components/layout/top-navbar"
import { TopbarTitleProvider } from "@/components/layout/topbar-title-context"
import { cn } from "@/lib/utils"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated, currentUser } = useAuthStore()
  const { initialize, initialized } = useDataStore()
  const [hydrated, setHydrated] = useState(false)
  const isHydraulicWorkspace = pathname === "/dashboard/hydraulic-model/workspace"

  // Wait for Zustand to hydrate from localStorage
  useEffect(() => {
    setHydrated(true)
  }, [])

  // Initialize live API-backed store state on first load
  useEffect(() => {
    if (hydrated && !initialized) {
      initialize()
    }
  }, [hydrated, initialized, initialize])

  // Auth guard
  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace("/login")
    }
  }, [hydrated, isAuthenticated, router])

  // Show nothing while hydrating or if not authenticated
  if (!hydrated || !isAuthenticated || !currentUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading MajiScope...</p>
        </div>
      </div>
    )
  }

  return (
    <SidebarProvider defaultOpen={false}>
      <TopbarTitleProvider>
        <div className="flex w-full h-screen">
          <AppSidebar />
          <div className="flex flex-col flex-1">
            <TopNavbar />
            <SidebarInset className="relative m-0 min-h-[calc(100svh-3.5rem)] rounded-none bg-background">
              <main
                className={cn(
                  "flex-1 bg-background text-slate-900 dark:text-slate-100",
                  isHydraulicWorkspace
                    ? "overflow-hidden p-0"
                    : "overflow-y-auto overflow-x-hidden p-6"
                )}
              >
                {children}
              </main>
            </SidebarInset>
          </div>
        </div>
      </TopbarTitleProvider>
    </SidebarProvider>
  )
}

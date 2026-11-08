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

  useEffect(() => {
    const root = document.documentElement
    root.dataset.dashboardContentTheme = "active"
    return () => {
      delete root.dataset.dashboardContentTheme
    }
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
    <SidebarProvider defaultOpen={true}>
      <TopbarTitleProvider>
        <div className="flex h-screen min-h-0 w-full overflow-hidden">
          <AppSidebar />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#172a39] dark:bg-[#172a39]">
            <TopNavbar />
            <SidebarInset className="relative m-0 !min-h-0 min-w-0 flex-1 overflow-hidden bg-[linear-gradient(112deg,#172a39_0%,#142f3f_55%,#173546_100%)] dark:bg-[linear-gradient(112deg,#172a39_0%,#101d29_55%,#111e2a_100%)]">
              <main
                className={cn(
                  "dashboard-content-area min-h-0 flex-1 bg-background text-foreground md:rounded-tl-[18px]",
                  isHydraulicWorkspace
                    ? "overflow-hidden p-0"
                    : "overflow-y-auto overflow-x-hidden px-5 py-6 xl:px-8 xl:py-7"
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

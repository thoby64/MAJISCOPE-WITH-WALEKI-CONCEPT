"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { MouseEvent } from "react"
import { useTheme } from "next-themes"
import { useAuthStore } from "@/store/auth-store"
import { NAV_ITEMS } from "@/lib/constants"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { BrandWordmark } from "@/components/shared/brand-wordmark"
import { cleanupHydraulicWorkspaceSession } from "@/lib/hydraulic-workspace"

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const { resolvedTheme } = useTheme()
  const isCollapsed = !isMobile && state === "collapsed"
  const isHydraulicWorkspace = pathname === "/dashboard/hydraulic-model/workspace"

  if (!currentUser) return null

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(currentUser.role))

  async function handleWorkspaceNavigation(event: MouseEvent<HTMLElement>, href: string) {
    if (isMobile) setOpenMobile(false)
    if (!isHydraulicWorkspace || href === pathname) return

    event.preventDefault()
    await cleanupHydraulicWorkspaceSession()
    router.push(href)
  }

  return (
    <Sidebar 
      collapsible="icon" 
      overlayExpandedDesktop={isHydraulicWorkspace}
      className="border-r border-slate-300/80 bg-sidebar shadow-[8px_0_24px_-26px_rgba(15,23,42,0.38)]"
    >
      <div className="absolute inset-0 bg-slate-200/45 dark:bg-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-slate-400/70 dark:bg-slate-700/70" />

      <SidebarHeader className={cn(
        "border-b border-slate-300/80 relative bg-slate-200/55 backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-900/60",
        isCollapsed ? "px-2 py-4" : "px-5 py-6"
      )}>
        <Link href="/dashboard" onClick={(event) => void handleWorkspaceNavigation(event, "/dashboard")} className={cn(
          "flex items-center",
          isCollapsed ? "justify-center" : "gap-4"
        )}>
          <div className={cn(
            "relative flex items-center justify-center",
            isCollapsed ? "h-10 w-10" : "h-14 w-14"
          )}>
            <div className={cn(
              "relative flex items-center justify-center rounded-xl border border-slate-300 bg-slate-100 shadow-sm shadow-slate-900/[0.04] transition-shadow duration-500 hover:shadow-slate-900/[0.08]",
              isCollapsed ? "h-10 w-10" : "h-full w-full rounded-2xl"
            )}>
              <img 
                src="/logo1.png" 
                alt="MajiScope Logo" 
                className={cn(
                  "object-contain rounded-lg",
                  isCollapsed ? "h-6 w-6" : "h-9 w-9"
                )}
              />
            </div>
          </div>

          {!isCollapsed && (
            <div className="flex flex-col gap-0.5">
              <BrandWordmark
                size="sm"
                theme={resolvedTheme === "dark" ? "dark" : "light"}
                wordClassName="leading-none"
                underlineClassName="mt-1 h-0.5"
              />
              <span className="mt-2 font-serif text-[11px] font-bold italic tracking-normal text-slate-600 dark:text-slate-400">
                <span className="text-cyan-700 dark:text-cyan-400">Smart Water.</span>{" "}
                <span>Informed Management.</span>
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className={cn(
        "flex flex-col h-full relative",
        isCollapsed ? "px-1 py-2" : "px-3 pt-4 pb-16"
      )}>
        <SidebarGroup className="flex-1 flex flex-col h-full">
          <SidebarGroupLabel className={cn(
            "text-slate-500 text-[10px] uppercase tracking-[0.15em] font-semibold mb-2",
            isCollapsed ? "px-0 text-center hidden" : "px-2"
          )}>
            {!isCollapsed && "Navigation"}
          </SidebarGroupLabel>
          <SidebarGroupContent className="flex-1 flex flex-col">
            <SidebarMenu className={cn(
              "flex flex-col",
              isCollapsed ? "gap-0 items-center justify-between flex-1 h-full" : "gap-1.5"
            )}>
              {visibleItems.map((item, index) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href))

                return (
                  <SidebarMenuItem key={item.href} className={isCollapsed ? "w-full flex justify-center flex-1" : ""}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={isMobile ? undefined : item.title}
                      className={cn(
                        "relative transition-all duration-300 ease-out",
                        isCollapsed ? "h-11 w-11 justify-center rounded-xl mx-auto" : "min-h-12 h-auto w-full rounded-xl justify-start px-4 py-2.5",
                        isActive 
                          ? "bg-gradient-to-r from-sky-700 to-blue-700 text-white shadow-md shadow-slate-900/15 hover:from-sky-800 hover:to-blue-800 hover:shadow-lg hover:shadow-slate-900/20" 
                          : "text-slate-600 hover:text-slate-950 hover:bg-slate-300/55",
                        "group overflow-hidden"
                      )}
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <Link 
                        href={item.href} 
                        onClick={(event) => void handleWorkspaceNavigation(event, item.href)}
                        className={cn(
                          "flex min-h-full w-full items-center",
                          isCollapsed ? "justify-center" : "gap-4"
                        )}
                      >
                        <div className="relative flex h-6 w-6 items-center justify-center">
                          <item.icon className={cn(
                            "transition-colors duration-200",
                            isActive 
                              ? "h-5 w-5 text-white" 
                              : "h-5 w-5 text-slate-700"
                          )} />
                        </div>
                        
                        {!isCollapsed && (
                          <span className={cn(
                            "max-w-[9.25rem] whitespace-normal break-words text-sm font-semibold leading-snug tracking-wide",
                            isActive ? "text-white" : ""
                          )}>
                            {item.title}
                          </span>
                        )}
                        
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
            {!isCollapsed && <div className="h-16 shrink-0" />}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

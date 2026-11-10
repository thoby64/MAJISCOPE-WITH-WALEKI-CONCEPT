"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, type MouseEvent } from "react"
import { ChevronRight } from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { NAV_ITEMS } from "@/lib/constants"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { BrandWordmark } from "@/components/shared/brand-wordmark"
import { cleanupHydraulicWorkspaceSession } from "@/lib/hydraulic-workspace"
import { loadWebUiPreferences, saveWebUiPreferences } from "@/lib/user-preferences"

const NAV_SECTIONS = [
  {
    id: "operations",
    label: "Operations",
    hrefs: ["/dashboard", "/dashboard/reports", "/dashboard/location-routing", "/dashboard/notifications"],
  },
  {
    id: "water-network",
    label: "Water network",
    hrefs: ["/dashboard/utilities", "/dashboard/utility-infrastructure", "/dashboard/dmas"],
  },
  {
    id: "monitoring",
    label: "Monitoring & insight",
    hrefs: [
      "/dashboard/hydraulic-model",
      "/dashboard/hydraulic-reports",
      "/dashboard/sensor-data",
      "/dashboard/sensors",
      "/dashboard/analytics",
    ],
  },
  {
    id: "people",
    label: "People & access",
    hrefs: [
      "/dashboard/managers",
      "/dashboard/dma-managers",
      "/dashboard/engineers",
      "/dashboard/teams",
      "/dashboard/team-leaders",
      "/dashboard/logs",
    ],
  },
] as const

// Default open state per group: frequent groups start open, the long tail
// (People & access) starts folded. Mobile opens only the first group since
// space is scarce there. Explicit user choices always win over these.
const DESKTOP_DEFAULT_OPEN: Record<string, boolean> = {
  operations: true,
  "water-network": true,
  monitoring: true,
  people: false,
}
const MOBILE_DEFAULT_OPEN: Record<string, boolean> = {
  operations: true,
  "water-network": false,
  monitoring: false,
  people: false,
}

function isNavItemActive(href: string, pathname: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
}

function resolveGroupOpen(
  groupId: string,
  isActiveSection: boolean,
  overrides: Record<string, boolean> | null,
  isMobile: boolean
) {
  const stored = overrides?.[groupId]
  if (stored !== undefined) return stored
  // The group containing the current page opens automatically so the active
  // item is never hidden — unless the user has explicitly chosen otherwise.
  if (isActiveSection) return true
  return (isMobile ? MOBILE_DEFAULT_OPEN : DESKTOP_DEFAULT_OPEN)[groupId] ?? true
}

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const isCollapsed = !isMobile && state === "collapsed"
  const isHydraulicWorkspace = pathname === "/dashboard/hydraulic-model/workspace"

  // null until preferences hydrate (after mount, so SSR markup stays stable).
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    setGroupOverrides(loadWebUiPreferences().sidebarOpenGroups)
  }, [])

  function toggleGroup(groupId: string, currentlyOpen: boolean) {
    // If hydration hasn't landed yet, read storage synchronously so a rapid
    // click can never clobber choices saved by an earlier visit.
    const base = groupOverrides ?? loadWebUiPreferences().sidebarOpenGroups
    const next = { ...base, [groupId]: !currentlyOpen }
    setGroupOverrides(next)
    saveWebUiPreferences({ sidebarOpenGroups: next })
  }

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
      className="border-r-0 group-data-[side=left]:border-r-0 bg-sidebar text-sidebar-foreground shadow-none"
    >
      <SidebarHeader className={cn(
        "relative flex-row items-center justify-between gap-2 overflow-hidden border-b border-sidebar-border bg-[#172a39] px-3 py-4 before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_at_88%_0%,rgba(85,164,192,0.16),transparent_58%)] after:pointer-events-none after:absolute after:bottom-0 after:left-5 after:right-5 after:h-px after:bg-gradient-to-r after:from-transparent after:via-[#5f9baa]/45 after:to-transparent",
        isCollapsed && "items-center px-2 py-4"
      )}>
        <Link
          href="/dashboard"
          onClick={(event) => void handleWorkspaceNavigation(event, "/dashboard")}
          aria-label="MajiScope home"
          className={cn("relative z-10 flex min-w-0 items-center", isCollapsed ? "flex-1 justify-center" : "gap-3")}
        >
          <span className={cn(
            "flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#e9efec] shadow-sm",
            isCollapsed ? "h-10 w-10" : "h-11 w-11"
          )}>
            <img src="/logo1.png" alt="" className="h-7 w-7 rounded-md object-contain" />
          </span>
          {!isCollapsed ? (
            <span className="flex min-w-0 flex-col">
              <BrandWordmark
                size="sm"
                theme="dark"
                wordClassName="leading-none"
              />
              <span className="mt-1.5 truncate font-serif text-[11px] italic tracking-[0.01em] text-[#c4d2d2]">
                <span className="bg-gradient-to-r from-[#75b9b2] via-[#8bc4bc] to-[#9abdc3] bg-clip-text text-transparent">Smart Water.</span>{" "}
                <span className="text-[#c4d2d2]">Informed Management.</span>
              </span>
            </span>
          ) : null}
        </Link>
        {!isMobile && !isCollapsed ? (
          <SidebarTrigger className="relative z-10 h-9 w-9 shrink-0 rounded-xl border border-[#4b7478] bg-gradient-to-br from-[#2a5860] to-[#203f4b] text-[#b8ded9] shadow-[0_5px_14px_-8px_rgba(0,0,0,0.8)] transition-all hover:border-[#78bdb5] hover:from-[#34717a] hover:to-[#28545f] hover:text-white focus-visible:ring-[#66c6bf]/55 [&_svg]:drop-shadow-[0_1px_2px_rgba(87,207,191,0.4)]" />
        ) : null}
      </SidebarHeader>

      <SidebarContent className={cn(
        "relative flex-1 overflow-x-hidden overflow-y-auto py-3",
        isCollapsed ? "px-1.5" : "px-3"
      )}>
        {NAV_SECTIONS.map((section) => {
          const sectionHrefs = new Set<string>(section.hrefs)
          const sectionItems = visibleItems.filter((item) => sectionHrefs.has(item.href))
          if (!sectionItems.length) return null

          const isActiveSection = section.hrefs.some((href) => isNavItemActive(href, pathname))
          const open = isCollapsed ? true : resolveGroupOpen(section.id, isActiveSection, groupOverrides, isMobile)

          return (
            <SidebarGroup key={section.id} className={cn(
              "p-0",
              !isCollapsed && "mb-3 border-b border-white/[0.055] pb-3 last:border-0 last:pb-0"
            )}>
              {!isCollapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(section.id, open)}
                  aria-expanded={open}
                  aria-controls={`sidebar-section-${section.id}`}
                  className="group mb-1 flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#96b1b5] transition-colors duration-150 hover:bg-white/[0.055] hover:text-[#c6d7db] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#66c6bf]/55"
                >
                  <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
                  {!open ? (
                    <span className="text-[9px] font-medium tabular-nums text-[#96b1b5]/70 group-hover:text-[#c6d7db]">
                      {sectionItems.length}
                    </span>
                  ) : null}
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "h-3 w-3 shrink-0 opacity-50 transition-all duration-200 group-hover:opacity-100",
                      open && "rotate-90"
                    )}
                  />
                </button>
              ) : null}
              <div
                id={`sidebar-section-${section.id}`}
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}
              >
                {/* Collapsed groups stay in the DOM (so the height animates)
                    but inert keeps their links out of the tab and a11y tree. */}
                <div className="min-h-0 overflow-hidden" inert={!open}>
                  <SidebarGroupContent>
                    <SidebarMenu className={cn("gap-1", isCollapsed && "items-center")}>
                  {sectionItems.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== "/dashboard" && pathname.startsWith(item.href))

                    return (
                      <SidebarMenuItem key={item.href} className={cn(isCollapsed && "flex w-full justify-center")}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={isMobile ? undefined : item.title}
                          className={cn(
                            "group relative h-10 rounded-lg text-[13px] font-medium transition-all duration-200 ease-out",
                            isCollapsed ? "mx-auto w-10 justify-center px-0" : "w-full justify-start gap-3 px-3",
                            isActive
                              ? "bg-[#2b4356] text-white shadow-[inset_3px_0_0_#65c8d0] hover:bg-[#344f63] hover:text-white"
                              : "text-[#d2dce5] hover:translate-x-0.5 hover:bg-white/[0.075] hover:text-white"
                          )}
                        >
                          <Link
                            href={item.href}
                            onClick={(event) => void handleWorkspaceNavigation(event, item.href)}
                            className={cn("flex min-h-full w-full min-w-0 items-center", isCollapsed ? "justify-center" : "gap-3")}
                          >
                            <span className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                              isActive
                                ? "bg-white/[0.09] text-[#80d4dc]"
                                : "text-[#aabac8] group-hover:bg-white/[0.055] group-hover:text-[#dbe9f2]"
                            )}>
                              <item.icon className="h-[17px] w-[17px]" />
                            </span>
                            {!isCollapsed ? <span className="min-w-0 truncate">{item.title}</span> : null}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </div>
              </div>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
    </Sidebar>
  )
}

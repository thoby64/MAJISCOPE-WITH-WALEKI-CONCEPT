"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import {
  Bell,
  CheckCheck,
  ChevronDown,
  User,
  LogOut,
  Shield,
  Moon,
  Sun,
  HelpCircle,
  Activity,
  Clock,
  Loader2,
  Settings,
} from "lucide-react"

import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { useTheme } from "next-themes"
import { useTopbarTitle } from "@/components/layout/topbar-title-context"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getNotificationTag, resolveNotificationDestinationWithData } from "@/lib/notifications"
import { formatTanzaniaShortDate } from "@/lib/date-time"
import { cn } from "@/lib/utils"
import { DEFAULT_WEB_UI_PREFERENCES, loadWebUiPreferences, subscribeToWebUiPreferences } from "@/lib/user-preferences"
import { BrandWordmark } from "@/components/shared/brand-wordmark"
import { NAV_ITEMS } from "@/lib/constants"

export function TopNavbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { state, isMobile } = useSidebar()
  const { currentUser, logout } = useAuthStore()
  const {
    notifications,
    fetchNotifications,
    getUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
  } = useDataStore()
  const { resolvedTheme, setTheme } = useTheme()
  const { title: topbarTitle } = useTopbarTitle()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [uiPreferences, setUiPreferences] = useState(DEFAULT_WEB_UI_PREFERENCES)

  const unreadCount = getUnreadNotificationCount()
  const recentNotifications = useMemo(() => notifications.slice(0, 5), [notifications])
  const isDarkMode = mounted && resolvedTheme === "dark"
  const isHydraulicWorkspace = pathname === "/dashboard/hydraulic-model/workspace"
  const activeNavItem = useMemo(() => {
    if (!currentUser?.role) return null

    return NAV_ITEMS
      .filter((item) => item.roles.includes(currentUser.role))
      .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      .sort((left, right) => right.href.length - left.href.length)[0] ?? null
  }, [currentUser?.role, pathname])
  const pageTitle = topbarTitle?.title || activeNavItem?.title || "Workspace"
  const shouldOffsetForHydraulicSidebar = isHydraulicWorkspace && !isMobile && state === "expanded"
  const hydraulicSidebarOffset = "calc(var(--sidebar-width) - var(--sidebar-width-icon))"

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const syncPreferences = () => {
      setUiPreferences(loadWebUiPreferences())
    }

    syncPreferences()
    return subscribeToWebUiPreferences(syncPreferences)
  }, [mounted])

  useEffect(() => {
    if (!currentUser?.id) return

    let active = true
    const loadNotifications = async () => {
      if (!active) return
      setNotificationsLoading(true)
      try {
        await fetchNotifications(currentUser.id)
      } finally {
        if (active) {
          setNotificationsLoading(false)
        }
      }
    }

    void loadNotifications()
    const intervalId = window.setInterval(() => {
      void fetchNotifications(currentUser.id)
    }, uiPreferences.notificationRefreshSeconds * 1000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [currentUser?.id, fetchNotifications, uiPreferences.notificationRefreshSeconds])

  const handleLogout = () => {
    logout()
    router.push("/login")
  }

  const handleProfile = () => {
    router.push("/dashboard/profile")
  }

  const handleSettings = () => {
    router.push("/dashboard/settings?section=preferences")
  }

  const handleHelp = () => {
    router.push("/dashboard/settings?section=help")
  }

  const handleOpenNotificationsPage = () => {
    setNotificationsOpen(false)
    router.push("/dashboard/notifications")
  }

  const handleOpenNotification = async (
    notificationId: string,
    title: string,
    type: string,
    link: string | null,
    data?: Record<string, unknown> | null
  ) => {
    await markNotificationRead(notificationId)
    setNotificationsOpen(false)

    const resolution = resolveNotificationDestinationWithData({
      id: notificationId,
      title,
      type,
      link,
      data,
    })
    router.push(resolution.destination || "/dashboard/notifications")
  }

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true)
    try {
      await markAllNotificationsRead()
    } finally {
      setMarkingAllRead(false)
    }
  }

  const formatNotificationTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const diffMs = Date.now() - date.getTime()
    const diffMinutes = Math.max(1, Math.floor(diffMs / 60000))

    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
    return formatTanzaniaShortDate(date, "N/A")
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "admin":
        return "Administrator"
      case "utility_manager":
        return "Utility Manager"
      case "dma_manager":
        return "DMA Manager"
      default:
        return "User"
    }
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-30 overflow-hidden transition-[margin,width] duration-200 ease-linear",
        shouldOffsetForHydraulicSidebar ? "ml-0" : "w-full"
      )}
      style={
        shouldOffsetForHydraulicSidebar
          ? {
              marginLeft: hydraulicSidebarOffset,
              width: `calc(100% - ${hydraulicSidebarOffset})`,
            }
          : undefined
      }
    >
      {/* Calm command bar */}
      <div className="relative flex h-16 w-full items-center justify-between gap-4 border-b border-[#c5d3cb] bg-[#dfe8e2] px-4 text-[#203642] backdrop-blur-xl dark:border-[#284650] dark:bg-[#102a32] dark:text-slate-100 sm:px-6">

        <div className="relative z-10 flex min-w-0 items-center gap-3 sm:gap-4">
          {/* Sidebar Trigger with Glow */}
          {isMobile || state === "collapsed" ? (
            <div className="relative shrink-0">
              <SidebarTrigger className="-ml-1 h-10 w-10 rounded-xl border border-[#b9d1c9] bg-gradient-to-br from-[#eff5f0] to-[#dce9e2] text-[#315861] shadow-sm shadow-[#18313c]/[0.08] transition-all hover:border-[#76aaa3] hover:from-[#e5f1eb] hover:to-[#cfe4dc] hover:text-[#087e83] focus-visible:ring-[#258f91]/45 dark:border-[#45656a] dark:bg-gradient-to-br dark:from-[#214853] dark:to-[#173640] dark:text-[#b6ded9] dark:hover:border-[#70aaa4] dark:hover:from-[#2b6269] dark:hover:to-[#1d4651] dark:hover:text-white [&_svg]:drop-shadow-[0_1px_2px_rgba(45,156,151,0.25)]" />
            </div>
          ) : null}

          <div className="hidden min-w-0 items-center gap-2.5 md:flex">
            {activeNavItem ? (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#c7d9d2] bg-[#e7f0ea] text-[#23787c] shadow-sm shadow-[#18313c]/[0.04] dark:border-[#31535b] dark:bg-[#193942] dark:text-[#86ccc5]">
                <activeNavItem.icon className="h-[17px] w-[17px]" />
              </span>
            ) : null}
            <span className="truncate text-sm font-semibold leading-none tracking-[-0.01em] text-[#203642] dark:text-slate-100">
              {pageTitle}
            </span>
          </div>

          {/* Styled MajiScope Name - Mobile Only */}
          <div className="flex min-w-0 items-center gap-2.5 md:hidden">
            <div className="relative shrink-0">
                <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-[#17313b] ring-1 ring-[#3a6870]">
                <Image
                  src="/logo1.png"
                  alt="MajiScope Logo"
                  width={28}
                  height={28}
                  className="object-contain"
                />
              </div>
            </div>
            <BrandWordmark
              size="sm"
              theme={isDarkMode ? "dark" : "light"}
              wordClassName="leading-none"
              className="shrink min-w-0"
            />
          </div>
        </div>

        {/* Center Content - Theme, Help, Notifications */}
        <div className="relative z-10 flex flex-1 items-center justify-end">
          <div className="flex items-center gap-0.5 rounded-2xl border border-[#c6d5cd] bg-[#e8efe9]/85 p-1 shadow-inner shadow-[#18313c]/[0.04] dark:border-[#2d4c54] dark:bg-[#17343c]/85 dark:shadow-black/10">
          {/* Theme Toggle MORDERN */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(isDarkMode ? "light" : "dark")}
                className="relative h-9 w-9 rounded-lg text-[#536b73] transition-colors hover:bg-[#e2e9e6] hover:text-[#203642] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            </TooltipContent>
          </Tooltip>

          {/* Help Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleHelp}
                className="relative hidden h-9 w-9 rounded-lg text-[#536b73] transition-colors hover:bg-[#e2e9e6] hover:text-[#203642] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:flex"
                aria-label="Open help and support"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Open help and support
            </TooltipContent>
          </Tooltip>

          {/* Notifications Dropdown */}
          <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative h-9 w-9 rounded-lg text-[#536b73] transition-colors hover:bg-[#e2e9e6] hover:text-[#203642] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#258f91]/40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                      aria-label="Open notifications"
                    >
                      <Bell className="h-4 w-4" />
                      {unreadCount > 0 ? (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center">
                          <span className="relative inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#087e83] px-1 text-[9px] font-bold text-white">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        </span>
                      ) : null}
                    </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                Open notifications
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="z-[9999] w-80 rounded-xl border border-[#d4ddd9] bg-[#f4f4ef] p-0 shadow-lg shadow-[#203642]/10 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-[#087e83] dark:text-[#65c7c2]" />
                  <span className="font-semibold text-slate-900 dark:text-white">Notifications</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#dfebe8] px-2 py-0.5 text-xs font-medium text-[#176b70] dark:bg-emerald-500/15 dark:text-emerald-300">
                    {unreadCount} unread
                  </span>
                  {unreadCount > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleMarkAllRead()}
                      disabled={markingAllRead}
                      className="h-7 rounded-lg px-2 text-xs text-[#087e83] hover:bg-[#dfebe8] hover:text-[#18313c] dark:text-emerald-300 dark:hover:text-emerald-200"
                    >
                      {markingAllRead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="max-h-80 overflow-auto p-2">
                {notificationsLoading ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg px-3 py-8 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading notifications...
                  </div>
                ) : recentNotifications.length > 0 ? (
                  recentNotifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => void handleOpenNotification(notification.id, notification.title, notification.type, notification.link, notification.data)}
                      className={`flex w-full gap-3 rounded-lg p-3 text-left transition-colors hover:bg-[#e8eeeb] dark:hover:bg-white/5 ${
                        notification.read ? "" : "bg-[#e6efec] dark:bg-emerald-500/5"
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          notification.read ? "bg-slate-100 dark:bg-slate-500/20" : "bg-[#dce9e5] dark:bg-emerald-500/15"
                        }`}
                      >
                        {notification.read ? (
                          <Clock className="h-4 w-4 text-slate-500 dark:text-slate-300" />
                        ) : (
                          <Bell className="h-4 w-4 text-[#087e83] dark:text-emerald-300" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{notification.title}</p>
                          {!notification.read ? (
                            <span className="rounded-full bg-[#dfebe8] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#176b70] dark:bg-emerald-500/15 dark:text-emerald-200">
                              New
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{notification.message}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-white/5 dark:text-slate-300">
                            {getNotificationTag(notification)}
                          </span>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">{formatNotificationTime(notification.createdAt)}</p>
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-lg px-3 py-8 text-center">
                    <Bell className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500" />
                    <p className="mt-3 text-sm font-medium text-slate-900 dark:text-white">No notifications yet</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Assignments, approvals, and alerts will appear here.</p>
                  </div>
                )}
              </div>
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  onClick={handleOpenNotificationsPage}
                  className="w-full justify-center rounded-lg text-sm text-[#087e83] hover:bg-[#dfebe8] hover:text-[#18313c] dark:text-emerald-300 dark:hover:text-emerald-200"
                >
                  View all notifications
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>

        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Divider */}
                <div className="hidden h-8 w-px bg-slate-200 dark:bg-slate-800 sm:block" />

          {/* User Profile Dropdown - Always at Right */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative flex h-auto items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-[#e4ebe1] hover:text-slate-900 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:hover:bg-slate-800 dark:hover:text-white sm:px-3"
              >
                <div className="relative">
                  <Avatar className="relative h-10 w-10 rounded-lg ring-1 ring-[#63a7a0]/45 ring-offset-2 ring-offset-[#dfe8e2] dark:ring-[#6dc8bd]/45 dark:ring-offset-[#102a32]">
                  <AvatarFallback className="rounded-lg bg-[#087e83] text-base font-semibold text-white">
                      {currentUser?.name
                        ?.split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                </div>

                {/* User Info - Desktop */}
                <div className="hidden flex-col items-start sm:flex">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {currentUser?.name || "User"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-[#c7d9d6] bg-[#dfebe8] px-2 py-0.5 text-[10px] font-medium text-[#176b70]">
                    <Shield className="h-2 w-2" />
                    {getRoleLabel(currentUser?.role || "")}
                  </span>
                </div>

                <ChevronDown className="hidden h-4 w-4 text-slate-500 transition-transform duration-200 group-data-[state=open]:rotate-180 dark:text-slate-400 sm:block" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="z-[9999] w-72 rounded-xl border border-[#d4ddd9] bg-[#f4f4ef] p-0 shadow-lg shadow-[#203642]/10 dark:border-slate-700 dark:bg-slate-900"
            >
              {/* Profile Header */}
              <div className="relative overflow-hidden border-b p-4">
                <div className="relative flex items-center gap-3">
                  <div className="relative">
                    <Avatar className="relative h-8 w-8 rounded-xl">
                      <AvatarFallback className="rounded-xl bg-[#087e83] text-sm font-semibold text-white">
                        {currentUser?.name
                          ?.split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {currentUser?.name || "User"}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {currentUser?.email || "Email unavailable"}
                    </span>
                    <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-[#c7d9d6] bg-[#dfebe8] px-2 py-0.5 text-[10px] font-medium text-[#176b70]">
                      <Shield className="h-2.5 w-2.5" />
                      {getRoleLabel(currentUser?.role || "")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="p-2">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={handleProfile}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white dark:focus:bg-white/5 dark:focus:text-white"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#dfebe8] dark:bg-emerald-500/15">
                      <User className="h-4 w-4 text-[#087e83] dark:text-emerald-300" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">View Profile</span>
                      <span className="text-[10px] text-slate-500">Manage your account details</span>
                    </div>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={handleSettings}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white dark:focus:bg-white/5 dark:focus:text-white"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#dfebe8] dark:bg-emerald-500/15">
                      <Settings className="h-4 w-4 text-[#087e83] dark:text-emerald-300" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Settings</span>
                      <span className="text-[10px] text-slate-500">Update preferences and support options</span>
                    </div>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={handleOpenNotificationsPage}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white dark:focus:bg-white/5 dark:focus:text-white"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
                      <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Notifications</span>
                      <span className="text-[10px] text-slate-500">Review your latest assignments and alerts</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator className="my-2 bg-slate-200 dark:bg-white/10" />

                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-red-600 transition-colors hover:bg-red-500/10 hover:text-red-700 focus:bg-red-500/10 focus:text-red-700 dark:text-red-400 dark:hover:text-red-300 dark:focus:bg-red-500/10 dark:focus:text-red-300"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10">
                    <LogOut className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Sign Out</span>
                    <span className="text-[10px] text-red-600/70 dark:text-red-400/70">End your current session</span>
                  </div>
                </DropdownMenuItem>
              </div>

            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

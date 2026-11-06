"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, CheckCheck, CheckCircle2, ClipboardCheck, ChevronRight, Loader2, RefreshCw, UserRound } from "lucide-react"
import { useAuthStore } from "@/store/auth-store"
import { useDataStore } from "@/store/data-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getNotificationTag, resolveNotificationDestinationWithData } from "@/lib/notifications"
import { formatTanzaniaDateTime } from "@/lib/date-time"
import { toast } from "sonner"

function getTanzaniaDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

function getNotificationIcon(type: string, title: string) {
  const description = `${type} ${title}`.toLowerCase()
  if (/assign|team|engineer/.test(description)) return UserRound
  if (/approv|review|follow/.test(description)) return ClipboardCheck
  if (/resolv|clos|complet/.test(description)) return CheckCircle2
  return Bell
}

export default function NotificationsPage() {
  const router = useRouter()
  const { currentUser } = useAuthStore()
  const {
    notifications,
    fetchNotifications,
    getUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
  } = useDataStore()
  const [loading, setLoading] = useState(true)
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const unreadCount = getUnreadNotificationCount()

  useEffect(() => {
    const loadNotifications = async () => {
      if (!currentUser?.id) {
        setLoading(false)
        return
      }

      setLoading(true)
      await fetchNotifications(currentUser.id)
      setLoading(false)
    }

    void loadNotifications()
  }, [currentUser?.id, fetchNotifications])

  const visibleNotifications = useMemo(() => {
    return showUnreadOnly ? notifications.filter((notification) => !notification.read) : notifications
  }, [notifications, showUnreadOnly])

  const notificationGroups = useMemo(() => {
    const todayKey = getTanzaniaDateKey(new Date())
    const yesterdayKey = getTanzaniaDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const groups: { key: string; title: string; items: typeof visibleNotifications }[] = [
      { key: "today", title: "Today", items: [] },
      { key: "yesterday", title: "Yesterday", items: [] },
      { key: "earlier", title: "Earlier", items: [] },
    ]

    for (const notification of visibleNotifications) {
      const dateKey = getTanzaniaDateKey(notification.createdAt)
      const group = dateKey === todayKey
        ? groups[0]
        : dateKey === yesterdayKey
          ? groups[1]
          : groups[2]
      group.items.push(notification)
    }

    return groups.filter((group) => group.items.length > 0)
  }, [visibleNotifications])

  const handleOpenNotification = async (
    notificationId: string,
    title: string,
    type: string,
    link: string | null,
    data?: Record<string, unknown> | null
  ) => {
    await markNotificationRead(notificationId)

    const resolution = resolveNotificationDestinationWithData({
      id: notificationId,
      title,
      type,
      link,
      data,
    })

    if (!resolution.destination) {
      toast.info("This notification was cleared, but it could not be opened right now.")
      return
    }

    if (resolution.source === "kind") {
      toast.info("Opened the report queue because this alert did not include a direct report link.")
    }

    router.push(resolution.destination)
  }

  const handleRefresh = async () => {
    if (!currentUser?.id) return
    setLoading(true)
    await fetchNotifications(currentUser.id)
    setLoading(false)
  }

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead()
  }

  return (
    <div className="content-page">
      <div className="content-surface-raised p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-start gap-4">
              <div className="content-accent-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
                <Bell className="h-6 w-6" />
              </div>
              <div>
                <p className="content-eyebrow">Alerts center</p>
                <h1 className="content-title mt-1 text-2xl sm:text-3xl">Notifications</h1>
                <p className="content-description mt-2">
                  Open assignment, review, approval, and follow-up alerts from one place.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge className="content-accent-soft px-3 py-1.5">{notifications.length} total</Badge>
            <Badge className="content-unread-count border-amber-700/15 bg-amber-700/10 px-3 py-1.5 text-amber-800 dark:text-amber-200">{unreadCount} unread</Badge>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant={showUnreadOnly ? "outline" : "default"}
            onClick={() => setShowUnreadOnly(false)}
            className={cn("content-control rounded-xl", !showUnreadOnly && "content-accent-button border-transparent")}
          >
            All Notifications
          </Button>
          <Button
            type="button"
            variant={showUnreadOnly ? "default" : "outline"}
            onClick={() => setShowUnreadOnly(true)}
            className={cn("content-control rounded-xl", showUnreadOnly && "content-accent-button border-transparent")}
          >
            Unread Only
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleRefresh()} className="content-control rounded-xl">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {unreadCount > 0 ? (
            <Button type="button" variant="outline" onClick={() => void handleMarkAllRead()} className="content-control rounded-xl">
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark All Read
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="content-surface overflow-hidden shadow-none">
        <CardContent className="p-6">
          {loading ? (
            <div className="content-description flex items-center justify-center py-16">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading notifications...
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="content-surface-inset px-6 py-16 text-center">
              <div className="content-accent-soft mx-auto flex h-16 w-16 items-center justify-center rounded-2xl">
                <Bell className="h-8 w-8" />
              </div>
              <p className="content-title mt-4 text-lg">No notifications to show</p>
              <p className="content-description mt-2 text-sm">
                {showUnreadOnly ? "You have already cleared every unread alert." : "New assignments and review updates will appear here."}
              </p>
            </div>
          ) : (
            <div className="space-y-7">
              {notificationGroups.map((group) => (
                <section key={group.key} aria-labelledby={`notification-group-${group.key}`} className="space-y-3">
                  <div className="flex items-center gap-3 px-1">
                    <h2 id={`notification-group-${group.key}`} className="content-eyebrow">{group.title}</h2>
                    <span className="content-description text-xs">
                      {group.items.length} {group.items.length === 1 ? "alert" : "alerts"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {group.items.map((notification) => {
                      const NotificationIcon = getNotificationIcon(notification.type, notification.title)
                      return (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => void handleOpenNotification(notification.id, notification.title, notification.type, notification.link, notification.data)}
                          className={cn(
                            "w-full rounded-2xl border p-5 text-left transition-all duration-200",
                            notification.read
                              ? "content-surface content-notification-hover"
                              : "content-notification-unread"
                          )}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", notification.read ? "content-surface-inset content-description" : "content-accent-soft")}>
                                <NotificationIcon className="h-4 w-4" aria-hidden="true" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="content-title text-base">{notification.title}</p>
                                  <span className="content-surface-inset content-description rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                                    {getNotificationTag(notification)}
                                  </span>
                                  {!notification.read ? (
                                    <span className="content-accent-soft rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                                      New
                                    </span>
                                  ) : null}
                                </div>
                                <p className="content-description mt-2 text-sm leading-6">{notification.message}</p>
                              </div>
                            </div>

                            <div className="content-description flex items-center gap-2 text-xs font-medium">
                              <span>{formatTanzaniaDateTime(notification.createdAt)}</span>
                              <ChevronRight className="h-4 w-4" />
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

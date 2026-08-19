export interface NotificationLike {
  id: string
  title: string
  type: string
  link: string | null
  data?: Record<string, unknown> | null
}

export interface NotificationDestinationResolution {
  destination: string | null
  source: "link" | "reportId" | "trackingId" | "kind" | "default"
}

export function getNotificationTag(notification: Pick<NotificationLike, "type" | "title" | "data">) {
  const kind = typeof notification.data?.notificationKind === "string" ? notification.data.notificationKind : ""
  const normalizedTitle = notification.title.toLowerCase()
  const normalizedType = (notification.type || "info").toLowerCase()

  if (kind === "team_leader_action" || normalizedTitle.includes("review")) return "Review"
  if (normalizedTitle.includes("assigned")) return "Assignment"
  if (normalizedTitle.includes("approved")) return "Approval"
  if (normalizedTitle.includes("rework") || normalizedTitle.includes("follow-up")) return "Rework"
  if (kind === "dma_action" || normalizedTitle.includes("dma")) return "DMA"
  return normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)
}

export function resolveNotificationDestination(link: string | null | undefined) {
  if (!link) return null
  if (link.startsWith("/")) return link

  try {
    const parsed = new URL(link)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

function getFallbackNotificationDestination(notification: NotificationLike): NotificationDestinationResolution {
  const kind = typeof notification.data?.notificationKind === "string" ? notification.data.notificationKind.toLowerCase() : ""
  const normalizedTitle = notification.title.toLowerCase()

  if (
    kind.includes("action") ||
    normalizedTitle.includes("assigned") ||
    normalizedTitle.includes("review") ||
    normalizedTitle.includes("approval") ||
    normalizedTitle.includes("rework") ||
    normalizedTitle.includes("reported leakage") ||
    normalizedTitle.includes("report")
  ) {
    return {
      destination: "/dashboard/reports",
      source: "kind",
    }
  }

  return {
    destination: "/dashboard/notifications",
    source: "default",
  }
}

export function resolveNotificationDestinationWithData(notification: NotificationLike): NotificationDestinationResolution {
  const directDestination = resolveNotificationDestination(notification.link)
  if (directDestination) {
    return {
      destination: directDestination,
      source: "link",
    }
  }

  const reportId =
    typeof notification.data?.reportId === "string" && notification.data.reportId.trim().length > 0
      ? notification.data.reportId.trim()
      : null

  if (reportId) {
    return {
      destination: `/dashboard/reports/${reportId}`,
      source: "reportId",
    }
  }

  const trackingId =
    typeof notification.data?.trackingId === "string" && notification.data.trackingId.trim().length > 0
      ? notification.data.trackingId.trim()
      : null

  if (trackingId) {
    return {
      destination: `/dashboard/reports?search=${encodeURIComponent(trackingId)}`,
      source: "trackingId",
    }
  }

  return getFallbackNotificationDestination(notification)
}

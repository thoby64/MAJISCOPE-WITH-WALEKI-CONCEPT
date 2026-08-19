export type NotificationRefreshSeconds = 30 | 60 | 120

export interface WebUiPreferences {
  showHeaderStats: boolean
  notificationRefreshSeconds: NotificationRefreshSeconds
}

const STORAGE_KEY = "majiscope_web_ui_preferences_v1"
const CHANGE_EVENT = "majiscope:web-ui-preferences-changed"

export const DEFAULT_WEB_UI_PREFERENCES: WebUiPreferences = {
  showHeaderStats: true,
  notificationRefreshSeconds: 60,
}

function normalizeRefreshSeconds(value: unknown): NotificationRefreshSeconds {
  if (value === 30 || value === 60 || value === 120) {
    return value
  }

  if (value === "30" || value === "60" || value === "120") {
    return Number(value) as NotificationRefreshSeconds
  }

  return DEFAULT_WEB_UI_PREFERENCES.notificationRefreshSeconds
}

export function loadWebUiPreferences(): WebUiPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_WEB_UI_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_WEB_UI_PREFERENCES
    }

    const parsed = JSON.parse(raw) as Partial<WebUiPreferences>
    return {
      showHeaderStats: parsed.showHeaderStats ?? DEFAULT_WEB_UI_PREFERENCES.showHeaderStats,
      notificationRefreshSeconds: normalizeRefreshSeconds(parsed.notificationRefreshSeconds),
    }
  } catch {
    return DEFAULT_WEB_UI_PREFERENCES
  }
}

export function saveWebUiPreferences(nextPreferences: Partial<WebUiPreferences>): WebUiPreferences {
  const merged = {
    ...loadWebUiPreferences(),
    ...nextPreferences,
  }

  const normalized: WebUiPreferences = {
    showHeaderStats: Boolean(merged.showHeaderStats),
    notificationRefreshSeconds: normalizeRefreshSeconds(merged.notificationRefreshSeconds),
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }

  return normalized
}

export function resetWebUiPreferences(): WebUiPreferences {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WEB_UI_PREFERENCES))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }

  return DEFAULT_WEB_UI_PREFERENCES
}

export function subscribeToWebUiPreferences(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY) {
      onChange()
    }
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(CHANGE_EVENT, onChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

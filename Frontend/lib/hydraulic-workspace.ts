export const HYDRAULIC_LAUNCH_STORAGE_KEY = "majiscope:hydraulic-launch-url"

type CleanupSessionInfo = {
  origin: string
  launchToken: string
  sessionId: string
}

function readCleanupSessionInfo(): CleanupSessionInfo | null {
  if (typeof window === "undefined") return null

  const launchUrl = window.sessionStorage.getItem(HYDRAULIC_LAUNCH_STORAGE_KEY)
  if (!launchUrl) return null

  try {
    const parsed = new URL(launchUrl)
    const launchToken = parsed.searchParams.get("launch_token")
    const sessionId = parsed.searchParams.get("session_id")
    if (!launchToken || !sessionId) return null

    return {
      origin: parsed.origin,
      launchToken,
      sessionId,
    }
  } catch {
    return null
  }
}

export function clearHydraulicWorkspaceSession(): void {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(HYDRAULIC_LAUNCH_STORAGE_KEY)
}

export async function cleanupHydraulicWorkspaceSession(options?: {
  clearStorage?: boolean
}): Promise<boolean> {
  const clearStorage = options?.clearStorage ?? true
  const session = readCleanupSessionInfo()

  if (!session) {
    if (clearStorage) clearHydraulicWorkspaceSession()
    return true
  }

  try {
    const response = await fetch(
      `${session.origin}/majiscope/cleanup/${encodeURIComponent(session.sessionId)}`,
      {
        method: "POST",
        headers: {
          "X-MajiScope-Launch-Token": session.launchToken,
          "X-MajiScope-Session-Id": session.sessionId,
        },
        keepalive: true,
      }
    )

    return response.ok
  } catch {
    return false
  } finally {
    if (clearStorage) clearHydraulicWorkspaceSession()
  }
}

import { NextResponse } from "next/server"
import CONFIG from "@/lib/config"

const BACKEND_URL = CONFIG.backend.baseUrl

export async function GET(
  _request: Request,
  context: { params: Promise<{ imageId: string }> }
) {
  const { imageId } = await context.params

  try {
    if (CONFIG.backend.usingFallbackBaseUrl) {
      console.warn(
        `[UploadPayloadProxy] NEXT_PUBLIC_BACKEND_URL is not set. Proxying upload payloads via fallback backend ${BACKEND_URL}.`
      )
    }

    const response = await fetch(`${BACKEND_URL}/api/uploads/${imageId}`, {
      cache: "no-store",
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to load upload payload (${response.status})` },
        { status: response.status }
      )
    }

    const payload = await response.json()
    return NextResponse.json(payload, { status: 200 })
  } catch (error) {
    console.error("Upload payload proxy error:", error)
    return NextResponse.json(
      {
        error: "Unable to reach backend upload service",
        hint: CONFIG.backend.usingFallbackBaseUrl
          ? "Set NEXT_PUBLIC_BACKEND_URL to your backend URL instead of relying on localhost fallback."
          : undefined,
      },
      { status: 502 }
    )
  }
}

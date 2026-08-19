"use client"

import { useEffect, useState } from "react"
import CONFIG from "@/lib/config"
import { cn } from "@/lib/utils"

const UPLOAD_URL_PATTERN = /\/api\/uploads\/([0-9a-fA-F-]{36})$/

const toAbsoluteUrl = (uri: string) => {
  if (!uri) return uri
  if (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("data:")) {
    return uri
  }
  if (uri.startsWith("/")) {
    return `${CONFIG.backend.baseUrl}${uri}`
  }
  return uri
}

const hexToBase64 = (hex: string) => {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((chunk) => parseInt(chunk, 16)) ?? [])
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

const getUploadId = (uri: string) => uri.match(UPLOAD_URL_PATTERN)?.[1] ?? null

const isVideoUri = (uri: string) => {
  const normalized = uri.toLowerCase()
  return (
    normalized.startsWith("data:video/") ||
    normalized.endsWith(".mp4") ||
    normalized.endsWith(".mov") ||
    normalized.endsWith(".webm") ||
    normalized.endsWith(".m4v")
  )
}

const resolveUploadUrl = async (uri: string) => {
  const uploadId = getUploadId(uri)
  if (!uploadId) {
    throw new Error("Invalid upload URL")
  }

  const response = await fetch(`/api/upload-payload/${uploadId}`)
  if (!response.ok) {
    throw new Error(`Failed to load image payload (${response.status})`)
  }

  const payload = await response.json()
  if (!payload?.data || !payload?.mimeType) {
    throw new Error("Invalid upload payload")
  }

  return `data:${payload.mimeType};base64,${hexToBase64(payload.data)}`
}

interface ResolvedImageProps {
  uri: string
  alt: string
  className?: string
  fallbackClassName?: string
  onClick?: (resolvedUri: string) => void
}

export function ResolvedImage({ uri, alt, className, fallbackClassName, onClick }: ResolvedImageProps) {
  const [resolvedUri, setResolvedUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!uri) {
        if (active) setFailed(true)
        return
      }

      try {
        if (uri.startsWith("data:") || !getUploadId(uri)) {
          if (active) setResolvedUri(toAbsoluteUrl(uri))
          return
        }

      const resolved = await resolveUploadUrl(uri)
      if (active) setResolvedUri(resolved)
    } catch (error) {
        console.warn("Media preview unavailable:", error instanceof Error ? error.message : error)
        if (active) setFailed(true)
      }
    }

    setResolvedUri(null)
    setFailed(false)
    void load()

    return () => {
      active = false
    }
  }, [uri])

  if (failed || !uri) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-medium text-slate-400",
          fallbackClassName
        )}
      >
        Media unavailable
      </div>
    )
  }

  if (!resolvedUri) {
    return (
      <div
        className={cn(
          "animate-pulse rounded-xl bg-slate-100",
          fallbackClassName
        )}
      />
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={() => onClick(resolvedUri)} className="block w-full text-left">
        {isVideoUri(resolvedUri) ? (
          <video src={resolvedUri} className={className} muted playsInline />
        ) : (
          <img src={resolvedUri} alt={alt} className={className} />
        )}
      </button>
    )
  }

  if (isVideoUri(resolvedUri)) {
    return <video src={resolvedUri} className={className} muted playsInline />
  }

  return <img src={resolvedUri} alt={alt} className={className} />
}

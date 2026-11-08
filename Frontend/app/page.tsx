"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"
import { BrandWordmark } from "@/components/shared/brand-wordmark"

export default function RootPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) {
      if (isAuthenticated) {
        router.replace("/dashboard")
      } else {
        router.replace("/login")
      }
    }
  }, [hydrated, isAuthenticated, router])

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#102a32] px-6 text-white"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(43,150,149,0.22),transparent_42%),linear-gradient(145deg,#102a32_0%,#10242d_58%,#153b40_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[42%] h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-teal-100/[0.07] intro-ripple" />
      <div className="pointer-events-none absolute left-1/2 top-[42%] h-[20rem] w-[20rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-teal-100/[0.09] intro-ripple intro-ripple-delay" />

      <div className="relative flex flex-col items-center">
        <Image
          src="/logo1.png"
          alt="MajiScope"
          width={32}
          height={32}
          priority
          className="mb-2 h-8 w-8 rounded-lg object-contain"
        />

        <div className="text-center">
          <BrandWordmark size="md" theme="dark" centered />
        </div>

        <p className="mt-10 text-sm font-medium tracking-[0.2em] text-[#d4e5e5]/75">Loading......</p>

        <div className="mt-5 flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((item) => (
            <span key={item} className="h-1 w-5 rounded-full bg-[#6ed3c5]/70 intro-progress-segment" style={{ animationDelay: `${item * 130}ms` }} />
          ))}
        </div>
      </div>
    </main>
  )
}

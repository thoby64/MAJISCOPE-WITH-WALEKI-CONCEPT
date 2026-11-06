"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/store/auth-store"

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
        <div className="relative mb-7 flex h-28 w-28 items-center justify-center rounded-[2rem] border border-white/15 bg-white/[0.08] shadow-[0_24px_70px_-30px_rgba(4,20,24,0.9)] backdrop-blur-xl">
          <span className="absolute inset-1 rounded-[1.7rem] border border-teal-100/15" />
          <Image src="/logo1.png" alt="MajiScope" width={76} height={76} priority className="relative z-10 h-[4.75rem] w-[4.75rem] rounded-2xl object-contain" />
          <span className="absolute -right-2 -top-2 h-4 w-4 rounded-full border-[3px] border-[#102a32] bg-[#73d4c6] intro-orbit-dot" />
          <span className="absolute -bottom-1 -left-2 h-2.5 w-2.5 rounded-full bg-[#80b9cb] intro-orbit-dot intro-orbit-dot-delay" />
        </div>

        <div className="text-center">
          <h1 className="text-[2.35rem] font-extrabold tracking-[-0.055em] leading-none">
            <span className="bg-gradient-to-r from-[#79ded0] via-[#a7e9df] to-[#67bcc7] bg-clip-text text-transparent">Maji</span><span className="text-white">Scope</span>
          </h1>
          <p className="mt-3 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/45">Smart Water. Informed Management.</p>
        </div>

        <div className="mt-10 flex items-center gap-3 rounded-full border border-white/[0.08] bg-white/[0.045] px-5 py-3 backdrop-blur-sm">
          <span className="flex h-3 w-3 items-center justify-center">
            <span className="absolute h-3 w-3 rounded-full bg-[#73d4c6]/35 intro-status-pulse" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-[#83ded1]" />
          </span>
          <p className="text-sm font-medium tracking-wide text-[#d4e5e5]/80">Preparing your workspace</p>
        </div>

        <div className="mt-5 flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((item) => (
            <span key={item} className="h-1 w-5 rounded-full bg-[#6ed3c5]/70 intro-progress-segment" style={{ animationDelay: `${item * 130}ms` }} />
          ))}
        </div>
      </div>
    </main>
  )
}

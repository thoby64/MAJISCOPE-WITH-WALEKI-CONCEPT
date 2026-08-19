"use client"

import Link from "next/link"
import { Home, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-cyan-950 to-blue-950 px-6 py-16 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/4 top-1/4 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-blue-400/10 blur-3xl" />
      </div>

      <section className="relative z-10 w-full max-w-2xl rounded-[2rem] border border-white/10 bg-white/10 p-8 shadow-2xl shadow-cyan-950/40 backdrop-blur-xl sm:p-12">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg shadow-cyan-500/30">
          <SearchX className="h-10 w-10 text-white" />
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-200">404 Error</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">Page not found</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-slate-200 sm:text-base">
            The page you tried to open is unavailable, may have moved, or the link may be incomplete.
          </p>
        </div>

        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild className="h-11 bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700">
            <Link href="/dashboard">
              <Home className="mr-2 h-4 w-4" />
              Go to Dashboard
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
            <Link href="/login">Back to Sign In</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}

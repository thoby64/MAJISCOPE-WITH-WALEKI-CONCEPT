import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function ReportThanksPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 text-slate-950">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">Report received</p>
        <h1 className="mt-3 text-3xl font-bold">Thank you</h1>
        <p className="mt-3 text-slate-600">
          Your report has been submitted successfully and will be reviewed by the responsible utility team.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Return home</Link>
        </Button>
      </section>
    </main>
  )
}

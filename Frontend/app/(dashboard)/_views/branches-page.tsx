"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Layers, MapPin, Users } from "lucide-react"

export default function BranchesPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-slate-200/60 shadow-lg shadow-slate-200/20">
        <CardContent className="py-16">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
              <Layers className="h-8 w-8 text-white" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-800">Branch Management Removed</h1>
              <p className="text-sm leading-6 text-slate-500">
                The live hierarchy is now <span className="font-semibold text-slate-700">Admin -&gt; Utility -&gt; DMA -&gt; Team -&gt; Engineer</span>.
                Teams now sit directly under a DMA, so branches are no longer part of the operational workflow.
              </p>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <MapPin className="mb-2 h-5 w-5 text-cyan-600" />
                <p className="text-sm font-semibold text-slate-700">DMAs own coverage</p>
                <p className="mt-1 text-xs text-slate-500">Public reports now route to the nearest DMA.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <Users className="mb-2 h-5 w-5 text-cyan-600" />
                <p className="text-sm font-semibold text-slate-700">Teams are the field unit</p>
                <p className="mt-1 text-xs text-slate-500">Create teams directly under a DMA and place engineers there.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <Layers className="mb-2 h-5 w-5 text-cyan-600" />
                <p className="text-sm font-semibold text-slate-700">Legacy data stays safe</p>
                <p className="mt-1 text-xs text-slate-500">Old branch records are retained only for backend compatibility.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button asChild className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700">
                <Link href="/dashboard/dmas">Open DMAs</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-xl">
                <Link href="/dashboard/teams">Open Teams</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-xl">
                <Link href="/dashboard/engineers">Open Engineers</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

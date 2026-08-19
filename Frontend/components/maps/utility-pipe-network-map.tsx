"use client"

import dynamic from "next/dynamic"

export const UtilityPipeNetworkMap = dynamic(
  () => import("./utility-pipe-network-map-impl").then((module) => module.UtilityPipeNetworkMapImpl),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[320px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        Loading utility pipe network map...
      </div>
    ),
  }
)

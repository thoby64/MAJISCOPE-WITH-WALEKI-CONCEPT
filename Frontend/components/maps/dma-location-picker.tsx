"use client"

import dynamic from "next/dynamic"

const DMALocationPickerInner = dynamic(
  () => import("./dma-location-picker-impl").then((module) => module.DMALocationPickerImpl),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[320px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        Loading DMA location picker...
      </div>
    ),
  }
)

export function DMALocationPicker(props: {
  centerValue: { latitude: number | null; longitude: number | null }
  boundaryPoints: Array<{ latitude: number; longitude: number }>
  onCenterChange: (next: { latitude: number; longitude: number }) => void
  onBoundaryChange: (next: Array<{ latitude: number; longitude: number }>) => void
}) {
  return <DMALocationPickerInner {...props} />
}

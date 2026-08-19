"use client"

import dynamic from "next/dynamic"

const MapPickerInner = dynamic(
  () => import("./map-picker-impl").then((module) => module.MapPickerImpl),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        Loading map...
      </div>
    ),
  }
)

export interface MapPickerProps {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
  utilityCenter?: { latitude: number | null; longitude: number | null } | null
  dmaCenter?: { latitude: number | null; longitude: number | null } | null
  userRole?: string
}

export function MapPicker({ latitude, longitude, onChange, utilityCenter, dmaCenter, userRole }: MapPickerProps) {
  return <MapPickerInner latitude={latitude} longitude={longitude} onChange={onChange} utilityCenter={utilityCenter} dmaCenter={dmaCenter} userRole={userRole} />
}
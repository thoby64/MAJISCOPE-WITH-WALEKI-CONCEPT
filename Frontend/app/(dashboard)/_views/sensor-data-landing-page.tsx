"use client"

import { useRouter } from "next/navigation"
import { ArrowRight, Building2, Waves } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"

export default function SensorDataLandingPage() {
  const router = useRouter()
  const options = [
    {
      title: "Storage facilities sensor data",
      description: "Monitor water-level and water-quality sensors installed in storage facilities such as tanks and reservoirs.",
      icon: Building2,
      path: "/dashboard/sensor-data/storage-facilities",
      tint: "bg-cyan-50 text-cyan-700",
    },
    {
      title: "Water sources sensor data",
      description: "Monitor readings from sensors installed in boreholes, wells, intakes, and other sources.",
      icon: Waves,
      path: "/dashboard/sensor-data/water-sources",
      tint: "bg-sky-50 text-sky-700",
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Sensor Data Monitoring"
        description="Choose an asset group to view its dedicated sensor readings and history."
      />
      <div className="grid gap-5 md:grid-cols-2">
        {options.map(({ title, description, icon: Icon, path, tint }) => (
          <Card
            key={path}
            role="button"
            tabIndex={0}
            onClick={() => router.push(path)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") router.push(path)
            }}
            className="cursor-pointer border-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <CardContent className="flex items-center gap-4 p-6">
              <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tint}`}>
                <Icon className="h-7 w-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{title}</span>
                <span className="mt-1 block text-sm text-slate-500">{description}</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-400" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

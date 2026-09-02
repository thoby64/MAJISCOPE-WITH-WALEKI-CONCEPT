import { redirect } from "next/navigation"

export default async function LegacyWaterLevelTankRedirectPage({
  params,
}: {
  params: Promise<{ tankId: string }>
}) {
  const { tankId } = await params
  redirect(`/dashboard/sensor-data/${tankId}`)
}

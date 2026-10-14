import { redirect } from "next/navigation"

export default async function LegacyWaterLevelStorageFacilityRedirectPage({
  params,
}: {
  params: Promise<{ storageFacilityId: string }>
}) {
  const { storageFacilityId } = await params
  redirect(`/dashboard/sensor-data/${storageFacilityId}`)
}

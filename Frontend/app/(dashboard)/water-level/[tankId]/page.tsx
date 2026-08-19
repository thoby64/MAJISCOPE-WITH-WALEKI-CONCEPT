import { redirect } from "next/navigation"

export default async function WaterLevelTankDetailRedirectPage({
  params,
}: {
  params: Promise<{ tankId: string }>
}) {
  const { tankId } = await params
  redirect(`/dashboard/water-level/${tankId}`)
}

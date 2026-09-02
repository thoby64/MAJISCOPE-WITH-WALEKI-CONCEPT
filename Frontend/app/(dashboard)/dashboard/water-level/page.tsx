import { redirect } from "next/navigation"

export default function LegacyWaterLevelRedirectPage() {
  redirect("/dashboard/sensor-data")
}

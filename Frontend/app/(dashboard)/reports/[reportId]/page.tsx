import { redirect } from "next/navigation"

export default async function ReportDetailsRedirectPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  redirect(`/dashboard/reports/${reportId}`)
}

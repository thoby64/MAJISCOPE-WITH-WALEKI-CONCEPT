import UtilityDetailPage from "../../../_views/utility-detail-page"

export default async function UtilityDetailRoute({
  params,
}: {
  params: Promise<{ utilityId: string }>
}) {
  const { utilityId } = await params

  return <UtilityDetailPage utilityId={utilityId} />
}

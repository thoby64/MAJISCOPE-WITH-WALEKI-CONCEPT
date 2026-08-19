import DMADetailPage from "../../../_views/dma-detail-page"

export default async function DMADetailRoute({
  params,
}: {
  params: Promise<{ dmaId: string }>
}) {
  const { dmaId } = await params

  return <DMADetailPage dmaId={dmaId} />
}

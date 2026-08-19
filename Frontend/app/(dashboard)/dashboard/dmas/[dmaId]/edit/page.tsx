import DMAFormPage from "../../../../_views/dma-form-page"

export default async function EditDMAPage({
  params,
}: {
  params: Promise<{ dmaId: string }>
}) {
  const { dmaId } = await params

  return <DMAFormPage mode="edit" dmaId={dmaId} />
}

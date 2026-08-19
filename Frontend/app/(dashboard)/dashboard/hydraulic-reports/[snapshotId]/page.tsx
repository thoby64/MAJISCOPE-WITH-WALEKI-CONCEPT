import HydraulicReportDetailsPage from "../../../_views/hydraulic-report-details-page"

export default async function Page({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params
  return <HydraulicReportDetailsPage snapshotId={snapshotId} />
}

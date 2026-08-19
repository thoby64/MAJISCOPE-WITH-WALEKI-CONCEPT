import UtilityFormPage from "../../../../_views/utility-form-page"

export default async function EditUtilityPage({
  params,
}: {
  params: Promise<{ utilityId: string }>
}) {
  const { utilityId } = await params

  return <UtilityFormPage mode="edit" utilityId={utilityId} />
}

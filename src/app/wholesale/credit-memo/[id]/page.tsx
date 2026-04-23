export const dynamic = 'force-dynamic'

import CreditMemoDetailView from '@/components/CreditMemoDetailView'

export default function CreditMemoDetailPage({ params }: { params: { id: string } }) {
  return <CreditMemoDetailView id={params.id} />
}

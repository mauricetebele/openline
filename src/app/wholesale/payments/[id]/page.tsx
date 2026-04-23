export const dynamic = 'force-dynamic'

import PaymentDetailView from '@/components/PaymentDetailView'

export default function PaymentDetailPage({ params }: { params: { id: string } }) {
  return <PaymentDetailView id={params.id} />
}

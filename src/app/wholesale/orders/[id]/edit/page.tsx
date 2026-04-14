export const dynamic = 'force-dynamic'

import WholesaleOrderCreateManager from '@/components/WholesaleOrderCreateManager'

export default function WholesaleOrderEditPage({ params }: { params: { id: string } }) {
  return <WholesaleOrderCreateManager editOrderId={params.id} />
}

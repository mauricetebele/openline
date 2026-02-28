export const dynamic = 'force-dynamic'

import WholesaleOrderDetailManager from '@/components/WholesaleOrderDetailManager'

export default function WholesaleOrderDetailPage({ params }: { params: { id: string } }) {
  return <WholesaleOrderDetailManager id={params.id} />
}

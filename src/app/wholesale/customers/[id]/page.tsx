export const dynamic = 'force-dynamic'

import WholesaleCustomerDetailManager from '@/components/WholesaleCustomerDetailManager'

export default function WholesaleCustomerDetailPage({ params }: { params: { id: string } }) {
  return <WholesaleCustomerDetailManager id={params.id} />
}

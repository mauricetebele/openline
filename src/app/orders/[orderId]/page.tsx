export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import OrderDetailView from '@/components/OrderDetailView'

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  return (
    <AppShell>
      <OrderDetailView orderId={orderId} />
    </AppShell>
  )
}

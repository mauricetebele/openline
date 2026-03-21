export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import UnshippedOrders from '@/components/UnshippedOrders'

export default function UnshippedOrdersPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden relative">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Order Fulfillment</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage orders through the fulfillment pipeline — process, serialize, verify, and ship.</p>
        </div>
        <UnshippedOrders />
      </div>
    </AppShell>
  )
}

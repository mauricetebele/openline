export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import UnshippedOrders from '@/components/UnshippedOrders'

export default function UnshippedOrdersPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Unshipped Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Unshipped and partially shipped MFN orders — sync to refresh, then buy shipping labels.</p>
        </div>
        <UnshippedOrders />
      </div>
    </AppShell>
  )
}

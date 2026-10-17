export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import BmUnpaidOrders from '@/components/BmUnpaidOrders'

export const metadata = { title: 'BM Unpaid Orders' }

export default function BmUnpaidOrdersPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-7rem)] p-6">
        <div className="mb-3">
          <h1 className="text-xl font-semibold dark:text-gray-100">BM Unpaid Orders</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Shipped Back Market orders with no payment (sales) transaction in the BM financials. Newly-shipped orders settle on a lag — watch the older ones.
          </p>
        </div>
        <BmUnpaidOrders />
      </div>
    </AppShell>
  )
}

export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import PurchaseOrdersManager from '@/components/PurchaseOrdersManager'

export default function PurchaseOrdersPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Create and manage purchase orders with your vendors.
          </p>
        </div>
        <PurchaseOrdersManager />
      </div>
    </AppShell>
  )
}

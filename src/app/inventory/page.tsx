export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import InventoryView from '@/components/InventoryView'

export default function InventoryPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            View stock levels by warehouse and location.
          </p>
        </div>
        <InventoryView />
      </div>
    </AppShell>
  )
}

export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import WarehouseManager from '@/components/WarehouseManager'

export default function WarehousesPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Warehouses</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage warehouses and their storage locations.
          </p>
        </div>
        <WarehouseManager />
      </div>
    </AppShell>
  )
}

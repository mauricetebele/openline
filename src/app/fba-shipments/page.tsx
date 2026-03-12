export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import FbaShipmentManager from '@/components/FbaShipmentManager'

export default function FbaShipmentsPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">FBA Shipments</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create and manage inbound shipments to Amazon FBA warehouses.</p>
        </div>
        <FbaShipmentManager />
      </div>
    </AppShell>
  )
}

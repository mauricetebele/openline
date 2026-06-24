import AppShell from '@/components/AppShell'
import RemovalShipmentView from '@/components/RemovalShipmentView'

export const dynamic = 'force-dynamic'

export default function RemovalShipmentsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">FBA Removal Shipments</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Track incoming FBA removal order shipments — synced from Amazon SP-API reports.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <RemovalShipmentView />
        </div>
      </div>
    </AppShell>
  )
}

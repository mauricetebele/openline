import AppShell from '@/components/AppShell'
import RepairOrders from '@/components/RepairOrders'

export const metadata = { title: 'Repair Orders' }

export default function RepairOrdersPage() {
  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold dark:text-gray-100">Repair Orders</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Send in-stock units to a repair vendor, track costs, ship out/back, and record outcomes.</p>
        </div>
        <RepairOrders />
      </div>
    </AppShell>
  )
}

import AppShell from '@/components/AppShell'
import ShippingBillAuditManager from '@/components/ShippingBillAuditManager'

export const dynamic = 'force-dynamic'

export default function ShippingBillAuditPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">Shipping Bill Auditing</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Upload your carrier billing CSV and reconcile the charges against the prices quoted when labels were purchased through the system.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <ShippingBillAuditManager />
        </div>
      </div>
    </AppShell>
  )
}

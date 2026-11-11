import AppShell from '@/components/AppShell'
import FedexBillAuditManager from '@/components/FedexBillAuditManager'

export const dynamic = 'force-dynamic'

export default function FedexBillAuditPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">Fedex Bill Auditing</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Upload a FedEx billing export and reconcile the charges against the rates quoted when labels were purchased through the system.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <FedexBillAuditManager />
        </div>
      </div>
    </AppShell>
  )
}

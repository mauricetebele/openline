import AppShell from '@/components/AppShell'
import RemovalCaseView from '@/components/RemovalCaseView'

export const dynamic = 'force-dynamic'

export default function RemovalCasesPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">FBA Removal Cases</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Cases opened for removal shipment items that were not received into inventory.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <RemovalCaseView />
        </div>
      </div>
    </AppShell>
  )
}

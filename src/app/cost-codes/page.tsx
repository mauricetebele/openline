export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import CostCodeManager from '@/components/CostCodeManager'

export default function CostCodesPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 shrink-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Cost Codes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage per-unit cost codes applied to purchase order lines (e.g. kitting, refurbishment).
          </p>
        </div>
        <CostCodeManager />
      </div>
    </AppShell>
  )
}

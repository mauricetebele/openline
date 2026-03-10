export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import ProfitabilityReport from '@/components/ProfitabilityReport'

export default function ProfitabilityPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Profitability Report</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Profit/loss breakdown for shipped orders across all channels.
          </p>
        </div>
        <ProfitabilityReport />
      </div>
    </AppShell>
  )
}

export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import SalesStatsReport from '@/components/SalesStatsReport'

export default function SalesStatsPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Sales Statistics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Per-SKU sales breakdown across all channels with profitability metrics.
          </p>
        </div>
        <SalesStatsReport />
      </div>
    </AppShell>
  )
}

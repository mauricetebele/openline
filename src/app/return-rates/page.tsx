export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import ReturnRatesReport from '@/components/ReturnRatesReport'

export default function ReturnRatesPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Return Rates</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Per-SKU return rates across all channels based on received marketplace returns.
          </p>
        </div>
        <ReturnRatesReport />
      </div>
    </AppShell>
  )
}

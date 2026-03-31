export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import FbaSalesReport from '@/components/FbaSalesReport'

export default function FbaSalesReportPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">FBA Sales Report</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Profitability breakdown for FBA orders with mapped marketplace SKUs.
          </p>
        </div>
        <FbaSalesReport />
      </div>
    </AppShell>
  )
}

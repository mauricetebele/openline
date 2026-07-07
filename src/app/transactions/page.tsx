import AppShell from '@/components/AppShell'
import TransactionView from '@/components/TransactionView'

export const dynamic = 'force-dynamic'

export default function TransactionsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">Transactions</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            All Amazon financial transactions — credits, debits, fees, refunds, and transfers.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <TransactionView />
        </div>
      </div>
    </AppShell>
  )
}

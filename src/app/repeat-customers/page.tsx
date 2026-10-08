import AppShell from '@/components/AppShell'
import RepeatCustomersManager from '@/components/RepeatCustomersManager'

export const metadata = { title: 'Repeat Customers' }

export default function RepeatCustomersPage() {
  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold dark:text-gray-100">Repeat Customers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Marketplace (Amazon &amp; BackMarket) buyers who have ordered more than once — potential wholesale leads. Matched on ship-to name + ZIP.</p>
        </div>
        <RepeatCustomersManager />
      </div>
    </AppShell>
  )
}

export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import ShippingRulesManager from '@/components/ShippingRulesManager'

export const metadata = { title: 'BM Shipping Rules' }

export default function ShippingRulesPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-7rem)] p-6">
        <div className="mb-3">
          <h1 className="text-xl font-semibold dark:text-gray-100">Back Market Shipping Rules</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            If/then rulesets that pick the shipping method for Back Market orders. Run them from Order Fulfillment via &quot;Apply BM Rules&quot; on selected Back Market orders.
          </p>
        </div>
        <ShippingRulesManager />
      </div>
    </AppShell>
  )
}

import AppShell from '@/components/AppShell'
import PricingManager from '@/components/PricingManager'

export const dynamic = 'force-dynamic'

export default function PricingRulesPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Pricing Rules</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            View current prices, min/max price limits, and fulfillment type for all your listings.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <PricingManager />
        </div>
      </div>
    </AppShell>
  )
}

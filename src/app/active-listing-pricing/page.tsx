import AppShell from '@/components/AppShell'
import ActiveListingPricingGrid from '@/components/ActiveListingPricingGrid'

export const dynamic = 'force-dynamic'

export default function ActiveListingPricingPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ActiveListingPricingGrid />
        </div>
      </div>
    </AppShell>
  )
}

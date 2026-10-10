export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import RepricingFeed from '@/components/RepricingFeed'

export default function RepricingPage() {
  return (
    <AppShell>
      <RepricingFeed />
    </AppShell>
  )
}

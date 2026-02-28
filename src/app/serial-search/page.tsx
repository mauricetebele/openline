export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import SerialSearchManager from '@/components/SerialSearchManager'

export default function SerialSearchPage() {
  return (
    <AppShell>
      <SerialSearchManager />
    </AppShell>
  )
}

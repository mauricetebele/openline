export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import ProcessReturnsManager from '@/components/ProcessReturnsManager'

export default function ProcessReturnsPage() {
  return (
    <AppShell>
      <ProcessReturnsManager />
    </AppShell>
  )
}

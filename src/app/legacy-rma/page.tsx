export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import LegacyRMAManager from '@/components/LegacyRMAManager'

export default function LegacyRMAPage() {
  return (
    <AppShell>
      <LegacyRMAManager />
    </AppShell>
  )
}

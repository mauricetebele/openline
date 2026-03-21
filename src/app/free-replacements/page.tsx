export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import FreeReplacementsManager from '@/components/FreeReplacementsManager'

export default function FreeReplacementsPage() {
  return (
    <AppShell>
      <FreeReplacementsManager />
    </AppShell>
  )
}

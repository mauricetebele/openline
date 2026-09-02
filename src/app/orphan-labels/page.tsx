export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import OrphanLabelsManager from '@/components/OrphanLabelsManager'

export default function OrphanLabelsPage() {
  return (
    <AppShell>
      <OrphanLabelsManager />
    </AppShell>
  )
}

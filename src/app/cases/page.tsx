export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import CaseManager from '@/components/CaseManager'

export default function CasesPage() {
  return (
    <AppShell>
      <CaseManager />
    </AppShell>
  )
}

export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import AppShell from '@/components/AppShell'
import ResolutionProviderShell from '@/components/ResolutionProviderShell'
import CaseManager from '@/components/CaseManager'

export default function CasesPage() {
  const role = cookies().get('__role')?.value

  if (role === 'RESOLUTION_PROVIDER') {
    return (
      <ResolutionProviderShell>
        <CaseManager />
      </ResolutionProviderShell>
    )
  }

  return (
    <AppShell>
      <CaseManager />
    </AppShell>
  )
}

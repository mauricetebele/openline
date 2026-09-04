export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import AppShell from '@/components/AppShell'
import MailClient from '@/components/MailClient'

export default function MailPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <MailClient />
      </Suspense>
    </AppShell>
  )
}

export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import AppShell from '@/components/AppShell'
import CustomerServiceShell from '@/components/CustomerServiceShell'
import CustomerServiceCases from '@/components/CustomerServiceCases'

export default function CustomerServicePage() {
  const role = cookies().get('__role')?.value

  if (role === 'MARKETPLACE_CS') {
    return (
      <CustomerServiceShell>
        <CustomerServiceCases />
      </CustomerServiceShell>
    )
  }

  return (
    <AppShell>
      <CustomerServiceCases />
    </AppShell>
  )
}

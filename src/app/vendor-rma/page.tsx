export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import VendorRMAManager from '@/components/VendorRMAManager'

export default function VendorRMAPage() {
  return (
    <AppShell>
      <VendorRMAManager />
    </AppShell>
  )
}

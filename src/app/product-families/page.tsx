export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import ProductFamiliesManager from '@/components/ProductFamiliesManager'

export default function ProductFamiliesPage() {
  return (
    <AppShell>
      <ProductFamiliesManager />
    </AppShell>
  )
}

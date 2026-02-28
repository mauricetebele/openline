export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import ProductsManager from '@/components/ProductsManager'

export default function ProductsPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage your product catalog, SKUs, and serialization settings.
          </p>
        </div>
        <ProductsManager />
      </div>
    </AppShell>
  )
}

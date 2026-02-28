export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import VendorsManager from '@/components/VendorsManager'

export default function VendorsPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage your vendor contacts and information.
          </p>
        </div>
        <VendorsManager />
      </div>
    </AppShell>
  )
}

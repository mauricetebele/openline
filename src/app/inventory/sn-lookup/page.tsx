export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import InventoryView from '@/components/InventoryView'

export default function SNLookupPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Serial Number Lookup</h1>
          <p className="text-sm text-gray-500 mt-0.5">Search for a serial number and view its full history.</p>
        </div>
        <InventoryView openModal="sn-lookup" />
      </div>
    </AppShell>
  )
}

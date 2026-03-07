export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import InventoryMigration from '@/components/InventoryMigration'

export default function MigratePage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Inventory Migration Tool</h1>
          <p className="text-sm text-gray-500 mt-0.5">Import inventory from a spreadsheet into OpenLine.</p>
        </div>
        <InventoryMigration />
      </div>
    </AppShell>
  )
}

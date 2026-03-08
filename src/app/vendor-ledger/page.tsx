export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import VendorLedgerManager from '@/components/VendorLedgerManager'

export default function VendorLedgerPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Vendor Ledger</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track vendor bills, payments, and balances.
          </p>
        </div>
        <VendorLedgerManager />
      </div>
    </AppShell>
  )
}

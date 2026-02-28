import AppShell from '@/components/AppShell'
import RefundTable from '@/components/RefundTable'

export const dynamic = 'force-dynamic'

export default function RefundsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Refunds</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Review Amazon Seller Central refunds — mark as Valid or Invalid.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <RefundTable />
        </div>
      </div>
    </AppShell>
  )
}

import AppShell from '@/components/AppShell'
import FbaRefundsManager from '@/components/FbaRefundsManager'

export const dynamic = 'force-dynamic'

export default function FbaRefundsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">FBA Refunds</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Track Amazon FBA refund transactions — synced from Finances API.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <FbaRefundsManager />
        </div>
      </div>
    </AppShell>
  )
}

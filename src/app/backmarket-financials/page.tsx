export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import BackMarketFinancials from '@/components/BackMarketFinancials'

export default function BackMarketFinancialsPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">BackMarket Financial Explorer</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Every BackMarket accounting entry from imported billing statements — search on the fly by order #.
          </p>
        </div>
        <BackMarketFinancials />
      </div>
    </AppShell>
  )
}

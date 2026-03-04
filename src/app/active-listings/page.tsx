import AppShell from '@/components/AppShell'
import ActiveListingsManager from '@/components/ActiveListingsManager'

export const dynamic = 'force-dynamic'

export default function ActiveListingsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Active Listings</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            View all active Amazon listings and update prices inline.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <ActiveListingsManager />
        </div>
      </div>
    </AppShell>
  )
}

import AppShell from '@/components/AppShell'
import MFNReturnsManager from '@/components/MFNReturnsManager'

export const dynamic = 'force-dynamic'

export default function ReturnsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold">MFN Returns</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Track merchant-fulfilled returns synced from Amazon SP-API.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <MFNReturnsManager />
        </div>
      </div>
    </AppShell>
  )
}

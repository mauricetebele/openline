export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import MFNReturnsManager from '@/components/MFNReturnsManager'

export default function ReturnsPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">MFN Returns</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Import and track your Merchant Fulfilled returns from Amazon Seller Central.
          </p>
        </div>
        <MFNReturnsManager />
      </div>
    </AppShell>
  )
}

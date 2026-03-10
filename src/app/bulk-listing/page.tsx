import AppShell from '@/components/AppShell'
import BulkListingCreator from '@/components/BulkListingCreator'

export const dynamic = 'force-dynamic'

export default function BulkListingPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Bulk Create Listings</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Paste or upload multiple SKU / ASIN / Price rows and create all listings at once.
          </p>
        </div>
        <div className="flex-1 overflow-auto">
          <BulkListingCreator />
        </div>
      </div>
    </AppShell>
  )
}

import AppShell from '@/components/AppShell'
import CreateListingManager from '@/components/CreateListingManager'

export const dynamic = 'force-dynamic'

export default function CreateListingPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Create Listing</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Create a new Amazon listing for an existing ASIN.
          </p>
        </div>
        <div className="flex-1 overflow-auto">
          <CreateListingManager />
        </div>
      </div>
    </AppShell>
  )
}

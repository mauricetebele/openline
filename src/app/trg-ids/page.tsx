import AppShell from '@/components/AppShell'
import TrgIdsUpload from '@/components/TrgIdsUpload'

export const metadata = { title: 'TRG IDs' }

export default function TrgIdsPage() {
  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold dark:text-gray-100">TRG IDs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Set an optional TRG ID per serial. Upload a CSV/Excel or paste rows — validated in real time. TRG IDs can be set on serials in any status and show up on the Serial # Lookup.</p>
        </div>
        <TrgIdsUpload />
      </div>
    </AppShell>
  )
}

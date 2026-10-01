import AppShell from '@/components/AppShell'
import UnlockCodesUpload from '@/components/UnlockCodesUpload'

export const metadata = { title: 'Unlock Codes' }

export default function UnlockCodesPage() {
  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold dark:text-gray-100">Unlock Codes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Set an optional device unlock code / passcode per serial. Upload a CSV/Excel or paste rows — validated in real time. Codes can be set on serials in any status and show up on the Serial # Lookup.</p>
        </div>
        <UnlockCodesUpload />
      </div>
    </AppShell>
  )
}

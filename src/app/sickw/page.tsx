export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import SickwManager from '@/components/SickwManager'

export default function SickwPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">SICKW IMEI Check</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Run device verification checks (iCloud, carrier, blacklist, Knox, etc.) via SICKW API.
          </p>
        </div>
        <SickwManager />
      </div>
    </AppShell>
  )
}

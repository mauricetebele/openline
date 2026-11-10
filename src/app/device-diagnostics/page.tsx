import AppShell from '@/components/AppShell'
import DeviceDiagnostics from '@/components/DeviceDiagnostics'

export const dynamic = 'force-dynamic'

export default function DeviceDiagnosticsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">Device Diagnostics</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Check a connected iPhone&apos;s battery health — maximum capacity, cycle count, and more.
          </p>
        </div>
        <div className="flex-1 overflow-hidden px-6 py-4">
          <DeviceDiagnostics />
        </div>
      </div>
    </AppShell>
  )
}

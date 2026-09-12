import AppShell from '@/components/AppShell'
import LabelPrintHistory from '@/components/LabelPrintHistory'

export const dynamic = 'force-dynamic'

export default function LabelPrintHistoryPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Label Print History</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Every shipping label print — who printed it and exactly when — for tracing shipping discrepancies.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <LabelPrintHistory />
        </div>
      </div>
    </AppShell>
  )
}

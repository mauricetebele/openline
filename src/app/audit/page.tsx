import AppShell from '@/components/AppShell'
import AuditLog from '@/components/AuditLog'

export const dynamic = 'force-dynamic'

export default function AuditPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Audit Log</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            All review changes and imports — searchable, exportable as CSV.
          </p>
        </div>
        <div className="flex-1 overflow-hidden">
          <AuditLog />
        </div>
      </div>
    </AppShell>
  )
}

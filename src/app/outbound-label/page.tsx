export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import ReturnLabelManager from '@/components/ReturnLabelManager'

export default function OutboundLabelPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Generate UPS Outbound Label</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Ship accessories, replacements, or missing items to customers.
          </p>
        </div>
        <ReturnLabelManager direction="outbound" />
      </div>
    </AppShell>
  )
}

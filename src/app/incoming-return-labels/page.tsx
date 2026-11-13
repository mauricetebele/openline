import AppShell from '@/components/AppShell'
import IncomingReturnLabelsGrid from '@/components/IncomingReturnLabelsGrid'

export const dynamic = 'force-dynamic'

export default function IncomingReturnLabelsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="flex-1 overflow-hidden">
          <IncomingReturnLabelsGrid />
        </div>
      </div>
    </AppShell>
  )
}

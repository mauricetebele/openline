import AppShell from '@/components/AppShell'
import MFNReturnsManager from '@/components/MFNReturnsManager'

export const dynamic = 'force-dynamic'

export default function ReturnsPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="flex-1 overflow-hidden">
          <MFNReturnsManager />
        </div>
      </div>
    </AppShell>
  )
}

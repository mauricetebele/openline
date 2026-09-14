import AppShell from '@/components/AppShell'
import ChargebackResponseGenerator from '@/components/ChargebackResponseGenerator'

export const dynamic = 'force-dynamic'

export default function ChargebackResponsePage() {
  return (
    <AppShell>
      <div className="h-screen overflow-auto bg-white">
        <ChargebackResponseGenerator />
      </div>
    </AppShell>
  )
}

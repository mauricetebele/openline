export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import OLIManager from '@/components/OLIManager'

export default function OLIPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Open Line Intelligence</h1>
          <p className="text-sm text-gray-500 mt-0.5">Pricing strategy manager</p>
        </div>
        <OLIManager />
      </div>
    </AppShell>
  )
}

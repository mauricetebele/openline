import AppShell from '@/components/AppShell'
import BmCaseManager from '@/components/BmCaseManager'

export const dynamic = 'force-dynamic'

export default function BmCasesPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">Back Market Cases</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Track Back Market support cases — log the case id, link, and issue, and mark them resolved.
          </p>
        </div>
        <div className="flex-1 overflow-hidden px-6 py-4">
          <BmCaseManager />
        </div>
      </div>
    </AppShell>
  )
}

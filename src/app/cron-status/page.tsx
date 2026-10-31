import AppShell from '@/components/AppShell'
import CronStatusPanel from '@/components/CronStatusPanel'

export const dynamic = 'force-dynamic'

export default function CronStatusPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
          <h1 className="text-xl font-semibold dark:text-gray-100">Cron Status</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Live status of all scheduled jobs — running progress, next run countdown, and run history.
          </p>
        </div>
        <div className="flex-1 overflow-hidden px-6 py-4">
          <CronStatusPanel />
        </div>
      </div>
    </AppShell>
  )
}

import AppShell from '@/components/AppShell'
import BatteryHealthUpload from '@/components/BatteryHealthUpload'

export const metadata = { title: 'Battery Health Upload' }

export default function BatteryHealthPage() {
  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold dark:text-gray-100">Battery Health Upload</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Set an optional battery health % per serial. Upload a CSV/Excel or paste rows — validated in real time. Only in-stock serials can be updated.</p>
        </div>
        <BatteryHealthUpload />
      </div>
    </AppShell>
  )
}

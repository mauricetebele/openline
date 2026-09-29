import AppShell from '@/components/AppShell'
import BhSortingTool from '@/components/BhSortingTool'

export const metadata = { title: 'BH Sorting Tool' }

export default function BhSortPage() {
  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold dark:text-gray-100">BH Sorting Tool</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Scan units to sort them by battery health against a threshold — green = at/above, red = below.</p>
        </div>
        <BhSortingTool />
      </div>
    </AppShell>
  )
}

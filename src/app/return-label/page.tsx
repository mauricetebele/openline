export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import ReturnLabelManager from '@/components/ReturnLabelManager'

export default function ReturnLabelPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Generate UPS Return Label</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Look up a customer&apos;s address by Amazon Order ID and create a prepaid UPS return label.
          </p>
        </div>
        <ReturnLabelManager />
      </div>
    </AppShell>
  )
}

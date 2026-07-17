export const dynamic = 'force-dynamic'
import AppShell from '@/components/AppShell'
import DescriptionGuesser from '@/components/DescriptionGuesser'

export default function DescriptionGuesserPage() {
  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900">Description Guessing</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Paste new SKUs and get suggested product descriptions inferred from existing,
            similarly-structured SKUs. Correct any row (the tool learns), then create the ones you want.
          </p>
        </div>
        <DescriptionGuesser />
      </div>
    </AppShell>
  )
}

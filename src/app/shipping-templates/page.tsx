import AppShell from '@/components/AppShell'
import ShippingTemplateManager from '@/components/ShippingTemplateManager'

export const dynamic = 'force-dynamic'

export default function ShippingTemplatesPage() {
  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        <div className="px-6 py-4 border-b bg-white">
          <h1 className="text-xl font-semibold">Shipping Templates</h1>
          <p className="text-gray-500 text-sm mt-0.5">View and bulk-update shipping templates for MFN listings.</p>
        </div>
        <div className="flex-1 overflow-hidden">
          <ShippingTemplateManager />
        </div>
      </div>
    </AppShell>
  )
}

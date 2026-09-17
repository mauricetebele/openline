import CreateShippingLabels from '@/components/CreateShippingLabels'

export const metadata = { title: 'Create Shipping Labels' }

export default function CreateShippingLabelsPage() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold dark:text-gray-100">Create Shipping Labels</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Buy multi-piece shipping labels via UPS Direct, FedEx Direct, or ShipStation (UPS).
        </p>
      </div>
      <CreateShippingLabels />
    </div>
  )
}

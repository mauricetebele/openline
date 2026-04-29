'use client'
import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import GradeBadge from './GradeBadge'

interface POLine {
  id: string
  qty: number
  unitCost: string
  product: { sku: string; description: string }
  grade: { grade: string } | null
  receiptLines: { qtyReceived: number }[]
}

interface PurchaseOrder {
  id: string
  poNumber: number
  date: string
  status: string
  notes: string | null
  vendor: { name: string }
  lines: POLine[]
}

export default function VendorPurchaseOrdersView() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/vendor/purchase-orders')
      .then(r => r.ok ? r.json() : { data: [] })
      .then(json => setOrders(json.data ?? []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardList size={22} className="text-orange-500" />
          Purchase Orders
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {loading ? 'Loading...' : `${orders.length} purchase orders`}
        </p>
      </div>

      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-12">Loading purchase orders...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No purchase orders found</p>
        ) : (
          orders.map(po => {
            const totalQty = po.lines.reduce((s, l) => s + l.qty, 0)
            const totalReceived = po.lines.reduce((s, l) => s + l.receiptLines.reduce((rs, rl) => rs + rl.qtyReceived, 0), 0)
            return (
              <div key={po.id} className="card overflow-hidden">
                <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm">PO-{String(po.poNumber).padStart(4, '0')}</span>
                    <span className="text-xs text-gray-500 ml-3">{new Date(po.date).toLocaleDateString()}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    po.status === 'CLOSED' ? 'bg-green-100 text-green-700'
                      : po.status === 'OPEN' ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {po.status}
                  </span>
                </div>
                <div className="px-5 py-2 text-xs text-gray-500 border-b">
                  {totalReceived}/{totalQty} units received
                  {po.notes && <span className="ml-3 text-gray-400">- {po.notes}</span>}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500">
                      <th className="px-4 py-2 text-left font-medium">SKU</th>
                      <th className="px-4 py-2 text-left font-medium">Description</th>
                      <th className="px-4 py-2 text-left font-medium">Grade</th>
                      <th className="px-4 py-2 text-right font-medium">Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {po.lines.map(line => (
                      <tr key={line.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2 font-mono text-xs">{line.product.sku}</td>
                        <td className="px-4 py-2 text-gray-700">{line.product.description}</td>
                        <td className="px-4 py-2">
                          {line.grade ? <GradeBadge grade={line.grade.grade} /> : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{line.qty}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {line.receiptLines.reduce((s, rl) => s + rl.qtyReceived, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

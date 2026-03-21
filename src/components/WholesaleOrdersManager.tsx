'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const SO_STATUS_COLOR: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  INVOICED: 'bg-yellow-100 text-yellow-700',
  PARTIALLY_PAID: 'bg-orange-100 text-orange-700',
  PAID: 'bg-green-100 text-green-700',
  VOID: 'bg-red-100 text-red-500',
}

const STATUSES = ['ALL', 'PENDING_APPROVAL', 'DRAFT', 'CONFIRMED', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'VOID']

interface Order {
  id: string
  orderNumber: string
  invoiceNumber?: string | null
  customer: { id: string; companyName: string }
  items: { id: string }[]
  total: number
  balance: number
  dueDate: string | null
  orderDate: string
  status: string
}

export default function WholesaleOrdersManager() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  const load = useCallback(async (status: string, q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status !== 'ALL') params.set('status', status)
      if (q) params.set('search', q)
      const res = await fetch(`/api/wholesale/orders?${params}`)
      const data = await res.json()
      setOrders(data.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(statusFilter, search) }, [statusFilter, load, search])

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Wholesale Orders</h1>
        <button
          onClick={() => router.push('/wholesale/orders/new')}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
        >
          + New Order
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'ALL' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order # or customer…"
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No orders found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Order #</th>
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-right px-5 py-3">Items</th>
                <th className="text-right px-5 py-3">Total</th>
                <th className="text-right px-5 py-3">Balance</th>
                <th className="text-left px-5 py-3">Due Date</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => router.push(`/wholesale/orders/${o.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-5 py-3 font-mono text-orange-600">{o.invoiceNumber ?? o.orderNumber}</td>
                  <td className="px-5 py-3 text-gray-500">{new Date(o.orderDate).toLocaleDateString()}</td>
                  <td className="px-5 py-3 font-medium">{o.customer.companyName}</td>
                  <td className="px-5 py-3 text-right text-gray-500">{o.items.length}</td>
                  <td className="px-5 py-3 text-right">{fmt(Number(o.total))}</td>
                  <td className="px-5 py-3 text-right font-semibold">{fmt(Number(o.balance))}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {o.dueDate ? new Date(o.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${SO_STATUS_COLOR[o.status] ?? ''}`}>
                      {o.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

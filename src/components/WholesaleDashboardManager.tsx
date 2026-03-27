'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const SO_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  INVOICED: 'bg-yellow-100 text-yellow-700',
  PARTIALLY_PAID: 'bg-orange-100 text-orange-700',
  PAID: 'bg-green-100 text-green-700',
}

interface RecentOrder {
  id: string
  orderNumber: string
  customer: { id: string; companyName: string }
  total: number
  balance: number
  dueDate: string | null
  status: string
}

export default function WholesaleDashboardManager() {
  const router = useRouter()
  const [orders, setOrders] = useState<RecentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalAR: 0,
    overdue: 0,
    dueThisMonth: 0,
    activeCustomers: 0,
  })

  useEffect(() => {
    async function load() {
      try {
        const [ordersRes, customersRes] = await Promise.all([
          fetch('/api/wholesale/orders?status=INVOICED&limit=10'),
          fetch('/api/wholesale/customers?active=true'),
        ])
        const ordersData = await ordersRes.json()
        const customersData = await customersRes.json()

        const allOrders: RecentOrder[] = ordersData.data ?? []

        // Also fetch PARTIALLY_PAID
        const partialRes = await fetch('/api/wholesale/orders?status=PARTIALLY_PAID&limit=10')
        const partialData = await partialRes.json()
        const combined = [...allOrders, ...(partialData.data ?? [])]
          .sort((a, b) => new Date(b.dueDate ?? 0).getTime() - new Date(a.dueDate ?? 0).getTime())
          .slice(0, 10)

        setOrders(combined)

        const today = new Date()
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

        let totalAR = 0
        let overdue = 0
        let dueThisMonth = 0
        for (const o of combined) {
          const bal = Number(o.balance)
          totalAR += bal
          const due = o.dueDate ? new Date(o.dueDate) : null
          if (due && due < today) overdue += bal
          if (due && due >= today && due <= endOfMonth) dueThisMonth += bal
        }

        setStats({
          totalAR,
          overdue,
          dueThisMonth,
          activeCustomers: (customersData.data ?? []).length,
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Wholesale Dashboard</h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/wholesale/orders/new')}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
          >
            + New Order
          </button>
          <button
            onClick={() => router.push('/wholesale/customers')}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Customers
          </button>
          <button
            onClick={() => router.push('/wholesale/aging')}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Aging Report
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total AR', value: fmt(stats.totalAR), color: 'text-gray-900' },
          { label: 'Overdue', value: fmt(stats.overdue), color: 'text-red-600' },
          { label: 'Due This Month', value: fmt(stats.dueThisMonth), color: 'text-yellow-600' },
          { label: 'Active Customers', value: stats.activeCustomers.toString(), color: 'text-blue-600' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{card.label}</p>
            <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Recent invoices */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Open Invoices</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No open invoices</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Order #</th>
                  <th className="text-left px-5 py-3">Customer</th>
                  <th className="text-right px-5 py-3">Total</th>
                  <th className="text-right px-5 py-3">Balance</th>
                  <th className="text-left px-5 py-3">Due</th>
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
                    <td className="px-5 py-3 font-mono text-orange-600">{o.orderNumber}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/wholesale/customers/${o.customer.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-orange-600"
                      >
                        {o.customer.companyName}
                      </Link>
                    </td>
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
          </div>
        )}
      </div>
    </div>
  )
}

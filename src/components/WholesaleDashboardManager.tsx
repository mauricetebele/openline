'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ReceivePaymentModal from './ReceivePaymentModal'
import ApplyCreditModal from './ApplyCreditModal'

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
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showCreditModal, setShowCreditModal] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
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
  }, [refreshKey])

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Wholesale Dashboard</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreditModal(true)}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            Apply Credit
          </button>
          <button
            onClick={() => setShowPaymentModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
          >
            Receive Payment
          </button>
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


      {showPaymentModal && (
        <ReceivePaymentModal
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {showCreditModal && (
        <ApplyCreditModal
          onClose={() => setShowCreditModal(false)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  )
}

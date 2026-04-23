'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, X } from 'lucide-react'

interface Payment {
  id: string
  paymentNumber: string
  paymentDate: string
  amount: number
  method: string
  memo?: string
  reference?: string
  customer: { id: string; companyName: string }
}

export default function PaymentListView() {
  const router = useRouter()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/wholesale/payments')
      .then((r) => r.json())
      .then((d) => setPayments(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const filtered = useMemo(() => {
    if (!search.trim()) return payments
    const q = search.toLowerCase().trim()
    return payments.filter((p) => {
      const amount = Number(p.amount).toFixed(2)
      return (
        p.paymentNumber.toLowerCase().includes(q) ||
        p.customer.companyName.toLowerCase().includes(q) ||
        amount.includes(q) ||
        p.method.toLowerCase().replace('_', ' ').includes(q) ||
        (p.memo ?? '').toLowerCase().includes(q) ||
        (p.reference ?? '').toLowerCase().includes(q) ||
        new Date(p.paymentDate).toLocaleDateString().includes(q)
      )
    })
  }, [payments, search])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer, amount, PMT #, method, memo…"
          className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {search ? 'No payments match your search' : 'No payments recorded'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-left px-5 py-3">Payment ID</th>
                  <th className="text-left px-5 py-3">Customer</th>
                  <th className="text-right px-5 py-3">Amount</th>
                  <th className="text-left px-5 py-3">Payment Method</th>
                  <th className="text-left px-5 py-3">Memo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/wholesale/payments/${p.id}`)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-5 py-3 text-gray-500">
                      {new Date(p.paymentDate).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 font-mono text-orange-600 font-medium">
                      {p.paymentNumber}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/wholesale/customers/${p.customer.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-orange-600"
                      >
                        {p.customer.companyName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right font-medium">{fmt(Number(p.amount))}</td>
                    <td className="px-5 py-3">{p.method.replace('_', ' ')}</td>
                    <td className="px-5 py-3 text-gray-500 truncate max-w-[200px]">{p.memo || '—'}</td>
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

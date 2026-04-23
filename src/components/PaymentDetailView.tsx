'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface PaymentAllocation {
  id: string
  amount: number
  createdAt: string
  order: { id: string; orderNumber: string; invoiceNumber?: string }
}

interface Payment {
  id: string
  paymentNumber: string
  paymentDate: string
  amount: number
  method: string
  reference?: string
  memo?: string
  unallocated: number
  customer: { id: string; companyName: string }
  allocations: PaymentAllocation[]
}

export default function PaymentDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [payment, setPayment] = useState<Payment | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wholesale/payments/${id}`)
      if (res.ok) setPayment(await res.json())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!payment) return <div className="p-8 text-center text-gray-400 text-sm">Payment not found</div>

  const allocated = Number(payment.amount) - Number(payment.unallocated)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">←</button>
        <h1 className="font-mono text-2xl font-bold text-orange-600">{payment.paymentNumber || 'Payment'}</h1>
      </div>

      {/* Payment details */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Date</p>
            <p className="font-medium text-gray-700">{new Date(payment.paymentDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Amount</p>
            <p className="font-medium text-gray-700">{fmt(Number(payment.amount))}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Method</p>
            <p className="font-medium text-gray-700">{payment.method.replace('_', ' ')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Customer</p>
            <Link href={`/wholesale/customers/${payment.customer.id}`} className="font-medium text-orange-600 hover:text-orange-700">
              {payment.customer.companyName}
            </Link>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Reference</p>
            <p className="font-mono font-medium text-gray-700">{payment.reference || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Memo</p>
            <p className="font-medium text-gray-700">{payment.memo || '—'}</p>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total', value: fmt(Number(payment.amount)), color: 'text-gray-900' },
          { label: 'Allocated', value: fmt(allocated), color: 'text-green-600' },
          { label: 'Unallocated', value: fmt(Number(payment.unallocated)), color: Number(payment.unallocated) > 0.005 ? 'text-orange-600' : 'text-gray-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Invoices Applied */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">
          Invoices Applied
        </div>
        {payment.allocations.length === 0 ? (
          <div className="px-5 py-6 text-center text-gray-400 text-sm">No allocations yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                <th className="text-left px-5 py-2">Invoice</th>
                <th className="text-right px-5 py-2">Amount Applied</th>
                <th className="text-right px-5 py-2">Date Applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payment.allocations.map((alloc) => (
                <tr key={alloc.id}>
                  <td className="px-5 py-2">
                    <Link href={`/wholesale/orders/${alloc.order.id}`} className="font-mono text-xs text-orange-600 hover:text-orange-700 font-medium">
                      {alloc.order.invoiceNumber ?? alloc.order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-2 text-right font-medium">{fmt(Number(alloc.amount))}</td>
                  <td className="px-5 py-2 text-right text-gray-500">
                    {new Date(alloc.createdAt).toLocaleDateString()}
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

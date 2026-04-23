'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'

const STATUS_COLOR: Record<string, string> = {
  UNAPPLIED: 'bg-gray-100 text-gray-600',
  PARTIALLY_APPLIED: 'bg-orange-100 text-orange-700',
  APPLIED: 'bg-green-100 text-green-700',
}

interface CreditMemoAllocation {
  id: string
  amount: number
  createdAt: string
  order: { id: string; orderNumber: string; invoiceNumber?: string }
}

interface CreditMemo {
  id: string
  memoNumber: string
  status: string
  subtotal: number
  restockingFee: number
  restockingReason?: string
  total: number
  unallocated: number
  notes?: string
  memo?: string
  description?: string
  createdAt: string
  customer: { id: string; companyName: string }
  rma: { id: string; rmaNumber: string } | null
  allocations: CreditMemoAllocation[]
}

export default function CreditMemoDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [memo, setMemo] = useState<CreditMemo | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wholesale/credit-memo/${id}`)
      if (res.ok) setMemo(await res.json())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!memo) return <div className="p-8 text-center text-gray-400 text-sm">Credit memo not found</div>

  const allocated = Number(memo.total) - Number(memo.unallocated)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">←</button>
        <h1 className="font-mono text-2xl font-bold text-orange-600">{memo.memoNumber}</h1>
        <span className={`inline-flex px-2.5 py-1 rounded text-xs font-semibold ${STATUS_COLOR[memo.status] ?? 'bg-gray-100 text-gray-600'}`}>
          {memo.status.replace(/_/g, ' ')}
        </span>
        <Link href={`/wholesale/customers/${memo.customer.id}`} className="text-sm text-gray-600 hover:text-orange-600">
          {memo.customer.companyName}
        </Link>
        {memo.rma ? (
          <span className="text-sm text-gray-500">
            RMA# <span className="font-mono font-medium text-gray-700">{memo.rma.rmaNumber}</span>
          </span>
        ) : (
          <span className="inline-flex px-2 py-0.5 rounded bg-orange-50 text-orange-600 text-xs font-medium">Manual Credit</span>
        )}
        <span className="text-sm text-gray-500">
          {new Date(memo.createdAt).toLocaleDateString()}
        </span>
        <button
          onClick={async () => {
            try {
              const res = await fetch('/api/wholesale/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'credit-memo', id: memo.id }),
              })
              const data = await res.json()
              if (!res.ok) { toast.error(data.error ?? 'Failed to send email'); return }
              toast.success('Credit memo emailed')
            } catch {
              toast.error('Failed to send email')
            }
          }}
          className="ml-auto px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-50 flex items-center gap-1"
        >
          <Mail size={12} /> Email Credit Memo
        </button>
      </div>

      {/* Financial summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500">Subtotal</span>
          <span>{fmt(Number(memo.subtotal))}</span>
        </div>
        {Number(memo.restockingFee) > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Restocking Fee{memo.restockingReason ? ` — ${memo.restockingReason}` : ''}</span>
            <span>-{fmt(Number(memo.restockingFee))}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
          <span>Credit Total</span>
          <span>{fmt(Number(memo.total))}</span>
        </div>
        <div className="flex justify-between text-green-600">
          <span>Allocated</span>
          <span>-{fmt(allocated)}</span>
        </div>
        <div className="flex justify-between font-bold text-orange-600 border-t border-gray-200 pt-2">
          <span>Unallocated</span>
          <span>{fmt(Number(memo.unallocated))}</span>
        </div>
      </div>

      {(memo.memo || memo.description || memo.notes) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-3">
          {memo.memo && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Memo</p>
              <p>{memo.memo}</p>
            </div>
          )}
          {memo.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Description</p>
              <p className="whitespace-pre-wrap">{memo.description}</p>
            </div>
          )}
          {memo.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</p>
              <p>{memo.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Invoices Applied */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">
          Invoices Applied
        </div>
        {memo.allocations.length === 0 ? (
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
              {memo.allocations.map((alloc) => (
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

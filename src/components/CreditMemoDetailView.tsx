'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'
import EmailDocumentModal from '@/components/EmailDocumentModal'

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
  customer: { id: string; companyName: string; email?: string }
  rma: { id: string; rmaNumber: string } | null
  allocations: CreditMemoAllocation[]
}

export default function CreditMemoDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [memo, setMemo] = useState<CreditMemo | null>(null)
  const [loading, setLoading] = useState(true)
  const [emailModal, setEmailModal] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)

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
        {Number(memo.unallocated) > 0.005 && (
          <button
            onClick={() => setApplyOpen(true)}
            className="ml-auto px-3 py-1.5 bg-orange-600 text-white rounded text-xs font-semibold hover:bg-orange-700 flex items-center gap-1"
          >
            Apply to Invoices
          </button>
        )}
        <button
          onClick={() => setEmailModal(true)}
          className={`${Number(memo.unallocated) > 0.005 ? '' : 'ml-auto '}px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-50 flex items-center gap-1`}
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

      {emailModal && (
        <EmailDocumentModal
          type="credit-memo"
          id={memo.id}
          defaultEmail={memo.customer.email ?? ''}
          label="Credit Memo"
          onClose={() => setEmailModal(false)}
        />
      )}

      {applyOpen && (
        <ApplyCreditModal
          memoId={memo.id}
          customerId={memo.customer.id}
          customerName={memo.customer.companyName}
          unallocated={Number(memo.unallocated)}
          onClose={() => setApplyOpen(false)}
          onApplied={() => { setApplyOpen(false); load() }}
        />
      )}
    </div>
  )
}

// ─── Apply credit to open invoices (no payment) ─────────────────────────────
interface OpenInvoice {
  id: string; orderNumber: string | number; invoiceNumber?: string | null
  total: string | number; balance: string | number; status: string
  orderDate?: string; createdAt?: string
}

function ApplyCreditModal({ memoId, customerId, customerName, unallocated, onClose, onApplied }: {
  memoId: string; customerId: string; customerName: string; unallocated: number
  onClose: () => void; onApplied: () => void
}) {
  const [invoices, setInvoices] = useState<OpenInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  const r2 = (n: number) => Math.round(n * 100) / 100

  useEffect(() => {
    let cancel = false
    fetch(`/api/wholesale/orders?customerId=${customerId}&limit=200`)
      .then(r => r.json())
      .then(d => {
        if (cancel) return
        const open: OpenInvoice[] = (d.data ?? [])
          .filter((o: OpenInvoice) => ['INVOICED', 'PARTIALLY_PAID'].includes(o.status) && Number(o.balance) > 0.005)
          .sort((a: OpenInvoice, b: OpenInvoice) => new Date(a.orderDate ?? a.createdAt ?? 0).getTime() - new Date(b.orderDate ?? b.createdAt ?? 0).getTime())
        setInvoices(open)
      })
      .catch(() => setErr('Failed to load open invoices'))
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [customerId])

  function autoFill() {
    let remaining = unallocated
    const next: Record<string, string> = {}
    for (const inv of invoices) {
      if (remaining <= 0.005) break
      const take = Math.min(remaining, Number(inv.balance))
      if (take > 0.005) { next[inv.id] = r2(take).toFixed(2); remaining = r2(remaining - take) }
    }
    setAmounts(next)
  }

  const allocated = r2(Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0))
  const remaining = r2(unallocated - allocated)
  const overBalance = invoices.some(inv => (parseFloat(amounts[inv.id] ?? '') || 0) > Number(inv.balance) + 0.005)

  async function submit() {
    setSubmitting(true); setErr(null)
    try {
      const allocations = Object.entries(amounts)
        .map(([orderId, v]) => ({ orderId, amount: parseFloat(v) || 0 }))
        .filter(a => a.amount > 0.005)
      if (allocations.length === 0) throw new Error('Enter at least one amount to apply')
      const res = await fetch(`/api/wholesale/credit-memo/${memoId}/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocations }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to apply credit')
      toast.success('Credit applied to invoices')
      onApplied()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to apply credit') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Apply Credit to Open Invoices</h3>
          <span className="ml-auto text-xs text-gray-500">{customerName}</span>
        </div>
        <div className="px-5 py-3 flex items-center justify-between text-xs border-b border-gray-100 dark:border-white/10">
          <span className="text-gray-500">Credit available</span>
          <span className="font-bold text-orange-600">{fmt(unallocated)}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">Loading open invoices…</div>
          ) : invoices.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">No open invoices for this customer.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-[11px] uppercase text-gray-500">
                <tr>
                  <th className="text-left px-5 py-2">Invoice</th>
                  <th className="text-right px-3 py-2">Balance</th>
                  <th className="text-right px-5 py-2 w-32">Apply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="px-5 py-2 font-mono text-xs text-gray-700 dark:text-gray-200">{inv.invoiceNumber ?? inv.orderNumber}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{fmt(Number(inv.balance))}</td>
                    <td className="px-5 py-2 text-right">
                      <span className="relative inline-block">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                        <input type="text" inputMode="decimal" value={amounts[inv.id] ?? ''}
                          onChange={e => setAmounts(p => ({ ...p, [inv.id]: e.target.value }))}
                          placeholder="0.00"
                          className={`w-24 h-7 pl-5 pr-2 text-xs text-right rounded border bg-white dark:bg-gray-800 ${(parseFloat(amounts[inv.id] ?? '') || 0) > Number(inv.balance) + 0.005 ? 'border-red-400' : 'border-gray-300 dark:border-white/15'}`} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-white/10 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <button onClick={autoFill} disabled={loading || invoices.length === 0}
              className="text-orange-600 hover:underline disabled:opacity-40">Auto-fill oldest first</button>
            <span className={remaining < -0.005 ? 'text-red-600 font-semibold' : 'text-gray-500'}>
              Applying {fmt(allocated)} · {fmt(remaining)} left
            </span>
          </div>
          {err && <div className="text-[11px] text-red-600">{err}</div>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-white/15 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5">Cancel</button>
            <button onClick={submit} disabled={submitting || allocated <= 0.005 || remaining < -0.005 || overBalance}
              className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
              {submitting ? 'Applying…' : `Apply ${fmt(allocated)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

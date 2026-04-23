'use client'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface CustomerResult {
  id: string
  companyName: string
  contactName?: string
}

interface CreditMemo {
  id: string
  memoNumber: string
  total: number
  unallocated: number
  status: string
  rma?: { rmaNumber: string }
}

interface OpenInvoice {
  id: string
  orderNumber: string
  total: number
  balance: number
  dueDate: string | null
}

const STEP_LABELS = ['Select Credit Memo', 'Allocate to Invoices']

export default function ApplyCreditModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState(1)

  // Step 1
  const [customers, setCustomers] = useState<CustomerResult[]>([])
  const [customersLoading, setCustomersLoading] = useState(true)
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [creditMemos, setCreditMemos] = useState<CreditMemo[]>([])
  const [memosLoading, setMemosLoading] = useState(false)
  const [selectedMemoId, setSelectedMemoId] = useState('')

  // Step 2
  const [invoices, setInvoices] = useState<OpenInvoice[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const selectedMemo = creditMemos.find((m) => m.id === selectedMemoId) ?? null
  const creditAmount = selectedMemo ? Number(selectedMemo.unallocated) : 0

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const remaining = Math.max(0, creditAmount - totalAllocated)

  // Load all customers on mount
  useEffect(() => {
    fetch('/api/wholesale/customers?active=true')
      .then((r) => r.json())
      .then((d) => setCustomers(d.data ?? []))
      .catch(() => {})
      .finally(() => setCustomersLoading(false))
  }, [])

  // Load credit memos when customer changes
  useEffect(() => {
    if (!selectedCustomerId) { setCreditMemos([]); setSelectedMemoId(''); return }
    setMemosLoading(true)
    setSelectedMemoId('')
    fetch(`/api/wholesale/credit-memo?customerId=${selectedCustomerId}`)
      .then((r) => r.json())
      .then((d) => {
        const all: CreditMemo[] = (d.data ?? []).filter((m: CreditMemo) => Number(m.unallocated) > 0)
        setCreditMemos(all)
      })
      .catch(() => toast.error('Failed to load credit memos'))
      .finally(() => setMemosLoading(false))
  }, [selectedCustomerId])

  function enterStep2() {
    if (!selectedMemoId) { toast.error('Select a credit memo'); return }
    setStep(2)
    setInvoicesLoading(true)
    Promise.all([
      fetch(`/api/wholesale/orders?customerId=${selectedCustomerId}&status=INVOICED&limit=200`).then((r) => r.json()),
      fetch(`/api/wholesale/orders?customerId=${selectedCustomerId}&status=PARTIALLY_PAID&limit=200`).then((r) => r.json()),
    ])
      .then(([inv, partial]) => {
        const all: OpenInvoice[] = [...(inv.data ?? []), ...(partial.data ?? [])]
          .filter((o: OpenInvoice) => Number(o.balance) > 0)
          .sort((a: OpenInvoice, b: OpenInvoice) => {
            const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
            const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
            return da - db
          })
        setInvoices(all)
        setAllocations({})
      })
      .catch(() => toast.error('Failed to load invoices'))
      .finally(() => setInvoicesLoading(false))
  }

  function setAllocation(orderId: string, value: string) {
    setAllocations((prev) => ({ ...prev, [orderId]: value }))
  }

  function toggleFullApply(orderId: string, balance: number) {
    const current = parseFloat(allocations[orderId] || '0') || 0
    if (current > 0) {
      setAllocations((prev) => ({ ...prev, [orderId]: '' }))
    } else {
      const availableForThis = remaining
      const applyAmt = Math.min(balance, availableForThis)
      if (applyAmt <= 0) { toast.error('No remaining credit to allocate'); return }
      setAllocations((prev) => ({ ...prev, [orderId]: applyAmt.toFixed(2) }))
    }
  }

  async function handleSubmit() {
    if (!selectedMemo) return
    if (totalAllocated <= 0) { toast.error('Allocate at least some credit'); return }

    const allocs = Object.entries(allocations)
      .map(([orderId, val]) => ({ orderId, amount: parseFloat(val) || 0 }))
      .filter((a) => a.amount > 0)

    if (totalAllocated > creditAmount + 0.005) {
      toast.error('Allocations exceed credit memo amount')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/wholesale/credit-memo/${selectedMemo.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocations: allocs }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        toast.error(e.error ?? 'Failed to apply credit')
        return
      }
      toast.success('Credit applied successfully')
      onSuccess()
      onClose()
    } catch {
      toast.error('Failed to apply credit')
    } finally {
      setSubmitting(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`bg-white rounded-xl shadow-xl mx-4 ${step === 2 ? 'w-full max-w-3xl' : 'w-full max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Apply Credit</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-4 px-6 pt-5">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                step === i + 1 ? 'bg-violet-500 border-violet-500 text-white' :
                step > i + 1  ? 'bg-green-500 border-green-500 text-white' :
                'border-gray-300 text-gray-400'
              }`}>{i + 1}</div>
              <span className={`text-sm ${step === i + 1 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{label}</span>
              {i < STEP_LABELS.length - 1 && <div className="w-8 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        <div className="px-6 py-5">
          {/* Step 1 — Select Credit Memo */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Customer *</label>
                {customersLoading ? (
                  <p className="text-sm text-gray-400 py-2">Loading customers...</p>
                ) : (
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    autoFocus
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    <option value="">Select a customer...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.companyName}{c.contactName ? ` — ${c.contactName}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Credit Memo *</label>
                {!selectedCustomerId ? (
                  <p className="text-sm text-gray-400 py-2">Select a customer first</p>
                ) : memosLoading ? (
                  <p className="text-sm text-gray-400 py-2">Loading credit memos...</p>
                ) : creditMemos.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No unapplied credit memos for this customer</p>
                ) : (
                  <select
                    value={selectedMemoId}
                    onChange={(e) => setSelectedMemoId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    <option value="">Select a credit memo...</option>
                    {creditMemos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.memoNumber} — {fmt(Number(m.unallocated))} available
                        {m.rma ? ` (RMA ${m.rma.rmaNumber})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={enterStep2}
                  className="px-6 py-2 bg-violet-500 text-white rounded-lg text-sm font-medium hover:bg-violet-600 disabled:opacity-50"
                  disabled={!selectedMemoId}
                >
                  Next: Allocate
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Allocate to Invoices */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Credit memo summary bar */}
              <div className="flex items-center justify-between bg-violet-50 rounded-lg px-4 py-3 text-sm">
                <div>
                  <span className="text-gray-500">Credit Memo:</span>{' '}
                  <span className="font-semibold">{selectedMemo?.memoNumber}</span>
                </div>
                <div>
                  <span className="text-gray-500">Available:</span>{' '}
                  <span className="font-semibold">{fmt(creditAmount)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Allocated:</span>{' '}
                  <span className={`font-semibold ${totalAllocated > creditAmount + 0.005 ? 'text-red-600' : 'text-green-600'}`}>
                    {fmt(totalAllocated)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Remaining:</span>{' '}
                  <span className="font-semibold">{fmt(remaining)}</span>
                </div>
              </div>

              {invoicesLoading ? (
                <div className="py-8 text-center text-gray-400 text-sm">Loading invoices...</div>
              ) : invoices.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">No open invoices for this customer</div>
              ) : (
                <div className="overflow-y-auto max-h-72 border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        <th className="text-left px-4 py-2.5">Invoice</th>
                        <th className="text-left px-4 py-2.5">Due</th>
                        <th className="text-right px-4 py-2.5">Total</th>
                        <th className="text-right px-4 py-2.5">Balance</th>
                        <th className="text-right px-4 py-2.5">Apply</th>
                        <th className="text-center px-4 py-2.5">Full</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invoices.map((inv) => {
                        const bal = Number(inv.balance)
                        const allocVal = allocations[inv.id] || ''
                        const allocNum = parseFloat(allocVal) || 0
                        const isChecked = allocNum > 0
                        const overBal = allocNum > bal + 0.005
                        return (
                          <tr key={inv.id} className={overBal ? 'bg-red-50' : ''}>
                            <td className="px-4 py-2.5 font-mono text-orange-600">{inv.orderNumber}</td>
                            <td className="px-4 py-2.5 text-gray-500">
                              {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right">{fmt(Number(inv.total))}</td>
                            <td className="px-4 py-2.5 text-right font-semibold">{fmt(bal)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="number"
                                min="0"
                                max={bal}
                                step="0.01"
                                value={allocVal}
                                onChange={(e) => setAllocation(inv.id, e.target.value)}
                                placeholder="0.00"
                                className={`w-24 border rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-violet-400 ${
                                  overBal ? 'border-red-300' : 'border-gray-200'
                                }`}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleFullApply(inv.id, bal)}
                                className="w-4 h-4 text-violet-600 border-gray-300 rounded focus:ring-violet-500 cursor-pointer"
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {totalAllocated > creditAmount + 0.005 && (
                <p className="text-xs text-red-600">Allocations exceed credit memo amount by {fmt(totalAllocated - creditAmount)}</p>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                  &larr; Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || totalAllocated <= 0 || totalAllocated > creditAmount + 0.005}
                  className="px-6 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  {submitting ? 'Applying...' : 'Apply Credit'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

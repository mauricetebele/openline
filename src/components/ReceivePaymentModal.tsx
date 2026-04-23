'use client'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface CustomerResult {
  id: string
  companyName: string
  contactName?: string
}

const PAYMENT_METHODS = [
  { value: 'CHECK', label: 'Check' },
  { value: 'ACH', label: 'ACH' },
  { value: 'WIRE', label: 'Wire' },
  { value: 'CREDIT_CARD', label: 'Credit Card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'OTHER', label: 'Other' },
]

export default function ReceivePaymentModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState(1)

  // Step 1
  const [customers, setCustomers] = useState<CustomerResult[]>([])
  const [customersLoading, setCustomersLoading] = useState(true)
  const [selectedCustomerId, setSelectedCustomerId] = useState('')

  // Step 2
  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState('CHECK')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Load all customers on mount
  useEffect(() => {
    fetch('/api/wholesale/customers?active=true')
      .then((r) => r.json())
      .then((d) => setCustomers(d.data ?? []))
      .catch(() => {})
      .finally(() => setCustomersLoading(false))
  }, [])

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null

  async function handleSubmit() {
    if (!selectedCustomer) return
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/wholesale/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          amount: amt,
          paymentDate,
          method,
          memo: memo.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        toast.error(e.error ?? 'Failed to record payment')
        return
      }
      toast.success('Payment recorded')
      onSuccess()
      onClose()
    } catch {
      toast.error('Failed to record payment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Receive Payment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-4 px-6 pt-5">
          {['Select Customer', 'Payment Details'].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                step === i + 1 ? 'bg-orange-500 border-orange-500 text-white' :
                step > i + 1  ? 'bg-green-500 border-green-500 text-white' :
                'border-gray-300 text-gray-400'
              }`}>{i + 1}</div>
              <span className={`text-sm ${step === i + 1 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{label}</span>
              {i < 1 && <div className="w-12 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        <div className="px-6 py-5">
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
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
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

              <div className="flex justify-end">
                <button
                  onClick={() => { if (!selectedCustomerId) { toast.error('Select a customer'); return } setStep(2) }}
                  className="px-6 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
                  disabled={!selectedCustomerId}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method *</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  >
                    {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Memo</label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Optional"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                  &larr; Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !amount || parseFloat(amount) <= 0}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit Payment'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

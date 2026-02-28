'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import jsPDF from 'jspdf'

const SO_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  INVOICED: 'bg-yellow-100 text-yellow-700',
  PARTIALLY_PAID: 'bg-orange-100 text-orange-700',
  PAID: 'bg-green-100 text-green-700',
  VOID: 'bg-red-100 text-red-500',
}

const TERMS_LABEL: Record<string, string> = {
  NET_15: 'Net 15', NET_30: 'Net 30', NET_60: 'Net 60',
  NET_90: 'Net 90', DUE_ON_RECEIPT: 'Due on Receipt',
}

const PAYMENT_METHODS = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER']

interface OrderItem {
  id: string; sku?: string; title: string; description?: string
  quantity: number; unitPrice: number; discount: number; total: number; taxable: boolean
}

interface Allocation {
  id: string; amount: number
  payment: { paymentDate: string; method: string; reference?: string }
}

interface Address { addressLine1: string; addressLine2?: string; city: string; state: string; postalCode: string }

interface Order {
  id: string; orderNumber: string; status: string; orderDate: string; dueDate?: string
  customer: { id: string; companyName: string; paymentTerms: string }
  items: OrderItem[]
  allocations: Allocation[]
  shippingAddress: Address | null
  billingAddress:  Address | null
  subtotal: number; discountPct: number; discountAmt: number
  taxRate: number; taxAmt: number; shippingCost: number
  total: number; paidAmount: number; balance: number
  notes?: string; internalNotes?: string
}

function addrLines(a: Address | null): string[] {
  if (!a) return []
  return [
    a.addressLine1,
    ...(a.addressLine2 ? [a.addressLine2] : []),
    `${a.city}, ${a.state} ${a.postalCode}`,
  ]
}

function generateInvoicePDF(order: Order) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const isPaid = order.status === 'PAID'

  // PAID watermark
  if (isPaid) {
    doc.setFontSize(72)
    doc.setTextColor(200, 200, 200)
    doc.text('PAID', w / 2, 400, { align: 'center', angle: 45 } as Parameters<typeof doc.text>[3])
    doc.setTextColor(0, 0, 0)
  }

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('INVOICE', 40, 50)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Invoice #: ${order.orderNumber}`, w - 40, 40, { align: 'right' })
  doc.text(`Date: ${new Date(order.orderDate).toLocaleDateString()}`, w - 40, 55, { align: 'right' })
  if (order.dueDate) doc.text(`Due: ${new Date(order.dueDate).toLocaleDateString()}`, w - 40, 70, { align: 'right' })
  doc.text(`Terms: ${TERMS_LABEL[order.customer.paymentTerms] ?? order.customer.paymentTerms}`, w - 40, 85, { align: 'right' })

  // Bill To / Ship To
  doc.setFont('helvetica', 'bold')
  doc.text('Bill To:', 40, 100)
  doc.text('Ship To:', 220, 100)
  doc.setFont('helvetica', 'normal')

  const billLines = [order.customer.companyName, ...addrLines(order.billingAddress)]
  const shipLines = [order.customer.companyName, ...addrLines(order.shippingAddress)]
  let y = 114
  for (let i = 0; i < Math.max(billLines.length, shipLines.length); i++) {
    if (billLines[i]) doc.text(billLines[i], 40, y)
    if (shipLines[i]) doc.text(shipLines[i], 220, y)
    y += 14
  }

  // Table header
  y = Math.max(y + 20, 180)
  doc.setFillColor(245, 245, 245)
  doc.rect(40, y - 14, w - 80, 18, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('#',    45, y)
  doc.text('SKU',  65, y)
  doc.text('Description',               160, y)
  doc.text('Qty',   360, y, { align: 'right' })
  doc.text('Unit Price', 450, y, { align: 'right' })
  doc.text('Disc%',      490, y, { align: 'right' })
  doc.text('Amount',  w - 45, y, { align: 'right' })
  y += 16

  doc.setFont('helvetica', 'normal')
  order.items.forEach((item, i) => {
    doc.text(String(i + 1),    45, y)
    doc.text(item.sku ?? '',   65, y)
    doc.text(item.title.substring(0, 45), 160, y)
    doc.text(String(Number(item.quantity)),  360, y, { align: 'right' })
    doc.text(`$${Number(item.unitPrice).toFixed(2)}`,  450, y, { align: 'right' })
    doc.text(`${Number(item.discount)}%`,  490, y, { align: 'right' })
    doc.text(`$${Number(item.total).toFixed(2)}`, w - 45, y, { align: 'right' })
    y += 16
  })

  // Totals
  y += 10
  doc.setLineWidth(0.5)
  doc.line(w - 220, y, w - 45, y)
  y += 14

  const totalsRows: [string, string][] = [
    ['Subtotal:', `$${Number(order.subtotal).toFixed(2)}`],
    [`Discount (${Number(order.discountPct)}%):`, `-$${Number(order.discountAmt).toFixed(2)}`],
    [`Tax (${Number(order.taxRate)}%):`, `$${Number(order.taxAmt).toFixed(2)}`],
    ['Shipping:', `$${Number(order.shippingCost).toFixed(2)}`],
  ]
  totalsRows.forEach(([label, val]) => {
    doc.text(label, w - 220, y)
    doc.text(val, w - 45, y, { align: 'right' })
    y += 16
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('TOTAL DUE:', w - 220, y)
  doc.text(`$${Number(order.total).toFixed(2)}`, w - 45, y, { align: 'right' })
  y += 16

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Amount Paid:', w - 220, y)
  doc.text(`-$${Number(order.paidAmount).toFixed(2)}`, w - 45, y, { align: 'right' })
  y += 2
  doc.setLineWidth(0.5)
  doc.line(w - 220, y, w - 45, y)
  y += 14

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('BALANCE DUE:', w - 220, y)
  doc.text(`$${Number(order.balance).toFixed(2)}`, w - 45, y, { align: 'right' })

  if (order.notes) {
    y += 30
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Notes: ${order.notes}`, 40, y)
  }

  doc.save(`Invoice-${order.orderNumber}.pdf`)
}

export default function WholesaleOrderDetailManager({ id }: { id: string }) {
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [transitioning, setTransitioning] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [payForm, setPayForm] = useState({
    amount: '', method: 'CHECK', reference: '', memo: '',
  })
  const [paymentSaving, setPaymentSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wholesale/orders/${id}`)
      if (res.ok) setOrder(await res.json())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function transition(newStatus: string) {
    setTransitioning(true)
    try {
      const res = await fetch(`/api/wholesale/orders/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed'); return }
      if (data.warning) toast.warning(data.warning)
      if (data.alerts?.length) data.alerts.forEach((a: string) => toast.warning(a))
      toast.success(`Status updated to ${newStatus}`)
      load()
    } finally {
      setTransitioning(false)
    }
  }

  async function recordPayment() {
    if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error('Enter amount'); return }
    setPaymentSaving(true)
    try {
      const res = await fetch('/api/wholesale/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: order!.customer.id,
          amount: Number(payForm.amount),
          method: payForm.method,
          reference: payForm.reference,
          memo: payForm.memo,
          allocations: [{ orderId: id, amount: Number(payForm.amount) }],
        }),
      })
      if (!res.ok) { const e = await res.json(); toast.error(e.error ?? 'Failed'); return }
      toast.success('Payment recorded')
      setShowPaymentModal(false)
      setPayForm({ amount: '', method: 'CHECK', reference: '', memo: '' })
      load()
    } finally {
      setPaymentSaving(false)
    }
  }

  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!order)  return <div className="p-8 text-center text-gray-400 text-sm">Order not found</div>

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">←</button>
        <h1 className="font-mono text-2xl font-bold text-orange-600">{order.orderNumber}</h1>
        <span className={`inline-flex px-2.5 py-1 rounded text-xs font-semibold ${SO_STATUS_COLOR[order.status]}`}>
          {order.status.replace('_', ' ')}
        </span>
        <Link href={`/wholesale/customers/${order.customer.id}`} className="text-sm text-gray-600 hover:text-orange-600">
          {order.customer.companyName}
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          {order.status === 'DRAFT' && (
            <>
              <button onClick={() => transition('CONFIRMED')} disabled={transitioning}
                className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 disabled:opacity-50">
                Confirm Order
              </button>
              <button onClick={() => transition('VOID')} disabled={transitioning}
                className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50">
                Void
              </button>
            </>
          )}
          {order.status === 'CONFIRMED' && (
            <>
              <button onClick={() => transition('INVOICED')} disabled={transitioning}
                className="px-3 py-1.5 bg-yellow-500 text-white rounded text-xs font-medium hover:bg-yellow-600 disabled:opacity-50">
                Mark as Invoiced
              </button>
              <button onClick={() => transition('VOID')} disabled={transitioning}
                className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50">
                Void
              </button>
            </>
          )}
          {(order.status === 'INVOICED' || order.status === 'PARTIALLY_PAID') && (
            <>
              <button onClick={() => setShowPaymentModal(true)}
                className="px-3 py-1.5 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600">
                Record Payment
              </button>
              <button onClick={() => generateInvoicePDF(order)}
                className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-50">
                Print Invoice
              </button>
              <button onClick={() => transition('VOID')} disabled={transitioning}
                className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50">
                Void
              </button>
            </>
          )}
          {order.status === 'PAID' && (
            <button onClick={() => generateInvoicePDF(order)}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-50">
              Print Invoice
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: addresses + items + notes */}
        <div className="lg:col-span-2 space-y-4">
          {/* Addresses */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Bill To', addr: order.billingAddress },
              { label: 'Ship To', addr: order.shippingAddress },
            ].map(({ label, addr }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-sm">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{label}</p>
                {addr ? (
                  <>
                    <p className="font-medium text-gray-700">{order.customer.companyName}</p>
                    <p className="text-gray-600">{addr.addressLine1}</p>
                    {addr.addressLine2 && <p className="text-gray-600">{addr.addressLine2}</p>}
                    <p className="text-gray-600">{addr.city}, {addr.state} {addr.postalCode}</p>
                  </>
                ) : <p className="text-gray-400">—</p>}
              </div>
            ))}
          </div>

          {/* Line items */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Line Items</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                  <th className="text-left px-5 py-2">SKU</th>
                  <th className="text-left px-5 py-2">Description</th>
                  <th className="text-right px-5 py-2">Qty</th>
                  <th className="text-right px-5 py-2">Unit Price</th>
                  <th className="text-right px-5 py-2">Disc%</th>
                  <th className="text-right px-5 py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-5 py-2 font-mono text-xs text-gray-500">{item.sku ?? '—'}</td>
                    <td className="px-5 py-2">{item.title}</td>
                    <td className="px-5 py-2 text-right">{Number(item.quantity)}</td>
                    <td className="px-5 py-2 text-right">{fmt(Number(item.unitPrice))}</td>
                    <td className="px-5 py-2 text-right">{Number(item.discount)}%</td>
                    <td className="px-5 py-2 text-right font-medium">{fmt(Number(item.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {(order.notes || order.internalNotes) && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2">
              {order.notes && (
                <div><p className="text-xs font-semibold text-gray-400 uppercase">Notes</p><p>{order.notes}</p></div>
              )}
              {order.internalNotes && (
                <div><p className="text-xs font-semibold text-gray-400 uppercase">Internal Notes</p><p>{order.internalNotes}</p></div>
              )}
            </div>
          )}
        </div>

        {/* Right: totals + payments */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span>{fmt(Number(order.subtotal))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Discount ({Number(order.discountPct)}%)</span>
              <span className="text-red-500">-{fmt(Number(order.discountAmt))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tax ({Number(order.taxRate)}%)</span>
              <span>{fmt(Number(order.taxAmt))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Shipping</span>
              <span>{fmt(Number(order.shippingCost))}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
              <span>Total</span>
              <span>{fmt(Number(order.total))}</span>
            </div>
            <div className="flex justify-between text-green-600">
              <span>Paid</span>
              <span>-{fmt(Number(order.paidAmount))}</span>
            </div>
            <div className="flex justify-between font-bold text-orange-600 border-t border-gray-200 pt-2">
              <span>Balance Due</span>
              <span>{fmt(Number(order.balance))}</span>
            </div>
          </div>

          {/* Payment history */}
          {order.allocations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Payment History</p>
              <div className="space-y-2 text-sm">
                {order.allocations.map((alloc) => (
                  <div key={alloc.id} className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">{alloc.payment.method}</p>
                      <p className="text-xs text-gray-400">{new Date(alloc.payment.paymentDate).toLocaleDateString()}</p>
                      {alloc.payment.reference && <p className="text-xs text-gray-400">Ref: {alloc.payment.reference}</p>}
                    </div>
                    <span className="text-green-600 font-semibold">{fmt(Number(alloc.amount))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Payment modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPaymentModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Record Payment</h3>
            <p className="text-sm text-gray-500">Balance due: <strong>{fmt(Number(order.balance))}</strong></p>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount *</label>
              <input
                type="number" min="0" step="0.01"
                value={payForm.amount}
                onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
              <select
                value={payForm.method}
                onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference #</label>
              <input
                type="text"
                value={payForm.reference}
                onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Memo</label>
              <input
                type="text"
                value={payForm.memo}
                onChange={(e) => setPayForm((f) => ({ ...f, memo: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={recordPayment}
                disabled={paymentSaving}
                className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50"
              >
                {paymentSaving ? 'Saving…' : 'Record Payment'}
              </button>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

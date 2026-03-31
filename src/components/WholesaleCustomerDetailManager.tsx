'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import jsPDF from 'jspdf'
import { Download } from 'lucide-react'
import { generateInvoicePDF } from '@/lib/generate-wholesale-invoice'
import { generateCreditMemoPDF } from '@/lib/generate-credit-memo-pdf'

const SO_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  INVOICED: 'bg-yellow-100 text-yellow-700',
  PARTIALLY_PAID: 'bg-orange-100 text-orange-700',
  PAID: 'bg-green-100 text-green-700',
}

interface StatementLine {
  date: string
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
  reference: string
  charges: number
  credits: number
  balance: number
}

interface Customer {
  id: string; companyName: string; contactName?: string; email?: string; phone?: string
  paymentTerms: string; taxRate: number; defaultDiscount: number; creditLimit?: number
  notes?: string; active: boolean; openBalance: number
  salesOrders: { id: string; orderNumber: string; orderDate: string; total: number; balance: number; status: string; dueDate?: string }[]
}

function generateStatementPDF(customer: Customer, lines: StatementLine[], openBalance: number) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('ACCOUNT STATEMENT', 40, 50)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Customer: ${customer.companyName}`, 40, 70)
  if (customer.contactName) doc.text(`Contact: ${customer.contactName}`, 40, 85)
  doc.text(`Date: ${new Date().toLocaleDateString()}`, w - 40, 70, { align: 'right' })
  doc.text(`Open Balance: $${openBalance.toFixed(2)}`, w - 40, 85, { align: 'right' })

  // Table header
  let y = 115
  doc.setFillColor(245, 245, 245)
  doc.rect(40, y - 14, w - 80, 18, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Date',      45, y)
  doc.text('Type',     130, y)
  doc.text('Reference',200, y)
  doc.text('Charges',  380, y, { align: 'right' })
  doc.text('Credits',  460, y, { align: 'right' })
  doc.text('Balance',  w - 45, y, { align: 'right' })
  y += 16

  doc.setFont('helvetica', 'normal')
  for (const line of lines) {
    if (y > 720) { doc.addPage(); y = 50 }
    doc.text(new Date(line.date).toLocaleDateString(), 45, y)
    doc.text(line.type, 130, y)
    doc.text(line.reference.substring(0, 30), 200, y)
    doc.text(line.charges > 0 ? `$${line.charges.toFixed(2)}` : '', 380, y, { align: 'right' })
    doc.text(line.credits > 0 ? `$${line.credits.toFixed(2)}` : '', 460, y, { align: 'right' })
    doc.text(`$${Number(line.balance).toFixed(2)}`, w - 45, y, { align: 'right' })
    y += 16
  }

  y += 10
  doc.setLineWidth(0.5)
  doc.line(40, y, w - 40, y)
  y += 14
  doc.setFont('helvetica', 'bold')
  doc.text(`Total Balance Due: $${openBalance.toFixed(2)}`, w - 40, y, { align: 'right' })

  doc.save(`Statement-${customer.companyName.replace(/\s+/g, '-')}.pdf`)
}

export default function WholesaleCustomerDetailManager({ id }: { id: string }) {
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'orders' | 'statement'>('orders')
  const [statement, setStatement] = useState<{ lines: StatementLine[]; openBalance: number } | null>(null)
  const [stmtLoading, setStmtLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wholesale/customers/${id}`)
      if (res.ok) setCustomer(await res.json())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function loadStatement() {
    if (statement) return
    setStmtLoading(true)
    try {
      const res = await fetch(`/api/wholesale/statement/${id}`)
      if (res.ok) {
        const data = await res.json()
        setStatement({ lines: data.lines, openBalance: data.openBalance })
      }
    } finally {
      setStmtLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'statement') loadStatement()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const [downloading, setDownloading] = useState<string | null>(null)

  async function downloadInvoicePDF(orderNumber: string) {
    if (!customer) return
    setDownloading(orderNumber)
    try {
      // Find order id from customer's salesOrders
      const order = customer.salesOrders.find(o => o.orderNumber === orderNumber)
      if (!order) { toast.error('Order not found'); return }
      const res = await fetch(`/api/wholesale/orders/${order.id}`)
      if (!res.ok) { toast.error('Failed to load order'); return }
      const data = await res.json()
      generateInvoicePDF(data)
    } catch {
      toast.error('Failed to generate invoice PDF')
    } finally {
      setDownloading(null)
    }
  }

  async function downloadCreditMemoPDF(memoNumber: string) {
    if (!customer) return
    setDownloading(memoNumber)
    try {
      const res = await fetch(`/api/wholesale/credit-memo?customerId=${customer.id}`)
      if (!res.ok) { toast.error('Failed to load credit memos'); return }
      const json = await res.json()
      const memos = json.data ?? json
      const memo = (Array.isArray(memos) ? memos : []).find((m: { memoNumber: string }) => m.memoNumber === memoNumber)
      if (!memo) { toast.error(`Credit memo ${memoNumber} not found`); return }

      // Fetch RMA to get serials
      const rmaId = memo.rmaId ?? memo.rma?.id
      if (!rmaId) { toast.error('Credit memo has no RMA reference'); return }
      const rmaRes = await fetch(`/api/wholesale/customer-rma/${rmaId}`)
      if (!rmaRes.ok) { toast.error(`Failed to load RMA (${rmaRes.status})`); return }
      const rma = await rmaRes.json()

      // Fetch customer billing address from addresses array
      let billingAddress: { addressLine1: string; addressLine2?: string | null; city: string; state: string; postalCode: string } | null = null
      try {
        const custRes = await fetch(`/api/wholesale/customers/${customer.id}`)
        if (custRes.ok) {
          const cust = await custRes.json()
          const addr = (cust.addresses ?? []).find((a: { type: string }) => a.type === 'BILLING')
          if (addr) billingAddress = addr
        }
      } catch { /* skip */ }

      const receivedSerials = (rma.serials ?? []).filter((s: { receivedAt: string | null }) => s.receivedAt)

      const pdfData = {
        memoNumber: memo.memoNumber,
        createdAt: memo.createdAt,
        customerName: customer.companyName,
        rmaNumber: memo.rma?.rmaNumber ?? rma.rmaNumber ?? memoNumber,
        billingAddress,
        serials: receivedSerials.map((s: { serialNumber: string; product?: { sku: string }; sku?: string; salePrice: string | null }) => ({
          serialNumber: s.serialNumber,
          sku: s.product?.sku ?? s.sku ?? '',
          salePrice: parseFloat(s.salePrice ?? '0'),
        })),
        subtotal: parseFloat(memo.subtotal ?? '0'),
        restockingFee: parseFloat(memo.restockingFee ?? '0'),
        total: parseFloat(memo.total ?? '0'),
        notes: memo.notes ?? null,
      }
      console.log('Credit memo PDF data:', pdfData)
      await generateCreditMemoPDF(pdfData)
    } catch (err) {
      console.error('Credit memo PDF error:', err)
      toast.error(`CM PDF error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(null)
    }
  }

  const fmt = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!customer) return <div className="p-8 text-center text-gray-400 text-sm">Customer not found</div>

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">←</button>
        <h1 className="text-2xl font-bold text-gray-900">{customer.companyName}</h1>
        {!customer.active && (
          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded font-medium">Inactive</span>
        )}
        <div className="ml-auto">
          <button
            onClick={() => router.push('/wholesale/orders/new')}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600"
          >
            + New Order
          </button>
        </div>
      </div>

      {/* Info card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-400 uppercase font-medium mb-1">Contact</p>
          <p>{customer.contactName ?? '—'}</p>
          <p className="text-gray-500">{customer.email ?? '—'}</p>
          <p className="text-gray-500">{customer.phone ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase font-medium mb-1">Terms / Discount</p>
          <p>{customer.paymentTerms}</p>
          <p className="text-gray-500">Discount: {Number(customer.defaultDiscount)}%</p>
          <p className="text-gray-500">Tax: {Number(customer.taxRate)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase font-medium mb-1">Credit Limit</p>
          <p>{customer.creditLimit ? fmt(Number(customer.creditLimit)) : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase font-medium mb-1">Open Balance</p>
          <p className="text-xl font-bold text-orange-600">{fmt(customer.openBalance)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['orders', 'statement'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-2.5 px-5 text-sm font-medium border-b-2 transition-colors capitalize ${
              tab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          {customer.salesOrders.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No orders yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                  <th className="text-left px-5 py-3">Order #</th>
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-right px-5 py-3">Total</th>
                  <th className="text-right px-5 py-3">Balance</th>
                  <th className="text-left px-5 py-3">Due</th>
                  <th className="text-left px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customer.salesOrders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => router.push(`/wholesale/orders/${o.id}`)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-5 py-3 font-mono text-orange-600">{o.orderNumber}</td>
                    <td className="px-5 py-3 text-gray-500">{new Date(o.orderDate).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right">{fmt(Number(o.total))}</td>
                    <td className="px-5 py-3 text-right font-semibold">{fmt(Number(o.balance))}</td>
                    <td className="px-5 py-3 text-gray-500">{o.dueDate ? new Date(o.dueDate).toLocaleDateString() : '—'}</td>
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
      )}

      {tab === 'statement' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm font-semibold text-gray-700">
              Open Balance: <span className="text-orange-600">{fmt(statement?.openBalance ?? 0)}</span>
            </p>
            {statement && (
              <button
                onClick={() => {
                  if (!statement) { toast.error('Statement not loaded'); return }
                  generateStatementPDF(customer, statement.lines, statement.openBalance)
                }}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Print Statement
              </button>
            )}
          </div>

          {stmtLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading statement…</div>
          ) : !statement || statement.lines.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No statement activity</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-left px-5 py-3">Type</th>
                    <th className="text-left px-5 py-3">Reference</th>
                    <th className="text-right px-5 py-3">Charges</th>
                    <th className="text-right px-5 py-3">Credits</th>
                    <th className="text-right px-5 py-3">Balance</th>
                    <th className="px-3 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {statement.lines.map((line, i) => (
                    <tr key={i} className={line.type === 'PAYMENT' ? 'bg-green-50/30' : line.type === 'CREDIT_MEMO' ? 'bg-purple-50/30' : ''}>
                      <td className="px-5 py-2.5 text-gray-500">{new Date(line.date).toLocaleDateString()}</td>
                      <td className="px-5 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          line.type === 'INVOICE' ? 'bg-yellow-100 text-yellow-700'
                            : line.type === 'CREDIT_MEMO' ? 'bg-purple-100 text-purple-700'
                            : 'bg-green-100 text-green-700'
                        }`}>{line.type === 'CREDIT_MEMO' ? 'CREDIT MEMO' : line.type}</span>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{line.reference}</td>
                      <td className="px-5 py-2.5 text-right">{line.charges > 0 ? fmt(line.charges) : ''}</td>
                      <td className="px-5 py-2.5 text-right text-green-600">{line.credits > 0 ? fmt(line.credits) : ''}</td>
                      <td className="px-5 py-2.5 text-right font-semibold">{fmt(Number(line.balance))}</td>
                      <td className="px-3 py-2.5 text-center">
                        {(line.type === 'INVOICE' || line.type === 'CREDIT_MEMO') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (line.type === 'INVOICE') downloadInvoicePDF(line.reference)
                              else downloadCreditMemoPDF(line.reference)
                            }}
                            disabled={downloading === line.reference}
                            className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
                            title={line.type === 'INVOICE' ? 'Download Invoice PDF' : 'Download Credit Memo PDF'}
                          >
                            {downloading === line.reference ? (
                              <span className="text-xs">...</span>
                            ) : (
                              <Download size={14} />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

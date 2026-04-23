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
  invoiceNumber: string | null
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

function fmtUSD(n: number) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function generateStatementPDF(customer: Customer, lines: StatementLine[], openBalance: number) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const margin = 48
  const right = w - margin

  // Brand colors
  const blue: [number, number, number] = [27, 94, 166]
  const red: [number, number, number] = [193, 52, 44]
  const navy: [number, number, number] = [27, 58, 92]
  const gray50: [number, number, number] = [249, 250, 251]
  const gray200: [number, number, number] = [229, 231, 235]
  const gray500: [number, number, number] = [107, 114, 128]
  const gray700: [number, number, number] = [55, 65, 81]

  // ─── Logo ───────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  const olCharSpace = 2.5
  const olBaseW = doc.getTextWidth('OPEN LINE')
  const olFullW = olBaseW + ('OPEN LINE'.length - 1) * olCharSpace
  doc.setFontSize(9)
  const mCharSpace = 4
  const mBaseW = doc.getTextWidth('MOBILITY')
  const mFullW = mBaseW + ('MOBILITY'.length - 1) * mCharSpace
  const blockW = Math.max(olFullW, mFullW)
  const blockCx = margin + blockW / 2

  const sc = 0.4
  const logoOx = blockCx - (135 * sc)
  const logoOy = 8
  const p0x = 60*sc+logoOx, p0y = 105*sc+logoOy
  const c1x = 100*sc+logoOx, c1y = 120*sc+logoOy
  const c2x = 160*sc+logoOx, c2y = 40*sc+logoOy
  const p3x = 210*sc+logoOx, p3y = 55*sc+logoOy

  doc.setLineWidth(1.5)
  for (let t = 0; t < 1; t += 0.04) {
    const t2 = Math.min(t + 0.04, 1)
    const bx = (ti: number) => Math.pow(1-ti,3)*p0x + 3*Math.pow(1-ti,2)*ti*c1x + 3*(1-ti)*ti*ti*c2x + ti*ti*ti*p3x
    const by = (ti: number) => Math.pow(1-ti,3)*p0y + 3*Math.pow(1-ti,2)*ti*c1y + 3*(1-ti)*ti*ti*c2y + ti*ti*ti*p3y
    const r = Math.round(blue[0] + (red[0]-blue[0])*t)
    const g = Math.round(blue[1] + (red[1]-blue[1])*t)
    const b = Math.round(blue[2] + (red[2]-blue[2])*t)
    doc.setDrawColor(r, g, b)
    doc.line(bx(t), by(t), bx(t2), by(t2))
  }
  const ldx = 58*sc+logoOx, ldy = 104*sc+logoOy
  doc.setDrawColor(...blue); doc.setLineWidth(1.6)
  doc.circle(ldx, ldy, 4.5, 'S')
  doc.setFillColor(...blue); doc.circle(ldx, ldy, 1.5, 'F')
  const rdx = 212*sc+logoOx, rdy = 54*sc+logoOy
  doc.setDrawColor(...red); doc.setLineWidth(1.6)
  doc.circle(rdx, rdy, 5, 'S')
  doc.setFillColor(...red); doc.circle(rdx, rdy, 1.6, 'F')

  const textY = Math.max(ldy, rdy) + 22
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...navy)
  doc.text('OPEN LINE', blockCx - olFullW / 2, textY, { charSpace: olCharSpace })
  doc.setFontSize(9); doc.setTextColor(...red)
  doc.text('MOBILITY', blockCx - mFullW / 2, textY + 13, { charSpace: mCharSpace })

  // Title
  doc.setFontSize(24); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text('STATEMENT', right, 42, { align: 'right' })
  doc.setDrawColor(...blue); doc.setLineWidth(2)
  doc.line(right - 130, 48, right - 30, 48)
  doc.setDrawColor(...red); doc.setLineWidth(2)
  doc.line(right - 30, 48, right, 48)

  // Meta (right)
  let y = 68
  doc.setFontSize(8.5)
  const metaRows: [string, string][] = [
    ['Date', new Date().toLocaleDateString()],
    ['Open Balance', fmtUSD(openBalance)],
  ]
  metaRows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
    doc.text(label, right - 120, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text(val, right, y, { align: 'right' })
    y += 14
  })

  // Customer info
  const logoBottom = textY + 28
  y = Math.max(y + 10, logoBottom + 10)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray500)
  doc.text('CUSTOMER', margin, y)
  y += 14
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text(customer.companyName, margin, y)
  if (customer.contactName) {
    y += 14
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray700)
    doc.text(customer.contactName, margin, y)
  }
  y += 24

  // Table header
  doc.setFillColor(...gray50)
  doc.rect(margin, y - 12, right - margin, 18, 'F')
  doc.setDrawColor(...gray200); doc.setLineWidth(0.5)
  doc.line(margin, y + 6, right, y + 6)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...gray500)
  doc.text('DATE', margin + 8, y)
  doc.text('TYPE', margin + 80, y)
  doc.text('REFERENCE', margin + 160, y)
  doc.text('INVOICE #', margin + 260, y)
  doc.text('CHARGES', right - 130, y, { align: 'right' })
  doc.text('CREDITS', right - 60, y, { align: 'right' })
  doc.text('BALANCE', right - 8, y, { align: 'right' })
  y += 18

  const typeLabel: Record<string, string> = { INVOICE: 'Invoice', PAYMENT: 'Payment', CREDIT_MEMO: 'Credit Memo' }
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal')
  for (const line of lines) {
    if (y > h - 80) { doc.addPage(); y = margin }
    doc.setTextColor(...gray700)
    doc.text(new Date(line.date).toLocaleDateString(), margin + 8, y)
    doc.text(typeLabel[line.type] ?? line.type, margin + 80, y)
    doc.text(line.reference.substring(0, 18), margin + 160, y)
    doc.text(line.invoiceNumber ?? '', margin + 260, y)
    doc.text(line.charges > 0 ? fmtUSD(line.charges) : '', right - 130, y, { align: 'right' })
    if (line.credits > 0) {
      doc.setTextColor(22, 163, 74)
      doc.text(fmtUSD(line.credits), right - 60, y, { align: 'right' })
      doc.setTextColor(...gray700)
    } else {
      doc.text('', right - 60, y, { align: 'right' })
    }
    doc.setFont('helvetica', 'bold')
    doc.text(fmtUSD(line.balance), right - 8, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 16
    doc.setDrawColor(...gray200); doc.setLineWidth(0.3)
    doc.line(margin, y - 4, right, y - 4)
  }

  // Total
  y += 8
  doc.setDrawColor(...navy); doc.setLineWidth(1)
  doc.line(right - 200, y - 2, right, y - 2)
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
  doc.text('Total Balance Due:', right - 200, y + 12)
  doc.text(fmtUSD(openBalance), right - 8, y + 12, { align: 'right' })

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
                    <th className="text-left px-5 py-3">Invoice #</th>
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
                      <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{line.invoiceNumber ?? ''}</td>
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

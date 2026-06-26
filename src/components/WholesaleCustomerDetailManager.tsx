'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Mail } from 'lucide-react'
import { generateInvoicePDF } from '@/lib/generate-wholesale-invoice'
import { generateCreditMemoPDF } from '@/lib/generate-credit-memo-pdf'
import { generatePaymentReceiptPDF } from '@/lib/generate-payment-receipt'
import { generateStatementPDF } from '@/lib/generate-statement-pdf'
import EmailDocumentModal from '@/components/EmailDocumentModal'

const SO_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  INVOICED: 'bg-yellow-100 text-yellow-700',
  PARTIALLY_PAID: 'bg-orange-100 text-orange-700',
  PAID: 'bg-green-100 text-green-700',
}

interface AllocationDetail {
  id: string
  label: string
  amount: number
  date: string
  linkId: string
  linkType: 'order' | 'payment' | 'credit-memo'
}

interface StatementLine {
  date: string
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_MEMO'
  reference: string
  invoiceNumber: string | null
  charges: number
  credits: number
  applied: number
  remaining: number
  balance: number
  paymentId?: string
  orderId?: string
  orderStatus?: string
  invoiceAllocations?: AllocationDetail[]
  creditMemoId?: string
  creditMemoStatus?: string
  creditMemoAllocations?: AllocationDetail[]
  paymentAllocations?: AllocationDetail[]
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

export default function WholesaleCustomerDetailManager({ id }: { id: string }) {
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'orders' | 'activity' | 'open'>('orders')
  const [statement, setStatement] = useState<{ lines: StatementLine[]; openBalance: number } | null>(null)
  const [openStatement, setOpenStatement] = useState<{ lines: StatementLine[]; openBalance: number } | null>(null)
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

  async function loadStatement(view: 'activity' | 'open') {
    if (view === 'activity' && statement) return
    if (view === 'open' && openStatement) return
    setStmtLoading(true)
    try {
      const url = view === 'open'
        ? `/api/wholesale/statement/${id}?view=open`
        : `/api/wholesale/statement/${id}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const payload = { lines: data.lines, openBalance: data.openBalance }
        if (view === 'open') setOpenStatement(payload)
        else setStatement(payload)
      }
    } finally {
      setStmtLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'activity') loadStatement('activity')
    if (tab === 'open') loadStatement('open')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState<string | null>(null)
  const [emailModal, setEmailModal] = useState<{
    type: 'invoice' | 'credit-memo' | 'payment' | 'statement'
    id: string
    email: string
    label: string
    viewType?: 'activity' | 'open'
  } | null>(null)

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

      // Fetch RMA serials if RMA-based credit memo
      const rmaId = memo.rmaId ?? memo.rma?.id
      let receivedSerials: { serialNumber: string; product?: { sku: string }; sku?: string; salePrice: string | null }[] = []
      let rmaNumber = memo.memo ?? 'Manual Credit'
      if (rmaId) {
        const rmaRes = await fetch(`/api/wholesale/customer-rma/${rmaId}`)
        if (rmaRes.ok) {
          const rma = await rmaRes.json()
          receivedSerials = (rma.serials ?? []).filter((s: { receivedAt: string | null }) => s.receivedAt)
          rmaNumber = memo.rma?.rmaNumber ?? rma.rmaNumber ?? memoNumber
        }
      }

      const pdfData = {
        memoNumber: memo.memoNumber,
        createdAt: memo.createdAt,
        customerName: customer.companyName,
        rmaNumber,
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
      await generateCreditMemoPDF(pdfData)
    } catch (err) {
      console.error('Credit memo PDF error:', err)
      toast.error(`CM PDF error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(null)
    }
  }

  async function downloadPaymentReceipt(paymentId: string) {
    setDownloading(paymentId)
    try {
      const res = await fetch(`/api/wholesale/payments/${paymentId}`)
      if (!res.ok) { toast.error('Failed to load payment'); return }
      generatePaymentReceiptPDF(await res.json())
    } catch {
      toast.error('Failed to generate payment receipt')
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
        {([
          { key: 'orders', label: 'Orders' },
          { key: 'open', label: 'Statement (Open)' },
          { key: 'activity', label: 'Activity Statement' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-2.5 px-5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
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

      {emailModal && (
        <EmailDocumentModal
          type={emailModal.type}
          id={emailModal.id}
          defaultEmail={emailModal.email}
          label={emailModal.label}
          viewType={emailModal.viewType}
          onClose={() => setEmailModal(null)}
        />
      )}

      {(tab === 'activity' || tab === 'open') && (() => {
        const currentData = tab === 'open' ? openStatement : statement
        const label = tab === 'open' ? 'Statement (Open)' : 'Activity Statement'
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm font-semibold text-gray-700">
                Open Balance: <span className="text-orange-600">{fmt(currentData?.openBalance ?? 0)}</span>
              </p>
              {currentData && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      generateStatementPDF(customer, currentData.lines, currentData.openBalance, tab as 'activity' | 'open')
                    }}
                    className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                  >
                    Print {label}
                  </button>
                  <button
                    onClick={() => setEmailModal({ type: 'statement', id: customer.id, email: customer.email ?? '', label, viewType: tab as 'activity' | 'open' })}
                    className="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1"
                    title={`Email ${label}`}
                  >
                    <Mail size={14} /> Email
                  </button>
                </div>
              )}
            </div>

            {stmtLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Loading statement…</div>
            ) : !currentData || currentData.lines.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                {tab === 'open' ? 'No open transactions' : 'No statement activity'}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-left px-5 py-3">Type</th>
                      <th className="text-left px-5 py-3">Reference</th>
                      <th className="text-left px-5 py-3">Document #</th>
                      <th className="text-right px-5 py-3">Charges</th>
                      <th className="text-right px-5 py-3">Credits</th>
                      <th className="text-right px-5 py-3">Applied</th>
                      <th className="text-right px-5 py-3">Balance</th>
                      <th className="px-3 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {currentData.lines.map((line, i) => {
                      const balanceVal = tab === 'open' ? Number(line.remaining) : Number(line.balance)
                      const lineKey = line.type === 'PAYMENT' ? line.paymentId : line.reference
                      const isCM = line.type === 'CREDIT_MEMO'
                      const isInv = line.type === 'INVOICE'
                      const isPay = line.type === 'PAYMENT'

                      // Determine allocations for this row
                      const rowAllocs: AllocationDetail[] | undefined =
                        isCM ? line.creditMemoAllocations
                        : isInv ? line.invoiceAllocations
                        : isPay ? line.paymentAllocations
                        : undefined
                      const hasAllocs = rowAllocs && rowAllocs.length > 0

                      // Unique expand key per row
                      const expandKey = isCM ? line.creditMemoId : isInv ? line.orderId : isPay ? line.paymentId : undefined
                      const isExpanded = expandKey ? expandedRows.has(expandKey) : false

                      // Status badge
                      let statusLabel: string | null = null
                      let statusColor = ''
                      if (isCM && line.creditMemoStatus) {
                        statusLabel = line.creditMemoStatus === 'APPLIED' ? 'Applied'
                          : line.creditMemoStatus === 'PARTIALLY_APPLIED' ? 'Partially Applied'
                          : 'Unapplied'
                        statusColor = line.creditMemoStatus === 'APPLIED' ? 'bg-green-100 text-green-700'
                          : line.creditMemoStatus === 'PARTIALLY_APPLIED' ? 'bg-orange-100 text-orange-700'
                          : 'bg-gray-100 text-gray-600'
                      } else if (isInv && line.orderStatus) {
                        statusLabel = line.orderStatus === 'PAID' ? 'Paid'
                          : line.orderStatus === 'PARTIALLY_PAID' ? 'Partially Paid'
                          : 'Open'
                        statusColor = line.orderStatus === 'PAID' ? 'bg-green-100 text-green-700'
                          : line.orderStatus === 'PARTIALLY_PAID' ? 'bg-orange-100 text-orange-700'
                          : 'bg-yellow-100 text-yellow-700'
                      } else if (isPay) {
                        const unalloc = Number(line.remaining)
                        const total = Number(line.credits)
                        if (unalloc <= 0.005) {
                          statusLabel = 'Fully Applied'; statusColor = 'bg-green-100 text-green-700'
                        } else if (unalloc < total - 0.005) {
                          statusLabel = 'Partially Applied'; statusColor = 'bg-orange-100 text-orange-700'
                        } else {
                          statusLabel = 'Unapplied'; statusColor = 'bg-gray-100 text-gray-600'
                        }
                      }

                      // Expand color per type
                      const expandBg = isCM ? 'bg-purple-50/50' : isInv ? 'bg-yellow-50/50' : 'bg-green-50/50'
                      const expandBorder = isCM ? 'border-purple-200' : isInv ? 'border-yellow-200' : 'border-green-200'
                      const expandHeadBg = isCM ? 'bg-purple-100/60 text-purple-700' : isInv ? 'bg-yellow-100/60 text-yellow-700' : 'bg-green-100/60 text-green-700'
                      const expandDivider = isCM ? 'divide-purple-100' : isInv ? 'divide-yellow-100' : 'divide-green-100'
                      const expandHover = isCM ? 'hover:bg-purple-50' : isInv ? 'hover:bg-yellow-50' : 'hover:bg-green-50'

                      // Column header for expanded sub-table
                      const allocColHeader = isInv ? 'Payment / Credit' : 'Applied To Invoice'

                      return (
                      <React.Fragment key={i}>
                      <tr
                        className={`${isPay ? 'bg-green-50/30' : isCM ? 'bg-purple-50/30' : ''} ${hasAllocs ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if (hasAllocs && expandKey) {
                            setExpandedRows((prev) => {
                              const next = new Set(prev)
                              if (next.has(expandKey)) next.delete(expandKey)
                              else next.add(expandKey)
                              return next
                            })
                          }
                        }}
                      >
                        <td className="px-5 py-2.5 text-gray-500">
                          <div className="flex items-center gap-1.5">
                            {hasAllocs && (
                              <span className={`text-[10px] text-gray-400 transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                            )}
                            {new Date(line.date).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              isInv ? 'bg-yellow-100 text-yellow-700'
                                : isCM ? 'bg-purple-100 text-purple-700'
                                : 'bg-green-100 text-green-700'
                            }`}>{isCM ? 'CREDIT MEMO' : line.type}</span>
                            {statusLabel && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor}`}>{statusLabel}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{line.reference}</td>
                        <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{line.invoiceNumber ?? ''}</td>
                        <td className="px-5 py-2.5 text-right">{line.charges > 0 ? fmt(line.charges) : ''}</td>
                        <td className="px-5 py-2.5 text-right text-green-600">{line.credits > 0 ? fmt(line.credits) : ''}</td>
                        <td className="px-5 py-2.5 text-right text-gray-500">{Number(line.applied) > 0 ? fmt(Number(line.applied)) : ''}</td>
                        <td className="px-5 py-2.5 text-right font-semibold">{fmt(balanceVal)}</td>
                        <td className="px-3 py-2.5 text-center">
                          {lineKey && (
                            <div className="flex items-center gap-1 justify-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isInv) downloadInvoicePDF(line.reference)
                                  else if (isCM) downloadCreditMemoPDF(line.invoiceNumber ?? line.reference)
                                  else if (line.paymentId) downloadPaymentReceipt(line.paymentId)
                                }}
                                disabled={downloading === lineKey}
                                className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
                                title={isInv ? 'Download Invoice PDF' : isCM ? 'Download Credit Memo PDF' : 'Download Payment Receipt'}
                              >
                                {downloading === lineKey ? <span className="text-xs">...</span> : <Download size={14} />}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isInv) {
                                    if (line.orderId) setEmailModal({ type: 'invoice', id: line.orderId, email: customer.email ?? '', label: 'Invoice' })
                                  } else if (isCM) {
                                    if (line.creditMemoId) setEmailModal({ type: 'credit-memo', id: line.creditMemoId, email: customer.email ?? '', label: 'Credit Memo' })
                                  } else if (line.paymentId) {
                                    setEmailModal({ type: 'payment', id: line.paymentId, email: customer.email ?? '', label: 'Payment Receipt' })
                                  }
                                }}
                                className="text-gray-400 hover:text-blue-600"
                                title={`Email ${isInv ? 'Invoice' : isCM ? 'Credit Memo' : 'Payment Receipt'}`}
                              >
                                <Mail size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isExpanded && rowAllocs && rowAllocs.length > 0 && (
                        <tr className={expandBg}>
                          <td colSpan={9} className="px-5 py-0 pb-3">
                            <div className={`ml-6 mt-1 border ${expandBorder} rounded-lg overflow-hidden`}>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className={`text-[10px] font-medium uppercase tracking-wide ${expandHeadBg}`}>
                                    <th className="text-left px-4 py-1.5">{allocColHeader}</th>
                                    <th className="text-left px-4 py-1.5">Type</th>
                                    <th className="text-right px-4 py-1.5">Amount</th>
                                    <th className="text-left px-4 py-1.5">Date</th>
                                  </tr>
                                </thead>
                                <tbody className={`divide-y ${expandDivider}`}>
                                  {rowAllocs.map((alloc) => {
                                    const linkUrl = alloc.linkType === 'order'
                                      ? `/wholesale/orders/${alloc.linkId}`
                                      : alloc.linkType === 'credit-memo'
                                      ? `/wholesale/credit-memo/${alloc.linkId}`
                                      : undefined
                                    const typeBadge = alloc.linkType === 'payment'
                                      ? { label: 'Payment', cls: 'bg-green-100 text-green-700' }
                                      : alloc.linkType === 'credit-memo'
                                      ? { label: 'Credit', cls: 'bg-purple-100 text-purple-700' }
                                      : { label: 'Invoice', cls: 'bg-yellow-100 text-yellow-700' }
                                    return (
                                      <tr key={alloc.id} className={expandHover}>
                                        <td className="px-4 py-1.5">
                                          {linkUrl ? (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); router.push(linkUrl) }}
                                              className="font-mono text-orange-600 hover:text-orange-700 hover:underline"
                                            >
                                              {alloc.label}
                                            </button>
                                          ) : (
                                            <span className="font-mono text-gray-600">{alloc.label}</span>
                                          )}
                                        </td>
                                        <td className="px-4 py-1.5">
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeBadge.cls}`}>{typeBadge.label}</span>
                                        </td>
                                        <td className="px-4 py-1.5 text-right text-green-700 font-medium">{fmt(alloc.amount)}</td>
                                        <td className="px-4 py-1.5 text-gray-500">{new Date(alloc.date).toLocaleDateString()}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )})}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

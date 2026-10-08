'use client'
import { useState, useEffect, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Package, MapPin, Truck, Hash, FileText, Printer,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, RotateCcw, Landmark, Smartphone, ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import { generateOrderInvoicePDF } from '@/lib/generate-order-invoice'
import CreateReturnModal from './CreateMarketplaceReturnModal'
import CreateReplacementOrderModal from './CreateReplacementOrderModal'
import SickwCheckButton from './SickwCheckButton'
import type { OrderSearchResult } from './CreateMarketplaceReturnModal'

// ─── Badge maps ────────────────────────────────────────────────────────────────

const WORKFLOW_BADGE: Record<string, string> = {
  PENDING:               'bg-yellow-100 text-yellow-800 border border-yellow-200',
  PROCESSING:            'bg-blue-100 text-blue-800 border border-blue-200',
  AWAITING_VERIFICATION: 'bg-purple-100 text-purple-800 border border-purple-200',
  SHIPPED:               'bg-green-100 text-green-800 border border-green-200',
  CANCELLED:             'bg-red-100 text-red-800 border border-red-200',
}
const WORKFLOW_LABEL: Record<string, string> = {
  PENDING: 'Pending', PROCESSING: 'Unshipped', AWAITING_VERIFICATION: 'Awaiting Verification',
  SHIPPED: 'Shipped', CANCELLED: 'Cancelled',
}
const SOURCE_COLOR: Record<string, string> = {
  amazon:     'bg-orange-100 text-orange-800 border border-orange-200',
  backmarket: 'bg-blue-100 text-blue-800 border border-blue-200',
  wholesale:  'bg-emerald-100 text-emerald-800 border border-emerald-200',
}
const FULFILLMENT_LABEL: Record<string, string> = {
  MFN: 'Merchant (MFN)', AFN: 'Amazon FBA',
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string; orderItemId: string; asin: string | null; sellerSku: string | null
  title: string | null; quantityOrdered: number; quantityShipped: number
  itemPrice: string | null; itemTax: string | null; shippingPrice: string | null
  bmSerials?: string[]
}
interface Label {
  trackingNumber: string; carrier: string | null; serviceCode: string | null
  shipmentCost: string | null; createdAt: string; isTest: boolean
}
interface SerialAssignment {
  id: string; orderItemId: string
  inventorySerial: { serialNumber: string; product: { sku: string } | null }
  orderItem: { sellerSku: string | null }
}
interface RMASerial {
  id: string; serialNumber: string; receivedAt: string | null; note: string | null
  location: { name: string; warehouse: { name: string } } | null
  grade: { grade: string } | null
}
interface RMAItem {
  id: string; sellerSku: string | null; title: string | null
  quantityReturned: number; returnReason: string | null
  serials: RMASerial[]
}
interface RMA {
  id: string; rmaNumber: string; status: string; notes: string | null; createdAt: string
  items: RMAItem[]
}
interface SickwCheck {
  id: string; imei: string; serviceName: string; status: string
  result: string | null; cost: number | null; source: string | null; createdAt: string
}
interface MfnReturn {
  id: string; rmaId: string | null; merchantRmaId: string | null
  returnReason: string | null; buyerComment: string | null; returnStatus: string | null; resolution: string | null
  returnDate: string | null; returnDeliveryDate: string | null
  trackingNumber: string | null; returnCarrier: string | null
  carrierStatus: string | null; deliveredAt: string | null; estimatedDelivery: string | null; trackingUpdatedAt: string | null
  refundedAmount: number | null; sku: string | null; title: string | null; quantity: number | null
  fmiStatus: string | null
}
interface FreeReplacement {
  id: string; replacementOrderId: string; originalOrderId: string
  title: string | null; asin: string | null; shippedAt: string | null
  returnTrackingNumber: string | null; returnCarrierStatus: string | null
}
interface RefundIssued {
  id: string; amount: number; currency: string; reason: string
  feedId: string | null; feedStatus: string | null; feedResult?: string | null; issuedByEmail: string | null; createdAt: string
}
interface FullOrder {
  id: string; olmNumber: number | null; amazonOrderId: string; orderSource: string
  orderStatus: string; workflowStatus: string; purchaseDate: string; lastUpdateDate: string
  orderTotal: string | null; currency: string | null; fulfillmentChannel: string | null
  shipmentServiceLevel: string | null; isPrime: boolean
  shipToName: string | null; shipToAddress1: string | null; shipToAddress2: string | null
  shipToCity: string | null; shipToState: string | null; shipToPostal: string | null
  shipToCountry: string | null; shipToPhone: string | null
  items: OrderItem[]; label: Label | null; serialAssignments: SerialAssignment[]
  marketplaceRMAs: RMA[]; sickwChecks: SickwCheck[]
  mfnReturns?: MfnReturn[]; freeReplacements?: FreeReplacement[]; refundsIssued?: RefundIssued[]
  customerPo?: string | null; shippedAt?: string | null; shipCarrier?: string | null; shipTracking?: string | null
}

// ─── Section card helper ───────────────────────────────────────────────────────

function Section({ title, icon, children, check }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; check?: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
        <h3 className="text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          {icon}{title}
          {check && <CheckCircle2 size={15} className="text-green-600 shrink-0" aria-label="yes" />}
        </h3>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 dark:text-white font-medium text-right">{value ?? '—'}</span>
    </div>
  )
}

function fmt(amount: string | null | undefined): string {
  if (!amount) return '$0.00'
  const n = parseFloat(amount)
  return isNaN(n) ? '$0.00' : `$${n.toFixed(2)}`
}

function fmtD(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Client-side carrier detection + tracking URL (mirrors @/lib/ups-tracking, which
// is server-only — can't be imported here).
function carrierOf(tracking: string): 'UPS' | 'FEDEX' | 'USPS' | 'UNKNOWN' {
  const t = tracking.replace(/\s+/g, '').toUpperCase()
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return 'UPS'
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t) || /^\d{20,22}$/.test(t)) return 'FEDEX'
  if (/^(9\d{21,25})$/.test(t)) return 'USPS'
  return 'UNKNOWN'
}
function trackingHref(tracking: string): string {
  const t = encodeURIComponent(tracking.trim())
  switch (carrierOf(tracking)) {
    case 'UPS':   return `https://www.ups.com/track?loc=en_US&tracknum=${t}`
    case 'FEDEX': return `https://www.fedex.com/fedextrack/?trknbr=${t}`
    case 'USPS':  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`
    default:      return `https://www.google.com/search?q=${t}`
  }
}

// ─── Live outbound-shipment tracking (UPS / FedEx) ──────────────────────────
function ShipmentTracking({ tracking }: { tracking: string }) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<{ status: string | null; deliveredAt: string | null; estimatedDelivery: string | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/tracking/status?tracking=${encodeURIComponent(tracking)}`)
      const d = await res.json()
      if (!res.ok || d.error) { setErr(d.error ?? 'Tracking unavailable'); setData(null) }
      else setData({ status: d.status ?? null, deliveredAt: d.deliveredAt ?? null, estimatedDelivery: d.estimatedDelivery ?? null })
    } catch { setErr('Tracking unavailable') }
    finally { setBusy(false); setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [tracking])

  const delivered = !!data?.deliveredAt
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/10 flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <a href={trackingHref(tracking)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-amazon-blue hover:underline break-all">{tracking}</a>
        <span className="text-[10px] text-gray-400 shrink-0">{carrierOf(tracking)}</span>
        {loading ? (
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> checking…</span>
        ) : data?.status ? (
          <span className={clsx('text-[11px] px-1.5 py-0.5 rounded font-semibold', delivered ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
            {delivered ? `Delivered ${fmtD(data.deliveredAt)}` : data.status}
          </span>
        ) : err ? (
          <span className="text-[11px] text-gray-400">{err}</span>
        ) : null}
        {!delivered && data?.estimatedDelivery && <span className="text-[11px] text-gray-500">Est. {fmtD(data.estimatedDelivery)}</span>}
      </div>
      <button onClick={load} disabled={busy} title="Refresh live carrier tracking" className="text-[11px] text-gray-500 hover:text-amazon-blue inline-flex items-center gap-1 disabled:opacity-50 shrink-0">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Refresh
      </button>
    </div>
  )
}

// ─── Amazon refund confirmation modal ───────────────────────────────────────
interface RefundEligible { source: string; currency: string; principal: number; tax: number; shipping: number; regulatoryFee: number }

function AmazonRefundModal({ order, onClose, onDone }: {
  order: FullOrder; onClose: () => void; onDone: () => void
}) {
  const [elig, setElig] = useState<RefundEligible | null>(null)
  const [eligLoading, setEligLoading] = useState(true)
  const [amountStr, setAmountStr] = useState('')
  const [reason, setReason] = useState<'CustomerReturn' | 'GeneralAdjustment' | 'CouldNotShip'>('CustomerReturn')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [ackReplacement, setAckReplacement] = useState(false)

  // Warn when the order's Amazon return is set to be resolved by a Replacement —
  // refunding on top of a replacement is usually a mistake.
  const replacementReturn = (order.mfnReturns ?? []).find(r => (r.resolution ?? '').toLowerCase().includes('replace'))

  // Prepopulate with the true item price (principal, no tax, no regulatory fee).
  useEffect(() => {
    let cancel = false
    fetch(`/api/orders/${order.id}/refund-eligible`)
      .then(r => r.json())
      .then(d => {
        if (cancel || d?.error) return
        setElig(d)
        if (typeof d.principal === 'number') setAmountStr(d.principal.toFixed(2))
      })
      .catch(() => {})
      .finally(() => { if (!cancel) setEligLoading(false) })
    return () => { cancel = true }
  }, [order.id])

  const amount = parseFloat(amountStr) || 0

  async function submit(force = false) {
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/refund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'custom', customAmount: amount, reason, force }),
      })
      const data = await res.json()
      if (res.status === 409 && data.alreadyIssued) { setConflict(true); setErr(data.error); return }
      if (!res.ok) throw new Error(data.error ?? 'Refund failed')
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Refund failed') }
    finally { setSubmitting(false) }
  }

  const cur = elig?.currency ?? 'USD'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-white/10 flex items-center gap-2">
          <RotateCcw size={15} className="text-red-600" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Refund on Amazon</h3>
          <span className="ml-auto text-xs font-mono text-gray-400">{order.amazonOrderId}</span>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 text-xs text-red-700 dark:text-red-300">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            This issues a <strong>real, irreversible refund</strong> to the buyer via Amazon. It is submitted as a payment-adjustment feed and cannot be undone.
          </div>

          {/* Replacement-resolution warning */}
          {replacementReturn && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/50 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">This order’s return resolution is “Replacement”.</p>
                <p className="mt-0.5">Are you sure you want to continue issuing the refund, even though the Return Resolution is Replacement?</p>
                <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer font-medium">
                  <input type="checkbox" checked={ackReplacement} onChange={e => setAckReplacement(e.target.checked)} />
                  Yes, issue the refund anyway
                </label>
              </div>
            </div>
          )}

          {/* Refundable breakdown */}
          <div className="rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2 text-xs space-y-1">
            {eligLoading ? (
              <div className="flex items-center gap-2 text-gray-500"><Loader2 size={13} className="animate-spin" /> Calculating refundable amount…</div>
            ) : elig ? (
              <>
                <div className="flex justify-between"><span className="text-gray-500">Item price (principal)</span><span className="font-semibold text-gray-900 dark:text-white">${elig.principal.toFixed(2)}</span></div>
                {elig.shipping > 0 && <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span>${elig.shipping.toFixed(2)}</span></div>}
                <div className="flex justify-between text-gray-400"><span>Tax (Amazon refunds automatically)</span><span>${elig.tax.toFixed(2)}</span></div>
                {elig.regulatoryFee > 0 && <div className="flex justify-between text-gray-400"><span>Regulatory fee (not refundable)</span><span>${elig.regulatoryFee.toFixed(2)}</span></div>}
                {elig.source === 'stored' && (
                  <div className="text-[10px] text-amber-600 pt-0.5">Couldn’t read live charges — showing stored item price; verify the amount before refunding.</div>
                )}
              </>
            ) : (
              <div className="text-gray-400">Enter the item price to refund.</div>
            )}
          </div>

          {/* Amount — prepopulated with the item price (no tax) */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 shrink-0">Refund amount</span>
            <span className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
              <input type="text" inputMode="decimal" value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
                className="w-28 h-7 pl-5 pr-2 text-xs rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800" />
            </span>
            <span className="text-[10px] text-gray-400">item price, no tax</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Reason</span>
            <select value={reason} onChange={e => setReason(e.target.value as typeof reason)}
              className="h-7 px-2 text-xs rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-gray-800">
              <option value="CustomerReturn">Customer return</option>
              <option value="GeneralAdjustment">General adjustment</option>
              <option value="CouldNotShip">Could not ship</option>
            </select>
          </div>
          {err && (
            <div className="flex items-start gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-amber-800 dark:text-amber-300 text-[11px]">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />{err}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 dark:border-white/10 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-white/15 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5">Cancel</button>
          {conflict ? (
            <button onClick={() => submit(true)} disabled={submitting}
              className="px-3 py-1.5 text-xs bg-red-700 text-white rounded-lg hover:bg-red-800 disabled:opacity-50 flex items-center gap-1.5">
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <AlertCircle size={13} />} Refund again anyway
            </button>
          ) : (
            <button onClick={() => submit(false)} disabled={submitting || eligLoading || !(amount > 0) || (!!replacementReturn && !ackReplacement)}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Issue refund {cur === 'USD' ? '$' : ''}{amount.toFixed(2)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SICKW / FMI result parsing ──────────────────────────────────────────────

/** Derive the iCloud/FMI verdict from a raw SICKW result string (same patterns
 *  as SickwCheckButton, tolerating HTML-wrapped values). */
function parseFmiVerdict(result: string): 'ON' | 'OFF' | 'UNKNOWN' {
  const patterns = [
    /iCloud Lock:\s*(?:<[^>]*>|\s)*(ON|OFF)/i,
    /Find My (?:iPhone|iPad|Mac|iPod):\s*(?:<[^>]*>|\s)*(ON|OFF)/i,
    /FMI:\s*(?:<[^>]*>|\s)*(ON|OFF)/i,
    /Find My:\s*(?:<[^>]*>|\s)*(ON|OFF)/i,
    /iCloud Status:\s*(?:<[^>]*>|\s)*(ON|OFF|Clean|Lost|Locked)/i,
  ]
  for (const pat of patterns) {
    const m = result.match(pat)
    if (m) {
      const val = m[1].toUpperCase()
      return val === 'CLEAN' || val === 'OFF' ? 'OFF' : 'ON'
    }
  }
  return 'UNKNOWN'
}

/** Human-readable text from the stored JSON result (strips SICKW's HTML). */
function extractResultText(raw: string | null): string {
  if (!raw) return '—'
  try {
    const obj = JSON.parse(raw)
    const inner = typeof obj?.result === 'string' ? obj.result
      : typeof obj?.error === 'string' ? obj.error
      : raw
    return inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim() || raw
  } catch {
    return raw
  }
}

const SICKW_SOURCE_LABEL: Record<string, { label: string; cls: string }> = {
  manual:      { label: 'Manual',          cls: 'bg-blue-100 text-blue-800 border border-blue-200' },
  auto_return: { label: 'Auto (Return)',   cls: 'bg-purple-100 text-purple-800 border border-purple-200' },
}

// ─── Main component ────────────────────────────────────────────────────────────

type BmEntry = { order_id: string; orderline_id: string | null; invoice_key: string; amount: number }

const BM_KEY_LABEL: Record<string, string> = {
  sales: 'Sale', sales_fees: 'Commission', payment_fees: 'Payment fee',
  affirm_fees: 'Payment fee (Affirm)', paypal_fees: 'Payment fee (PayPal)', klarna_fees: 'Payment fee (Klarna)',
  ccbm_fees: 'Customer Care fee', deals_commission_discount: 'Commission discount',
  avoir_sales_fees: 'Commission refund', credit_requests: 'Credit request', refunds: 'Refund',
  monthly_fees: 'Monthly membership fee', manual_reimbursement: 'Seller Compensation Reimbursement',
  sales_dp_adjustment: 'Adjustment (+)',
  dp_adjustment_fee: 'Adjustment (−)', dp_adjustment_fee_refund: 'Adjustment reversal',
}
const bmMoney = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function OrderDetailView({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [order, setOrder] = useState<FullOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [returnModalOrder, setReturnModalOrder] = useState<OrderSearchResult | null>(null)
  const [returnLoading, setReturnLoading] = useState(false)
  const [bmEntries, setBmEntries] = useState<BmEntry[]>([])
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set())
  const [showReplacementModal, setShowReplacementModal] = useState(false)
  const [showRefundModal, setShowRefundModal] = useState(false)
  const [trackingBusy, setTrackingBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/orders/${orderId}`)
      .then(r => { if (!r.ok) throw new Error(r.status === 404 ? 'Order not found' : 'Failed to load order'); return r.json() })
      .then(j => setOrder(j.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [orderId])

  // Re-fetch the order (used after issuing a refund) without the full-page spinner.
  function reload() {
    fetch(`/api/orders/${orderId}`)
      .then(r => r.json())
      .then(j => setOrder(j.data))
      .catch(() => {})
  }

  // Pull live carrier status for one return's tracking number and patch it in place.
  async function refreshReturnTracking(returnId: string) {
    setTrackingBusy(returnId)
    try {
      const res = await fetch(`/api/returns/${returnId}/tracking`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Tracking lookup failed')
      setOrder(prev => prev ? {
        ...prev,
        mfnReturns: (prev.mfnReturns ?? []).map(r => r.id === returnId
          ? { ...r, carrierStatus: data.carrierStatus, deliveredAt: data.deliveredAt, estimatedDelivery: data.estimatedDelivery, trackingUpdatedAt: data.trackingUpdatedAt }
          : r),
      } : prev)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Tracking lookup failed')
    } finally {
      setTrackingBusy(null)
    }
  }

  // First time an order with a return tracking # is opened and we have no cached
  // carrier status, fetch it once so the view shows live tracking immediately.
  useEffect(() => {
    if (!order) return
    const needs = (order.mfnReturns ?? []).find(r => r.trackingNumber && !r.carrierStatus)
    if (needs) refreshReturnTracking(needs.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id])

  // Load this order's BackMarket accounting entries (for the Financials panel).
  useEffect(() => {
    if (order?.orderSource !== 'backmarket' || !order.amazonOrderId) return
    const oid = order.amazonOrderId
    fetch(`/api/backmarket/billing-entries?search=${encodeURIComponent(oid)}&pageSize=200`)
      .then(r => r.json())
      .then(d => setBmEntries((d.data ?? []).filter((e: BmEntry) => e.order_id === oid)))
      .catch(() => {})
  }, [order?.orderSource, order?.amazonOrderId])

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-gray-500">
      <Loader2 size={20} className="animate-spin" /> Loading order...
    </div>
  )
  if (error || !order) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <AlertCircle size={32} className="text-red-400" />
      <p className="text-sm text-gray-600 dark:text-gray-400">{error ?? 'Order not found'}</p>
      <button onClick={() => router.back()} className="text-sm text-amazon-blue hover:underline">Go back</button>
    </div>
  )

  const isShipped = order.workflowStatus === 'SHIPPED'
  // itemPrice is the line total (all units), so sum it directly — no × qty.
  const itemsSubtotal = order.items.reduce((s, i) => s + (i.itemPrice ? parseFloat(i.itemPrice) : 0), 0)
  const taxTotal = order.items.reduce((s, i) => s + (i.itemTax ? parseFloat(i.itemTax) : 0), 0)
  const shippingSubtotal = order.items.reduce((s, i) => s + (i.shippingPrice ? parseFloat(i.shippingPrice) : 0), 0)
  const orderTotalNum = order.orderTotal ? parseFloat(order.orderTotal) : itemsSubtotal + taxTotal + shippingSubtotal

  async function handlePrintInvoice() {
    if (!order) return
    await generateOrderInvoicePDF({
      amazonOrderId: order.amazonOrderId,
      olmNumber: order.olmNumber,
      purchaseDate: order.purchaseDate,
      orderTotal: order.orderTotal,
      currency: order.currency,
      shipToName: order.shipToName,
      shipToAddress1: order.shipToAddress1,
      shipToAddress2: order.shipToAddress2,
      shipToCity: order.shipToCity,
      shipToState: order.shipToState,
      shipToPostal: order.shipToPostal,
      shipToCountry: order.shipToCountry,
      items: order.items.map(i => ({
        id: i.id, orderItemId: i.orderItemId, sellerSku: i.sellerSku,
        title: i.title, quantityOrdered: i.quantityOrdered, itemPrice: i.itemPrice, itemTax: i.itemTax, shippingPrice: i.shippingPrice,
      })),
      serialAssignments: order.serialAssignments.map(sa => ({
        orderItemId: sa.orderItemId,
        inventorySerial: { serialNumber: sa.inventorySerial.serialNumber },
      })),
      label: order.label ? {
        trackingNumber: order.label.trackingNumber,
        carrier: order.label.carrier,
        serviceCode: order.label.serviceCode,
        shipmentCost: order.label.shipmentCost,
      } : null,
      customerPo: order.customerPo,
      shippedAt: order.shippedAt,
      shipCarrier: order.shipCarrier,
      shipTracking: order.shipTracking,
      orderSource: order.orderSource,
    })
  }

  async function handleOpenReturnModal() {
    if (!order) return
    setReturnLoading(true)
    try {
      const res = await fetch(`/api/marketplace-rma/order-search?q=${encodeURIComponent(order.amazonOrderId)}`)
      const json = await res.json()
      const match = (json.data ?? []).find((o: OrderSearchResult) => o.id === order.id)
      if (!match) throw new Error('Order not found in search results')
      setReturnModalOrder(match)
    } catch {
      alert('Failed to load order details for return')
    }
    setReturnLoading(false)
  }

  function handleReturnCreated() {
    setReturnModalOrder(null)
    // Re-fetch order to refresh Returns section
    fetch(`/api/orders/${orderId}`)
      .then(r => r.json())
      .then(j => setOrder(j.data))
      .catch(() => {})
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors shrink-0">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {order.olmNumber && (
              <span className="text-sm font-bold bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white px-2 py-0.5 rounded">
                OLM-{order.olmNumber}
              </span>
            )}
            <span className="text-sm font-mono text-gray-500">{order.amazonOrderId}</span>
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium capitalize', SOURCE_COLOR[order.orderSource] ?? 'bg-gray-100 text-gray-600')}>
              {order.orderSource}
            </span>
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', WORKFLOW_BADGE[order.workflowStatus] ?? 'bg-gray-100 text-gray-600')}>
              {WORKFLOW_LABEL[order.workflowStatus] ?? order.workflowStatus}
            </span>
            {order.isPrime && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-[#00A8E1] text-white flex items-center gap-0.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Prime
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isShipped && (
            <button
              onClick={handleOpenReturnModal}
              disabled={returnLoading}
              className="flex items-center gap-1.5 text-xs font-medium bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/40 px-3 py-1.5 rounded-md transition-colors"
            >
              <RotateCcw size={14} /> {returnLoading ? 'Loading...' : 'Create Return'}
            </button>
          )}
          {order.orderSource === 'backmarket' && (
            <button
              onClick={() => setShowReplacementModal(true)}
              className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700/40 px-3 py-1.5 rounded-md transition-colors"
            >
              <RotateCcw size={14} /> Create Replacement Order
            </button>
          )}
          {order.orderSource === 'amazon' && (
            <button
              onClick={() => setShowRefundModal(true)}
              title="Issue a refund to the buyer via the Amazon API"
              className="flex items-center gap-1.5 text-xs font-medium bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700/40 px-3 py-1.5 rounded-md transition-colors"
            >
              <RotateCcw size={14} /> Refund on Amazon
            </button>
          )}
          <button
            onClick={handlePrintInvoice}
            className="flex items-center gap-1.5 text-xs font-medium bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-md transition-colors"
          >
            <Printer size={14} /> Print Invoice
          </button>
        </div>
      </div>

      {/* Banner for non-shipped orders */}
      {!isShipped && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40">
          <AlertCircle size={16} className="text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            This order has not shipped yet. Some details (tracking, serials) may not be available.
            Edits can be made from the <button onClick={() => router.push('/unshipped-orders')} className="underline font-medium">Fulfillment</button> page.
          </p>
        </div>
      )}

      {/* ── Two-column layout ───────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-6">

        {/* Sidebar */}
        <div className="lg:w-56 shrink-0 space-y-4">
          <Section title="Order Info" icon={<FileText size={12} />}>
            <div className="space-y-0.5">
              <KV label="Order Date" value={new Date(order.purchaseDate).toLocaleDateString()} />
              <KV label="Last Updated" value={new Date(order.lastUpdateDate).toLocaleDateString()} />
              {order.fulfillmentChannel && (
                <KV label="Fulfillment" value={FULFILLMENT_LABEL[order.fulfillmentChannel] ?? order.fulfillmentChannel} />
              )}
              {order.shipmentServiceLevel && (
                <KV label="Service Level" value={order.shipmentServiceLevel} />
              )}
            </div>
            <div className="border-t border-gray-200 dark:border-white/10 mt-2 pt-2 space-y-0.5">
              <KV label="Items Subtotal" value={fmt(String(itemsSubtotal))} />
              {taxTotal > 0 && <KV label="Tax" value={fmt(String(taxTotal))} />}
              {shippingSubtotal > 0 && <KV label="Shipping" value={fmt(String(shippingSubtotal))} />}
              <div className="flex justify-between text-xs py-1 font-bold">
                <span className="text-gray-700 dark:text-gray-300">Order Total</span>
                <span className="text-gray-900 dark:text-white">{fmt(String(orderTotalNum))}</span>
              </div>
            </div>
          </Section>

          {/* BackMarket accounting entries for this order */}
          {order.orderSource === 'backmarket' && bmEntries.length > 0 && (
            <Section title="BackMarket Financials" icon={<Landmark size={12} />}>
              <div className="space-y-0.5">
                {bmEntries.map((e, i) => (
                  <div key={i} className="flex justify-between gap-2 text-[11px] py-0.5">
                    <span className="text-gray-500 dark:text-gray-400 truncate" title={e.orderline_id ? `Line #${e.orderline_id}` : e.invoice_key}>
                      {BM_KEY_LABEL[e.invoice_key] ?? e.invoice_key}
                    </span>
                    <span className={clsx('tabular-nums shrink-0', e.amount < 0 ? 'text-red-600' : 'text-green-700')}>{bmMoney(e.amount)}</span>
                  </div>
                ))}
                <div className="border-t border-gray-200 dark:border-white/10 mt-1 pt-1 flex justify-between text-[11px] font-bold">
                  <span className="text-gray-700 dark:text-gray-300">Net Payout</span>
                  <span className="text-gray-900 dark:text-white tabular-nums">{bmMoney(bmEntries.reduce((s, e) => s + e.amount, 0))}</span>
                </div>
              </div>
            </Section>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-4">

          {/* Ship To */}
          <Section title="Ship To" icon={<MapPin size={12} />}>
            {order.shipToName ? (
              <div className="text-sm space-y-0.5">
                <p className="font-semibold text-gray-900 dark:text-white">{order.shipToName}</p>
                {order.shipToAddress1 && <p className="text-gray-600 dark:text-gray-400">{order.shipToAddress1}</p>}
                {order.shipToAddress2 && <p className="text-gray-600 dark:text-gray-400">{order.shipToAddress2}</p>}
                <p className="text-gray-600 dark:text-gray-400">
                  {[order.shipToCity, order.shipToState ? `${order.shipToState} ${order.shipToPostal ?? ''}`.trim() : order.shipToPostal].filter(Boolean).join(', ')}
                </p>
                {order.shipToCountry && order.shipToCountry !== 'US' && (
                  <p className="text-gray-600 dark:text-gray-400">{order.shipToCountry}</p>
                )}
                {order.shipToPhone && <p className="text-gray-500 text-xs mt-1">{order.shipToPhone}</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No address on file</p>
            )}
          </Section>

          {/* Items Ordered */}
          <Section title="Items Ordered" icon={<Package size={12} />}>
            <div className="overflow-x-auto -mx-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                    <th className="px-4 py-2">SKU</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">ASIN</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Ext Price</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map(item => {
                    // itemPrice is stored as the LINE TOTAL (all units), matching
                    // Amazon's SP-API ItemPrice and how BackMarket line prices sync.
                    // Ext Price = line total; unit Price = line total / qty.
                    const lineTotal = item.itemPrice ? parseFloat(item.itemPrice) : 0
                    const qty = item.quantityOrdered || 1
                    const unitPrice = lineTotal / qty
                    return (
                      <tr key={item.id} className="border-b border-gray-100 dark:border-white/5">
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">{item.sellerSku ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400 max-w-[250px] truncate">{item.title ?? '—'}</td>
                        <td className="px-4 py-2 font-mono text-gray-500">{item.asin ?? '—'}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{item.quantityOrdered}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{item.itemPrice ? fmt(String(unitPrice)) : '—'}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-white">{item.itemPrice ? fmt(String(lineTotal)) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Shipment */}
          {order.label ? (
            <Section title="Shipment" icon={<Truck size={12} />}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-gray-500 mb-0.5">Carrier</p>
                  <p className="font-medium text-gray-900 dark:text-white">{order.label.carrier ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-0.5">Service</p>
                  <p className="font-medium text-gray-900 dark:text-white">{order.label.serviceCode ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-0.5">Cost</p>
                  <p className="font-medium text-gray-900 dark:text-white">{fmt(order.label.shipmentCost)}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-0.5">Tracking</p>
                  <p className="font-mono font-medium text-gray-900 dark:text-white break-all">{order.label.trackingNumber}</p>
                </div>
              </div>
              {order.label.isTest && (
                <span className="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Test Label</span>
              )}
              {order.label.trackingNumber && !order.label.isTest && <ShipmentTracking tracking={order.label.trackingNumber} />}
            </Section>
          ) : order.shipTracking ? (
            <Section title="Shipment" icon={<Truck size={12} />}>
              <div className="grid grid-cols-2 gap-4 text-xs">
                {order.shipCarrier && (
                  <div>
                    <p className="text-gray-500 mb-0.5">Carrier</p>
                    <p className="font-medium text-gray-900 dark:text-white">{order.shipCarrier}</p>
                  </div>
                )}
                <div>
                  <p className="text-gray-500 mb-0.5">Tracking</p>
                  <p className="font-mono font-medium text-gray-900 dark:text-white break-all">{order.shipTracking}</p>
                </div>
              </div>
              {order.shipTracking && <ShipmentTracking tracking={order.shipTracking} />}
            </Section>
          ) : null}

          {/* Serialized Units */}
          {order.serialAssignments.length > 0 && (
            <Section title="Serialized Units" icon={<Hash size={12} />}>
              <div className="overflow-x-auto -mx-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Serial Number</th>
                      <th className="px-4 py-2">SKU</th>
                      <th className="px-4 py-2">FMI Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.serialAssignments.map((sa, i) => (
                      <tr key={sa.id} className="border-b border-gray-100 dark:border-white/5">
                        <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2 font-mono font-medium text-gray-900 dark:text-white">{sa.inventorySerial.serialNumber}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{sa.orderItem.sellerSku ?? sa.inventorySerial.product?.sku ?? '—'}</td>
                        <td className="px-4 py-2"><SickwCheckButton serial={sa.inventorySerial.serialNumber} compact deviceHint={`${sa.orderItem.sellerSku ?? sa.inventorySerial.product?.sku ?? ''}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Back Market Serials */}
          {order.orderSource === 'backmarket' && order.items.some(i => (i.bmSerials?.length ?? 0) > 0) && (
            <Section title="Serial / IMEI Numbers" icon={<Hash size={12} />}>
              <div className="overflow-x-auto -mx-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Serial / IMEI</th>
                      <th className="px-4 py-2">SKU</th>
                      <th className="px-4 py-2">FMI Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let counter = 0
                      return order.items.flatMap(item =>
                        (item.bmSerials ?? []).map(serial => {
                          counter++
                          return (
                            <tr key={`${item.id}-${serial}`} className="border-b border-gray-100 dark:border-white/5">
                              <td className="px-4 py-2 text-gray-400">{counter}</td>
                              <td className="px-4 py-2 font-mono font-medium text-gray-900 dark:text-white">{serial}</td>
                              <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{item.sellerSku ?? '—'}</td>
                              <td className="px-4 py-2"><SickwCheckButton serial={serial} compact deviceHint={`${item.sellerSku ?? ''} ${item.title ?? ''}`} /></td>
                            </tr>
                          )
                        })
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Amazon Return Authorization (MFN/FBM) */}
          {order.orderSource === 'amazon' && ((order.mfnReturns?.length ?? 0) > 0 || (order.freeReplacements?.length ?? 0) > 0) && (
            <Section title="Amazon Return" icon={<RotateCcw size={12} />}>
              <div className="space-y-3">
                {/* Replacement indicator */}
                {((order.freeReplacements?.length ?? 0) > 0 || order.mfnReturns?.some(r => (r.resolution ?? '').toLowerCase().includes('replace'))) && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700/40 text-xs text-indigo-700 dark:text-indigo-300">
                    <RotateCcw size={14} className="shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Replacement order issued on Amazon.</span>
                      {(order.freeReplacements ?? []).map(fr => (
                        <div key={fr.id} className="mt-0.5 font-mono text-[11px]">
                          {fr.replacementOrderId}{fr.shippedAt ? ` · shipped ${fmtD(fr.shippedAt)}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Return authorization(s) */}
                {(order.mfnReturns ?? []).map(r => (
                  <div key={r.id} className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">{r.rmaId ?? r.merchantRmaId ?? 'Return'}</span>
                      {r.resolution && (
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold',
                          r.resolution.toLowerCase().includes('replace') ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700')}>
                          {r.resolution}
                        </span>
                      )}
                    </div>
                    <KV label="Return reason" value={r.returnReason ?? '—'} />
                    {r.buyerComment && (
                      <div className="py-1">
                        <p className="text-[11px] text-gray-500 mb-0.5">Buyer comment</p>
                        <p className="text-xs text-gray-800 dark:text-gray-200 italic bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded px-2 py-1.5 whitespace-pre-wrap">“{r.buyerComment}”</p>
                      </div>
                    )}
                    <KV label="Requested" value={fmtD(r.returnDate)} />
                    {r.returnStatus && <KV label="Status" value={r.returnStatus} />}
                    {r.refundedAmount != null && <KV label="Refunded (per Amazon)" value={`$${r.refundedAmount.toFixed(2)}`} />}

                    {/* Live return tracking */}
                    {r.trackingNumber && (
                      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/10">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Truck size={12} className="text-gray-400 shrink-0" />
                            <a href={trackingHref(r.trackingNumber)} target="_blank" rel="noopener noreferrer"
                              className="text-xs font-mono text-amazon-blue hover:underline truncate">{r.trackingNumber}</a>
                            <span className="text-[10px] text-gray-400 shrink-0">{r.returnCarrier ?? carrierOf(r.trackingNumber)}</span>
                          </div>
                          <button onClick={() => refreshReturnTracking(r.id)} disabled={trackingBusy === r.id}
                            title="Refresh live carrier tracking"
                            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-amazon-blue disabled:opacity-50 shrink-0">
                            {trackingBusy === r.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Refresh
                          </button>
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          {r.carrierStatus
                            ? <span className={clsx('text-[11px] px-1.5 py-0.5 rounded font-semibold',
                                r.deliveredAt ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
                                {r.deliveredAt ? `Delivered ${fmtD(r.deliveredAt)}` : r.carrierStatus}
                              </span>
                            : <span className="text-[11px] text-gray-400">{trackingBusy === r.id ? 'Checking…' : 'No live status yet'}</span>}
                          {!r.deliveredAt && r.estimatedDelivery && (
                            <span className="text-[11px] text-gray-500">Est. delivery {fmtD(r.estimatedDelivery)}</span>
                          )}
                          {r.trackingUpdatedAt && <span className="text-[10px] text-gray-400">as of {fmtDT(r.trackingUpdatedAt)}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Seller-Initiated Refund — refunds issued to Amazon via this system */}
          {order.orderSource === 'amazon' && (order.refundsIssued?.length ?? 0) > 0 && (
            <Section title="Seller-Initiated Refund" icon={<RotateCcw size={12} />}
              check={(order.refundsIssued ?? []).some(rf => rf.feedStatus === 'SUCCESS' || rf.feedStatus === 'DONE')}>

              <div className="space-y-2">
                {(order.refundsIssued ?? []).map(rf => {
                  const ok = rf.feedStatus === 'SUCCESS' || rf.feedStatus === 'DONE'
                  const failed = rf.feedStatus === 'ERROR' || rf.feedStatus === 'FATAL' || rf.feedStatus === 'CANCELLED'
                  return (
                    <div key={rf.id} className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-900 dark:text-white">${rf.amount.toFixed(2)}</span>
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold',
                          ok ? 'bg-green-100 text-green-700' : failed ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')}>
                          {ok ? 'Refunded' : failed ? 'Declined' : 'Pending'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500 flex flex-wrap items-center gap-x-2">
                        <span>{fmtDT(rf.createdAt)}</span>
                        <span>· {rf.reason}</span>
                        {rf.issuedByEmail && <span>· by {rf.issuedByEmail}</span>}
                      </div>
                      {failed && rf.feedResult && <p className="mt-1 text-[11px] text-red-600">{rf.feedResult}</p>}
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Returns (Marketplace RMAs) */}
          {order.marketplaceRMAs.length > 0 && (
            <Section title="Returns" icon={<RotateCcw size={12} />}
              check={order.marketplaceRMAs.some(r => r.status === 'RECEIVED')}>

              <div className="space-y-4">
                {order.marketplaceRMAs.map(rma => (
                  <div key={rma.id} className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
                    {/* RMA header */}
                    <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">{rma.rmaNumber}</span>
                      <span className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        rma.status === 'RECEIVED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800',
                      )}>
                        {rma.status}
                      </span>
                      <span className="text-[11px] text-gray-500">{new Date(rma.createdAt).toLocaleDateString()}</span>
                      {rma.notes && (
                        <span className="text-[11px] text-gray-500 italic ml-auto">— {rma.notes}</span>
                      )}
                    </div>

                    {/* RMA items table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-white/5">
                            <th className="px-3 py-1.5">SKU</th>
                            <th className="px-3 py-1.5">Title</th>
                            <th className="px-3 py-1.5">Serial #</th>
                            <th className="px-3 py-1.5">FMI</th>
                            <th className="px-3 py-1.5">Return Reason</th>
                            <th className="px-3 py-1.5">Received</th>
                            <th className="px-3 py-1.5">Location</th>
                            <th className="px-3 py-1.5">Grade</th>
                            <th className="px-3 py-1.5">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rma.items.flatMap(item =>
                            item.serials.length > 0
                              ? item.serials.map(s => (
                                <tr key={s.id} className="border-b border-gray-50 dark:border-white/5">
                                  <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">{item.sellerSku ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">{item.title ?? '—'}</td>
                                  <td className="px-3 py-1.5 font-mono text-gray-900 dark:text-white">{s.serialNumber}</td>
                                  <td className="px-3 py-1.5"><SickwCheckButton serial={s.serialNumber} compact deviceHint={`${item.sellerSku ?? ''} ${item.title ?? ''}`} /></td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{item.returnReason ?? '—'}</td>
                                  <td className="px-3 py-1.5">
                                    {s.receivedAt ? (
                                      <span className="flex items-center gap-1 text-green-700"><CheckCircle2 size={12} />{new Date(s.receivedAt).toLocaleDateString()}</span>
                                    ) : (
                                      <span className="text-yellow-600">Pending</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">
                                    {s.location ? `${s.location.warehouse.name} / ${s.location.name}` : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{s.grade?.grade ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-500">{s.note ?? '—'}</td>
                                </tr>
                              ))
                              : [(
                                <tr key={item.id} className="border-b border-gray-50 dark:border-white/5">
                                  <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">{item.sellerSku ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">{item.title ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{item.returnReason ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-500">Qty: {item.quantityReturned}</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                </tr>
                              )]
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* SICKW / FMI Check History */}
          {order.sickwChecks.length > 0 && (
            <Section title={`SICKW Checks (${order.sickwChecks.length})`} icon={<Smartphone size={12} />}>
              <div className="overflow-x-auto -mx-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                      <th className="px-4 py-2">When</th>
                      <th className="px-4 py-2">Serial / IMEI</th>
                      <th className="px-4 py-2">Service</th>
                      <th className="px-4 py-2">Source</th>
                      <th className="px-4 py-2">Result</th>
                      <th className="px-4 py-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.sickwChecks.map(c => {
                      const verdict = c.status === 'error' ? 'ERROR' : parseFmiVerdict(c.result ?? '')
                      const src = c.source ? SICKW_SOURCE_LABEL[c.source] : null
                      const isOpen = expandedChecks.has(c.id)
                      const verdictCls =
                        verdict === 'ON' ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400'
                        : verdict === 'OFF' ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400'
                      const verdictLabel = verdict === 'ON' ? 'iCloud ON' : verdict === 'OFF' ? 'iCloud OFF' : verdict === 'ERROR' ? 'Error' : 'Unknown'
                      return (
                        <Fragment key={c.id}>
                          <tr
                            className="border-b border-gray-100 dark:border-white/5 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5"
                            onClick={() => setExpandedChecks(prev => {
                              const next = new Set(prev)
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id)
                              return next
                            })}
                          >
                            <td className="px-4 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">
                              <span className="inline-flex items-center gap-1">
                                <ChevronRight size={11} className={clsx('text-gray-400 transition-transform', isOpen && 'rotate-90')} />
                                {new Date(c.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono font-medium text-gray-900 dark:text-white">{c.imei}</td>
                            <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{c.serviceName}</td>
                            <td className="px-4 py-2">
                              {src
                                ? <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', src.cls)}>{src.label}</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-2">
                              <span className={clsx('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border', verdictCls)}>
                                {verdict === 'OFF' && <CheckCircle2 size={10} />}
                                {(verdict === 'ERROR' || verdict === 'UNKNOWN') && <AlertCircle size={10} />}
                                {verdictLabel}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">{c.cost != null ? `$${c.cost.toFixed(2)}` : '—'}</td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/5">
                              <td colSpan={6} className="px-4 py-2">
                                <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-600 dark:text-gray-300 font-mono max-h-56 overflow-y-auto">{extractResultText(c.result)}</pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

        </div>
      </div>

      {/* Create Return Modal */}
      {returnModalOrder && (
        <CreateReturnModal
          order={returnModalOrder}
          onClose={() => setReturnModalOrder(null)}
          onCreated={handleReturnCreated}
        />
      )}

      {/* Create Replacement Order Modal (BackMarket only) */}
      {showReplacementModal && (
        <CreateReplacementOrderModal
          orderId={order.id}
          sourceItems={order.items.map(i => ({
            sellerSku: i.sellerSku,
            title: i.title,
            quantityOrdered: i.quantityOrdered,
          }))}
          onClose={() => setShowReplacementModal(false)}
          onCreated={(o) => {
            setShowReplacementModal(false)
            router.push(`/orders/${o.id}`)
          }}
        />
      )}

      {/* Amazon Refund Modal */}
      {showRefundModal && (
        <AmazonRefundModal
          order={order}
          onClose={() => setShowRefundModal(false)}
          onDone={() => { setShowRefundModal(false); reload() }}
        />
      )}
    </div>
  )
}

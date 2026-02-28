'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Search, RefreshCcw, Package, X, AlertCircle, ChevronLeft, ChevronRight,
  Download, Link2, CheckCircle2, Truck, Settings, FlaskConical, ClipboardCheck,
  MapPin, Printer, RotateCcw, Hash, XCircle, ExternalLink, Phone, FileText, Eye,
  AlertTriangle, Pencil, Tag, History, ChevronDown, ChevronUp, Ban,
} from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'
import PickListModal from '@/components/PickListModal'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = 'pending' | 'unshipped' | 'awaiting' | 'shipped' | 'cancelled'

interface OrderItem {
  id: string; orderItemId: string; asin: string | null; sellerSku: string | null
  title: string | null; quantityOrdered: number; quantityShipped: number
  itemPrice: string | null; shippingPrice: string | null
  isSerializable?: boolean
}

interface OrderLabelSummary {
  trackingNumber: string; labelFormat: string; carrier: string | null
  serviceCode: string | null; shipmentCost: string | null
  createdAt: string; isTest: boolean; ssShipmentId: number | null
}

interface Order {
  id: string; olmNumber: number | null; amazonOrderId: string; orderStatus: string; workflowStatus: string
  purchaseDate: string; lastUpdateDate: string; lastSyncedAt: string; processedAt: string | null
  orderTotal: string | null; currency: string | null; isPrime: boolean
  fulfillmentChannel: string | null; shipmentServiceLevel: string | null; numberOfItemsUnshipped: number
  shipToName: string | null; shipToAddress1: string | null; shipToAddress2: string | null
  shipToCity: string | null; shipToState: string | null; shipToPostal: string | null
  shipToCountry: string | null; shipToPhone: string | null
  items: OrderItem[]
  label?: OrderLabelSummary | null
  serialAssignments?: { id: string; orderItemId: string; inventorySerial: { serialNumber: string } }[]
  isBuyerRequestedCancel: boolean
  buyerCancelReason: string | null
  latestShipDate: string | null
  presetRateAmount: string | null
  presetRateCarrier: string | null
  presetRateService: string | null
  presetRateId: string | null
  presetRateError: string | null
  presetRateCheckedAt: string | null
  appliedPresetId: string | null
  // Wholesale-specific (undefined / null for Amazon orders)
  orderSource?: 'amazon' | 'wholesale'
  wholesaleOrderNumber?: string | null
  wholesaleCustomerName?: string | null
  shipCarrier?: string | null
  shipTracking?: string | null
  shippedAt?: string | null
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

interface SyncJob {
  id: string; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number; totalSynced: number; errorMessage: string | null
  startedAt: string
}

interface SSAccount { id: string; name: string; isActive: boolean; createdAt: string }

interface PackageDimensions { length: number; width: number; height: number; unit: 'inches' | 'centimeters' }
interface Weight { value: number; unit: 'ounces' | 'grams' | 'pounds' | 'kilograms' }

// ─── Inventory types ──────────────────────────────────────────────────────────

interface InventoryLocation {
  locationId: string; locationName: string; warehouseName: string; qty: number
  gradeId: string | null; gradeName: string | null; isFinishedGoods: boolean
}
interface OrderItemInventory {
  orderItemId: string; sellerSku: string | null; title: string | null
  quantityOrdered: number; productId: string | null; productDescription: string | null
  totalQtyAvailable: number
  gradeId: string | null; gradeName: string | null
  locations: InventoryLocation[]
}
interface OrderInventoryData { orderId: string; items: OrderItemInventory[] }

// ─── Verification types ───────────────────────────────────────────────────────

interface VerificationItem {
  orderItemId: string; sellerSku: string | null; title: string | null
  quantityOrdered: number; isSerializable: boolean; assignedSerials: string[]
}
interface VerificationStatus {
  orderId: string; amazonOrderId: string; trackingNumber: string | null
  hasLabel: boolean; items: VerificationItem[]
}

// ─── Small logo badges ────────────────────────────────────────────────────────

function AmazonSmileIcon() {
  // Amazon wordmark + smile arrow badge
  return (
    <span
      title="Amazon order"
      aria-label="Amazon"
      className="inline-flex flex-col items-center leading-none select-none"
      style={{ gap: 0 }}
    >
      {/* "amazon" text in dark slate, condensed */}
      <span style={{
        fontFamily: 'Arial, sans-serif',
        fontWeight: 900,
        fontSize: 8,
        letterSpacing: '-0.3px',
        color: '#232F3E',
        lineHeight: 1,
      }}>
        amazon
      </span>
      {/* Orange smile arrow */}
      <svg width="22" height="6" viewBox="0 0 22 6" fill="none" style={{ marginTop: -1 }}>
        <path d="M1 4C6 7.5 16 7.5 21 4" stroke="#FF9900" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
        <path d="M17.5 2.5L21 4L17.5 5.5" stroke="#FF9900" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    </span>
  )
}

function PrimeBadge() {
  return (
    <span className="inline-flex items-center text-[7px] font-black italic tracking-wider bg-[#00A8E0] text-white px-1 py-px rounded" title="Amazon Prime">
      prime
    </span>
  )
}

function WholesaleIcon() {
  return (
    <span
      title="Wholesale order"
      className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-700 text-white font-black text-[10px] select-none shrink-0"
    >
      W
    </span>
  )
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const PKG_KEY  = 'ss_package'
const WT_KEY   = 'ss_weight'
const CONF_KEY = 'ss_confirmation'
const TAB_KEY  = 'orders_active_tab'

function load<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback } catch { return fallback }
}

const DEFAULT_PKG: PackageDimensions = { length: 12, width: 10, height: 6, unit: 'inches' }
const DEFAULT_WT: Weight = { value: 16, unit: 'ounces' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiPost<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status}`)
  return json as T
}

function fmt(amount: string | null | undefined, currency?: string | null) {
  if (amount == null) return '—'
  const n = parseFloat(String(amount))
  if (isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD', minimumFractionDigits: 2 }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function downloadLabelData(labelData: string, labelFormat: string, filename: string) {
  const bytes = Uint8Array.from(atob(labelData), c => c.charCodeAt(0))
  const mime  = labelFormat === 'pdf' ? 'application/pdf' : 'image/png'
  const ext   = labelFormat === 'pdf' ? 'pdf' : 'png'
  const blob  = new Blob([bytes], { type: mime })
  const url   = URL.createObjectURL(blob)
  const a     = document.createElement('a')
  a.href = url; a.download = `${filename}.${ext}`; a.click()
  URL.revokeObjectURL(url)
}

// ─── Process Order Modal ───────────────────────────────────────────────────────

interface ReservationSelection {
  orderItemId: string; productId: string; locationId: string; qtyReserved: number; gradeId?: string | null
}

function ProcessOrderModal({ order, onClose, onProcessed }: {
  order: Order; onClose: () => void; onProcessed: () => void
}) {
  const [inventoryData, setInventoryData] = useState<OrderInventoryData | null>(null)
  const [loading, setLoading]             = useState(true)
  const [loadErr, setLoadErr]             = useState<string | null>(null)
  const [selections, setSelections]       = useState<Record<string, ReservationSelection>>({})
  const [processing, setProcessing]       = useState(false)
  const [processErr, setProcessErr]       = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setLoadErr(null)
    fetch(`/api/orders/${order.id}/inventory`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then((data: OrderInventoryData) => {
        setInventoryData(data)
        const initial: Record<string, ReservationSelection> = {}
        for (const item of data.items) {
          if (!item.productId || item.locations.length === 0) continue
          const best = item.locations.find(l => l.qty >= item.quantityOrdered) ?? item.locations[0]
          initial[item.orderItemId] = {
            orderItemId: item.orderItemId, productId: item.productId,
            locationId: best.locationId, qtyReserved: Math.min(item.quantityOrdered, best.qty),
            gradeId: item.gradeId ?? null,
          }
        }
        setSelections(initial)
      })
      .catch(e => setLoadErr(e instanceof Error ? e.message : 'Failed to load inventory'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const allItemsHaveStock = inventoryData?.items.every(item =>
    !item.productId ? false : item.totalQtyAvailable >= item.quantityOrdered
  ) ?? false

  const allSelectionsValid = inventoryData?.items.every(item => {
    if (!item.productId) return false
    const sel = selections[item.orderItemId]
    if (!sel) return false
    const loc = item.locations.find(l => l.locationId === sel.locationId)
    return loc && sel.qtyReserved >= 1 && sel.qtyReserved <= loc.qty
  }) ?? false

  async function handleConfirm() {
    if (!allSelectionsValid) return
    setProcessing(true); setProcessErr(null)
    try {
      await apiPost(`/api/orders/${order.id}/process`, { reservations: Object.values(selections) })
      onProcessed()
    } catch (e) { setProcessErr(e instanceof Error ? e.message : 'Failed to process order') }
    finally { setProcessing(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <ClipboardCheck size={15} className="text-amazon-blue" /> Process Order
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{order.amazonOrderId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-4"><RefreshCcw size={13} className="animate-spin" /> Loading inventory…</div>}
          {loadErr && <div className="flex items-start gap-2 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{loadErr}</div>}
          {!loading && inventoryData && inventoryData.items.map(item => {
            const sel        = selections[item.orderItemId]
            const hasProduct = !!item.productId
            const hasStock   = item.totalQtyAvailable >= item.quantityOrdered
            // Look up ASIN from the original order items
            const asin = order.items.find(oi => oi.id === item.orderItemId)?.asin ?? null
            const imgSrc = asin
              ? `/api/asin-image?asin=${asin}`
              : null
            return (
              <div key={item.orderItemId} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  {/* Product image */}
                  {imgSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imgSrc}
                      alt={item.sellerSku ?? 'Product'}
                      width={52}
                      height={52}
                      className="rounded border border-gray-200 object-contain bg-gray-50 shrink-0"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-[52px] h-[52px] rounded border border-gray-200 bg-gray-100 shrink-0 flex items-center justify-center">
                      <Package size={18} className="text-gray-300" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-mono text-xs font-semibold text-gray-800">{item.sellerSku ?? '—'}</p>
                      {asin && <span className="font-mono text-[10px] text-gray-400">{asin}</span>}
                      {item.gradeName && (
                        <span className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[10px] font-bold">
                          Grade {item.gradeName}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{item.title ?? '—'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Qty: <strong>{item.quantityOrdered}</strong></p>
                  </div>
                  {!hasProduct && <span className="inline-flex items-center gap-1 text-[10px] bg-gradient-to-r from-red-500 to-rose-500 text-white px-2 py-0.5 rounded font-semibold shrink-0 shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-white/70 animate-pulse shrink-0" />Out of Stock</span>}
                  {hasProduct && !hasStock && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium shrink-0">Out of stock</span>}
                  {hasProduct && hasStock && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium shrink-0">{item.totalQtyAvailable} available</span>}
                </div>
                {hasProduct && item.locations.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1"><MapPin size={10} /> Location</label>
                    <select value={sel?.locationId ?? ''} onChange={e => {
                      const loc = item.locations.find(l => l.locationId === e.target.value)
                      if (!loc || !item.productId) return
                      setSelections(prev => ({
                        ...prev,
                        [item.orderItemId]: {
                          orderItemId: item.orderItemId, productId: item.productId!,
                          locationId: loc.locationId, qtyReserved: Math.min(prev[item.orderItemId]?.qtyReserved ?? item.quantityOrdered, loc.qty),
                          gradeId: item.gradeId ?? null,
                        },
                      }))
                    }} className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                      {item.locations.map(loc => (
                        <option key={loc.locationId} value={loc.locationId}>
                          {loc.warehouseName} › {loc.locationName}
                          {loc.gradeName ? ` [${loc.gradeName}]` : ''} — {loc.qty} avail
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-gray-600">Qty to reserve</label>
                      <input type="number" min={1} max={item.locations.find(l => l.locationId === sel?.locationId)?.qty ?? item.quantityOrdered} value={sel?.qtyReserved ?? item.quantityOrdered}
                        onChange={e => {
                          const v = Math.max(1, parseInt(e.target.value) || 1)
                          setSelections(prev => ({ ...prev, [item.orderItemId]: { ...prev[item.orderItemId], qtyReserved: v } }))
                        }}
                        className="w-16 h-7 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                      <span className="text-xs text-gray-400">of {item.quantityOrdered}</span>
                    </div>
                  </div>
                )}
                {hasProduct && item.locations.length === 0 && <p className="text-xs text-gray-500 italic">No inventory found for this SKU.</p>}
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {processErr && <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{processErr}</div>}
          {!allItemsHaveStock && !loading && <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />One or more items are out of stock.</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleConfirm} disabled={processing || !allSelectionsValid || !allItemsHaveStock}
              className="px-3 py-1.5 text-xs bg-amazon-blue text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
              {processing ? <><RefreshCcw size={12} className="animate-spin" /> Reserving…</> : 'Reserve & Process'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Bulk Process Modal ────────────────────────────────────────────────────────

interface BulkOrderInventory {
  orderId:      string
  amazonOrderId: string
  items:        OrderItemInventory[]
  asinMap:      Record<string, string | null>  // orderItemId → asin
  allFG:        boolean  // every item can be auto-reserved from FG
}

function BulkProcessModal({
  orderInventories,
  onClose,
  onProcessed,
}: {
  orderInventories: BulkOrderInventory[]
  onClose:    () => void
  onProcessed: () => void
}) {
  // selections: orderId → orderItemId → ReservationSelection
  const [selections, setSelections] = useState<Record<string, Record<string, ReservationSelection>>>(() => {
    const init: Record<string, Record<string, ReservationSelection>> = {}
    for (const oi of orderInventories) {
      init[oi.orderId] = {}
      for (const item of oi.items) {
        if (!item.productId || item.locations.length === 0) continue
        // Prefer FG location with enough stock, then best qty
        const fg   = item.locations.find(l => l.isFinishedGoods && l.qty >= item.quantityOrdered)
        const best = fg ?? item.locations.find(l => l.qty >= item.quantityOrdered) ?? item.locations[0]
        init[oi.orderId][item.orderItemId] = {
          orderItemId: item.orderItemId,
          productId:   item.productId,
          locationId:  best.locationId,
          qtyReserved: Math.min(item.quantityOrdered, best.qty),
          gradeId:     item.gradeId ?? null,
        }
      }
    }
    return init
  })

  const [processing, setProcessing] = useState(false)
  const [results, setResults]       = useState<{ orderId: string; success: boolean; error?: string }[] | null>(null)
  const [expanded, setExpanded]     = useState<Record<string, boolean>>(() =>
    Object.fromEntries(orderInventories.map(o => [o.orderId, !o.allFG]))
  )

  function toggleExpand(orderId: string) {
    setExpanded(p => ({ ...p, [orderId]: !p[orderId] }))
  }

  function setSelection(orderId: string, orderItemId: string, sel: ReservationSelection) {
    setSelections(p => ({ ...p, [orderId]: { ...p[orderId], [orderItemId]: sel } }))
  }

  function isOrderValid(oi: BulkOrderInventory) {
    for (const item of oi.items) {
      if (!item.productId) return false
      const sel = selections[oi.orderId]?.[item.orderItemId]
      if (!sel) return false
      const loc = item.locations.find(l => l.locationId === sel.locationId)
      if (!loc || sel.qtyReserved < 1 || sel.qtyReserved > loc.qty) return false
    }
    return true
  }

  const allValid = orderInventories.every(isOrderValid)

  async function handleConfirm() {
    if (!allValid || processing) return
    setProcessing(true)
    try {
      const payload = orderInventories.map(oi => ({
        orderId:      oi.orderId,
        reservations: Object.values(selections[oi.orderId] ?? {}),
      }))
      const res  = await fetch('/api/orders/bulk-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: payload }),
      })
      const data = await res.json()
      setResults(data.results)
      if (data.failed === 0) {
        setTimeout(() => { onProcessed() }, 1200)
      }
    } catch (err) {
      setResults([{ orderId: 'all', success: false, error: err instanceof Error ? err.message : 'Request failed' }])
    } finally {
      setProcessing(false)
    }
  }

  const totalOrders    = orderInventories.length
  const autoFGCount    = orderInventories.filter(o => o.allFG).length
  const needInputCount = totalOrders - autoFGCount

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <ClipboardCheck size={15} className="text-amazon-blue" />
              Process {totalOrders} Order{totalOrders !== 1 ? 's' : ''}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {autoFGCount > 0 && <span className="text-green-600">{autoFGCount} auto-reserve from Finished Goods</span>}
              {autoFGCount > 0 && needInputCount > 0 && <span className="text-gray-400"> · </span>}
              {needInputCount > 0 && <span className="text-amber-600">{needInputCount} require location selection</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        {/* Results view */}
        {results ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {results.map(r => {
              const oi = orderInventories.find(o => o.orderId === r.orderId)
              return (
                <div key={r.orderId} className={clsx(
                  'flex items-start gap-2 p-3 rounded-lg border text-xs',
                  r.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200',
                )}>
                  <span className={r.success ? 'text-green-600' : 'text-red-500'}>
                    {r.success ? '✓' : '✗'}
                  </span>
                  <span className={clsx('font-mono font-medium', r.success ? 'text-green-800' : 'text-red-800')}>
                    {oi?.amazonOrderId ?? r.orderId}
                  </span>
                  {r.error && <span className="text-red-600 ml-1">{r.error}</span>}
                </div>
              )
            })}
          </div>
        ) : (
          /* Order list */
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
            {orderInventories.map(oi => {
              const isValid = isOrderValid(oi)
              const isOpen  = expanded[oi.orderId]
              return (
                <div key={oi.orderId} className={clsx(
                  'rounded-lg border',
                  oi.allFG ? 'border-green-200' : 'border-gray-200',
                )}>
                  {/* Order header */}
                  <button
                    type="button"
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-left rounded-t-lg',
                      oi.allFG ? 'bg-green-50' : 'bg-gray-50',
                    )}
                    onClick={() => toggleExpand(oi.orderId)}
                  >
                    <span className="text-xs font-mono font-semibold text-gray-800 flex-1">{oi.amazonOrderId}</span>
                    {oi.allFG && (
                      <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                        Auto FG
                      </span>
                    )}
                    {!oi.allFG && !isValid && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                        Needs input
                      </span>
                    )}
                    {!oi.allFG && isValid && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                        Ready
                      </span>
                    )}
                    <ChevronDown size={12} className={clsx('text-gray-400 transition-transform shrink-0', isOpen && 'rotate-180')} />
                  </button>

                  {/* Item list */}
                  {isOpen && (
                    <div className="px-3 pb-3 pt-2 space-y-3">
                      {oi.items.map(item => {
                        const sel = selections[oi.orderId]?.[item.orderItemId]
                        const hasProduct = !!item.productId
                        const hasStock   = item.totalQtyAvailable >= item.quantityOrdered
                        const asin   = oi.asinMap[item.orderItemId] ?? null
                        const imgSrc = asin
                          ? `/api/asin-image?asin=${asin}`
                          : null
                        return (
                          <div key={item.orderItemId} className="rounded border border-gray-100 p-2.5 space-y-2 bg-white">
                            <div className="flex items-start gap-2">
                              {imgSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={imgSrc}
                                  alt={item.sellerSku ?? 'Product'}
                                  width={44}
                                  height={44}
                                  className="rounded border border-gray-200 object-contain bg-gray-50 shrink-0"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                                />
                              ) : (
                                <div className="w-[44px] h-[44px] rounded border border-gray-200 bg-gray-100 shrink-0 flex items-center justify-center">
                                  <Package size={16} className="text-gray-300" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-mono text-xs font-semibold text-gray-800">{item.sellerSku ?? '—'}</p>
                                <p className="text-xs text-gray-500 truncate">{item.title ?? '—'}</p>
                                <p className="text-xs text-gray-400">Qty: <strong>{item.quantityOrdered}</strong></p>
                              </div>
                              {!hasProduct && <span className="inline-flex items-center gap-1 text-[10px] bg-gradient-to-r from-red-500 to-rose-500 text-white px-2 py-0.5 rounded font-semibold shrink-0 shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-white/70 animate-pulse shrink-0" />Out of Stock</span>}
                              {hasProduct && !hasStock && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium shrink-0">Out of stock</span>}
                              {hasProduct && hasStock && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium shrink-0">{item.totalQtyAvailable} avail</span>}
                            </div>
                            {hasProduct && item.locations.length > 0 && (
                              <div className="space-y-1">
                                <label className="text-[10px] font-medium text-gray-500 flex items-center gap-1">
                                  <MapPin size={9} /> Location
                                </label>
                                <select
                                  value={sel?.locationId ?? ''}
                                  onChange={e => {
                                    const loc = item.locations.find(l => l.locationId === e.target.value)
                                    if (!loc || !item.productId) return
                                    setSelection(oi.orderId, item.orderItemId, {
                                      orderItemId: item.orderItemId,
                                      productId:   item.productId,
                                      locationId:  loc.locationId,
                                      qtyReserved: Math.min(sel?.qtyReserved ?? item.quantityOrdered, loc.qty),
                                      gradeId:     item.gradeId ?? null,
                                    })
                                  }}
                                  className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                                >
                                  {item.locations.map(loc => (
                                    <option key={loc.locationId} value={loc.locationId}>
                                      {loc.isFinishedGoods ? '★ ' : ''}{loc.warehouseName} › {loc.locationName}
                                      {loc.gradeName ? ` [${loc.gradeName}]` : ''} — {loc.qty} avail
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {hasProduct && item.locations.length === 0 && (
                              <p className="text-xs text-gray-400 italic">No inventory found for this SKU.</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t shrink-0 flex gap-2 justify-end">
          {results ? (
            <button onClick={onClose} className="px-4 py-1.5 text-xs bg-amazon-blue text-white rounded-lg hover:bg-blue-700">
              Close
            </button>
          ) : (
            <>
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={processing || !allValid}
                className="px-4 py-1.5 text-xs bg-amazon-blue text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {processing
                  ? <><RefreshCcw size={12} className="animate-spin" /> Processing…</>
                  : <><ClipboardCheck size={12} /> Process {totalOrders} Order{totalOrders !== 1 ? 's' : ''}</>
                }
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Verify Order Modal ────────────────────────────────────────────────────────

type SerialState = { value: string; valid: boolean | null; message: string; checking: boolean }

function VerifyOrderModal({ order, onClose, onVerified }: {
  order: Order; onClose: () => void; onVerified: () => void
}) {
  const [status, setStatus]         = useState<VerificationStatus | null>(null)
  const [loading, setLoading]       = useState(true)
  const [loadErr, setLoadErr]       = useState<string | null>(null)
  const [printingLabel, setPrintingLabel] = useState(false)

  // serialInputs: Record<"orderItemId-index", SerialState>
  const [serialInputs, setSerialInputs] = useState<Record<string, SerialState>>({})
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/orders/${order.id}/verification-status`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then((data: VerificationStatus) => {
        setStatus(data)
        // Pre-fill with any already-assigned serials
        const initial: Record<string, SerialState> = {}
        for (const item of data.items) {
          if (!item.isSerializable) continue
          for (let i = 0; i < item.quantityOrdered; i++) {
            const key = `${item.orderItemId}-${i}`
            const existing = item.assignedSerials[i] ?? ''
            initial[key] = { value: existing, valid: existing ? true : null, message: '', checking: false }
          }
        }
        setSerialInputs(initial)
      })
      .catch(e => setLoadErr(e instanceof Error ? e.message : 'Failed to load verification status'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const validateSerial = useCallback((key: string, sn: string, sku: string) => {
    if (!sn.trim()) {
      setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, valid: null, message: '', checking: false } }))
      return
    }
    // Mark as checking
    setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, checking: true, valid: null, message: '' } }))
    // Debounce
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
    debounceRefs.current[key] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/serials/validate?sn=${encodeURIComponent(sn.trim())}&sku=${encodeURIComponent(sku)}`)
        const data: { valid: boolean; reason?: string; detail?: string; location?: string } = await res.json()
        setSerialInputs(prev => ({
          ...prev,
          [key]: { value: sn, valid: data.valid, message: data.valid ? (data.location ?? '✓ Valid') : (data.detail ?? 'Invalid'), checking: false },
        }))
      } catch {
        setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], checking: false, valid: false, message: 'Validation error' } }))
      }
    }, 350)
  }, [])

  const needsSerials = status?.items.some(i => i.isSerializable) ?? false

  const allSerialsValid = (() => {
    if (!status) return false
    for (const item of status.items) {
      if (!item.isSerializable) continue
      for (let i = 0; i < item.quantityOrdered; i++) {
        const key = `${item.orderItemId}-${i}`
        const state = serialInputs[key]
        if (!state || !state.valid || state.checking) return false
      }
    }
    return true
  })()

  const canConfirm = !needsSerials || allSerialsValid

  async function printLabel() {
    setPrintingLabel(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/label`)
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? 'Failed to fetch label') }
      const data: { labelData: string; labelFormat: string; trackingNumber: string } = await res.json()
      downloadLabelData(data.labelData, data.labelFormat, `label-${order.amazonOrderId}`)
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to print label') }
    finally { setPrintingLabel(false) }
  }

  async function handleConfirm() {
    if (!status || !canConfirm) return
    setSubmitting(true); setSubmitErr(null)
    try {
      // Build assignments only for serializable items
      const assignments = status.items
        .filter(item => item.isSerializable)
        .map(item => ({
          orderItemId:   item.orderItemId,
          serialNumbers: Array.from({ length: item.quantityOrdered }, (_, i) =>
            serialInputs[`${item.orderItemId}-${i}`]?.value.trim() ?? ''
          ).filter(Boolean),
        }))
        .filter(a => a.serialNumbers.length > 0)

      await apiPost(`/api/orders/${order.id}/serialize`, { assignments })
      onVerified()
    } catch (e) { setSubmitErr(e instanceof Error ? e.message : 'Failed to complete verification') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <Hash size={15} className="text-purple-600" /> Verify & Serialize Order
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{order.amazonOrderId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-4"><RefreshCcw size={13} className="animate-spin" /> Loading…</div>}
          {loadErr && <div className="flex items-start gap-2 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{loadErr}</div>}

          {!loading && status && (<>
            {/* Label / Tracking */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Tracking Number</p>
                <p className="font-mono text-sm font-bold text-gray-900">{status.trackingNumber ?? '—'}</p>
              </div>
              {status.hasLabel && (
                <button onClick={printLabel} disabled={printingLabel}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50">
                  {printingLabel ? <RefreshCcw size={11} className="animate-spin" /> : <Printer size={11} />}
                  Print Label
                </button>
              )}
            </div>

            {/* Serial number section */}
            {!needsSerials && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex items-center gap-2">
                <CheckCircle2 size={14} />
                No serializable items — ready to confirm shipment.
              </div>
            )}

            {needsSerials && status.items.map(item => {
              if (!item.isSerializable) return (
                <div key={item.orderItemId} className="rounded-lg border border-gray-100 bg-gray-50 p-3 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-xs font-semibold text-gray-700">{item.sellerSku ?? '—'}</span>
                    <span className="text-xs text-gray-400 ml-2">×{item.quantityOrdered}</span>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{item.title ?? '—'}</p>
                  </div>
                  <span className="text-xs text-gray-400 italic">Not serializable</span>
                </div>
              )

              return (
                <div key={item.orderItemId} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div>
                    <span className="font-mono text-xs font-semibold text-gray-800">{item.sellerSku ?? '—'}</span>
                    <span className="text-xs text-gray-500 ml-2">×{item.quantityOrdered}</span>
                    <p className="text-xs text-gray-500 truncate">{item.title ?? '—'}</p>
                  </div>
                  <div className="space-y-1.5">
                    {Array.from({ length: item.quantityOrdered }, (_, i) => {
                      const key   = `${item.orderItemId}-${i}`
                      const state = serialInputs[key] ?? { value: '', valid: null, message: '', checking: false }
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-4 shrink-0">#{i + 1}</span>
                          <input
                            type="text"
                            placeholder="Enter serial number…"
                            value={state.value}
                            onChange={e => validateSerial(key, e.target.value, item.sellerSku ?? '')}
                            className={clsx(
                              'flex-1 h-8 rounded border px-2 text-xs font-mono focus:outline-none focus:ring-1',
                              state.valid === true  ? 'border-green-400 bg-green-50 focus:ring-green-400' :
                              state.valid === false ? 'border-red-400   bg-red-50   focus:ring-red-400' :
                              'border-gray-300 focus:ring-amazon-blue',
                            )}
                          />
                          <div className="w-5 shrink-0">
                            {state.checking && <RefreshCcw size={12} className="animate-spin text-gray-400" />}
                            {!state.checking && state.valid === true  && <CheckCircle2 size={14} className="text-green-500" />}
                            {!state.checking && state.valid === false && <AlertCircle  size={14} className="text-red-500" />}
                          </div>
                        </div>
                      )
                    })}
                    {/* Validation message (show the last non-empty one) */}
                    {Object.entries(serialInputs)
                      .filter(([k]) => k.startsWith(item.orderItemId))
                      .map(([k, s]) => s.message ? (
                        <p key={k} className={clsx('text-xs pl-6', s.valid ? 'text-green-600' : 'text-red-600')}>
                          {s.message}
                        </p>
                      ) : null)
                    }
                  </div>
                </div>
              )
            })}
          </>)}
        </div>

        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {submitErr && <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{submitErr}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleConfirm} disabled={submitting || !canConfirm || loading}
              className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
              {submitting ? <><RefreshCcw size={12} className="animate-spin" /> Confirming…</> : <><CheckCircle2 size={12} /> Confirm & Mark Shipped</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Wholesale Process Modal ───────────────────────────────────────────────────
// Mirrors ProcessOrderModal but uses wholesale inventory/process endpoints
// and the emerald color scheme.

function WholesaleProcessModal({ order, onClose, onProcessed }: {
  order: Order; onClose: () => void; onProcessed: () => void
}) {
  const [inventoryData, setInventoryData] = useState<OrderInventoryData | null>(null)
  const [loading, setLoading]             = useState(true)
  const [loadErr, setLoadErr]             = useState<string | null>(null)
  const [selections, setSelections]       = useState<Record<string, ReservationSelection>>({})
  const [processing, setProcessing]       = useState(false)
  const [processErr, setProcessErr]       = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setLoadErr(null)
    fetch(`/api/wholesale/orders/${order.id}/inventory`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then((data: OrderInventoryData) => {
        setInventoryData(data)
        const initial: Record<string, ReservationSelection> = {}
        for (const item of data.items) {
          if (!item.productId || item.locations.length === 0) continue
          const best = item.locations.find(l => l.qty >= item.quantityOrdered) ?? item.locations[0]
          initial[item.orderItemId] = {
            orderItemId: item.orderItemId, productId: item.productId,
            locationId: best.locationId, qtyReserved: Math.min(item.quantityOrdered, best.qty),
            gradeId: best.gradeId ?? null,
          }
        }
        setSelections(initial)
      })
      .catch(e => setLoadErr(e instanceof Error ? e.message : 'Failed to load inventory'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const allItemsHaveStock = inventoryData?.items.every(item =>
    !item.productId ? false : item.totalQtyAvailable >= item.quantityOrdered
  ) ?? false

  const allSelectionsValid = inventoryData?.items.every(item => {
    if (!item.productId) return false
    const sel = selections[item.orderItemId]
    if (!sel) return false
    const loc = item.locations.find(l => l.locationId === sel.locationId)
    return loc && sel.qtyReserved >= 1 && sel.qtyReserved <= loc.qty
  }) ?? false

  async function handleConfirm() {
    if (!allSelectionsValid) return
    setProcessing(true); setProcessErr(null)
    try {
      const res = await fetch(`/api/wholesale/orders/${order.id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservations: Object.values(selections) }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      onProcessed()
    } catch (e) { setProcessErr(e instanceof Error ? e.message : 'Failed to process order') }
    finally { setProcessing(false) }
  }

  const orderLabel = order.wholesaleOrderNumber ?? order.amazonOrderId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <ClipboardCheck size={15} className="text-emerald-600" /> Process Wholesale Order
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{orderLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-4"><RefreshCcw size={13} className="animate-spin" /> Loading inventory…</div>}
          {loadErr && <div className="flex items-start gap-2 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{loadErr}</div>}
          {!loading && inventoryData && inventoryData.items.map(item => {
            const sel        = selections[item.orderItemId]
            const hasProduct = !!item.productId
            const hasStock   = item.totalQtyAvailable >= item.quantityOrdered
            return (
              <div key={item.orderItemId} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs font-semibold text-gray-800">{item.sellerSku ?? '—'}</p>
                    <p className="text-xs text-gray-500 truncate">{item.title ?? '—'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Qty: <strong>{item.quantityOrdered}</strong></p>
                  </div>
                  {!hasProduct && <span className="inline-flex items-center gap-1 text-[10px] bg-gradient-to-r from-red-500 to-rose-500 text-white px-2 py-0.5 rounded font-semibold shrink-0 shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-white/70 animate-pulse shrink-0" />Out of Stock</span>}
                  {hasProduct && !hasStock && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium shrink-0">Out of stock</span>}
                  {hasProduct && hasStock && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium shrink-0">{item.totalQtyAvailable} available</span>}
                </div>
                {hasProduct && item.locations.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1"><MapPin size={10} /> Location &amp; Grade</label>
                    <select value={`${sel?.locationId ?? ''}::${sel?.gradeId ?? ''}`} onChange={e => {
                      const [locId, grId] = e.target.value.split('::')
                      const loc = item.locations.find(l => l.locationId === locId && (l.gradeId ?? '') === (grId ?? ''))
                      if (!loc || !item.productId) return
                      setSelections(prev => ({
                        ...prev,
                        [item.orderItemId]: {
                          orderItemId: item.orderItemId, productId: item.productId!,
                          locationId: loc.locationId, qtyReserved: Math.min(prev[item.orderItemId]?.qtyReserved ?? item.quantityOrdered, loc.qty),
                          gradeId: loc.gradeId ?? null,
                        },
                      }))
                    }} className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                      {item.locations.map(loc => (
                        <option key={`${loc.locationId}::${loc.gradeId ?? ''}`} value={`${loc.locationId}::${loc.gradeId ?? ''}`}>
                          {loc.warehouseName} › {loc.locationName}
                          {loc.gradeName ? ` [Grade ${loc.gradeName}]` : ''} — {loc.qty} avail
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-gray-600">Qty to reserve</label>
                      <input type="number" min={1} max={item.locations.find(l => l.locationId === sel?.locationId && (l.gradeId ?? null) === (sel?.gradeId ?? null))?.qty ?? item.quantityOrdered} value={sel?.qtyReserved ?? item.quantityOrdered}
                        onChange={e => {
                          const v = Math.max(1, parseInt(e.target.value) || 1)
                          setSelections(prev => ({ ...prev, [item.orderItemId]: { ...prev[item.orderItemId], qtyReserved: v } }))
                        }}
                        className="w-16 h-7 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      <span className="text-xs text-gray-400">of {item.quantityOrdered}</span>
                    </div>
                  </div>
                )}
                {hasProduct && item.locations.length === 0 && <p className="text-xs text-gray-500 italic">No inventory found for this SKU.</p>}
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {processErr && <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />{processErr}</div>}
          {!allItemsHaveStock && !loading && <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs"><AlertCircle size={12} className="shrink-0 mt-0.5" />One or more items are out of stock.</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleConfirm} disabled={processing || !allSelectionsValid || !allItemsHaveStock}
              className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
              {processing ? <><RefreshCcw size={12} className="animate-spin" /> Reserving…</> : 'Reserve & Process'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Wholesale Ship Modal ──────────────────────────────────────────────────────

type WholesaleSerialState = { value: string; valid: boolean | null; message: string; checking: boolean; serialId?: string }

function WholesaleShipModal({ order, onClose, onShipped }: {
  order: Order; onClose: () => void; onShipped: () => void
}) {
  const [carrier, setCarrier]   = useState('')
  const [tracking, setTracking] = useState('')
  const [serialInputs, setSerialInputs] = useState<Record<string, WholesaleSerialState>>({})
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState<string | null>(null)

  const serializableItems = order.items.filter(i => i.isSerializable)

  useEffect(() => {
    const initial: Record<string, WholesaleSerialState> = {}
    for (const item of serializableItems) {
      for (let i = 0; i < item.quantityOrdered; i++) {
        const key = `${item.orderItemId}-${i}`
        initial[key] = { value: '', valid: null, message: '', checking: false }
      }
    }
    setSerialInputs(initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const validateSerial = useCallback((key: string, sn: string, sku: string) => {
    if (!sn.trim()) {
      setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, valid: null, message: '', checking: false, serialId: undefined } }))
      return
    }
    setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, checking: true, valid: null, message: '', serialId: undefined } }))
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
    debounceRefs.current[key] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/serials/validate?sn=${encodeURIComponent(sn.trim())}&sku=${encodeURIComponent(sku)}`)
        const data: { valid: boolean; reason?: string; detail?: string; location?: string; serialId?: string } = await res.json()
        setSerialInputs(prev => ({
          ...prev,
          [key]: {
            value: sn,
            valid: data.valid,
            message: data.valid ? (data.location ?? '✓ Valid') : (data.detail ?? 'Invalid'),
            checking: false,
            serialId: data.valid ? data.serialId : undefined,
          },
        }))
      } catch {
        setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], checking: false, valid: false, message: 'Validation error', serialId: undefined } }))
      }
    }, 350)
  }, [])

  const needsSerials = serializableItems.length > 0

  const allSerialsValid = (() => {
    if (!needsSerials) return true
    for (const item of serializableItems) {
      for (let i = 0; i < item.quantityOrdered; i++) {
        const key = `${item.orderItemId}-${i}`
        const state = serialInputs[key]
        if (!state || !state.valid || state.checking) return false
      }
    }
    return true
  })()

  const canSubmit = carrier.trim() && tracking.trim() && allSerialsValid

  async function handleShip() {
    if (!canSubmit) return
    setSubmitting(true); setSubmitErr(null)
    try {
      const serials: { serialId: string; salesOrderItemId: string }[] = []
      for (const item of serializableItems) {
        for (let i = 0; i < item.quantityOrdered; i++) {
          const key = `${item.orderItemId}-${i}`
          const state = serialInputs[key]
          if (state?.valid && state.serialId) {
            serials.push({ serialId: state.serialId, salesOrderItemId: item.orderItemId })
          }
        }
      }
      const res = await fetch(`/api/wholesale/orders/${order.id}/ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: carrier.trim(), tracking: tracking.trim(), serials }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `${res.status}`)
      onShipped()
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Failed to ship order')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <Truck size={15} className="text-emerald-600" /> Ship Wholesale Order
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{order.wholesaleOrderNumber ?? order.amazonOrderId}</p>
            {order.wholesaleCustomerName && (
              <p className="text-xs text-gray-400 mt-0.5">{order.wholesaleCustomerName}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Carrier + Tracking */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-1">Carrier <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={carrier}
                onChange={e => setCarrier(e.target.value)}
                placeholder="e.g. UPS, FedEx, USPS…"
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-1">Tracking Number <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={tracking}
                onChange={e => setTracking(e.target.value)}
                placeholder="Tracking number…"
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Order Items */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              Order Items {needsSerials && <span className="text-amber-600 normal-case font-normal">(serial numbers required)</span>}
            </p>
            <div className="space-y-3">
              {order.items.map(item => (
                <div key={item.id} className={clsx('rounded-lg border p-3 space-y-2', item.isSerializable ? 'border-gray-200' : 'border-gray-100 bg-gray-50/60')}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-semibold text-gray-800">{item.sellerSku ?? '—'}</span>
                      <span className="text-xs text-gray-400 ml-2">×{item.quantityOrdered}</span>
                      {item.title && <p className="text-xs text-gray-500 truncate mt-0.5">{item.title}</p>}
                    </div>
                    {!item.isSerializable && <span className="text-[9px] text-gray-400 italic shrink-0">Not serializable</span>}
                  </div>
                  {item.isSerializable && (
                    <div className="space-y-1.5">
                      {Array.from({ length: item.quantityOrdered }, (_, i) => {
                        const key   = `${item.orderItemId}-${i}`
                        const state = serialInputs[key] ?? { value: '', valid: null, message: '', checking: false }
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-4 shrink-0">#{i + 1}</span>
                            <input
                              type="text"
                              placeholder="Enter serial number…"
                              value={state.value}
                              onChange={e => validateSerial(key, e.target.value, item.sellerSku ?? '')}
                              className={clsx(
                                'flex-1 h-8 rounded border px-2 text-xs font-mono focus:outline-none focus:ring-1',
                                state.valid === true  ? 'border-green-400 bg-green-50 focus:ring-green-400' :
                                state.valid === false ? 'border-red-400   bg-red-50   focus:ring-red-400' :
                                'border-gray-300 focus:ring-emerald-500',
                              )}
                            />
                            <div className="w-5 shrink-0">
                              {state.checking && <RefreshCcw size={12} className="animate-spin text-gray-400" />}
                              {!state.checking && state.valid === true  && <CheckCircle2 size={14} className="text-green-500" />}
                              {!state.checking && state.valid === false && <AlertCircle  size={14} className="text-red-500" />}
                            </div>
                          </div>
                        )
                      })}
                      {Object.entries(serialInputs)
                        .filter(([k]) => k.startsWith(item.orderItemId))
                        .map(([k, s]) => s.message ? (
                          <p key={k} className={clsx('text-xs pl-6', s.valid ? 'text-green-600' : 'text-red-600')}>
                            {s.message}
                          </p>
                        ) : null)
                      }
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {submitErr && (
            <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />{submitErr}
            </div>
          )}
          {needsSerials && !allSerialsValid && (
            <p className="text-xs text-amber-700 flex items-center gap-1">
              <AlertCircle size={11} /> All serial numbers must be validated before shipping.
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleShip} disabled={submitting || !canSubmit}
              className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
              {submitting ? <><RefreshCcw size={12} className="animate-spin" /> Shipping…</> : <><Truck size={12} /> Mark as Shipped</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Order Detail Modal ────────────────────────────────────────────────────────

const WORKFLOW_BADGE: Record<string, string> = {
  PENDING:               'bg-yellow-100 text-yellow-800 border border-yellow-200',
  PROCESSING:            'bg-blue-100 text-blue-800 border border-blue-200',
  AWAITING_VERIFICATION: 'bg-purple-100 text-purple-800 border border-purple-200',
  SHIPPED:               'bg-green-100 text-green-800 border border-green-200',
  CANCELLED:             'bg-red-100 text-red-800 border border-red-200',
}
const WORKFLOW_LABEL: Record<string, string> = {
  PENDING:               'Pending',
  PROCESSING:            'Unshipped',
  AWAITING_VERIFICATION: 'Awaiting Verification',
  SHIPPED:               'Shipped',
  CANCELLED:             'Cancelled',
}
const AMAZON_BADGE: Record<string, string> = {
  Pending:          'bg-yellow-50 text-yellow-700 border border-yellow-200',
  Unshipped:        'bg-orange-50 text-orange-700 border border-orange-200',
  PartiallyShipped: 'bg-amber-50 text-amber-700 border border-amber-200',
  Shipped:          'bg-green-50 text-green-700 border border-green-200',
  Canceled:         'bg-gray-100 text-gray-500 border border-gray-200',
}
const FULFILLMENT_LABEL: Record<string, string> = {
  MFN: 'Merchant (MFN)',
  AFN: 'Amazon FBA',
}

function SectionCard({ title, icon, children, action }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
        <h3 className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
          {icon}{title}
        </h3>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function OrderDetailModal({
  order, onClose, onSkuChanged,
}: {
  order: Order
  onClose: () => void
  onSkuChanged?: (itemId: string, newSku: string | null, newTitle: string | null | undefined) => void
}) {
  const [addr, setAddr] = useState({
    shipToName: order.shipToName, shipToAddress1: order.shipToAddress1,
    shipToAddress2: order.shipToAddress2, shipToCity: order.shipToCity,
    shipToState: order.shipToState, shipToPostal: order.shipToPostal,
    shipToCountry: order.shipToCountry, shipToPhone: order.shipToPhone,
  })
  const [syncingSS, setSyncingSS] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Local items state (so SKU edits are reflected instantly in the modal)
  const [localItems, setLocalItems] = useState(order.items)
  const [editingSkuItemId, setEditingSkuItemId] = useState<string | null>(null)
  const [editingSkuValue, setEditingSkuValue]   = useState('')

  // Pending SKU changes — staged locally, committed only when user clicks Save
  type PendingSkuChange = { newSku: string | null; newTitle: string | null; originalSku: string | null; originalTitle: string | null }
  const [pendingSkuChanges, setPendingSkuChanges] = useState<Map<string, PendingSkuChange>>(() => new Map())
  const [savingSkuChanges, setSavingSkuChanges]   = useState(false)

  // SKU autocomplete
  type SkuSuggestion = { sku: string; description: string }
  const [skuSuggestions, setSkuSuggestions]     = useState<SkuSuggestion[]>([])
  const [skuSuggestIdx, setSkuSuggestIdx]       = useState(-1)
  const skuDebounceRef                          = useRef<ReturnType<typeof setTimeout> | null>(null)

  function fetchSkuSuggestions(query: string) {
    if (skuDebounceRef.current) clearTimeout(skuDebounceRef.current)
    if (!query.trim()) { setSkuSuggestions([]); return }
    skuDebounceRef.current = setTimeout(() => {
      fetch(`/api/products?search=${encodeURIComponent(query)}`)
        .then(r => r.ok ? r.json() : { data: [] })
        .then((d: { data: SkuSuggestion[] }) => {
          setSkuSuggestions((d.data ?? []).slice(0, 8))
          setSkuSuggestIdx(-1)
        })
        .catch(() => {})
    }, 200)
  }

  // Stage the picked suggestion locally — does NOT call the API
  function pickSkuSuggestion(s: SkuSuggestion) {
    if (!editingSkuItemId) return
    const itemId = editingSkuItemId
    const original = localItems.find(i => i.id === itemId)
    setPendingSkuChanges(prev => {
      const next = new Map(prev)
      next.set(itemId, {
        newSku:       s.sku,
        newTitle:     s.description || null,
        originalSku:  original?.sellerSku ?? null,
        originalTitle: original?.title ?? null,
      })
      return next
    })
    setLocalItems(prev => prev.map(i => i.id === itemId
      ? { ...i, sellerSku: s.sku, title: s.description || i.title }
      : i))
    setEditingSkuValue(s.sku)
    setSkuSuggestions([])
    setSkuSuggestIdx(-1)
    setEditingSkuItemId(null)
  }

  const isPendingOrder = order.workflowStatus === 'PENDING'

  // Commit all staged SKU changes to the DB, then close
  async function saveAllPendingChanges() {
    setSavingSkuChanges(true)
    for (const [itemId, change] of Array.from(pendingSkuChanges.entries())) {
      try {
        const res = await fetch(`/api/orders/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sellerSku: change.newSku }),
        })
        if (res.ok) {
          const data = await res.json() as { id: string; sellerSku: string | null; title: string | null }
          onSkuChanged?.(itemId, data.sellerSku, data.title)
        }
      } catch { /* ignore */ }
    }
    setSavingSkuChanges(false)
    setPendingSkuChanges(new Map())
    onClose()
  }

  // Discard staged changes and close
  function handleClose() {
    if (pendingSkuChanges.size > 0) {
      setLocalItems(prev => prev.map(i => {
        const pending = pendingSkuChanges.get(i.id)
        return pending ? { ...i, sellerSku: pending.originalSku, title: pending.originalTitle } : i
      }))
    }
    onClose()
  }

  async function syncFromShipStation() {
    setSyncingSS(true); setSyncMsg(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/sync-buyer-info`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Sync failed')
      setAddr({
        shipToName: data.shipTo.shipToName ?? null, shipToAddress1: data.shipTo.shipToAddress1 ?? null,
        shipToAddress2: data.shipTo.shipToAddress2 ?? null, shipToCity: data.shipTo.shipToCity ?? null,
        shipToState: data.shipTo.shipToState ?? null, shipToPostal: data.shipTo.shipToPostal ?? null,
        shipToCountry: data.shipTo.shipToCountry ?? null, shipToPhone: data.shipTo.shipToPhone ?? null,
      })
      setSyncMsg({ type: 'ok', text: 'Buyer info updated from ShipStation.' })
    } catch (e) {
      setSyncMsg({ type: 'err', text: e instanceof Error ? e.message : 'Sync failed' })
    } finally { setSyncingSS(false) }
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const itemsSubtotal = order.items.reduce((s, i) => {
    return s + (i.itemPrice ? parseFloat(i.itemPrice) * i.quantityOrdered : 0)
  }, 0)
  const shippingSubtotal = order.items.reduce((s, i) => {
    return s + (i.shippingPrice ? parseFloat(i.shippingPrice) : 0)
  }, 0)
  const orderTotalNum = order.orderTotal
    ? parseFloat(order.orderTotal)
    : itemsSubtotal + shippingSubtotal

  const addressLines = [
    addr.shipToAddress1, addr.shipToAddress2,
    [addr.shipToCity, addr.shipToState, addr.shipToPostal].filter(Boolean).join(', '),
    addr.shipToCountry,
  ].filter(Boolean) as string[]

  const hasAddress = addressLines.length > 0 || !!addr.shipToName

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-6 py-3.5 border-b bg-white shrink-0 rounded-t-xl">
          {/* Amazon logo */}
          <div className="shrink-0 w-9 h-9 rounded-lg bg-[#232F3E] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <path d="M4 20c7 5 17 5 24 0" stroke="#FF9900" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M22 17l4 3-4 3" stroke="#FF9900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <text x="3" y="13" fontFamily="Arial" fontWeight="900" fontSize="10" fill="white" letterSpacing="-0.5">amazon</text>
            </svg>
          </div>

          {/* Order identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Order Number</span>
              {order.isPrime && <PrimeBadge />}
              <a
                href={`https://sellercentral.amazon.com/orders-v3/order/${order.amazonOrderId}`}
                target="_blank" rel="noopener noreferrer"
                className="font-mono text-base font-bold text-amazon-blue hover:underline flex items-center gap-1"
              >
                {order.amazonOrderId} <ExternalLink size={11} className="text-gray-400" />
              </a>
              {order.olmNumber != null && (
                <span className="font-mono text-xs text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
                  OLM-{order.olmNumber}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-gray-500">Store: <strong className="text-gray-700">Amazon</strong></span>
              <span className="text-gray-300">|</span>
              <span className="text-xs text-gray-500">Status:</span>
              <span className={clsx('inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold',
                WORKFLOW_BADGE[order.workflowStatus] ?? 'bg-gray-100 text-gray-600 border border-gray-200')}>
                {WORKFLOW_LABEL[order.workflowStatus] ?? order.workflowStatus}
              </span>
              <span className={clsx('inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium',
                AMAZON_BADGE[order.orderStatus] ?? 'bg-gray-100 text-gray-500 border border-gray-200')}>
                {order.orderStatus}
              </span>
              {order.isBuyerRequestedCancel && (
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                  <AlertTriangle size={9} /> Buyer Cancel Request
                </span>
              )}
            </div>
          </div>

          <button onClick={handleClose} className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex gap-0 h-full">

            {/* ── Left sidebar: ORDER DETAILS ── */}
            <div className="w-56 shrink-0 border-r border-gray-200 px-4 py-4 space-y-1.5 bg-gray-50/50">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Order Details</p>

              {[
                { label: 'Order Date',    value: fmtDate(order.purchaseDate) },
                { label: 'Last Updated',  value: fmtDate(order.lastUpdateDate) },
                { label: 'Fulfillment',   value: order.fulfillmentChannel ? (FULFILLMENT_LABEL[order.fulfillmentChannel] ?? order.fulfillmentChannel) : null },
                { label: 'Service Level', value: order.shipmentServiceLevel },
                { label: 'Items Unshipped', value: String(order.numberOfItemsUnshipped) },
                { label: 'Processed',     value: order.processedAt ? fmtDate(order.processedAt) : null },
                { label: 'Last Synced',   value: fmtDate(order.lastSyncedAt) },
              ].filter(r => r.value != null).map(row => (
                <div key={row.label}>
                  <p className="text-[10px] text-gray-400 leading-none mb-0.5">{row.label}</p>
                  <p className="text-xs font-medium text-gray-800 leading-snug">{row.value}</p>
                </div>
              ))}

              {/* Order total block */}
              <div className="pt-3 mt-3 border-t border-gray-200">
                <p className="text-[10px] text-gray-400 leading-none mb-0.5">Items Subtotal</p>
                <p className="text-xs font-medium text-gray-700">{fmt(String(itemsSubtotal), order.currency)}</p>
              </div>
              {shippingSubtotal > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 leading-none mb-0.5">Shipping</p>
                  <p className="text-xs font-medium text-gray-700">{fmt(String(shippingSubtotal), order.currency)}</p>
                </div>
              )}
              <div className="pt-2 border-t border-gray-200">
                <p className="text-[10px] text-gray-400 leading-none mb-0.5">Order Total</p>
                <p className="text-sm font-bold text-gray-900">{fmt(String(orderTotalNum), order.currency)}</p>
              </div>

              {/* Buyer cancel reason */}
              {order.isBuyerRequestedCancel && (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide flex items-center gap-1 mb-1">
                    <AlertTriangle size={9} /> Cancel Request
                  </p>
                  <p className="text-[11px] text-amber-800">
                    {order.buyerCancelReason ?? 'Buyer requested cancellation'}
                  </p>
                </div>
              )}
            </div>

            {/* ── Main content ── */}
            <div className="flex-1 min-w-0 px-5 py-4 space-y-4 overflow-y-auto">

              {/* RECIPIENT INFO */}
              <SectionCard
                title="Recipient Info"
                icon={<MapPin size={11} />}
                action={
                  <button type="button" onClick={syncFromShipStation} disabled={syncingSS}
                    className="inline-flex items-center gap-1 h-6 px-2.5 rounded text-[10px] font-medium border border-gray-200 text-gray-500 hover:border-amazon-blue hover:text-amazon-blue disabled:opacity-40 transition-colors bg-white">
                    {syncingSS ? <><RefreshCcw size={9} className="animate-spin" /> Syncing…</> : <><RefreshCcw size={9} /> Sync from ShipStation</>}
                  </button>
                }
              >
                {syncMsg && (
                  <div className={clsx('mb-3 flex items-start gap-1.5 rounded px-2.5 py-1.5 text-xs',
                    syncMsg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200')}>
                    {syncMsg.type === 'ok' ? <CheckCircle2 size={11} className="shrink-0 mt-px" /> : <AlertCircle size={11} className="shrink-0 mt-px" />}
                    {syncMsg.text}
                    <button onClick={() => setSyncMsg(null)} className="ml-auto opacity-60 hover:opacity-100"><X size={10} /></button>
                  </div>
                )}
                <div className="flex gap-6">
                  {/* Ship-to house icon + address */}
                  <div className="flex gap-3 flex-1">
                    <div className="shrink-0 w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-400 mt-0.5">
                      <MapPin size={14} />
                    </div>
                    <div>
                      {hasAddress ? (
                        <div className="space-y-px">
                          {addr.shipToName && <p className="text-sm font-semibold text-gray-900">{addr.shipToName}</p>}
                          {addressLines.map((line, i) => <p key={i} className="text-sm text-gray-600">{line}</p>)}
                          {addr.shipToPhone && (
                            <p className="text-xs text-gray-500 pt-1 flex items-center gap-1.5">
                              <Phone size={10} /> {addr.shipToPhone}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">No address on file — sync from ShipStation to populate</p>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* ITEMS ORDERED */}
              <SectionCard title={`Items Ordered (${order.items.length})`} icon={<Package size={11} />}>
                <div className="-mx-4 -mt-3">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          SKU {isPendingOrder && <span className="ml-1 text-[9px] font-normal text-indigo-500 normal-case">(click to edit — must pick from list)</span>}
                        </th>
                        <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                        <th className="px-4 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Price</th>
                        <th className="px-4 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                        <th className="px-4 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Ext. Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {localItems.map(item => {
                        const extPrice = item.itemPrice ? parseFloat(item.itemPrice) * item.quantityOrdered : 0
                        const isEditingSku = editingSkuItemId === item.id
                        return (
                          <tr key={item.id} className="hover:bg-gray-50/60">
                            {/* SKU cell — editable on pending orders */}
                            <td className="px-4 py-2.5 whitespace-nowrap align-top">
                              {isPendingOrder && isEditingSku ? (
                                <div className="relative">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={editingSkuValue}
                                    onChange={e => { setEditingSkuValue(e.target.value); fetchSkuSuggestions(e.target.value) }}
                                    onKeyDown={e => {
                                      if (e.key === 'ArrowDown') { e.preventDefault(); setSkuSuggestIdx(i => Math.min(i + 1, skuSuggestions.length - 1)) }
                                      if (e.key === 'ArrowUp')   { e.preventDefault(); setSkuSuggestIdx(i => Math.max(i - 1, -1)) }
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        if (skuSuggestIdx >= 0 && skuSuggestions[skuSuggestIdx]) {
                                          pickSkuSuggestion(skuSuggestions[skuSuggestIdx])
                                        } else {
                                          // Must pick from list — discard free-form text
                                          setEditingSkuItemId(null)
                                          setSkuSuggestions([])
                                        }
                                      }
                                      if (e.key === 'Escape') { setEditingSkuItemId(null); setSkuSuggestions([]) }
                                    }}
                                    onBlur={() => { setTimeout(() => { setSkuSuggestions([]); setEditingSkuItemId(null) }, 150) }}
                                    className="font-mono text-[11px] border border-indigo-300 rounded px-2 py-1 w-52 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                    placeholder="Search and select SKU…"
                                  />
                                  {skuSuggestions.length > 0 && (
                                    <ul className="absolute z-50 top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                                      {skuSuggestions.map((s, i) => (
                                        <li
                                          key={s.sku}
                                          onMouseDown={e => { e.preventDefault(); pickSkuSuggestion(s) }}
                                          className={clsx(
                                            'flex flex-col px-3 py-2 cursor-pointer text-xs',
                                            i === skuSuggestIdx ? 'bg-indigo-50' : 'hover:bg-gray-50',
                                          )}
                                        >
                                          <span className="font-mono font-semibold text-gray-900">{s.sku}</span>
                                          {s.description && <span className="text-gray-400 truncate">{s.description}</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  <p className="text-[9px] text-gray-400 mt-1">Select from the list — free text not accepted</p>
                                </div>
                              ) : (
                                <button
                                  onClick={isPendingOrder ? () => { setEditingSkuItemId(item.id); setEditingSkuValue(item.sellerSku ?? '') } : undefined}
                                  className={clsx(
                                    'font-mono text-[11px] text-gray-700 text-left',
                                    isPendingOrder && 'group inline-flex items-center gap-1.5 hover:text-indigo-600 cursor-pointer',
                                  )}
                                >
                                  {item.sellerSku ?? <span className="text-gray-400 italic">—</span>}
                                  {isPendingOrder && <Pencil size={10} className="shrink-0 text-gray-300 group-hover:text-indigo-400 transition-colors" />}
                                  {/* Amber dot = unsaved staged change */}
                                  {pendingSkuChanges.has(item.id) && (
                                    <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved change — click Save Changes to apply" />
                                  )}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              <div className="flex items-start gap-2">
                                {item.asin ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`/api/asin-image?asin=${item.asin}`}
                                    alt={item.sellerSku ?? 'Product'}
                                    width={44}
                                    height={44}
                                    className="rounded border border-gray-200 object-contain bg-gray-50 shrink-0"
                                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                                  />
                                ) : (
                                  <div className="w-[44px] h-[44px] rounded border border-gray-200 bg-gray-100 shrink-0 flex items-center justify-center">
                                    <Package size={16} className="text-gray-300" />
                                  </div>
                                )}
                                <div>
                                  <p className="text-gray-800 font-medium leading-snug">{item.title ?? <span className="text-gray-400 italic">—</span>}</p>
                                  {item.asin && <p className="font-mono text-[10px] text-gray-400 mt-0.5">{item.asin}</p>}
                                  {item.quantityShipped > 0 && (
                                    <p className="text-[10px] text-gray-400 mt-0.5">{item.quantityShipped} shipped</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap align-top">
                              {item.itemPrice ? fmt(item.itemPrice, order.currency) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900 align-top">{item.quantityOrdered}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap align-top">
                              {extPrice > 0 ? fmt(String(extPrice), order.currency) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Totals block */}
                  <div className="border-t border-gray-200 px-4 pt-2 pb-1">
                    <div className="flex justify-end">
                      <dl className="space-y-1 text-xs w-56">
                        <div className="flex justify-between gap-6">
                          <dt className="text-gray-500">Sub total:</dt>
                          <dd className="tabular-nums font-medium text-gray-800">{fmt(String(itemsSubtotal), order.currency)}</dd>
                        </div>
                        <div className="flex justify-between gap-6">
                          <dt className="text-gray-500">Shipping:</dt>
                          <dd className="tabular-nums text-gray-700">{fmt(String(shippingSubtotal), order.currency)}</dd>
                        </div>
                        <div className="flex justify-between gap-6 border-t border-gray-200 pt-1.5 mt-1">
                          <dt className="font-semibold text-gray-700">Total:</dt>
                          <dd className="tabular-nums font-bold text-gray-900">{fmt(String(orderTotalNum), order.currency)}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* SHIPPING LABEL */}
              {order.label && (
                <SectionCard
                  title="Shipment"
                  icon={<Truck size={11} />}
                  action={order.label.isTest ? (
                    <span className="text-[9px] font-bold bg-yellow-100 text-yellow-700 border border-yellow-200 px-1.5 py-px rounded uppercase tracking-wide">Test Label</span>
                  ) : undefined}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    {order.label.carrier && (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Carrier</p>
                        <p className="font-semibold text-gray-900">{order.label.carrier}</p>
                      </div>
                    )}
                    {order.label.serviceCode && (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Service</p>
                        <p className="font-medium text-gray-800">{order.label.serviceCode}</p>
                      </div>
                    )}
                    {order.label.shipmentCost && (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Label Cost</p>
                        <p className="font-semibold text-gray-900">{fmt(order.label.shipmentCost, order.currency)}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Label Date</p>
                      <p className="font-medium text-gray-700">{fmtDate(order.label.createdAt)}</p>
                    </div>
                    <div className="col-span-2 sm:col-span-4">
                      <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Tracking Number</p>
                      <p className="font-mono font-semibold text-gray-900 text-sm">{order.label.trackingNumber}</p>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* SERIAL NUMBERS */}
              {order.serialAssignments && order.serialAssignments.length > 0 && (
                <SectionCard title={`Serialized Units (${order.serialAssignments.length})`} icon={<Hash size={11} />}>
                  <div className="-mx-4 -mt-3">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide w-8">#</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Serial Number</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {order.serialAssignments.map((sa, idx) => {
                          const item = order.items.find(i => i.id === sa.orderItemId)
                          return (
                            <tr key={sa.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2 text-gray-400 tabular-nums">{idx + 1}</td>
                              <td className="px-4 py-2 font-mono font-semibold text-gray-900">{sa.inventorySerial.serialNumber}</td>
                              <td className="px-4 py-2 font-mono text-gray-600">{item?.sellerSku ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t bg-gray-50 shrink-0 flex items-center justify-between rounded-b-xl">
          <span className="text-[11px] text-gray-400">Last synced from Amazon: {fmtDate(order.lastSyncedAt)}</span>
          <div className="flex items-center gap-3">
            {pendingSkuChanges.size > 0 && (
              <span className="text-[11px] text-amber-600 font-medium">
                {pendingSkuChanges.size} unsaved SKU change{pendingSkuChanges.size !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={handleClose}
              className="h-8 px-5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              {pendingSkuChanges.size > 0 ? 'Discard & Close' : 'Close'}
            </button>
            {pendingSkuChanges.size > 0 && (
              <button
                onClick={saveAllPendingChanges}
                disabled={savingSkuChanges}
                className="h-8 px-5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {savingSkuChanges
                  ? <><RefreshCcw size={11} className="animate-spin" /> Saving…</>
                  : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Connect ShipStation Modal ─────────────────────────────────────────────────

function ConnectSSModal({ onConnected, onClose }: { onConnected: (acct: SSAccount) => void; onClose: () => void }) {
  const [name, setName] = useState('ShipStation')
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleConnect() {
    if (!key.trim() || !secret.trim()) { setErr('API Key and Secret are required'); return }
    setSaving(true); setErr(null)
    try {
      const acct = await apiPost<SSAccount>('/api/shipstation/accounts', { name, apiKey: key.trim(), apiSecret: secret.trim() })
      onConnected(acct)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Connection failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-amazon-blue" />
            <h3 className="text-base font-semibold text-gray-900">Connect ShipStation</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Find your API credentials in ShipStation → Account → API Settings.</p>
        {err && <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs mb-3"><AlertCircle size={13} className="mt-0.5 shrink-0" />{err}</div>}
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Account Name</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">API Key <span className="text-red-500">*</span></label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue" placeholder="e.g. a1b2c3d4e5f6…" value={key} onChange={e => setKey(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">API Secret <span className="text-red-500">*</span></label>
            <input type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue" placeholder="••••••••" value={secret} onChange={e => setSecret(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleConnect() }} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleConnect} disabled={saving || !key.trim() || !secret.trim()} className="px-4 py-1.5 text-sm bg-amazon-blue text-white rounded-lg hover:opacity-90 disabled:opacity-50">{saving ? 'Connecting…' : 'Connect'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Label Panel ───────────────────────────────────────────────────────────────

interface SSShipTo { name: string; street1: string; street2?: string | null; city: string; state: string; postalCode: string; country: string; phone?: string | null }
type SSLookupResult =
  | { status: 'loading' }
  | { status: 'found';     ssOrderId: number; orderStatus: string; shipTo: SSShipTo }
  | { status: 'not_found'; error?: string }

interface SSWarehouseAddress { name: string; street1: string; city: string; state: string; postalCode: string; country: string; phone?: string | null }
interface SSWarehouse { warehouseId: number; warehouseName: string; originAddress: SSWarehouseAddress; isDefault: boolean }

interface SSRate {
  serviceName: string; serviceCode: string; carrierCode: string; carrierName?: string
  shipmentCost: number; otherCost: number; transitDays: number | null; deliveryDate: string | null; rate_id?: string
}

interface LabelPanelProps {
  order: Order; ssAccount: SSAccount | null; onClose: () => void
  onLabelSaved?: () => void  // called after real label is saved to DB
}

const FROM_ZIP_KEY  = 'ss_from_zip'
const WH_KEY        = 'ss_warehouse_id'
const TEST_MODE_KEY = 'ss_test_mode'

function LabelPanel({ order, ssAccount, onClose, onLabelSaved }: LabelPanelProps) {
  const [lookup, setLookup]         = useState<SSLookupResult>({ status: 'loading' })
  const [warehouses, setWarehouses] = useState<SSWarehouse[]>([])
  const [whLoading, setWhLoading]   = useState(false)
  const [selectedWhId, setSelectedWhId] = useState<string>('')
  const [pkg, setPkg]               = useState<PackageDimensions>(DEFAULT_PKG)
  const [weight, setWeight]         = useState<Weight>(DEFAULT_WT)
  const [fromZip, setFromZip]       = useState<string>('')
  const [confirmation, setConfirmation] = useState<string>('none')

  // Hydrate from localStorage after mount (avoids SSR/client mismatch)
  useEffect(() => {
    try {
      const storedWh   = localStorage.getItem(WH_KEY)
      const storedPkg  = localStorage.getItem(PKG_KEY)
      const storedWt   = localStorage.getItem(WT_KEY)
      const storedZip  = localStorage.getItem(FROM_ZIP_KEY)
      const storedConf = localStorage.getItem(CONF_KEY)
      if (storedWh)   setSelectedWhId(storedWh)
      if (storedPkg)  setPkg(JSON.parse(storedPkg))
      if (storedWt)   setWeight(JSON.parse(storedWt))
      if (storedZip)  setFromZip(storedZip)
      if (storedConf) setConfirmation(JSON.parse(storedConf))
    } catch { /* */ }
  }, [])

  useEffect(() => { localStorage.setItem(PKG_KEY, JSON.stringify(pkg)) }, [pkg])
  useEffect(() => { localStorage.setItem(WT_KEY, JSON.stringify(weight)) }, [weight])
  useEffect(() => { try { localStorage.setItem(FROM_ZIP_KEY, fromZip) } catch { /* */ } }, [fromZip])
  useEffect(() => { localStorage.setItem(CONF_KEY, JSON.stringify(confirmation)) }, [confirmation])
  useEffect(() => { try { localStorage.setItem(WH_KEY, selectedWhId) } catch { /* */ } }, [selectedWhId])

  const [rates, setRates]               = useState<SSRate[] | null>(null)
  const [amazonServices, setAmazonServices] = useState<{ code: string; name: string; carrierCode: string; carrierName: string; shipmentCost?: number }[] | null>(null)
  const [loadingRates, setLoadingRates] = useState(false)
  const [ratesErr, setRatesErr]         = useState<string | null>(null)
  const [jwtStatus, setJwtStatus]       = useState<'expired' | 'missing' | null>(null)
  const [testMode, setTestMode]         = useState<boolean>(false)
  useEffect(() => {
    try { if (localStorage.getItem(TEST_MODE_KEY) === 'true') setTestMode(true) } catch { /* */ }
  }, [])
  useEffect(() => { try { localStorage.setItem(TEST_MODE_KEY, String(testMode)) } catch { /* */ } }, [testMode])

  const [purchasing, setPurchasing]     = useState<string | null>(null)
  const [purchaseErr, setPurchaseErr]   = useState<string | null>(null)
  const [purchased, setPurchased]       = useState<{ trackingNumber: string; labelData: string; labelFormat: string; isTest?: boolean } | null>(null)
  const [savingLabel, setSavingLabel]   = useState(false)

  useEffect(() => {
    if (!ssAccount) { setLookup({ status: 'not_found', error: 'No ShipStation account connected.' }); return }
    setLookup({ status: 'loading' })
    fetch(`/api/shipstation/order-lookup?amazonOrderId=${encodeURIComponent(order.amazonOrderId)}`)
      .then(r => r.json())
      .then((data: { found: boolean; ssOrderId?: number; orderStatus?: string; shipTo?: SSShipTo; error?: string }) => {
        if (data.found && data.ssOrderId && data.shipTo) setLookup({ status: 'found', ssOrderId: data.ssOrderId, orderStatus: data.orderStatus ?? '', shipTo: data.shipTo })
        else setLookup({ status: 'not_found', error: data.error })
      })
      .catch(e => setLookup({ status: 'not_found', error: e instanceof Error ? e.message : 'Lookup failed' }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.amazonOrderId, ssAccount?.id])

  useEffect(() => {
    if (!ssAccount) return
    setWhLoading(true)
    fetch('/api/shipstation/warehouses')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: SSWarehouse[]) => {
        if (!Array.isArray(data) || data.length === 0) return
        setWarehouses(data)
        const stored = data.find(w => String(w.warehouseId) === selectedWhId)
        const wh = stored ?? data.find(w => w.isDefault) ?? data[0]
        setSelectedWhId(String(wh.warehouseId)); setFromZip(wh.originAddress.postalCode)
      })
      .catch(() => {})
      .finally(() => setWhLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssAccount?.id])

  async function getRates() {
    if (lookup.status !== 'found' || !fromZip) return
    setLoadingRates(true); setRatesErr(null); setRates(null); setAmazonServices(null); setPurchased(null); setJwtStatus(null)
    try {
      const { shipTo } = lookup
      const selectedWh = warehouses.find(w => String(w.warehouseId) === selectedWhId)
      const data = await apiPost<{ rates: SSRate[]; errors?: string[]; jwtExpired?: boolean; amazonServices?: { code: string; name: string; carrierCode: string; carrierName: string; shipmentCost?: number }[] }>(
        '/api/shipstation/rate-shop', {
          warehouseId: selectedWh?.warehouseId, orderId: lookup.ssOrderId,
          fromPostalCode: fromZip, fromCity: selectedWh?.originAddress.city,
          fromState: selectedWh?.originAddress.state, fromAddress1: selectedWh?.originAddress.street1,
          fromName: selectedWh?.originAddress.name, fromPhone: selectedWh?.originAddress.phone,
          fromCountry: selectedWh?.originAddress.country ?? 'US',
          toState: shipTo.state, toCountry: shipTo.country || 'US',
          toPostalCode: shipTo.postalCode, toCity: shipTo.city,
          toName: shipTo.name, toPhone: shipTo.phone,
          toAddress1: shipTo.street1, toAddress2: shipTo.street2,
          weight: { value: weight.value, units: weight.unit },
          dimensions: { units: pkg.unit, length: pkg.length, width: pkg.width, height: pkg.height },
          confirmation, residential: true,
          amazonOrderId: order.amazonOrderId,
          orderItems: order.items.map(item => ({ orderItemId: item.orderItemId, title: item.title, quantity: item.quantityOrdered })),
        })
      setRates(Array.isArray(data.rates) ? data.rates : [])
      if (data.amazonServices?.length) setAmazonServices(data.amazonServices)
      if (data.jwtExpired) setJwtStatus('expired')
      else if (data.errors?.some(e => e.toLowerCase().includes('session token'))) setJwtStatus('missing')
      if (data.errors?.length) {
        const nonJwt = data.errors.filter(e => !e.toLowerCase().includes('session token'))
        if (nonJwt.length) setRatesErr(nonJwt.join(' · '))
      }
    } catch (e) { setRatesErr(e instanceof Error ? e.message : 'Failed to get rates') }
    finally { setLoadingRates(false) }
  }

  async function buyLabel(rate: SSRate) {
    if (lookup.status !== 'found') return
    setPurchasing(`${rate.carrierCode}-${rate.serviceCode}`); setPurchaseErr(null)
    try {
      const label = await apiPost<{ trackingNumber: string; labelData: string; labelFormat: string; shipmentCost?: number }>(
        '/api/shipstation/label-for-order', {
          orderId: lookup.ssOrderId, carrierCode: rate.carrierCode, serviceCode: rate.serviceCode,
          packageCode: 'package', confirmation, shipDate: new Date().toISOString().slice(0, 10),
          weight: { value: weight.value, units: weight.unit },
          dimensions: { units: pkg.unit, length: pkg.length, width: pkg.width, height: pkg.height },
          testLabel: testMode,
          ...(rate.rate_id ? { rateId: rate.rate_id } : {}),
        },
      )
      setPurchased({ ...label, isTest: testMode })

      // ── Save real label to DB and move order to Awaiting Verification ──────
      if (!testMode) {
        setSavingLabel(true)
        try {
          await apiPost(`/api/orders/${order.id}/save-label`, {
            trackingNumber: label.trackingNumber,
            labelData:      label.labelData,
            labelFormat:    label.labelFormat ?? 'pdf',
            shipmentCost:   rate.shipmentCost + rate.otherCost,
            carrier:        rate.carrierCode,
            serviceCode:    rate.serviceCode,
          })
          // Notify parent so the unshipped list refreshes and order disappears
          onLabelSaved?.()
        } catch (e) {
          // Non-fatal: label was purchased, just couldn't save to DB
          console.error('[LabelPanel] Failed to save label to DB:', e)
        } finally { setSavingLabel(false) }
      }
    } catch (e) { setPurchaseErr(e instanceof Error ? e.message : 'Failed to create label') }
    finally { setPurchasing(null) }
  }

  const ratesReady = lookup.status === 'found' && !!fromZip

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-[480px] bg-white shadow-2xl border-l border-gray-200">
      <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 shrink-0">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Truck size={15} className="text-[#FF9900]" /> Shipping Rates</h2>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{order.amazonOrderId}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setTestMode(m => !m)}
            className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors',
              testMode ? 'bg-amber-100 border-amber-400 text-amber-700' : 'bg-gray-100 border-gray-300 text-gray-400 hover:border-gray-400')}
            title={testMode ? 'Test mode ON — labels will NOT mark packages as shipped' : 'Test mode OFF — labels are real'}>
            <FlaskConical size={11} /> TEST
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {purchased && (
          <div className={clsx('border rounded-xl p-4 space-y-3', purchased.isTest ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-200')}>
            <div className={clsx('flex items-center gap-2', purchased.isTest ? 'text-amber-700' : 'text-green-700')}>
              {purchased.isTest ? <FlaskConical size={18} /> : <CheckCircle2 size={18} />}
              <span className="font-semibold text-sm">{purchased.isTest ? 'Test Label Created' : 'Label Created!'}</span>
              {purchased.isTest && <span className="ml-auto text-xs font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">TEST — not shipped</span>}
              {!purchased.isTest && savingLabel && <span className="ml-auto text-xs text-green-600 flex items-center gap-1"><RefreshCcw size={10} className="animate-spin" /> Saving…</span>}
              {!purchased.isTest && !savingLabel && <span className="ml-auto text-xs font-semibold text-green-700 bg-green-200 px-2 py-0.5 rounded-full">Moved to Awaiting Verification</span>}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 mb-0.5">Tracking Number</p>
              <p className="font-mono text-sm font-bold text-gray-900">{purchased.trackingNumber}</p>
            </div>
            <button onClick={() => downloadLabelData(purchased.labelData, purchased.labelFormat, `label-${order.amazonOrderId}`)}
              className="w-full flex items-center justify-center gap-2 bg-green-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-green-700">
              <Download size={14} /> Download Label
            </button>
            <button onClick={() => { setPurchased(null); setRates(null) }} className="w-full text-xs text-gray-500 hover:text-gray-700 text-center">Buy another label</button>
          </div>
        )}

        {!purchased && (<>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
            {order.items.map(item => (
              <div key={item.id} className="flex items-start gap-2 text-xs">
                <span className="font-mono text-gray-600 shrink-0">{item.sellerSku ?? '—'}</span>
                <span className="text-gray-500">×{item.quantityOrdered}</span>
                <span className="text-gray-700 truncate">{item.title ?? '—'}</span>
              </div>
            ))}
          </div>

          <section>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">ShipStation Order</h3>
            {lookup.status === 'loading' && <div className="flex items-center gap-2 text-sm text-gray-500 py-2"><RefreshCcw size={13} className="animate-spin" /> Looking up order…</div>}
            {lookup.status === 'not_found' && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 space-y-1">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5"><AlertCircle size={13} /> Order not found in ShipStation</p>
                <p className="text-xs text-amber-700">{lookup.error ?? 'Make sure your Amazon store is connected to ShipStation and orders are synced.'}</p>
              </div>
            )}
            {lookup.status === 'found' && (
              <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700"><CheckCircle2 size={13} /> Found — SS #{lookup.ssOrderId}</span>
                  <span className="text-[10px] bg-green-200 text-green-800 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">{lookup.orderStatus.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-xs text-green-800 space-y-0.5 pt-0.5">
                  {lookup.shipTo.name    && <p className="font-medium">{lookup.shipTo.name}</p>}
                  {lookup.shipTo.street1 && <p>{lookup.shipTo.street1}{lookup.shipTo.street2 ? `, ${lookup.shipTo.street2}` : ''}</p>}
                  <p>{[lookup.shipTo.city, lookup.shipTo.state, lookup.shipTo.postalCode].filter(Boolean).join(' ')}</p>
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Package</h3>
            <div className="flex gap-2 mb-2">
              {(['length', 'width', 'height'] as const).map(dim => (
                <div key={dim} className="flex-1 flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600 capitalize">{dim}</label>
                  <input type="number" min={0} step={0.1} value={pkg[dim]} onChange={e => setPkg(p => ({ ...p, [dim]: parseFloat(e.target.value) || 0 }))} className="h-8 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF9900]" />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Unit</label>
                <select value={pkg.unit} onChange={e => setPkg(p => ({ ...p, unit: e.target.value as PackageDimensions['unit'] }))} className="h-8 rounded border border-gray-300 px-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FF9900]">
                  <option value="inches">in</option><option value="centimeters">cm</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Weight</label>
                <input type="number" min={0} step={0.1} value={weight.value} onChange={e => setWeight(w => ({ ...w, value: parseFloat(e.target.value) || 0 }))} className="h-8 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF9900]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Unit</label>
                <select value={weight.unit} onChange={e => setWeight(w => ({ ...w, unit: e.target.value as Weight['unit'] }))} className="h-8 rounded border border-gray-300 px-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FF9900]">
                  <option value="ounces">oz</option><option value="pounds">lb</option><option value="grams">g</option><option value="kilograms">kg</option>
                </select>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Shipping Options</h3>
            <div className="flex gap-3 flex-wrap">
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <label className="text-xs font-medium text-gray-600">Ship From</label>
                {whLoading ? <div className="flex items-center gap-1.5 h-8 text-xs text-gray-400"><RefreshCcw size={11} className="animate-spin" /> Loading…</div>
                : warehouses.length > 0 ? (
                  <select value={selectedWhId} onChange={e => { const wh = warehouses.find(w => String(w.warehouseId) === e.target.value); if (wh) { setSelectedWhId(String(wh.warehouseId)); setFromZip(wh.originAddress.postalCode); setRates(null) } }} className="h-8 rounded border border-gray-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FF9900] truncate">
                    {warehouses.map(wh => <option key={wh.warehouseId} value={String(wh.warehouseId)}>{wh.warehouseName} — {wh.originAddress.city}, {wh.originAddress.state} {wh.originAddress.postalCode}</option>)}
                  </select>
                ) : (
                  <input value={fromZip} onChange={e => { setFromZip(e.target.value); setRates(null) }} placeholder="e.g. 78701" maxLength={10} className="h-8 w-28 rounded border border-gray-300 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#FF9900]" />
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <label className="text-xs font-medium text-gray-600">Confirmation</label>
                <select value={confirmation} onChange={e => { setConfirmation(e.target.value); setRates(null) }} className="h-8 rounded border border-gray-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FF9900]">
                  <option value="none">None</option><option value="delivery">Delivery</option><option value="signature">Signature</option><option value="adult_signature">Adult Signature</option>
                </select>
              </div>
            </div>
          </section>

          {jwtStatus && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-500" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{jwtStatus === 'expired' ? 'Amazon Buy Shipping session token expired' : 'Amazon Buy Shipping not configured'}</p>
                <p className="mt-0.5 text-amber-700">{jwtStatus === 'expired' ? 'Refresh your ShipStation session token to get Amazon rates.' : 'Add a ShipStation session token to get Amazon Buy Shipping rates.'}</p>
              </div>
              <a href="/shipstation" target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900 whitespace-nowrap">Settings →</a>
            </div>
          )}

          <button onClick={getRates} disabled={loadingRates || !ratesReady}
            className={clsx('w-full h-10 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors',
              loadingRates || !ratesReady ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#FF9900] text-white hover:bg-orange-500')}>
            {loadingRates ? <><RefreshCcw size={13} className="animate-spin" /> Getting rates…</> : 'Get Shipping Rates'}
          </button>

          {ratesErr && <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{ratesErr}</span></div>}
          {purchaseErr && <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{purchaseErr}</span></div>}

          {amazonServices && amazonServices.length > 0 && (
            <section className="space-y-2">
              <div>
                <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Amazon Buy Shipping — {amazonServices.length} service{amazonServices.length !== 1 ? 's' : ''}</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Amazon discounted &amp; seller-protected rates.</p>
              </div>
              {amazonServices.sort((a, b) => (a.shipmentCost ?? 999) - (b.shipmentCost ?? 999)).map((svc, idx) => {
                const key = `${svc.carrierCode}-${svc.code}`, isBuying = purchasing === key
                return (
                  <div key={`${key}-${idx}`} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[#FF9900]/40 bg-orange-50/40 hover:border-[#FF9900] transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{svc.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{svc.carrierName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {svc.shipmentCost !== undefined ? <span className="text-sm font-bold text-gray-900">${svc.shipmentCost.toFixed(2)}</span> : <span className="text-xs text-gray-400 italic">Price at purchase</span>}
                      <button onClick={() => buyLabel({ serviceName: svc.name, serviceCode: svc.code, carrierCode: svc.carrierCode, carrierName: svc.carrierName, shipmentCost: svc.shipmentCost ?? 0, otherCost: 0, transitDays: null, deliveryDate: null })} disabled={!!purchasing}
                        className={clsx('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors', purchasing ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#FF9900] text-white hover:bg-orange-500')}>
                        {isBuying ? <RefreshCcw size={11} className="animate-spin" /> : <Download size={11} />}{isBuying ? 'Buying…' : 'Buy'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {rates !== null && rates.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{rates.length} Available Rate{rates.length !== 1 ? 's' : ''} — cheapest first</h3>
              {rates.map((rate, idx) => {
                const total = rate.shipmentCost + rate.otherCost, isBuying = purchasing === `${rate.carrierCode}-${rate.serviceCode}`
                return (
                  <div key={`${rate.carrierCode}-${rate.serviceCode}-${idx}`} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#FF9900] transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{rate.serviceName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{rate.carrierName ?? rate.carrierCode}{rate.transitDays != null ? ` · ${rate.transitDays}d` : ''}{rate.deliveryDate ? ` · Est. ${new Date(rate.deliveryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-gray-900">${total.toFixed(2)}</span>
                      <button onClick={() => buyLabel(rate)} disabled={!!purchasing}
                        className={clsx('flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-colors', purchasing ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-[#FF9900] text-white hover:bg-orange-500')}>
                        {isBuying ? <RefreshCcw size={11} className="animate-spin" /> : <Download size={11} />}{isBuying ? 'Buying…' : 'Buy'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          )}
          {rates !== null && rates.length === 0 && <p className="text-sm text-gray-500 text-center py-2">No shipping rates available for this route.</p>}
        </>)}
      </div>
    </div>
  )
}

// ─── Tab configuration ────────────────────────────────────────────────────────

interface ShippingPreset {
  id: string; name: string; carrierCode: string; serviceCode: string | null; packageCode: string | null
  weightValue: number; weightUnit: string; dimLength: number | null; dimWidth: number | null; dimHeight: number | null
  dimUnit: string; confirmation: string | null; isDefault: boolean
}

interface PackagePreset {
  id: string; name: string; packageCode: string | null
  weightValue: number; weightUnit: string; dimLength: number | null; dimWidth: number | null; dimHeight: number | null
  dimUnit: string; confirmation: string | null; isDefault: boolean
}

// ─── Preset Management Modal ───────────────────────────────────────────────────

const WEIGHT_UNITS = ['ounces', 'pounds', 'grams', 'kilograms'] as const
const DIM_UNITS    = ['inches', 'centimeters'] as const
const CONF_OPTIONS = ['none', 'delivery', 'signature', 'adult_signature'] as const

interface SSCarrierOption  { code: string; name: string; nickname: string | null }
interface SSServiceOption  { code: string; name: string }
interface SSPackageOption  { code: string; name: string }

function PresetManagementModal({ onClose, onChange }: {
  onClose: () => void
  onChange: () => void
}) {
  const [presets, setPresets]   = useState<ShippingPreset[]>([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState<ShippingPreset | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  // Carrier / service / package options
  const [carriers, setCarriers]     = useState<SSCarrierOption[]>([])
  const [services, setServices]     = useState<SSServiceOption[]>([])
  const [packages, setPackages]     = useState<SSPackageOption[]>([])
  const [loadingCarriers, setLoadingCarriers] = useState(false)
  const [loadingServices, setLoadingServices] = useState(false)
  const [loadingPackages, setLoadingPackages] = useState(false)

  const blankPreset: Omit<ShippingPreset, 'id'> = {
    name: '', carrierCode: '', serviceCode: null, packageCode: null,
    weightValue: 16, weightUnit: 'ounces', dimLength: null, dimWidth: null, dimHeight: null,
    dimUnit: 'inches', confirmation: null, isDefault: false,
  }
  const [form, setForm] = useState<Omit<ShippingPreset, 'id'>>(blankPreset)

  function loadPresets() {
    setLoading(true)
    fetch('/api/shipping-presets')
      .then(r => r.json()).then(d => setPresets(Array.isArray(d) ? d : []))
      .catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadPresets()
    // Load V1 carriers for the dropdown
    setLoadingCarriers(true)
    fetch('/api/shipstation/carriers')
      .then(r => r.ok ? r.json() : null)
      .then((d: { v1?: { ok: boolean; carriers?: { code: string; name: string; nickname: string | null }[] } } | null) => {
        if (d?.v1?.ok && Array.isArray(d.v1.carriers)) {
          setCarriers(d.v1.carriers.map(c => ({ code: c.code, name: c.name, nickname: c.nickname })))
        }
      })
      .catch(() => {})
      .finally(() => setLoadingCarriers(false))
  }, [])

  // Load services + packages whenever the selected carrier changes
  useEffect(() => {
    if (!form.carrierCode) { setServices([]); setPackages([]); return }
    setLoadingServices(true)
    setLoadingPackages(true)
    setServices([]); setPackages([])
    fetch(`/api/shipstation/carrier-services?carrierCode=${encodeURIComponent(form.carrierCode)}`)
      .then(r => r.ok ? r.json() : [])
      .then((d: { code: string; name: string }[]) => { if (Array.isArray(d)) setServices(d.map(s => ({ code: s.code, name: s.name }))) })
      .catch(() => {})
      .finally(() => setLoadingServices(false))
    fetch(`/api/shipstation/carrier-packages?carrierCode=${encodeURIComponent(form.carrierCode)}`)
      .then(r => r.ok ? r.json() : [])
      .then((d: { code: string; name: string }[]) => { if (Array.isArray(d)) setPackages(d.map(p => ({ code: p.code, name: p.name }))) })
      .catch(() => {})
      .finally(() => setLoadingPackages(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.carrierCode])

  function startCreate() { setForm(blankPreset); setEditing(null); setCreating(true); setErr(null) }
  function startEdit(p: ShippingPreset) {
    setForm({ name: p.name, carrierCode: p.carrierCode, serviceCode: p.serviceCode, packageCode: p.packageCode,
      weightValue: p.weightValue, weightUnit: p.weightUnit, dimLength: p.dimLength, dimWidth: p.dimWidth,
      dimHeight: p.dimHeight, dimUnit: p.dimUnit, confirmation: p.confirmation, isDefault: p.isDefault })
    setEditing(p); setCreating(false); setErr(null)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.carrierCode.trim()) { setErr('Name and Carrier Code are required'); return }
    if (!form.weightValue || form.weightValue <= 0) { setErr('Weight must be greater than 0'); return }
    setSaving(true); setErr(null)
    try {
      const url    = editing ? `/api/shipping-presets/${editing.id}` : '/api/shipping-presets'
      const method = editing ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `${res.status}`)
      setEditing(null); setCreating(false); loadPresets(); onChange()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save') }
    finally { setSaving(false) }
  }

  async function handleDelete(p: ShippingPreset) {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    try {
      const res = await fetch(`/api/shipping-presets/${p.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `${res.status}`) }
      loadPresets(); onChange()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to delete') }
  }

  const showForm = creating || editing !== null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <Package size={14} className="text-amazon-blue" /> Shipping Presets
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Preset list */}
          {!showForm && (
            <>
              {loading && <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><RefreshCcw size={12} className="animate-spin" /> Loading…</div>}
              {!loading && presets.length === 0 && <p className="text-xs text-gray-400 italic py-4 text-center">No presets yet. Click "New Preset" to create one.</p>}
              {!loading && presets.length > 0 && (
                <div className="space-y-2">
                  {presets.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 bg-gray-50/60">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-900">{p.name}</span>
                          {p.isDefault && <span className="text-[9px] bg-amazon-blue text-white px-1.5 py-px rounded font-medium">DEFAULT</span>}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5 font-mono">
                          {p.carrierCode}{p.serviceCode ? ` › ${p.serviceCode}` : ''} · {p.weightValue} {p.weightUnit}
                          {p.dimLength && p.dimWidth && p.dimHeight ? ` · ${p.dimLength}×${p.dimWidth}×${p.dimHeight} ${p.dimUnit}` : ''}
                          {p.confirmation && p.confirmation !== 'none' ? ` · ${p.confirmation}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => startEdit(p)} className="h-6 px-2 rounded text-[10px] border border-gray-300 text-gray-600 hover:bg-gray-100">Edit</button>
                        <button onClick={() => handleDelete(p)} className="h-6 px-2 rounded text-[10px] border border-red-200 text-red-600 hover:bg-red-50">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={startCreate} className="flex items-center gap-1.5 h-7 px-3 rounded border border-dashed border-amazon-blue text-amazon-blue text-xs hover:bg-blue-50 transition-colors">
                + New Preset
              </button>
            </>
          )}

          {/* Create / Edit form */}
          {showForm && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{creating ? 'New Preset' : `Edit: ${editing?.name}`}</h4>
              {err && <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={11} className="shrink-0 mt-px" />{err}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Preset Name <span className="text-red-500">*</span></label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue" placeholder="e.g. USPS Priority Small" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Carrier <span className="text-red-500">*</span></label>
                  <select value={form.carrierCode}
                    onChange={e => setForm(f => ({ ...f, carrierCode: e.target.value, serviceCode: null, packageCode: null }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:opacity-50"
                    disabled={loadingCarriers}>
                    <option value="">{loadingCarriers ? 'Loading carriers…' : '— Select carrier —'}</option>
                    {carriers.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.nickname ? `${c.nickname} (${c.code})` : `${c.name} (${c.code})`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Service</label>
                  <select value={form.serviceCode ?? ''}
                    onChange={e => setForm(f => ({ ...f, serviceCode: e.target.value || null }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:opacity-50"
                    disabled={!form.carrierCode || loadingServices}>
                    <option value="">
                      {!form.carrierCode ? '— Select carrier first —' : loadingServices ? 'Loading…' : '— Cheapest available —'}
                    </option>
                    {services.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Package Type</label>
                  <select value={form.packageCode ?? ''}
                    onChange={e => setForm(f => ({ ...f, packageCode: e.target.value || null }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:opacity-50"
                    disabled={!form.carrierCode || loadingPackages}>
                    <option value="">
                      {!form.carrierCode ? '— Select carrier first —' : loadingPackages ? 'Loading…' : '— None / default —'}
                    </option>
                    {packages.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Confirmation</label>
                  <select value={form.confirmation ?? 'none'} onChange={e => setForm(f => ({ ...f, confirmation: e.target.value === 'none' ? null : e.target.value }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                    {CONF_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {/* Weight */}
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Weight <span className="text-red-500">*</span></label>
                  <div className="flex gap-1">
                    <input type="number" min={0.1} step={0.1} value={form.weightValue}
                      onChange={e => setForm(f => ({ ...f, weightValue: parseFloat(e.target.value) || 0 }))}
                      className="flex-1 h-7 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                    <select value={form.weightUnit} onChange={e => setForm(f => ({ ...f, weightUnit: e.target.value }))}
                      className="h-7 rounded border border-gray-300 px-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                      {WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                {/* Dimensions */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Dimensions (L × W × H)</label>
                  <div className="flex gap-1 items-center">
                    <input type="number" min={0} step={0.1} placeholder="L" value={form.dimLength ?? ''}
                      onChange={e => setForm(f => ({ ...f, dimLength: e.target.value ? parseFloat(e.target.value) : null }))}
                      className="w-16 h-7 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                    <span className="text-gray-400 text-xs">×</span>
                    <input type="number" min={0} step={0.1} placeholder="W" value={form.dimWidth ?? ''}
                      onChange={e => setForm(f => ({ ...f, dimWidth: e.target.value ? parseFloat(e.target.value) : null }))}
                      className="w-16 h-7 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                    <span className="text-gray-400 text-xs">×</span>
                    <input type="number" min={0} step={0.1} placeholder="H" value={form.dimHeight ?? ''}
                      onChange={e => setForm(f => ({ ...f, dimHeight: e.target.value ? parseFloat(e.target.value) : null }))}
                      className="w-16 h-7 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                    <select value={form.dimUnit} onChange={e => setForm(f => ({ ...f, dimUnit: e.target.value }))}
                      className="h-7 rounded border border-gray-300 px-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                      {DIM_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                    className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue" />
                  <label htmlFor="isDefault" className="text-xs text-gray-600">Set as default preset</label>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t shrink-0 flex justify-end gap-2">
          {showForm ? (
            <>
              <button onClick={() => { setEditing(null); setCreating(false); setErr(null) }} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
              <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-amazon-blue text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <><RefreshCcw size={11} className="animate-spin" /> Saving…</> : 'Save Preset'}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Close</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Package Preset Management Modal ──────────────────────────────────────────

function PackagePresetManagementModal({ onClose, onChange }: {
  onClose: () => void
  onChange: () => void
}) {
  const [presets, setPresets]   = useState<PackagePreset[]>([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState<PackagePreset | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  const blank: Omit<PackagePreset, 'id'> = {
    name: '', packageCode: null,
    weightValue: 16, weightUnit: 'ounces', dimLength: null, dimWidth: null, dimHeight: null,
    dimUnit: 'inches', confirmation: null, isDefault: false,
  }
  const [form, setForm] = useState<Omit<PackagePreset, 'id'>>(blank)

  function load() {
    setLoading(true)
    fetch('/api/package-presets')
      .then(r => r.json()).then(d => setPresets(Array.isArray(d) ? d : []))
      .catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function startCreate() { setForm(blank); setEditing(null); setCreating(true); setErr(null) }
  function startEdit(p: PackagePreset) {
    setForm({ name: p.name, packageCode: p.packageCode, weightValue: p.weightValue, weightUnit: p.weightUnit,
      dimLength: p.dimLength, dimWidth: p.dimWidth, dimHeight: p.dimHeight, dimUnit: p.dimUnit,
      confirmation: p.confirmation, isDefault: p.isDefault })
    setEditing(p); setCreating(false); setErr(null)
  }

  async function handleSave() {
    if (!form.name.trim())  { setErr('Name is required'); return }
    if (!form.weightValue || form.weightValue <= 0) { setErr('Weight must be > 0'); return }
    setSaving(true); setErr(null)
    try {
      const url    = editing ? `/api/package-presets/${editing.id}` : '/api/package-presets'
      const method = editing ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `${res.status}`)
      setEditing(null); setCreating(false); load(); onChange()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save') }
    finally { setSaving(false) }
  }

  async function handleDelete(p: PackagePreset) {
    if (!confirm(`Delete preset "${p.name}"?`)) return
    try {
      const res = await fetch(`/api/package-presets/${p.id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `${res.status}`) }
      load(); onChange()
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to delete') }
  }

  const showForm = creating || editing !== null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <Package size={14} className="text-emerald-600" /> Package Presets
            <span className="text-[10px] font-normal text-gray-400 ml-1">— carrier-agnostic rate shop</span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!showForm && (
            <>
              {loading && <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><RefreshCcw size={12} className="animate-spin" /> Loading…</div>}
              {!loading && presets.length === 0 && <p className="text-xs text-gray-400 italic py-4 text-center">No package presets yet. Click "New Preset" to create one.</p>}
              {!loading && presets.length > 0 && (
                <div className="space-y-2">
                  {presets.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 bg-gray-50/60">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-900">{p.name}</span>
                          {p.isDefault && <span className="text-[9px] bg-emerald-600 text-white px-1.5 py-px rounded font-medium">DEFAULT</span>}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5 font-mono">
                          {p.weightValue} {p.weightUnit}
                          {p.dimLength && p.dimWidth && p.dimHeight ? ` · ${p.dimLength}×${p.dimWidth}×${p.dimHeight} ${p.dimUnit}` : ''}
                          {p.packageCode ? ` · ${p.packageCode}` : ''}
                          {p.confirmation && p.confirmation !== 'none' ? ` · ${p.confirmation}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => startEdit(p)} className="h-6 px-2 rounded text-[10px] border border-gray-300 text-gray-600 hover:bg-gray-100">Edit</button>
                        <button onClick={() => handleDelete(p)} className="h-6 px-2 rounded text-[10px] border border-red-200 text-red-600 hover:bg-red-50">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={startCreate} className="flex items-center gap-1.5 h-7 px-3 rounded border border-dashed border-emerald-600 text-emerald-600 text-xs hover:bg-emerald-50 transition-colors">
                + New Preset
              </button>
            </>
          )}

          {showForm && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{creating ? 'New Package Preset' : `Edit: ${editing?.name}`}</h4>
              {err && <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={11} className="shrink-0 mt-px" />{err}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Preset Name <span className="text-red-500">*</span></label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="e.g. Small Box" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Package Type</label>
                  <select value={form.packageCode ?? ''} onChange={e => setForm(f => ({ ...f, packageCode: e.target.value || null }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                    <option value="">— Select package type —</option>
                    <option value="package">Package</option>
                    <option value="small_flat_rate_box">Small Flat Rate Box</option>
                    <option value="medium_flat_rate_box">Medium Flat Rate Box</option>
                    <option value="large_flat_rate_box">Large Flat Rate Box</option>
                    <option value="flat_rate_envelope">Flat Rate Envelope</option>
                    <option value="legal_flat_rate_envelope">Legal Flat Rate Envelope</option>
                    <option value="padded_flat_rate_envelope">Padded Flat Rate Envelope</option>
                    <option value="regional_rate_box_a">Regional Rate Box A</option>
                    <option value="regional_rate_box_b">Regional Rate Box B</option>
                    <option value="large_envelope_or_flat">Large Envelope / Flat</option>
                    <option value="thick_envelope">Thick Envelope</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Confirmation</label>
                  <select value={form.confirmation ?? 'none'} onChange={e => setForm(f => ({ ...f, confirmation: e.target.value === 'none' ? null : e.target.value }))}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                    {CONF_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Weight <span className="text-red-500">*</span></label>
                  <div className="flex gap-1">
                    <input type="number" min={0.1} step={0.1} value={form.weightValue}
                      onChange={e => setForm(f => ({ ...f, weightValue: parseFloat(e.target.value) || 0 }))}
                      className="flex-1 h-7 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                    <select value={form.weightUnit} onChange={e => setForm(f => ({ ...f, weightUnit: e.target.value }))}
                      className="h-7 rounded border border-gray-300 px-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                      {WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Dimensions (L × W × H)</label>
                  <div className="flex gap-1 items-center">
                    {(['dimLength', 'dimWidth', 'dimHeight'] as const).map((dim, i) => (
                      <>
                        {i > 0 && <span key={`sep-${dim}`} className="text-gray-400 text-xs">×</span>}
                        <input key={dim} type="number" min={0} step={0.1} placeholder={['L','W','H'][i]} value={(form[dim] as number | null) ?? ''}
                          onChange={e => setForm(f => ({ ...f, [dim]: e.target.value ? parseFloat(e.target.value) : null }))}
                          className="w-16 h-7 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      </>
                    ))}
                    <select value={form.dimUnit} onChange={e => setForm(f => ({ ...f, dimUnit: e.target.value }))}
                      className="h-7 rounded border border-gray-300 px-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
                      {DIM_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" id="pkgIsDefault" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                    className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                  <label htmlFor="pkgIsDefault" className="text-xs text-gray-600">Set as default package preset</label>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t shrink-0 flex justify-end gap-2">
          {showForm ? (
            <>
              <button onClick={() => { setEditing(null); setCreating(false); setErr(null) }} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
              <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
                {saving ? <><RefreshCcw size={11} className="animate-spin" /> Saving…</> : 'Save Preset'}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Close</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Label Batch types ────────────────────────────────────────────────────────

interface LabelBatchItemStatus {
  id: string
  orderId: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  error: string | null
  order: { amazonOrderId: string }
}

interface LabelBatchPollData {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  isTest: boolean
  totalOrders: number
  completed: number
  failed: number
  completedAt: string | null
  items: LabelBatchItemStatus[]
}

// ─── BatchHistoryModal ────────────────────────────────────────────────────────

interface BatchHistoryItem {
  id: string
  orderId: string
  status: string
  error: string | null
  order: { amazonOrderId: string; olmNumber: number | null }
}

interface BatchHistoryEntry {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  isTest: boolean
  totalOrders: number
  completed: number
  failed: number
  createdAt: string
  completedAt: string | null
  items: BatchHistoryItem[]
}

const BATCH_STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-gray-100 text-gray-600',
  RUNNING:   'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED:    'bg-red-100 text-red-700',
}

function BatchHistoryModal({ onClose }: { onClose: () => void }) {
  const [batches, setBatches]     = useState<BatchHistoryEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/orders/label-batch')
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then((data: BatchHistoryEntry[]) => setBatches(data))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <History size={14} className="text-indigo-600" /> Label Batch History
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
              <RefreshCcw size={13} className="animate-spin" /> Loading…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-red-600">
              <AlertCircle size={13} /> {error}
            </div>
          )}
          {!loading && !error && batches.length === 0 && (
            <div className="text-center py-12 text-sm text-gray-400">No batches yet.</div>
          )}
          {!loading && batches.map(batch => {
            const isExpanded = expandedId === batch.id
            const hasFailures = batch.failed > 0
            const isRunning = batch.status === 'RUNNING' || batch.status === 'PENDING'
            return (
              <div key={batch.id} className="border-b last:border-0">
                {/* Batch row */}
                <div className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                  {/* Status badge */}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${BATCH_STATUS_BADGE[batch.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {isRunning && <RefreshCcw size={9} className="animate-spin mr-1" />}
                    {batch.status}
                  </span>

                  {/* Date */}
                  <span className="text-xs text-gray-500 shrink-0">
                    {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' '}
                    {new Date(batch.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>

                  {/* Counts */}
                  <span className="text-xs text-gray-700 flex items-center gap-1">
                    <CheckCircle2 size={11} className="text-green-500" />
                    {batch.completed}/{batch.totalOrders} labels
                  </span>
                  {hasFailures && (
                    <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                      <AlertCircle size={11} /> {batch.failed} failed
                    </span>
                  )}
                  {batch.isTest && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">TEST</span>
                  )}
                  {batch.completedAt && (
                    <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                      {Math.round((new Date(batch.completedAt).getTime() - new Date(batch.createdAt).getTime()) / 1000)}s
                    </span>
                  )}

                  {/* Expand toggle */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : batch.id)}
                    className="ml-auto shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    title={isExpanded ? 'Collapse' : 'Show orders'}
                  >
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="bg-gray-50 border-t px-5 py-2 space-y-1">
                    {batch.items.map(item => (
                      <div key={item.id} className="flex items-center gap-2 text-xs py-0.5">
                        <span className={`w-16 shrink-0 font-semibold ${
                          item.status === 'COMPLETED' ? 'text-green-600' :
                          item.status === 'FAILED'    ? 'text-red-600'   :
                          item.status === 'RUNNING'   ? 'text-blue-600'  :
                          'text-gray-400'
                        }`}>
                          {item.status}
                        </span>
                        <span className="font-mono text-gray-700">
                          {item.order.olmNumber != null ? `OLM-${item.order.olmNumber}` : item.order.amazonOrderId}
                        </span>
                        {item.error && (
                          <span className="text-red-500 truncate" title={item.error}>— {item.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t shrink-0 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── LabelBatchStatusBar ──────────────────────────────────────────────────────

function LabelBatchStatusBar({
  batchId, onComplete, onDismiss,
}: { batchId: string; onComplete: () => void; onDismiss: () => void }) {
  const [data, setData] = useState<LabelBatchPollData | null>(null)
  const [showFailed, setShowFailed] = useState(false)

  useEffect(() => {
    let stopped = false
    let autoDismissTimer: ReturnType<typeof setTimeout> | null = null

    function clearAutoDismiss() {
      if (autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = null }
    }

    async function poll() {
      try {
        const res = await fetch(`/api/orders/label-batch/${batchId}`)
        if (!res.ok) return
        const batch: LabelBatchPollData = await res.json()
        setData(batch)

        if (batch.status === 'COMPLETED' || batch.status === 'FAILED') {
          stopped = true
          if (batch.status === 'COMPLETED' && batch.failed === 0) {
            onComplete()
            autoDismissTimer = setTimeout(() => onDismiss(), 3000)
          }
        }
      } catch { /* transient */ }
    }

    poll()
    const interval = setInterval(() => { if (!stopped) poll() }, 3000)

    return () => {
      stopped = true
      clearInterval(interval)
      clearAutoDismiss()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId])

  const isDone    = data?.status === 'COMPLETED' || data?.status === 'FAILED'
  const hasErrors = (data?.failed ?? 0) > 0
  const failedItems = data?.items.filter(i => i.status === 'FAILED') ?? []

  const bannerCls = isDone
    ? hasErrors
      ? 'bg-amber-50 border-amber-300 text-amber-900'
      : 'bg-green-50 border-green-200 text-green-800'
    : 'bg-gray-50 border-gray-200 text-gray-700'

  return (
    <div className={`flex flex-col border-b text-xs ${bannerCls}`}>
      <div className="flex items-center justify-between gap-3 px-6 py-2">
        <div className="flex items-center gap-2">
          {!isDone && <RefreshCcw size={12} className="animate-spin shrink-0" />}
          {isDone && hasErrors && <AlertTriangle size={12} className="shrink-0 text-amber-600" />}
          {isDone && !hasErrors && <CheckCircle2 size={12} className="shrink-0 text-green-600" />}
          <span>
            <span className="font-semibold">Label Batch</span>
            {data?.isTest && <span className="ml-1 text-[10px] bg-amber-200 text-amber-800 px-1 rounded">TEST</span>}
            {' — '}
            {data
              ? `${data.completed}/${data.totalOrders} labels created`
              : 'Starting…'
            }
          </span>
          {hasErrors && (
            <span className="text-red-600 font-medium">
              · {data!.failed} failed
              <button
                type="button"
                onClick={() => setShowFailed(v => !v)}
                className="ml-1 underline text-red-500 hover:text-red-700"
              >
                {showFailed ? 'hide' : 'show'}
              </button>
            </span>
          )}
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 text-gray-400 hover:text-gray-600">
          <X size={13} />
        </button>
      </div>
      {showFailed && failedItems.length > 0 && (
        <div className="px-6 pb-2 space-y-0.5">
          {failedItems.map(item => (
            <p key={item.id} className="text-[10px] font-mono text-red-700">
              {item.order.amazonOrderId}: {item.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

const TAB_LABELS: Record<ActiveTab, string> = {
  pending:   'Pending Orders',
  unshipped: 'Unshipped Orders',
  awaiting:  'Awaiting Verification',
  shipped:   'Shipped Orders',
  cancelled: 'Cancelled Orders',
}

const EMPTY_MESSAGES: Record<ActiveTab, { title: string; sub: string }> = {
  pending:   { title: 'No pending orders.',               sub: 'Click Sync Orders to pull the latest from Amazon.' },
  unshipped: { title: 'No unshipped orders.',             sub: 'Process pending orders to reserve inventory and move them here.' },
  awaiting:  { title: 'No orders awaiting verification.', sub: 'Orders move here after a shipping label is purchased.' },
  shipped:   { title: 'No shipped orders found.',         sub: 'Orders move here after serialization and verification.' },
  cancelled: { title: 'No cancelled orders.',             sub: 'Cancelled orders will appear here.' },
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UnshippedOrders() {
  const [accounts, setAccounts]                   = useState<AmazonAccountDTO[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [accountsError, setAccountsError]         = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<ActiveTab>('pending')
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TAB_KEY) as ActiveTab | null
      if (stored) setActiveTab(stored)
    } catch { /* */ }
  }, [])

  const [orders, setOrders]               = useState<Order[]>([])
  const [pagination, setPagination]       = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 0 })
  const [loading, setLoading]             = useState(false)
  const [fetchError, setFetchError]       = useState<string | null>(null)

  const [search, setSearch]               = useState('')
  const [page, setPage]                   = useState(1)
  const [pageSize, setPageSize]           = useState(50)
  const [fetchKey, setFetchKey]           = useState(0)
  const [sortBy, setSortBy]               = useState('purchaseDate')
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('desc')

  const [syncing, setSyncing]             = useState(false)
  const [syncStatus, setSyncStatus]       = useState<SyncJob | null>(null)
  const [syncError, setSyncError]         = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Buyer cancellation check state
  type CancelFlaggedOrder = { id: string; amazonOrderId: string; olmNumber: number | null; buyerCancelReason: string | null; workflowStatus: string }
  const [checkingCancels, setCheckingCancels]   = useState(false)
  const [cancelFlagged, setCancelFlagged]       = useState<CancelFlaggedOrder[] | null>(null)
  const [cancelCheckedCount, setCancelCheckedCount] = useState<number | null>(null)
  const [cancelCheckError, setCancelCheckError] = useState<string | null>(null)

  const [ssAccount, setSSAccount]         = useState<SSAccount | null>(null)
  const [showConnectSS, setShowConnectSS] = useState(false)
  const [labelOrder, setLabelOrder]       = useState<Order | null>(null)
  const [processOrder, setProcessOrder]   = useState<Order | null>(null)
  const [verifyOrder, setVerifyOrder]     = useState<Order | null>(null)

  // Unprocess / cancel / reinstate state
  const [unprocessingId, setUnprocessingId]       = useState<string | null>(null)
  const [cancellingId, setCancellingId]           = useState<string | null>(null)
  const [reinstatingId, setReinstatingId]         = useState<string | null>(null)
  const [voidingId, setVoidingId]                 = useState<string | null>(null)
  const [voidSuccessMsg, setVoidSuccessMsg]       = useState<string | null>(null)

  // Wholesale state
  const [wholesaleOrders, setWholesaleOrders]             = useState<Order[]>([])
  const [wholesaleShipOrder, setWholesaleShipOrder]       = useState<Order | null>(null)
  const [wholesaleProcessOrder, setWholesaleProcessOrder] = useState<Order | null>(null)

  // Order detail modal
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)

  // Shipping presets state
  const [presets, setPresets]                 = useState<ShippingPreset[]>([])
  // Package presets state
  const [packagePresets, setPackagePresets]           = useState<PackagePreset[]>([])
  const [selectedPackagePresetId, setSelectedPackagePresetId] = useState('')
  const [applyingPackagePreset, setApplyingPackagePreset]     = useState(false)
  const [pkgRatingOrderIds, setPkgRatingOrderIds]             = useState<Set<string>>(new Set())
  const [applyPkgResult, setApplyPkgResult]                   = useState<{ applied: number; total: number; errors: { orderId: string; amazonOrderId: string; error: string }[] } | null>(null)
  const [showPackagePresetModal, setShowPackagePresetModal]   = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [applyingPreset, setApplyingPreset]       = useState(false)
  const [ratingOrderIds, setRatingOrderIds]       = useState<Set<string>>(new Set())
  const [applyPresetResult, setApplyPresetResult] = useState<{ applied: number; total: number; errors: { orderId: string; amazonOrderId: string; error: string }[] } | null>(null)
  const [showPresetModal, setShowPresetModal]     = useState(false)
  const [showPickList, setShowPickList]           = useState(false)

  // Tab counts
  const [tabCounts, setTabCounts] = useState<{ pending: number; unshipped: number; awaiting: number } | null>(null)

  // Label batch state
  const [activeBatchId,    setActiveBatchId]    = useState<string | null>(null)
  const [showBatchConfirm, setShowBatchConfirm] = useState(false)
  const [batchIsTest,      setBatchIsTest]      = useState(false)
  const [batchCreateErr,   setBatchCreateErr]   = useState<string | null>(null)
  const [showBatchHistory, setShowBatchHistory] = useState(false)

  // Bulk process state
  const [bulkProcessing,      setBulkProcessing]      = useState(false)
  const [bulkOrderInventories, setBulkOrderInventories] = useState<BulkOrderInventory[] | null>(null)


  useEffect(() => { try { localStorage.setItem(TAB_KEY, activeTab) } catch { /* */ } }, [activeTab])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    fetch('/api/shipstation/accounts', { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: SSAccount[]) => { if (Array.isArray(data)) setSSAccount(data[0] ?? null) })
      .catch(() => {})
      .finally(() => clearTimeout(timeout))
  }, [])

  useEffect(() => {
    fetch('/api/accounts')
      .then(async r => { if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `${r.status}`) } return r.json() })
      .then((data: AmazonAccountDTO[]) => {
        if (!Array.isArray(data) || data.length === 0) { setAccountsError('No Amazon accounts connected. Go to Connect Amazon to add one.'); return }
        setAccounts(data); setSelectedAccountId(data[0].id)
      })
      .catch(err => setAccountsError(err.message))
  }, [])

  function fetchPresets() {
    fetch('/api/shipping-presets')
      .then(r => r.ok ? r.json() : [])
      .then((data: ShippingPreset[]) => {
        if (!Array.isArray(data)) return
        setPresets(data)
        // Pre-select default preset if nothing selected yet
        const def = data.find(p => p.isDefault)
        if (def) setSelectedPresetId(prev => prev || def.id)
      })
      .catch(() => {})
  }

  useEffect(() => { fetchPresets() }, [])

  function fetchPackagePresets() {
    fetch('/api/package-presets')
      .then(r => r.ok ? r.json() : [])
      .then((data: PackagePreset[]) => {
        if (!Array.isArray(data)) return
        setPackagePresets(data)
        const def = data.find(p => p.isDefault)
        if (def) setSelectedPackagePresetId(prev => prev || def.id)
      })
      .catch(() => {})
  }

  useEffect(() => { fetchPackagePresets() }, [])

  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    setLoading(true); setFetchError(null)
    // 'sku' sort is handled client-side; pass 'purchaseDate' as server sort in that case
    const serverSortBy = sortBy === 'sku' ? 'purchaseDate' : sortBy
    const params = new URLSearchParams({ accountId: selectedAccountId, tab: activeTab, page: String(page), pageSize: String(pageSize), sortBy: serverSortBy, sortDir })
    if (search) params.set('search', search)
    fetch(`/api/orders?${params}`)
      .then(async res => { if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `${res.status}`) } return res.json() })
      .then(({ data, pagination: p }) => {
        if (!cancelled) {
          setOrders(data); setPagination(p)
          // Fire-and-forget: fill in any missing ship-to addresses from ShipStation
          fetch('/api/orders/enrich-addresses', { method: 'POST' }).catch(() => {})
        }
      })
      .catch(err => { if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedAccountId, activeTab, page, pageSize, search, sortBy, sortDir, fetchKey])

  useEffect(() => { setPage(1); setFetchKey(k => k + 1) }, [search, selectedAccountId, pageSize, activeTab, sortBy, sortDir])

  // Fetch tab counts whenever the account or fetchKey changes
  useEffect(() => {
    if (!selectedAccountId) return
    fetch(`/api/orders/counts?accountId=${selectedAccountId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTabCounts(d) })
      .catch(() => {})
  }, [selectedAccountId, fetchKey])

  // Wholesale orders fetch — runs in parallel with the Amazon orders fetch
  useEffect(() => {
    // Map active tab → wholesale fulfillmentStatus (wholesale skips the 'awaiting' step)
    const statusMap: Partial<Record<ActiveTab, string>> = {
      pending:   'PENDING',
      unshipped: 'PROCESSING',
      shipped:   'SHIPPED',
      cancelled: 'CANCELLED',
    }
    const fulfillmentStatus = statusMap[activeTab]
    if (!fulfillmentStatus) { setWholesaleOrders([]); return }

    let cancelled = false
    const params = new URLSearchParams({ fulfillmentStatus })
    if (search) params.set('search', search)

    fetch(`/api/wholesale/orders/for-grid?${params}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(({ data }: { data: Order[] }) => {
        if (!cancelled) setWholesaleOrders(Array.isArray(data) ? data : [])
      })
      .catch(() => { if (!cancelled) setWholesaleOrders([]) })

    return () => { cancelled = true }
  }, [activeTab, search, fetchKey])

  async function startSync() {
    if (!selectedAccountId) return
    // Cancel any existing poll (including stale reconnects) before starting fresh
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setSyncing(true); setSyncStatus(null); setSyncError(null)
    try {
      const { jobId } = await apiPost<{ jobId: string }>('/api/orders/sync', { accountId: selectedAccountId })
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/orders/sync?jobId=${jobId}`)
          if (!res.ok) return
          const job: SyncJob = await res.json()
          setSyncStatus(job)
          if (job.status === 'COMPLETED' || job.status === 'FAILED') {
            clearInterval(pollRef.current!); pollRef.current = null; setSyncing(false)
            if (job.status === 'FAILED') setSyncError(job.errorMessage ?? 'Sync failed')
            else setFetchKey(k => k + 1)
          }
        } catch { /* transient */ }
      }, 5_000)
    } catch (err) { setSyncError(err instanceof Error ? err.message : String(err)); setSyncing(false) }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function resetSync() {
    if (!selectedAccountId) return
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try {
      await fetch(`/api/orders/sync?accountId=${encodeURIComponent(selectedAccountId)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    setSyncing(false)
    setSyncStatus(null)
    setSyncError(null)
  }

  function handleSort(field: string) {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
    setPage(1)
  }


  async function checkCancellations() {
    if (!selectedAccountId) return
    setCheckingCancels(true); setCancelCheckError(null); setCancelFlagged(null); setCancelCheckedCount(null)
    try {
      const res = await apiPost<{ checked: number; flagged: CancelFlaggedOrder[] }>(
        '/api/orders/check-cancellations',
        { accountId: selectedAccountId },
      )
      setCancelFlagged(res.flagged)
      setCancelCheckedCount(res.checked)
      // Refresh the grid so row highlights appear immediately
      setFetchKey(k => k + 1)
    } catch (err) {
      setCancelCheckError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setCheckingCancels(false)
    }
  }

  // On mount or account change: reconnect to any in-progress sync so the
  // spinner and progress text reappear even if the user navigated away mid-sync.
  // Only reconnects to jobs started within the last 10 minutes to avoid
  // locking the UI against truly stale/crashed jobs.
  useEffect(() => {
    if (!selectedAccountId) return
    if (pollRef.current) return  // already polling

    const TEN_MIN = 10 * 60 * 1000
    let cancelled = false
    fetch(`/api/orders/sync?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((job: SyncJob | null) => {
        if (cancelled || !job) return
        if (job.status !== 'PENDING' && job.status !== 'RUNNING') return
        // Ignore stale jobs — they were likely killed by a server restart
        if (Date.now() - new Date(job.startedAt).getTime() > TEN_MIN) return
        // Resume the polling loop against the existing job
        setSyncing(true)
        setSyncStatus(job)
        pollRef.current = setInterval(async () => {
          try {
            const res = await fetch(`/api/orders/sync?jobId=${job.id}`)
            if (!res.ok) return
            const updated: SyncJob = await res.json()
            setSyncStatus(updated)
            if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
              clearInterval(pollRef.current!); pollRef.current = null; setSyncing(false)
              if (updated.status === 'FAILED') setSyncError(updated.errorMessage ?? 'Sync failed')
              else setFetchKey(k => k + 1)
            }
          } catch { /* ignore transient network errors */ }
        }, 5_000)
      })
      .catch(() => { /* ignore errors during reconnect probe */ })

    return () => { cancelled = true }
  }, [selectedAccountId])

  async function handleUnprocess(order: Order) {
    const orderLabel = order.olmNumber != null ? `OLM-${order.olmNumber}` : order.amazonOrderId
    if (!confirm(`Unprocess order ${orderLabel}? This will release the reserved inventory.`)) return
    setUnprocessingId(order.id)
    try {
      await apiPost(`/api/orders/${order.id}/unprocess`, {})
      setFetchKey(k => k + 1)
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to unprocess order') }
    finally { setUnprocessingId(null) }
  }

  async function handleCancel(order: Order) {
    const orderLabel = order.olmNumber != null ? `OLM-${order.olmNumber}` : order.amazonOrderId
    const hasReservations = order.workflowStatus === 'PROCESSING' || order.workflowStatus === 'AWAITING_VERIFICATION'
    const msg = hasReservations
      ? `Cancel order ${orderLabel}? This will release the reserved inventory and cannot be undone.`
      : `Cancel order ${orderLabel}? This cannot be undone.`
    if (!confirm(msg)) return
    setCancellingId(order.id)
    try {
      await apiPost(`/api/orders/${order.id}/cancel`, {})
      setFetchKey(k => k + 1)
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to cancel order') }
    finally { setCancellingId(null) }
  }

  async function handleReinstate(order: Order) {
    const orderLabel = order.olmNumber != null ? `OLM-${order.olmNumber}` : order.amazonOrderId
    if (!confirm(`Reinstate order ${orderLabel}? It will move back to Pending.`)) return
    setReinstatingId(order.id)
    try {
      await apiPost(`/api/orders/${order.id}/reinstate`, {})
      setFetchKey(k => k + 1)
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to reinstate order') }
    finally { setReinstatingId(null) }
  }


  // Orders eligible for batch label creation
  const batchEligible = useMemo(
    () => Array.from(selectedOrderIds).filter(id => {
      const o = orders.find(x => x.id === id)
      return o && !o.presetRateError &&
        (o.presetRateId || (o.presetRateCarrier && o.appliedPresetId))
    }),
    [selectedOrderIds, orders],
  )

  async function handlePrintLabel(orderId: string) {
    try {
      const res  = await fetch(`/api/orders/${orderId}/label`)
      if (!res.ok) { alert('No label found for this order'); return }
      const data = await res.json() as { labelData: string; labelFormat: string }
      const mime = data.labelFormat === 'pdf' ? 'application/pdf' : 'image/png'
      const blob = new Blob(
        [Uint8Array.from(atob(data.labelData), c => c.charCodeAt(0))],
        { type: mime },
      )
      window.open(URL.createObjectURL(blob), '_blank')
    } catch { alert('Failed to fetch label') }
  }

  async function handleVoidLabel(order: Order) {
    if (!confirm(`Void the shipping label for order ${order.amazonOrderId}?\n\nThe order will move back to Unshipped so you can create a new label.`)) return
    setVoidingId(order.id)
    try {
      const res = await fetch(`/api/orders/${order.id}/void-label`, { method: 'POST' })
      const data = await res.json() as { error?: string }
      if (!res.ok) { alert(`Void failed: ${data.error}`); return }
      load()
      setVoidSuccessMsg(`Label voided for order ${order.amazonOrderId} — order moved back to Unshipped.`)
      setTimeout(() => setVoidSuccessMsg(null), 5000)
    } catch { alert('Failed to void label') }
    finally { setVoidingId(null) }
  }

  async function handleCreateBatch() {
    setBatchCreateErr(null)
    try {
      const data = await apiPost<{ batchId: string; totalOrders: number; skipped: number }>(
        '/api/orders/label-batch',
        { orderIds: batchEligible, isTest: batchIsTest },
      )
      setActiveBatchId(data.batchId)
      setShowBatchConfirm(false)
      setBatchIsTest(false)
    } catch (e) {
      setBatchCreateErr(e instanceof Error ? e.message : 'Failed to create batch')
    }
  }

  async function handleBulkProcess() {
    if (selectedOrderIds.size === 0) return
    // Only process Amazon pending orders
    const pendingAmazonIds = [...selectedOrderIds].filter(id => {
      const o = orders.find(x => x.id === id)
      return o && o.orderSource !== 'wholesale' && o.workflowStatus === 'PENDING'
    })
    if (pendingAmazonIds.length === 0) return

    setBulkProcessing(true)
    try {
      // Fetch inventory for all selected orders in parallel
      const inventoryResults = await Promise.all(
        pendingAmazonIds.map(orderId =>
          fetch(`/api/orders/${orderId}/inventory`)
            .then(r => r.json() as Promise<OrderInventoryData>)
            .then(data => ({ orderId, data }))
            .catch(() => ({ orderId, data: null }))
        )
      )

      const orderInventories: BulkOrderInventory[] = inventoryResults
        .filter(r => r.data !== null)
        .map(r => {
          const data = r.data!
          const order = orders.find(o => o.id === r.orderId)
          // An order is "all FG" if every item has a FG location with enough stock
          const allFG = data.items.every(item => {
            if (!item.productId) return false
            return item.locations.some(l => l.isFinishedGoods && l.qty >= item.quantityOrdered)
          })
          // Build asinMap from original order items
          const asinMap: Record<string, string | null> = {}
          for (const item of data.items) {
            const orig = order?.items.find(oi => oi.id === item.orderItemId)
            asinMap[item.orderItemId] = orig?.asin ?? null
          }
          return {
            orderId:      r.orderId,
            amazonOrderId: order?.amazonOrderId ?? r.orderId,
            items:        data.items,
            asinMap,
            allFG,
          }
        })

      if (orderInventories.length === 0) return
      setBulkOrderInventories(orderInventories)
    } finally {
      setBulkProcessing(false)
    }
  }

  async function applyPreset() {
    if (!selectedPresetId || selectedOrderIds.size === 0 || !selectedAccountId) return
    const ids = [...selectedOrderIds]
    setApplyingPreset(true)
    setApplyPresetResult(null)
    setRatingOrderIds(new Set(ids))

    try {
      const res = await fetch('/api/orders/apply-preset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ presetId: selectedPresetId, orderIds: ids, accountId: selectedAccountId }),
      })

      // Non-streaming error response (setup failures before stream starts)
      if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json()
        throw new Error(data.error ?? `${res.status}`)
      }

      // Read SSE stream
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE messages are separated by double newlines
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: 'rate' | 'done' | 'error'
              orderId?: string
              amazonOrderId?: string
              olmNumber?: number | null
              rateAmount?: number | null
              rateCarrier?: string | null
              rateService?: string | null
              rateId?: string | null
              error?: string | null
              applied?: number
              total?: number
              errors?: { orderId: string; amazonOrderId: string; error: string }[]
            }

            if (event.type === 'rate' && event.orderId) {
              // Update this order's rate fields in-place so the column updates immediately
              setOrders(prev => prev.map(o =>
                o.id === event.orderId
                  ? {
                      ...o,
                      presetRateAmount:    event.rateAmount != null ? String(event.rateAmount) : null,
                      presetRateCarrier:   event.rateCarrier ?? null,
                      presetRateService:   event.rateService ?? null,
                      presetRateId:        event.rateId ?? null,
                      presetRateError:     event.error ?? null,
                      presetRateCheckedAt: new Date().toISOString(),
                    }
                  : o,
              ))
              // Remove from the "rating" set so the spinner goes away for this row
              setRatingOrderIds(prev => { const n = new Set(prev); n.delete(event.orderId!); return n })
            }

            if (event.type === 'done') {
              setApplyPresetResult({
                applied: event.applied ?? 0,
                total:   event.total   ?? ids.length,
                errors:  event.errors  ?? [],
              })
            }

            if (event.type === 'error') {
              throw new Error(event.error ?? 'Unknown error')
            }
          } catch (parseErr) {
            // Ignore malformed events; continue reading
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }
    } catch (e) {
      setApplyPresetResult({ applied: 0, total: ids.length, errors: [{ orderId: '', amazonOrderId: '', error: e instanceof Error ? e.message : 'Failed' }] })
    } finally {
      setApplyingPreset(false)
      setRatingOrderIds(new Set())
      setSelectedOrderIds(new Set())
    }
  }

  async function applyPackagePreset() {
    if (!selectedPackagePresetId || selectedOrderIds.size === 0 || !selectedAccountId) return
    const ids = [...selectedOrderIds]
    setApplyingPackagePreset(true)
    setApplyPkgResult(null)
    setPkgRatingOrderIds(new Set(ids))

    try {
      const res = await fetch('/api/orders/apply-package-preset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ presetId: selectedPackagePresetId, orderIds: ids, accountId: selectedAccountId }),
      })

      if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json()
        throw new Error(data.error ?? `${res.status}`)
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: 'rate' | 'done' | 'error'
              orderId?: string; rateAmount?: number | null; rateCarrier?: string | null
              rateService?: string | null; rateId?: string | null; error?: string | null
              applied?: number; total?: number; errors?: { orderId: string; amazonOrderId: string; error: string }[]
            }

            if (event.type === 'rate' && event.orderId) {
              setOrders(prev => prev.map(o =>
                o.id === event.orderId
                  ? { ...o,
                      presetRateAmount:    event.rateAmount != null ? String(event.rateAmount) : null,
                      presetRateCarrier:   event.rateCarrier   ?? null,
                      presetRateService:   event.rateService   ?? null,
                      presetRateId:        event.rateId        ?? null,
                      presetRateError:     event.error         ?? null,
                      presetRateCheckedAt: new Date().toISOString(),
                    }
                  : o,
              ))
              setPkgRatingOrderIds(prev => { const n = new Set(prev); n.delete(event.orderId!); return n })
            }

            if (event.type === 'done') {
              setApplyPkgResult({ applied: event.applied ?? 0, total: event.total ?? ids.length, errors: event.errors ?? [] })
            }

            if (event.type === 'error') throw new Error(event.error ?? 'Unknown error')
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }
    } catch (e) {
      setApplyPkgResult({ applied: 0, total: ids.length, errors: [{ orderId: '', amazonOrderId: '', error: e instanceof Error ? e.message : 'Failed' }] })
    } finally {
      setApplyingPackagePreset(false)
      setPkgRatingOrderIds(new Set())
      setSelectedOrderIds(new Set())
    }
  }

  function syncStatusText() {
    if (!syncStatus) return 'Syncing orders…'
    if (syncStatus.status === 'RUNNING') return `Syncing… (${syncStatus.totalSynced} imported)`
    if (syncStatus.status === 'COMPLETED') return `Synced ${syncStatus.totalSynced} order${syncStatus.totalSynced !== 1 ? 's' : ''}`
    return 'Syncing…'
  }

  function orderTotal(order: Order) {
    if (order.orderTotal) return fmt(order.orderTotal, order.currency)
    let sum = 0
    for (const item of order.items) if (item.itemPrice) sum += parseFloat(item.itemPrice) * item.quantityOrdered
    return sum > 0 ? fmt(String(sum), order.currency) : '—'
  }

  const showProcessCol      = activeTab === 'pending'
  const showShipCol         = activeTab === 'unshipped'
  const showVerifyCol       = activeTab === 'awaiting'
  const showReinstateCol    = activeTab === 'cancelled'
  const showShippedPrintCol = activeTab === 'shipped'
  const showActionCol       = showProcessCol || showShipCol || showVerifyCol || showReinstateCol || showShippedPrintCol
  const colSpan             = 12 + (showActionCol ? 1 : 0)

  // Amazon ship-by dates use Pacific time (e.g. stored as 2026-02-28T07:59:59Z = Feb 27 11:59pm PST).
  // Always evaluate ship-by dates in Pacific time to match Amazon's intent.
  function pstDateStr(isoString: string): string {
    // Returns 'YYYY-MM-DD' in Pacific time
    return new Date(isoString).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  }
  function shipByDiff(isoString: string): number {
    const shipPst = pstDateStr(isoString)
    const todayPst = pstDateStr(new Date().toISOString())
    const [sy, sm, sd] = shipPst.split('-').map(Number)
    const [ty, tm, td] = todayPst.split('-').map(Number)
    return Math.round((new Date(sy, sm - 1, sd).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000)
  }

  // Orders due out today or overdue (pending/unshipped only)
  const todayPst = pstDateStr(new Date().toISOString())
  const dueCount = orders.filter(o =>
    o.latestShipDate &&
    pstDateStr(o.latestShipDate) <= todayPst &&
    o.workflowStatus !== 'COMPLETED' && o.workflowStatus !== 'CANCELLED'
  ).length

  // Merge Amazon + wholesale orders, sorted client-side
  const displayOrders = useMemo(() => {
    const merged = [...orders, ...wholesaleOrders]
    if (sortBy === 'sku') {
      return merged.sort((a, b) => {
        const skuA = a.items[0]?.sellerSku ?? ''
        const skuB = b.items[0]?.sellerSku ?? ''
        return sortDir === 'asc' ? skuA.localeCompare(skuB) : skuB.localeCompare(skuA)
      })
    }
    // For date-based sort, re-sort the merged list so wholesale orders interleave correctly
    return merged.sort((a, b) => {
      const dateA = new Date(a.purchaseDate).getTime()
      const dateB = new Date(b.purchaseDate).getTime()
      return sortDir === 'asc' ? dateA - dateB : dateB - dateA
    })
  }, [orders, wholesaleOrders, sortBy, sortDir])

  // Status badge helper
  function statusBadge(status: string) {
    const cls =
      status === 'Unshipped'  ? 'bg-orange-100 text-orange-800' :
      status === 'Shipped'    ? 'bg-green-100  text-green-800'  :
      status === 'Pending'    ? 'bg-yellow-100 text-yellow-800' :
      'bg-gray-100 text-gray-700'
    return <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', cls)}>{status}</span>
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Modals */}
      {showPresetModal && <PresetManagementModal onClose={() => setShowPresetModal(false)} onChange={fetchPresets} />}
      {showPackagePresetModal && <PackagePresetManagementModal onClose={() => setShowPackagePresetModal(false)} onChange={fetchPackagePresets} />}
      {detailOrder  && <OrderDetailModal  order={detailOrder}  onClose={() => setDetailOrder(null)}
          onSkuChanged={(itemId, newSku, newTitle) => setOrders(prev => prev.map(o => o.id !== detailOrder.id ? o : {
            ...o, items: o.items.map(i => i.id === itemId
              ? { ...i, sellerSku: newSku, ...(newTitle != null ? { title: newTitle } : {}) }
              : i),
          }))}
        />}
      {showConnectSS && <ConnectSSModal onConnected={acct => { setSSAccount(acct); setShowConnectSS(false) }} onClose={() => setShowConnectSS(false)} />}
      {processOrder && <ProcessOrderModal order={processOrder} onClose={() => setProcessOrder(null)} onProcessed={() => { setProcessOrder(null); setFetchKey(k => k + 1) }} />}
      {bulkOrderInventories && (
        <BulkProcessModal
          orderInventories={bulkOrderInventories}
          onClose={() => setBulkOrderInventories(null)}
          onProcessed={() => { setBulkOrderInventories(null); setSelectedOrderIds(new Set()); setFetchKey(k => k + 1) }}
        />
      )}
      {verifyOrder  && <VerifyOrderModal  order={verifyOrder}  onClose={() => setVerifyOrder(null)}  onVerified={() => { setVerifyOrder(null); setActiveTab('shipped') }} />}
      {wholesaleProcessOrder && <WholesaleProcessModal order={wholesaleProcessOrder} onClose={() => setWholesaleProcessOrder(null)} onProcessed={() => { setWholesaleProcessOrder(null); setFetchKey(k => k + 1) }} />}
      {wholesaleShipOrder && <WholesaleShipModal order={wholesaleShipOrder} onClose={() => setWholesaleShipOrder(null)} onShipped={() => { setWholesaleShipOrder(null); setFetchKey(k => k + 1) }} />}
      {showPickList && (
        <PickListModal
          orderIds={Array.from(selectedOrderIds)}
          showLocations={activeTab !== 'pending'}
          onClose={() => setShowPickList(false)}
        />
      )}
      {labelOrder && <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setLabelOrder(null)} />}
      {labelOrder && <LabelPanel order={labelOrder} ssAccount={ssAccount} onClose={() => setLabelOrder(null)} onLabelSaved={() => { setLabelOrder(null); setFetchKey(k => k + 1) }} />}

      {/* Batch history modal */}
      {showBatchHistory && <BatchHistoryModal onClose={() => setShowBatchHistory(false)} />}

      {/* Batch label confirmation modal */}
      {showBatchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <Tag size={14} className="text-indigo-600" /> Create Label Batch
              </h3>
              <button onClick={() => setShowBatchConfirm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700">
                Purchase labels for{' '}
                <strong>{batchEligible.length} order{batchEligible.length !== 1 ? 's' : ''}</strong>{' '}
                in the background. You can close your browser — the process will continue on the server.
              </p>
              {selectedOrderIds.size > batchEligible.length && (
                <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  {selectedOrderIds.size - batchEligible.length} order{selectedOrderIds.size - batchEligible.length !== 1 ? 's' : ''} have no captured rate and will be skipped.
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchIsTest}
                  onChange={e => setBatchIsTest(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Create test labels (no charge)
              </label>
              {batchCreateErr && (
                <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  {batchCreateErr}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button
                onClick={() => setShowBatchConfirm(false)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBatch}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1.5"
              >
                <Tag size={11} /> Confirm Batch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error banners */}
      {accountsError    && <div className="flex items-center gap-2 px-6 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs"><AlertCircle size={13} className="shrink-0" />{accountsError}</div>}
      {syncError        && <div className="flex items-center justify-between gap-2 px-6 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs"><div className="flex items-center gap-2"><AlertCircle size={13} className="shrink-0" /><span><strong>Sync failed:</strong> {syncError}</span></div><button onClick={() => setSyncError(null)}><X size={13} /></button></div>}
      {fetchError       && <div className="flex items-center justify-between gap-2 px-6 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs"><div className="flex items-center gap-2"><AlertCircle size={13} className="shrink-0" /><span><strong>Load failed:</strong> {fetchError}</span></div><button onClick={() => setFetchError(null)}><X size={13} /></button></div>}
      {cancelCheckError && <div className="flex items-center justify-between gap-2 px-6 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs"><div className="flex items-center gap-2"><AlertCircle size={13} className="shrink-0" /><span><strong>Cancellation check failed:</strong> {cancelCheckError}</span></div><button onClick={() => setCancelCheckError(null)}><X size={13} /></button></div>}

      {/* Cancellation results banner */}
      {cancelFlagged !== null && (
        <div className={clsx(
          'flex items-start justify-between gap-3 px-6 py-2 border-b text-xs',
          cancelFlagged.length > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-green-50 border-green-200 text-green-800',
        )}>
          <div className="flex items-start gap-2">
            {cancelFlagged.length > 0
              ? <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
              : <CheckCircle2  size={13} className="shrink-0 mt-0.5 text-green-600" />
            }
            {cancelFlagged.length > 0 ? (
              <div>
                <span className="font-semibold">{cancelFlagged.length} buyer cancellation request{cancelFlagged.length !== 1 ? 's' : ''} found</span>
                <span className="text-amber-700"> ({cancelCheckedCount} orders checked) — rows highlighted in amber below</span>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {cancelFlagged.map(o => (
                    <span key={o.id} className="font-mono text-[10px] text-amber-800">
                      {o.olmNumber != null ? `OLM-${o.olmNumber}` : o.amazonOrderId}
                      {o.buyerCancelReason ? ` — ${o.buyerCancelReason}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <span>No buyer cancellation requests found ({cancelCheckedCount} orders checked)</span>
            )}
          </div>
          <button onClick={() => { setCancelFlagged(null); setCancelCheckedCount(null) }} className="shrink-0 mt-0.5">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Apply preset result banner */}
      {applyPresetResult !== null && (
        <div className={clsx(
          'flex items-start justify-between gap-3 px-6 py-2 border-b text-xs',
          applyPresetResult.errors.length > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-green-50 border-green-200 text-green-800',
        )}>
          <div className="flex items-start gap-2">
            {applyPresetResult.errors.length === 0
              ? <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-green-600" />
              : <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
            }
            <div>
              <span className="font-semibold">
                {applyPresetResult.applied} of {applyPresetResult.total} order{applyPresetResult.total !== 1 ? 's' : ''} rated successfully
              </span>
              {applyPresetResult.errors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {applyPresetResult.errors.map((e, i) => (
                    <p key={i} className="text-[10px] font-mono text-amber-800">
                      {e.amazonOrderId || e.orderId}: {e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setApplyPresetResult(null)} className="shrink-0 mt-0.5"><X size={13} /></button>
        </div>
      )}

      {/* Apply package preset result banner */}
      {applyPkgResult !== null && (
        <div className={clsx(
          'flex items-start justify-between gap-3 px-6 py-2 border-b text-xs',
          applyPkgResult.errors.length > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800',
        )}>
          <div className="flex items-start gap-2">
            {applyPkgResult.errors.length === 0
              ? <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-600" />
              : <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
            }
            <div>
              <span className="font-semibold">
                Rate Shop: {applyPkgResult.applied} of {applyPkgResult.total} order{applyPkgResult.total !== 1 ? 's' : ''} rated (cheapest Amazon Buy Shipping)
              </span>
              {applyPkgResult.errors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {applyPkgResult.errors.map((e, i) => (
                    <p key={i} className="text-[10px] font-mono text-amber-800">
                      {e.amazonOrderId || e.orderId}: {e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setApplyPkgResult(null)} className="shrink-0 mt-0.5"><X size={13} /></button>
        </div>
      )}

      {/* Due-out counter */}
      {dueCount > 0 && (
        <div className="flex items-center gap-2 px-6 py-2 border-b bg-red-50 border-red-200">
          <AlertCircle size={14} className="text-red-600 shrink-0" />
          <span className="text-sm font-bold text-red-700">
            {dueCount} Order{dueCount !== 1 ? 's' : ''} Due Out By Today
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-gray-50">
        <select value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)} disabled={accounts.length === 0}
          className="h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:opacity-50">
          {accounts.length === 0 && <option value="">No accounts</option>}
          {accounts.map(a => <option key={a.id} value={a.id}>{a.marketplaceName} — {a.sellerId}</option>)}
        </select>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Order ID or SKU…" value={search} onChange={e => setSearch(e.target.value)}
            className="h-8 pl-7 pr-2 rounded border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue w-48" />
        </div>
        <div className="flex-1" />
        {ssAccount ? (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded">
              <CheckCircle2 size={11} /> {ssAccount.name}
            </span>
            <a href="/shipstation" title="ShipStation Settings" className="p-1 text-gray-400 hover:text-amazon-blue rounded"><Settings size={13} /></a>
          </div>
        ) : (
          <button onClick={() => setShowConnectSS(true)} className="flex items-center gap-1 h-8 px-2.5 rounded border border-dashed border-gray-300 text-xs text-gray-600 hover:border-amazon-blue hover:text-amazon-blue transition-colors">
            <Link2 size={12} /> Connect ShipStation
          </button>
        )}
        {syncing && <span className="text-xs text-gray-500 flex items-center gap-1"><RefreshCcw size={12} className="animate-spin" />{syncStatusText()}</span>}
        {!syncing && syncStatus?.status === 'COMPLETED' && <span className="text-xs text-green-600">{syncStatusText()}</span>}
        {/* Preset controls */}
        {presets.length > 0 && (
          <select value={selectedPresetId} onChange={e => setSelectedPresetId(e.target.value)}
            className="h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue max-w-[180px]">
            <option value="">— Select preset —</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button onClick={applyPreset}
          disabled={applyingPreset || selectedOrderIds.size === 0 || !selectedPresetId || !selectedAccountId}
          className={clsx('flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors',
            applyingPreset || selectedOrderIds.size === 0 || !selectedPresetId || !selectedAccountId
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
          {applyingPreset
            ? <><RefreshCcw size={12} className="animate-spin" /> Rating {ratingOrderIds.size > 0 ? `${ratingOrderIds.size} left…` : '…'}</>
            : <><Truck size={12} /> Apply to {selectedOrderIds.size > 0 ? selectedOrderIds.size : ''} Selected</>
          }
        </button>
        {selectedOrderIds.size > 0 && (
          <button onClick={() => setShowPickList(true)}
            className="flex items-center gap-1.5 h-8 px-3 rounded border border-gray-300 text-xs text-gray-600 hover:border-green-500 hover:text-green-700 transition-colors">
            <FileText size={12} /> Pick List ({selectedOrderIds.size})
          </button>
        )}
        <button onClick={() => setShowPresetModal(true)}
          className="flex items-center gap-1 h-8 px-2.5 rounded border border-gray-300 text-xs text-gray-600 hover:border-indigo-400 hover:text-indigo-700 transition-colors">
          <Settings size={12} /> Presets
        </button>
        {/* Package preset controls */}
        {packagePresets.length > 0 && (
          <select value={selectedPackagePresetId} onChange={e => setSelectedPackagePresetId(e.target.value)}
            className="h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[180px]">
            <option value="">— Package Preset —</option>
            {packagePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button onClick={applyPackagePreset}
          disabled={applyingPackagePreset || selectedOrderIds.size === 0 || !selectedPackagePresetId || !selectedAccountId}
          className={clsx('flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors',
            applyingPackagePreset || selectedOrderIds.size === 0 || !selectedPackagePresetId || !selectedAccountId
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-emerald-600 text-white hover:bg-emerald-700')}>
          {applyingPackagePreset
            ? <><RefreshCcw size={12} className="animate-spin" /> Pricing {pkgRatingOrderIds.size > 0 ? `${pkgRatingOrderIds.size} left…` : '…'}</>
            : <><Truck size={12} /> Rate Shop {selectedOrderIds.size > 0 ? selectedOrderIds.size : ''} Selected</>
          }
        </button>
        <button onClick={() => setShowPackagePresetModal(true)}
          className="flex items-center gap-1 h-8 px-2.5 rounded border border-gray-300 text-xs text-gray-600 hover:border-emerald-500 hover:text-emerald-700 transition-colors">
          <Settings size={12} /> Pkg Presets
        </button>
        {activeTab === 'pending' && selectedOrderIds.size > 0 && (
          <button
            onClick={handleBulkProcess}
            disabled={bulkProcessing}
            className={clsx(
              'flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors',
              bulkProcessing
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-amazon-blue text-white hover:bg-blue-700',
            )}
          >
            {bulkProcessing
              ? <><RefreshCcw size={12} className="animate-spin" /> Loading…</>
              : <><ClipboardCheck size={12} /> Process Selected ({selectedOrderIds.size})</>
            }
          </button>
        )}
        {activeTab === 'unshipped' && batchEligible.length > 0 && (
          <button
            onClick={() => { setBatchCreateErr(null); setShowBatchConfirm(true) }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
          >
            <Tag size={13} />
            Create Label Batch ({batchEligible.length})
          </button>
        )}
        <button
          onClick={() => setShowBatchHistory(true)}
          className="flex items-center gap-1 h-8 px-2.5 rounded border border-gray-300 text-xs text-gray-600 hover:border-indigo-400 hover:text-indigo-700 transition-colors"
          title="View label batch history"
        >
          <History size={12} /> Batches
        </button>
        <button onClick={checkCancellations} disabled={checkingCancels || !selectedAccountId}
          className={clsx('flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors',
            checkingCancels || !selectedAccountId
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : cancelFlagged && cancelFlagged.length > 0
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-white border border-gray-300 text-gray-700 hover:border-amber-400 hover:text-amber-700')}>
          {checkingCancels
            ? <><RefreshCcw size={12} className="animate-spin" /> Checking…</>
            : <><AlertTriangle size={12} /> Check Cancellations{cancelFlagged && cancelFlagged.length > 0 ? ` (${cancelFlagged.length})` : ''}</>
          }
        </button>
        <button onClick={startSync} disabled={syncing || !selectedAccountId}
          className={clsx('flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors',
            syncing || !selectedAccountId ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-amazon-blue text-white hover:bg-blue-700')}>
          <Package size={12} />{syncing ? 'Syncing…' : 'Sync Orders'}
        </button>
        {syncing && (
          <button
            onClick={resetSync}
            title="Reset stuck sync job"
            className="flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors bg-white border border-red-300 text-red-600 hover:bg-red-50"
          >
            <XCircle size={12} /> Reset Sync
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b bg-white px-4 gap-0 shrink-0">
        {(Object.keys(TAB_LABELS) as ActiveTab[]).map(tab => {
          const count =
            tab === 'pending'   ? tabCounts?.pending :
            tab === 'unshipped' ? tabCounts?.unshipped :
            tab === 'awaiting'  ? tabCounts?.awaiting : undefined
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={clsx('flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab ? 'border-amazon-blue text-amazon-blue' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}>
              {TAB_LABELS[tab]}
              {count !== undefined && count > 0 && (
                <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                  activeTab === tab ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600')}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Label batch status bar */}
      {activeBatchId && (
        <LabelBatchStatusBar
          batchId={activeBatchId}
          onComplete={() => { setFetchKey(k => k + 1); setSelectedOrderIds(new Set()) }}
          onDismiss={() => setActiveBatchId(null)}
        />
      )}

      {voidSuccessMsg && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
          <CheckCircle2 size={14} className="shrink-0 text-green-600" />
          <span className="flex-1">{voidSuccessMsg}</span>
          <button onClick={() => setVoidSuccessMsg(null)} className="text-green-600 hover:text-green-800"><X size={13} /></button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
            <tr>
              <th className="px-3 py-2.5 text-center w-8">
                <input type="checkbox"
                  checked={orders.length > 0 && orders.every(o => selectedOrderIds.has(o.id))}
                  onChange={e => {
                    if (e.target.checked) setSelectedOrderIds(new Set(orders.map(o => o.id)))
                    else setSelectedOrderIds(new Set())
                  }}
                  className="rounded border-gray-500 text-indigo-400 focus:ring-indigo-500"
                />
              </th>
              {/* Sortable column headers */}
              {([
                ['olmNumber',            'Order ID',    'left'],
                ['purchaseDate',         'Date',        'left'],
                ['latestShipDate',       'Ship By',     'left'],
              ] as [string, string, string][]).map(([field, label, align]) => (
                <th key={field}
                  onClick={() => handleSort(field)}
                  className={clsx('px-3 py-2.5 font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors', `text-${align}`)}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <span className={clsx('text-[10px]', sortBy === field ? 'text-amazon-orange' : 'text-gray-500')}>
                      {sortBy === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </span>
                </th>
              ))}
              <th
                onClick={() => handleSort('sku')}
                className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors"
              >
                <span className="inline-flex items-center gap-1">
                  SKU(s)
                  <span className={clsx('text-[10px]', sortBy === 'sku' ? 'text-amazon-orange' : 'text-gray-500')}>
                    {sortBy === 'sku' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </span>
              </th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Qty</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-100">Product</th>
              <th
                onClick={() => handleSort('orderTotal')}
                className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors"
              >
                <span className="inline-flex items-center justify-end gap-1">
                  Total
                  <span className={clsx('text-[10px]', sortBy === 'orderTotal' ? 'text-amazon-orange' : 'text-gray-500')}>
                    {sortBy === 'orderTotal' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </span>
              </th>
              <th
                onClick={() => handleSort('shipToState')}
                className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors"
              >
                <span className="inline-flex items-center gap-1">
                  Ship To
                  <span className={clsx('text-[10px]', sortBy === 'shipToState' ? 'text-amazon-orange' : 'text-gray-500')}>
                    {sortBy === 'shipToState' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </span>
              </th>
              <th
                onClick={() => handleSort('workflowStatus')}
                className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors"
              >
                <span className="inline-flex items-center gap-1">
                  Status
                  <span className={clsx('text-[10px]', sortBy === 'workflowStatus' ? 'text-amazon-orange' : 'text-gray-500')}>
                    {sortBy === 'workflowStatus' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </span>
              </th>
              <th
                onClick={() => handleSort('shipmentServiceLevel')}
                className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors"
              >
                <span className="inline-flex items-center gap-1">
                  Ship Method
                  <span className={clsx('text-[10px]', sortBy === 'shipmentServiceLevel' ? 'text-amazon-orange' : 'text-gray-500')}>
                    {sortBy === 'shipmentServiceLevel' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </span>
              </th>
              <th
                onClick={() => handleSort('presetRateAmount')}
                className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors"
              >
                <span className="inline-flex items-center justify-end gap-1">
                  Preset Rate
                  <span className={clsx('text-[10px]', sortBy === 'presetRateAmount' ? 'text-amazon-orange' : 'text-gray-500')}>
                    {sortBy === 'presetRateAmount' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </span>
              </th>
              {showActionCol && (
                <th className="px-3 py-2.5 text-center font-semibold text-gray-100 whitespace-nowrap">
                  {showProcessCol ? 'Actions' : showShipCol ? 'Ship' : showReinstateCol ? 'Reinstate' : showShippedPrintCol ? 'Label' : 'Verify'}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr><td colSpan={colSpan} className="px-3 py-10 text-center text-gray-400">
                <RefreshCcw size={14} className="inline-block animate-spin mr-1.5" />Loading orders…
              </td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={colSpan} className="px-3 py-12 text-center">
                <p className="text-gray-500 text-xs mb-1">{EMPTY_MESSAGES[activeTab].title}</p>
                <p className="text-gray-400 text-[11px]">{EMPTY_MESSAGES[activeTab].sub}</p>
              </td></tr>
            )}
            {!loading && displayOrders.map((order, rowIdx) => {
              const multi = order.items.length > 1
              const isUnprocessing = unprocessingId === order.id
              const hasCancelRequest = order.isBuyerRequestedCancel
              return (
                <tr key={order.id} className={clsx(
                  'border-b border-gray-200 last:border-0 transition-colors align-middle',
                  hasCancelRequest
                    ? 'bg-amber-50 hover:bg-amber-100/60'
                    : rowIdx % 2 === 0
                      ? 'bg-white hover:bg-blue-50/50'
                      : 'bg-gray-50 hover:bg-blue-50/50',
                )}>
                  {/* Checkbox */}
                  <td className="px-3 py-1.5 text-center w-8">
                    <input type="checkbox"
                      checked={selectedOrderIds.has(order.id)}
                      onChange={e => {
                        setSelectedOrderIds(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(order.id)
                          else next.delete(order.id)
                          return next
                        })
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  {/* Order ID */}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      {order.orderSource === 'wholesale' ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <WholesaleIcon />
                            <span className="font-mono text-[11px] font-semibold text-emerald-700">
                              {order.wholesaleOrderNumber ?? order.amazonOrderId}
                            </span>
                          </div>
                          {order.wholesaleCustomerName && (
                            <span className="text-[10px] text-gray-400 leading-tight">{order.wholesaleCustomerName}</span>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setDetailOrder(order)}
                              className="flex items-center gap-1 group"
                              title="View order details"
                            >
                              {order.olmNumber != null
                                ? <span className="font-mono text-[11px] font-semibold text-amazon-blue group-hover:underline">OLM-{order.olmNumber}</span>
                                : <span className="font-mono text-[11px] text-gray-400 italic">—</span>
                              }
                              <Eye size={10} className="text-gray-300 group-hover:text-amazon-blue transition-colors" />
                            </button>
                            <AmazonSmileIcon />
                            {order.isPrime && <PrimeBadge />}
                            {order.isBuyerRequestedCancel && (
                              <span
                                title={order.buyerCancelReason ? `Buyer cancel reason: ${order.buyerCancelReason}` : 'Buyer requested cancellation'}
                                className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 px-1 py-px rounded"
                              >
                                <AlertTriangle size={8} /> CANCEL REQ
                              </span>
                            )}
                          </div>
                          <a
                            href={`https://sellercentral.amazon.com/orders-v3/order/${order.amazonOrderId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[10px] text-gray-400 hover:text-amazon-blue hover:underline"
                          >
                            {order.amazonOrderId}
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                  {/* Date */}
                  <td className="px-3 py-1.5 whitespace-nowrap text-[11px] text-gray-700">{fmtDate(order.purchaseDate)}</td>
                  {/* Ship By */}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {order.latestShipDate ? (() => {
                      const dayDiff = shipByDiff(order.latestShipDate)
                      const [sy, sm, sd] = pstDateStr(order.latestShipDate).split('-').map(Number)
                      const label = dayDiff === 0
                        ? 'Today'
                        : new Date(sy, sm - 1, sd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      return (
                        <span className={clsx('text-[11px] font-semibold',
                          dayDiff < 0  ? 'text-red-600' :
                          dayDiff === 0 ? 'text-amber-600' :
                          'text-gray-600'
                        )}>
                          {dayDiff < 0 && '⚠ '}{label}
                        </span>
                      )
                    })() : <span className="text-gray-300 text-[11px]">—</span>}
                  </td>
                  {/* SKUs */}
                  {/* SKUs */}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <div className={clsx('flex flex-col', multi && 'gap-0.5')}>
                      {order.items.map(i => <span key={i.id} className="font-mono text-[11px] text-gray-800 leading-4">{i.sellerSku ?? '—'}</span>)}
                    </div>
                  </td>
                  {/* Qty */}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <div className={clsx('flex flex-col', multi && 'gap-0.5')}>
                      {order.items.map(i => <span key={i.id} className="text-[11px] text-gray-700 leading-4 tabular-nums">{i.quantityOrdered}</span>)}
                    </div>
                  </td>
                  {/* Product */}
                  <td className="px-3 py-1.5 max-w-[200px]">
                    <div className={clsx('flex flex-col', multi && 'gap-0.5')}>
                      {order.items.map(i => <span key={i.id} className="text-[11px] text-gray-700 leading-4 truncate" title={i.title ?? ''}>{i.title ?? <span className="text-gray-300">—</span>}</span>)}
                    </div>
                  </td>
                  {/* Total */}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap text-[11px] font-semibold text-gray-800 tabular-nums">{orderTotal(order)}</td>
                  {/* Ship To */}
                  <td className="px-3 py-1.5 whitespace-nowrap text-[11px] text-gray-700">
                    {activeTab === 'awaiting' && order.label
                      ? <span className="font-mono text-[10px] text-purple-700 font-medium">{order.label.trackingNumber}</span>
                      : activeTab === 'shipped' && order.orderSource === 'wholesale' && order.shipTracking
                        ? <span className="font-mono text-[10px] text-emerald-700 font-medium">{order.shipTracking}</span>
                        : [order.shipToCity, order.shipToState].filter(Boolean).join(', ') || '—'
                    }
                  </td>
                  {/* Status */}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {order.orderSource === 'wholesale' ? (
                      <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                        WORKFLOW_BADGE[order.workflowStatus] ?? 'bg-gray-100 text-gray-600 border border-gray-200')}>
                        {WORKFLOW_LABEL[order.workflowStatus] ?? order.workflowStatus}
                      </span>
                    ) : statusBadge(order.orderStatus)}
                  </td>
                  {/* Ship Method */}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {order.orderSource === 'wholesale' ? (
                      order.shipCarrier
                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">{order.shipCarrier}</span>
                        : <span className="text-gray-300">—</span>
                    ) : order.shipmentServiceLevel ? (
                      <span className={clsx(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                        /next.?day|overnight|priority/i.test(order.shipmentServiceLevel)
                          ? 'bg-red-100 text-red-700'
                          : /second.?day|2.?day|expedited/i.test(order.shipmentServiceLevel)
                            ? 'bg-orange-100 text-orange-700'
                            : /same.?day/i.test(order.shipmentServiceLevel)
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-600',
                      )}>
                        {order.shipmentServiceLevel}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Preset Rate */}
                  <td className={clsx('px-3 py-1.5 text-right', order.presetRateError && !ratingOrderIds.has(order.id) && !pkgRatingOrderIds.has(order.id) ? 'whitespace-normal' : 'whitespace-nowrap')}>
                    {(ratingOrderIds.has(order.id) || pkgRatingOrderIds.has(order.id)) ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
                        <RefreshCcw size={10} className="animate-spin" /> Rating…
                      </span>
                    ) : order.presetRateError ? (
                      <div title={order.presetRateError} className="flex flex-col items-end gap-0.5 cursor-help max-w-[120px]">
                        <span className="inline-flex items-center gap-1 text-[10px] text-red-600">
                          <AlertCircle size={10} className="shrink-0" /> Error
                        </span>
                        <span className="text-[9px] text-red-400 leading-tight text-right line-clamp-2 break-words whitespace-normal">
                          {order.presetRateError}
                        </span>
                      </div>
                    ) : order.presetRateAmount ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[11px] font-semibold text-gray-900 tabular-nums">
                          {fmt(order.presetRateAmount)}
                        </span>
                        {order.presetRateService && (
                          <span className="text-[9px] text-gray-400 leading-none truncate max-w-[100px]" title={order.presetRateService}>
                            {order.presetRateService}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300 text-[10px]">—</span>
                    )}
                  </td>
                  {/* Action column */}
                  {showProcessCol && (
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      {order.orderSource !== 'wholesale' && (
                        <button onClick={() => handleCancel(order)} disabled={cancellingId === order.id}
                          title="Cancel order" className="inline-flex items-center justify-center h-6 w-6 rounded text-[10px] text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors">
                          {cancellingId === order.id ? <RefreshCcw size={10} className="animate-spin" /> : <XCircle size={11} />}
                        </button>
                      )}
                    </td>
                  )}
                  {showShipCol && (
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      {order.orderSource === 'wholesale' ? (
                        <button onClick={() => setWholesaleShipOrder(order)}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                          <Truck size={10} /> Ship
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setLabelOrder(order)}
                            className={clsx('inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium transition-colors',
                              ssAccount ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                            <Truck size={10} /> Ship
                          </button>
                          <button onClick={() => handleUnprocess(order)} disabled={isUnprocessing} title="Unprocess — release inventory reservation"
                            className="inline-flex items-center justify-center h-6 w-6 rounded text-[10px] text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40 transition-colors">
                            {isUnprocessing ? <RefreshCcw size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                          </button>
                          <button onClick={() => handleCancel(order)} disabled={cancellingId === order.id}
                            title="Cancel order — release reservation" className="inline-flex items-center justify-center h-6 w-6 rounded text-[10px] text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors">
                            {cancellingId === order.id ? <RefreshCcw size={10} className="animate-spin" /> : <XCircle size={11} />}
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                  {showVerifyCol && (
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        {order.label && (
                          <button
                            type="button"
                            title="Print shipping label"
                            onClick={() => handlePrintLabel(order.id)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                          >
                            <Printer size={14} />
                          </button>
                        )}
                        <button onClick={() => setVerifyOrder(order)}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-purple-600 text-white hover:bg-purple-700">
                          <Hash size={10} /> Verify
                        </button>
                        {order.label && (
                          <button onClick={() => handleVoidLabel(order)} disabled={voidingId === order.id}
                            title="Void shipping label — moves order back to Unshipped"
                            className="inline-flex items-center justify-center h-6 w-6 rounded text-[10px] text-amber-500 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors">
                            {voidingId === order.id ? <RefreshCcw size={10} className="animate-spin" /> : <Ban size={11} />}
                          </button>
                        )}
                        <button onClick={() => handleCancel(order)} disabled={cancellingId === order.id}
                          title="Cancel order — release reservation" className="inline-flex items-center justify-center h-6 w-6 rounded text-[10px] text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors">
                          {cancellingId === order.id ? <RefreshCcw size={10} className="animate-spin" /> : <XCircle size={11} />}
                        </button>
                      </div>
                    </td>
                  )}
                  {showReinstateCol && (
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      <button onClick={() => handleReinstate(order)} disabled={reinstatingId === order.id}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors">
                        {reinstatingId === order.id
                          ? <RefreshCcw size={10} className="animate-spin" />
                          : <RotateCcw size={10} />
                        }
                        Reinstate
                      </button>
                    </td>
                  )}
                  {showShippedPrintCol && (
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      {order.label && order.orderSource !== 'wholesale' ? (
                        <button
                          type="button"
                          title="Print shipping label"
                          onClick={() => handlePrintLabel(order.id)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                        >
                          <Printer size={14} />
                        </button>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(pagination.totalPages > 1 || pagination.total > 0) && (
        <div className="flex items-center justify-between px-4 py-2 border-t bg-white text-xs text-gray-500">
          <div className="flex items-center gap-3">
            <span>{pagination.total} order{pagination.total !== 1 ? 's' : ''}</span>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-400">Rows:</span>
              <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                className="h-6 rounded border border-gray-300 px-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronLeft size={13} /></button>
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages} className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronRight size={13} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Search, RefreshCcw, Package, X, AlertCircle, ChevronLeft, ChevronRight,
  Download, Link2, CheckCircle2, Truck, Settings, FlaskConical, ClipboardCheck,
  MapPin, Printer, RotateCcw, Hash, XCircle, ExternalLink, Phone, FileText, Eye,
  AlertTriangle, Pencil, Tag, History, ChevronDown, ChevronUp, Ban, ShieldCheck, ScanLine, Clock,
} from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import { AmazonAccountDTO } from '@/types'
import { generateOrderInvoicePDF } from '@/lib/generate-order-invoice'
import PickListModal from '@/components/PickListModal'
import ShipByItemModal from '@/components/ShipByItemModal'
import { useQzTray } from '@/lib/use-qz-tray'

// ─── Scanner confirmation tone (Web Audio API) ──────────────────────────────
let _audioCtx: AudioContext | null = null
function playTone(success: boolean) {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext()
    const ctx = _audioCtx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    if (success) {
      // Two-tone ascending chime
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)        // A5
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.1) // D6
      gain.gain.setValueAtTime(0.18, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.25)
    } else {
      // Harsh descending buzz for failure
      osc.type = 'square'
      osc.frequency.setValueAtTime(400, ctx.currentTime)
      osc.frequency.setValueAtTime(200, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
    }
  } catch { /* AudioContext not available */ }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = 'pending' | 'unshipped' | 'awaiting' | 'shipped' | 'cancelled'

interface OrderItem {
  id: string; orderItemId: string; asin: string | null; sellerSku: string | null
  title: string | null; quantityOrdered: number; quantityShipped: number
  itemPrice: string | null; itemTax: string | null; shippingPrice: string | null
  imageUrl?: string | null
  isSerializable?: boolean
  isTransparency?: boolean
  transparencyCodes?: string[]
  bmSerials?: string[]
  gradeId?: string | null
  internalSku?: string | null
  mappedGradeName?: string | null
}

interface OrderLabelSummary {
  trackingNumber: string; labelFormat: string; carrier: string | null
  serviceCode: string | null; shipmentCost: string | null
  createdAt: string; isTest: boolean; ssShipmentId: string | null
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
  latestDeliveryDate: string | null
  presetRateAmount: string | null
  presetRateCarrier: string | null
  presetRateService: string | null
  presetRateId: string | null
  presetRateError: string | null
  presetRateCheckedAt: string | null
  presetShipDate: string | null
  appliedPresetId: string | null
  appliedPackagePresetId: string | null
  appliedPackagePreset: { id: string; name: string } | null
  ssOrderId: number | null
  requiresTransparency?: boolean
  // Source: amazon, backmarket, or wholesale
  orderSource?: 'amazon' | 'backmarket' | 'wholesale'
  wholesaleOrderNumber?: string | null
  wholesaleCustomerName?: string | null
  customerPo?: string | null
  shipCarrier?: string | null
  shipTracking?: string | null
  shippedAt?: string | null
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

interface SyncJob {
  id: string; source: string; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
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
  gradeId: string | null; gradeName: string | null
  internalSku?: string | null; mappedGradeName?: string | null
}
interface VerificationStatus {
  orderId: string; amazonOrderId: string; trackingNumber: string | null
  hasLabel: boolean; items: VerificationItem[]
}

// ─── Small logo badges ────────────────────────────────────────────────────────

// ─── Sync Progress Bar ───────────────────────────────────────────────────────

const STRIPE_BG = 'repeating-linear-gradient(45deg,transparent,transparent 6px,rgba(255,255,255,0.2) 6px,rgba(255,255,255,0.2) 12px)'

const BAR_COLORS: Record<string, { running: string; done: string; error: string }> = {
  blue:   { running: 'bg-blue-500',  done: 'bg-green-500', error: 'bg-red-500' },
  teal:   { running: 'bg-teal-500',  done: 'bg-green-500', error: 'bg-red-500' },
  purple: { running: 'bg-purple-500', done: 'bg-green-500', error: 'bg-red-500' },
}

function SyncProgressRow({ label, job, color, indeterminateText, completedText }: {
  label: string
  job: SyncJob | null
  color: 'blue' | 'teal' | 'purple'
  indeterminateText?: string
  completedText?: string
}) {
  const colors = BAR_COLORS[color]
  const isRunning   = job?.status === 'RUNNING' || job?.status === 'PENDING'
  const isCompleted = job?.status === 'COMPLETED' || (!job && completedText)
  const isError     = job?.status === 'FAILED'
  const indeterminate = !job || (job.status === 'PENDING') || (job.status === 'RUNNING' && job.totalFound === 0)

  const pct = !indeterminate && job && job.totalFound > 0
    ? Math.min(100, Math.round((job.totalSynced / job.totalFound) * 100))
    : 0
  const widthPct = indeterminate ? 100 : pct

  const barColor = isError ? colors.error : isCompleted ? colors.done : colors.running

  let rightText = ''
  if (completedText) {
    rightText = completedText
  } else if (indeterminateText) {
    rightText = indeterminateText
  } else if (isError) {
    rightText = job?.errorMessage ?? 'Failed'
  } else if (job?.status === 'PENDING') {
    rightText = 'Starting sync…'
  } else if (indeterminate) {
    rightText = 'Fetching orders…'
  } else if (isCompleted && job) {
    rightText = `${job.totalSynced} synced`
  } else if (job) {
    rightText = `${job.totalSynced} / ${job.totalFound} (${pct}%)`
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider w-12 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-5 bg-gray-200 rounded-full overflow-hidden relative">
        <div
          className={clsx('h-full rounded-full transition-all duration-700', barColor)}
          style={{
            width: `${widthPct}%`,
            ...(isRunning || indeterminateText ? {
              backgroundImage: STRIPE_BG,
              backgroundSize: '1rem 1rem',
              animation: 'sync-stripe 0.6s linear infinite',
            } : {}),
          }}
        />
      </div>
      <span className={clsx('text-[10px] font-medium shrink-0 min-w-[100px] text-right',
        isError ? 'text-red-600' : isCompleted ? 'text-green-600' : 'text-gray-500'
      )}>
        {rightText}
      </span>
    </div>
  )
}

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

function BackMarketIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0.72 182 166.32" className={className}>
      <path d="M167.45.72H14.55C6.51.72 0 7.21 0 15.23v136.58c0 8.02 6.51 14.51 14.55 14.51h152.9c8.03 0 14.55-6.5 14.55-14.51V15.23C182 7.22 175.49.72 167.45.72ZM99.14 133.69H69.13c-.96 0-1.87-.38-2.55-1.06L18.54 84.59c-.59-.59-.59-1.55 0-2.15L66.58 34.4c.68-.68 1.59-1.06 2.55-1.06h30.01c.82 0 1.23.99.65 1.56L52.25 82.44c-.59.59-.59 1.55 0 2.15l47.54 47.54c.58.58.17 1.56-.65 1.56Zm16.04-49.1 47.54 47.54c.58.58.17 1.56-.65 1.56h-30.01c-.96 0-1.87-.38-2.55-1.06L81.47 84.58c-.59-.59-.59-1.55 0-2.15l48.04-48.04c.68-.68 1.59-1.06 2.55-1.06h30.01c.82 0 1.23.99.65 1.56l-47.54 47.54c-.59.59-.59 1.55 0 2.15Z" fill="currentColor"/>
    </svg>
  )
}

function BackMarketBadge() {
  return (
    <span
      title="Back Market order"
      aria-label="Back Market"
      className="inline-flex items-center justify-center shrink-0 select-none"
    >
      <BackMarketIcon size={16} />
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
        // Prefer grade-matching FG location with enough stock, then best qty
        const fg   = item.locations.find(l =>
          l.isFinishedGoods && l.qty >= item.quantityOrdered
          && (item.gradeId ? l.gradeId === item.gradeId : true)
        )
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
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-mono text-xs font-semibold text-gray-800">{item.sellerSku ?? '—'}</p>
                                  {item.gradeName && (
                                    <span className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[10px] font-bold">
                                      Grade {item.gradeName}
                                    </span>
                                  )}
                                </div>
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

  const validateSerial = useCallback((key: string, sn: string, sku: string, immediate = false, gradeId?: string | null) => {
    if (!sn.trim()) {
      setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, valid: null, message: '', checking: false } }))
      return
    }
    // Mark as checking
    setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, checking: true, valid: null, message: '' } }))
    // Debounce (skip if immediate — e.g. scanner Enter)
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
    const doValidate = async () => {
      try {
        let url = `/api/serials/validate?sn=${encodeURIComponent(sn.trim())}&sku=${encodeURIComponent(sku)}`
        if (gradeId) url += `&gradeId=${encodeURIComponent(gradeId)}`
        const res = await fetch(url)
        const data: { valid: boolean; reason?: string; detail?: string; location?: string } = await res.json()
        setSerialInputs(prev => ({
          ...prev,
          [key]: { value: sn, valid: data.valid, message: data.valid ? (data.location ?? '✓ Valid') : (data.detail ?? 'Invalid'), checking: false },
        }))
        if (immediate) {
          playTone(data.valid)
          if (!data.valid) {
            // Show error briefly, then clear so user can scan another
            setTimeout(() => {
              setSerialInputs(prev => ({ ...prev, [key]: { value: '', valid: null, message: '', checking: false } }))
            }, 1500)
          }
        }
      } catch {
        setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], checking: false, valid: false, message: 'Validation error' } }))
        if (immediate) {
          playTone(false)
          setTimeout(() => {
            setSerialInputs(prev => ({ ...prev, [key]: { value: '', valid: null, message: '', checking: false } }))
          }, 1500)
        }
      }
    }
    if (immediate) { doValidate() } else { debounceRefs.current[key] = setTimeout(doValidate, 350) }
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
                    <span className="font-mono text-xs font-semibold text-gray-700">{item.internalSku ?? item.sellerSku ?? '—'}</span>
                    <span className="text-xs text-gray-400 ml-2">×{item.quantityOrdered}</span>
                    {item.mappedGradeName && <span className="block text-[9px] font-semibold text-purple-700">Grade {item.mappedGradeName}</span>}
                    <p className="text-xs text-gray-500 truncate mt-0.5">{item.title ?? '—'}</p>
                  </div>
                  <span className="text-xs text-gray-400 italic">Not serializable</span>
                </div>
              )

              return (
                <div key={item.orderItemId} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div>
                    <span className="font-mono text-xs font-semibold text-gray-800">{item.internalSku ?? item.sellerSku ?? '—'}</span>
                    <span className="text-xs text-gray-500 ml-2">×{item.quantityOrdered}</span>
                    {(item.mappedGradeName || item.gradeName) && (
                      <span className="block text-[9px] font-semibold text-purple-700">
                        Grade {item.mappedGradeName ?? item.gradeName}
                      </span>
                    )}
                    <p className="text-xs text-gray-500 truncate">{item.title ?? '—'}</p>
                  </div>
                  <div className="space-y-1.5">
                    {Array.from({ length: item.quantityOrdered }, (_, i) => {
                      const key   = `${item.orderItemId}-${i}`
                      const state = serialInputs[key] ?? { value: '', valid: null, message: '', checking: false }
                      // For BackMarket orders, show the expected serial from the BM Serialize step
                      const bmItem = order.orderSource === 'backmarket'
                        ? order.items.find(oi => oi.orderItemId === item.orderItemId)
                        : null
                      const expectedSerial = bmItem?.bmSerials?.[i]
                      return (
                        <div key={key} className="space-y-0.5">
                          {expectedSerial && (
                            <p className="text-[10px] text-purple-600 font-medium pl-6">
                              EXPECTED SERIAL #: <span className="font-mono">{expectedSerial}</span>
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-4 shrink-0">#{i + 1}</span>
                            <input
                              type="text"
                              placeholder="Scan or enter serial…"
                              value={state.value}
                              onChange={e => validateSerial(key, e.target.value, item.sellerSku ?? '', false, item.gradeId)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  const val = (e.target as HTMLInputElement).value
                                  if (val.trim()) validateSerial(key, val, item.sellerSku ?? '', true, item.gradeId)
                                }
                              }}
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
                          {/* Warn if entered serial doesn't match expected BM serial */}
                          {expectedSerial && state.value.trim() && state.valid === true
                            && state.value.trim().toUpperCase() !== expectedSerial.trim().toUpperCase() && (
                            <div className="flex items-start gap-1.5 pl-6 py-1 px-2 rounded bg-amber-50 border border-amber-200 text-amber-800">
                              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                              <div className="text-[10px]">
                                <p className="font-semibold">Serial mismatch — expected <span className="font-mono">{expectedSerial}</span></p>
                                <p className="text-amber-600 mt-0.5">
                                  This serial differs from the one assigned during BackMarket serialization.{' '}
                                  <button type="button" className="underline font-medium hover:text-amber-800"
                                    onClick={() => validateSerial(key, expectedSerial, item.sellerSku ?? '', false, item.gradeId)}>
                                    Use expected serial
                                  </button>{' '}
                                  or proceed with the current one.
                                </p>
                              </div>
                            </div>
                          )}
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

// ─── Wholesale Serialize Modal ─────────────────────────────────────────────────

type WholesaleSerialState = { value: string; valid: boolean | null; message: string; checking: boolean; serialId?: string }

function WholesaleSerializeModal({ order, onClose, onSaved }: {
  order: Order; onClose: () => void; onSaved: () => void
}) {
  const [serialInputs, setSerialInputs] = useState<Record<string, WholesaleSerialState>>({})
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState<string | null>(null)

  const serializableItems = order.items.filter(i => i.isSerializable)

  // Pre-fill from existing serial assignments
  useEffect(() => {
    const initial: Record<string, WholesaleSerialState> = {}
    const existingByItem = new Map<string, { serialNumber: string; id: string }[]>()
    for (const sa of (order.serialAssignments ?? [])) {
      const arr = existingByItem.get(sa.orderItemId) ?? []
      arr.push({ serialNumber: sa.inventorySerial.serialNumber, id: sa.id })
      existingByItem.set(sa.orderItemId, arr)
    }

    for (const item of serializableItems) {
      const existing = existingByItem.get(item.orderItemId) ?? []
      for (let i = 0; i < item.quantityOrdered; i++) {
        const key = `${item.orderItemId}-${i}`
        if (existing[i]) {
          initial[key] = { value: existing[i].serialNumber, valid: null, message: '', checking: false }
        } else {
          initial[key] = { value: '', valid: null, message: '', checking: false }
        }
      }
    }
    setSerialInputs(initial)

    // Re-validate existing serials
    for (const item of serializableItems) {
      const existing = existingByItem.get(item.orderItemId) ?? []
      for (let i = 0; i < existing.length && i < item.quantityOrdered; i++) {
        const key = `${item.orderItemId}-${i}`
        validateSerial(key, existing[i].serialNumber, item.sellerSku ?? '', true, item.gradeId)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  const orderIdRef = useRef(order.id)

  const validateSerial = useCallback((key: string, sn: string, sku: string, immediate = false, gradeId?: string | null) => {
    if (!sn.trim()) {
      setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, valid: null, message: '', checking: false, serialId: undefined } }))
      return
    }
    setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, checking: true, valid: null, message: '', serialId: undefined } }))
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
    const doValidate = async () => {
      try {
        let url = `/api/serials/validate?sn=${encodeURIComponent(sn.trim())}&sku=${encodeURIComponent(sku)}`
        if (gradeId) url += `&gradeId=${encodeURIComponent(gradeId)}`
        url += `&excludeSalesOrderId=${encodeURIComponent(orderIdRef.current)}`
        const res = await fetch(url)
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
        if (immediate) {
          playTone(data.valid)
          if (!data.valid) {
            setTimeout(() => {
              setSerialInputs(prev => ({ ...prev, [key]: { value: '', valid: null, message: '', checking: false, serialId: undefined } }))
            }, 1500)
          }
        }
      } catch {
        setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], checking: false, valid: false, message: 'Validation error', serialId: undefined } }))
        if (immediate) {
          playTone(false)
          setTimeout(() => {
            setSerialInputs(prev => ({ ...prev, [key]: { value: '', valid: null, message: '', checking: false, serialId: undefined } }))
          }, 1500)
        }
      }
    }
    if (immediate) { doValidate() } else { debounceRefs.current[key] = setTimeout(doValidate, 350) }
  }, [])

  const allSerialsValid = (() => {
    for (const item of serializableItems) {
      for (let i = 0; i < item.quantityOrdered; i++) {
        const key = `${item.orderItemId}-${i}`
        const state = serialInputs[key]
        if (!state || !state.valid || state.checking) return false
      }
    }
    return true
  })()

  async function handleSave() {
    if (!allSerialsValid) return
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
      const res = await fetch(`/api/wholesale/orders/${order.id}/serialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serials }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `${res.status}`)
      onSaved()
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Failed to save serials')
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
              <Hash size={15} className="text-purple-600" /> Serialize Wholesale Order
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{order.wholesaleOrderNumber ?? order.amazonOrderId}</p>
            {order.wholesaleCustomerName && (
              <p className="text-xs text-gray-400 mt-0.5">{order.wholesaleCustomerName}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Order Items with serial inputs */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              Assign Serial Numbers
            </p>
            <div className="space-y-3">
              {order.items.map(item => (
                <div key={item.id} className={clsx('rounded-lg border p-3 space-y-2', item.isSerializable ? 'border-gray-200' : 'border-gray-100 bg-gray-50/60')}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-semibold text-gray-800">{item.internalSku ?? item.sellerSku ?? '—'}</span>
                      <span className="text-xs text-gray-400 ml-2">×{item.quantityOrdered}</span>
                      {item.mappedGradeName && <span className="block text-[9px] font-semibold text-purple-700">Grade {item.mappedGradeName}</span>}
                      {item.title && <p className="text-xs text-gray-500 truncate mt-0.5">{item.title}</p>}
                    </div>
                    {!item.isSerializable && <span className="text-[9px] text-gray-400 italic shrink-0">Not serializable</span>}
                  </div>
                  {item.isSerializable && (
                    <div className="space-y-1.5">
                      {/* Bulk paste area */}
                      <div className="mb-1">
                        <textarea
                          placeholder={`Paste up to ${item.quantityOrdered} serials (one per line)…`}
                          rows={2}
                          className="w-full rounded border border-dashed border-gray-300 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none placeholder:text-gray-400"
                          onPaste={e => {
                            e.preventDefault()
                            const text = e.clipboardData.getData('text')
                            const lines = text.split(/[\n\r\t]+/).map(s => s.trim()).filter(Boolean)
                            const sku = item.sellerSku ?? ''
                            lines.slice(0, item.quantityOrdered).forEach((sn, i) => {
                              const key = `${item.orderItemId}-${i}`
                              validateSerial(key, sn, sku, true, item.gradeId)
                            })
                            ;(e.target as HTMLTextAreaElement).value = ''
                          }}
                          onChange={e => {
                            const text = e.target.value
                            if (!text.includes('\n') && !text.includes('\t')) return
                            const lines = text.split(/[\n\r\t]+/).map(s => s.trim()).filter(Boolean)
                            if (lines.length > 1) {
                              const sku = item.sellerSku ?? ''
                              lines.slice(0, item.quantityOrdered).forEach((sn, i) => {
                                const key = `${item.orderItemId}-${i}`
                                validateSerial(key, sn, sku, true, item.gradeId)
                              })
                              e.target.value = ''
                            }
                          }}
                        />
                      </div>
                      {Array.from({ length: item.quantityOrdered }, (_, i) => {
                        const key   = `${item.orderItemId}-${i}`
                        const state = serialInputs[key] ?? { value: '', valid: null, message: '', checking: false }
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-4 shrink-0">#{i + 1}</span>
                            <input
                              type="text"
                              placeholder="Scan or enter serial…"
                              value={state.value}
                              onChange={e => validateSerial(key, e.target.value, item.sellerSku ?? '', false, item.gradeId)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  const val = (e.target as HTMLInputElement).value
                                  if (val.trim()) validateSerial(key, val, item.sellerSku ?? '', true, item.gradeId)
                                }
                              }}
                              className={clsx(
                                'flex-1 h-8 rounded border px-2 text-xs font-mono focus:outline-none focus:ring-1',
                                state.valid === true  ? 'border-green-400 bg-green-50 focus:ring-green-400' :
                                state.valid === false ? 'border-red-400   bg-red-50   focus:ring-red-400' :
                                'border-gray-300 focus:ring-purple-500',
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
          {!allSerialsValid && (
            <p className="text-xs text-amber-700 flex items-center gap-1">
              <AlertCircle size={11} /> All serial numbers must be validated before saving.
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={submitting || !allSerialsValid}
              className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
              {submitting ? <><RefreshCcw size={12} className="animate-spin" /> Saving…</> : <><Hash size={12} /> Save Serials</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Wholesale Ship Modal ──────────────────────────────────────────────────────

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
  const totalSerializable = serializableItems.reduce((s, i) => s + i.quantityOrdered, 0)
  const assigned = order.serialAssignments?.length ?? 0
  const isPreSerialized = totalSerializable > 0 && assigned >= totalSerializable
  const needsSerials = serializableItems.length > 0 && !isPreSerialized

  useEffect(() => {
    if (isPreSerialized) return // no serial inputs needed
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

  const validateSerial = useCallback((key: string, sn: string, sku: string, immediate = false, gradeId?: string | null) => {
    if (!sn.trim()) {
      setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, valid: null, message: '', checking: false, serialId: undefined } }))
      return
    }
    setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], value: sn, checking: true, valid: null, message: '', serialId: undefined } }))
    if (debounceRefs.current[key]) clearTimeout(debounceRefs.current[key])
    const doValidate = async () => {
      try {
        let url = `/api/serials/validate?sn=${encodeURIComponent(sn.trim())}&sku=${encodeURIComponent(sku)}`
        if (gradeId) url += `&gradeId=${encodeURIComponent(gradeId)}`
        const res = await fetch(url)
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
        if (immediate) {
          playTone(data.valid)
          if (!data.valid) {
            setTimeout(() => {
              setSerialInputs(prev => ({ ...prev, [key]: { value: '', valid: null, message: '', checking: false, serialId: undefined } }))
            }, 1500)
          }
        }
      } catch {
        setSerialInputs(prev => ({ ...prev, [key]: { ...prev[key], checking: false, valid: false, message: 'Validation error', serialId: undefined } }))
        if (immediate) {
          playTone(false)
          setTimeout(() => {
            setSerialInputs(prev => ({ ...prev, [key]: { value: '', valid: null, message: '', checking: false, serialId: undefined } }))
          }, 1500)
        }
      }
    }
    if (immediate) { doValidate() } else { debounceRefs.current[key] = setTimeout(doValidate, 350) }
  }, [])

  const allSerialsValid = (() => {
    if (isPreSerialized) return true
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
      // Build serials only for all-at-once flow (not pre-serialized)
      const serials: { serialId: string; salesOrderItemId: string }[] = []
      if (!isPreSerialized) {
        for (const item of serializableItems) {
          for (let i = 0; i < item.quantityOrdered; i++) {
            const key = `${item.orderItemId}-${i}`
            const state = serialInputs[key]
            if (state?.valid && state.serialId) {
              serials.push({ serialId: state.serialId, salesOrderItemId: item.orderItemId })
            }
          }
        }
      }
      const res = await fetch(`/api/wholesale/orders/${order.id}/ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: carrier.trim(), tracking: tracking.trim(), ...(serials.length > 0 ? { serials } : {}) }),
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

  // Group pre-assigned serials by item for read-only display
  const preAssignedByItem = useMemo(() => {
    if (!isPreSerialized) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const sa of (order.serialAssignments ?? [])) {
      const arr = map.get(sa.orderItemId) ?? []
      arr.push(sa.inventorySerial.serialNumber)
      map.set(sa.orderItemId, arr)
    }
    return map
  }, [isPreSerialized, order.serialAssignments])

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
              Order Items {isPreSerialized
                ? <span className="text-green-600 normal-case font-normal">(serials pre-assigned)</span>
                : needsSerials
                  ? <span className="text-amber-600 normal-case font-normal">(serial numbers required)</span>
                  : null}
            </p>
            <div className="space-y-3">
              {order.items.map(item => (
                <div key={item.id} className={clsx('rounded-lg border p-3 space-y-2', item.isSerializable ? 'border-gray-200' : 'border-gray-100 bg-gray-50/60')}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-semibold text-gray-800">{item.internalSku ?? item.sellerSku ?? '—'}</span>
                      <span className="text-xs text-gray-400 ml-2">x{item.quantityOrdered}</span>
                      {item.mappedGradeName && <span className="block text-[9px] font-semibold text-purple-700">Grade {item.mappedGradeName}</span>}
                      {item.title && <p className="text-xs text-gray-500 truncate mt-0.5">{item.title}</p>}
                    </div>
                    {!item.isSerializable && <span className="text-[9px] text-gray-400 italic shrink-0">Not serializable</span>}
                  </div>
                  {item.isSerializable && isPreSerialized && (
                    <div className="space-y-0.5">
                      {(preAssignedByItem.get(item.orderItemId) ?? []).map((sn, i) => (
                        <div key={i} className="flex items-center gap-2 py-1 px-2 rounded bg-green-50 border border-green-200">
                          <CheckCircle2 size={11} className="text-green-500 shrink-0" />
                          <span className="font-mono text-xs text-gray-800">{sn}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {item.isSerializable && !isPreSerialized && (
                    <div className="space-y-1.5">
                      {/* Bulk paste area */}
                      <div className="mb-1">
                        <textarea
                          placeholder={`Paste up to ${item.quantityOrdered} serials (one per line)…`}
                          rows={2}
                          className="w-full rounded border border-dashed border-gray-300 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none placeholder:text-gray-400"
                          onPaste={e => {
                            e.preventDefault()
                            const text = e.clipboardData.getData('text')
                            const lines = text.split(/[\n\r\t]+/).map(s => s.trim()).filter(Boolean)
                            const sku = item.sellerSku ?? ''
                            lines.slice(0, item.quantityOrdered).forEach((sn, i) => {
                              const key = `${item.orderItemId}-${i}`
                              validateSerial(key, sn, sku, true, item.gradeId)
                            })
                            ;(e.target as HTMLTextAreaElement).value = ''
                          }}
                          onChange={e => {
                            const text = e.target.value
                            if (!text.includes('\n') && !text.includes('\t')) return
                            const lines = text.split(/[\n\r\t]+/).map(s => s.trim()).filter(Boolean)
                            if (lines.length > 1) {
                              const sku = item.sellerSku ?? ''
                              lines.slice(0, item.quantityOrdered).forEach((sn, i) => {
                                const key = `${item.orderItemId}-${i}`
                                validateSerial(key, sn, sku, true, item.gradeId)
                              })
                              e.target.value = ''
                            }
                          }}
                        />
                      </div>
                      {Array.from({ length: item.quantityOrdered }, (_, i) => {
                        const key   = `${item.orderItemId}-${i}`
                        const state = serialInputs[key] ?? { value: '', valid: null, message: '', checking: false }
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-4 shrink-0">#{i + 1}</span>
                            <input
                              type="text"
                              placeholder="Scan or enter serial…"
                              value={state.value}
                              onChange={e => validateSerial(key, e.target.value, item.sellerSku ?? '', false, item.gradeId)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  const val = (e.target as HTMLInputElement).value
                                  if (val.trim()) validateSerial(key, val, item.sellerSku ?? '', true, item.gradeId)
                                }
                              }}
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

// ─── Unserialize Modal ────────────────────────────────────────────────────────

function UnserializeModal({ order, onClose, onUnserialized }: {
  order: Order; onClose: () => void; onUnserialized: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const assignments = order.serialAssignments ?? []

  // Group serials by SKU
  const bySku = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const sa of assignments) {
      const item = order.items.find(i => i.id === sa.orderItemId)
      const sku = item?.sellerSku ?? 'Unknown'
      const arr = map.get(sku) ?? []
      arr.push(sa.inventorySerial.serialNumber)
      map.set(sku, arr)
    }
    return Array.from(map.entries())
  }, [assignments, order.items])

  async function handleUnserialize() {
    setSubmitting(true); setErr(null)
    try {
      const url = order.orderSource === 'wholesale'
        ? `/api/wholesale/orders/${order.id}/unserialize`
        : `/api/orders/${order.id}/unserialize`
      const res = await fetch(url, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to unserialize')
      onUnserialized()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to unserialize')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[420px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Serial Assignments</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {order.olmNumber != null ? `OLM-${order.olmNumber}` : order.amazonOrderId}
              <span className="ml-1 text-gray-400">· {assignments.length} serial{assignments.length !== 1 ? 's' : ''}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {bySku.map(([sku, serials]) => (
            <div key={sku}>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{sku}</p>
              <div className="space-y-0.5">
                {serials.map(sn => (
                  <div key={sn} className="flex items-center gap-2 py-1 px-2 rounded bg-gray-50">
                    <ScanLine size={11} className="text-indigo-400 shrink-0" />
                    <span className="font-mono text-xs text-gray-800">{sn}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {err && (
          <div className="px-5 py-2">
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5">{err}</p>
          </div>
        )}

        <div className="px-5 py-3 border-t flex items-center justify-between gap-3">
          <button type="button" onClick={onClose}
            className="h-8 px-4 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50">
            Close
          </button>
          <button type="button" onClick={handleUnserialize} disabled={submitting}
            className="h-8 px-4 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <RotateCcw size={11} />
            {submitting ? 'Removing…' : 'Unserialize All'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Manual Ship Modal (2-step: serialize → carrier/tracking) ─────────────────

function ManualShipModal({ order, onClose, onShipped }: {
  order: Order; onClose: () => void; onShipped: () => void
}) {
  const [carrier, setCarrier]           = useState('')
  const [tracking, setTracking]         = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [submitErr, setSubmitErr]       = useState<string | null>(null)

  const canSubmit = carrier.trim() && tracking.trim()

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true); setSubmitErr(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/manual-ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: carrier.trim(), tracking: tracking.trim(), ...(shippingCost ? { shippingCost: parseFloat(shippingCost) } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `${res.status}`)
      onShipped()
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Failed to mark as shipped')
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
              <Truck size={15} className="text-orange-600" /> Manual Ship
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {order.olmNumber ? `OLM-${order.olmNumber}` : order.amazonOrderId}
            </p>
            {order.shipToName && <p className="text-xs text-gray-400 mt-0.5">{order.shipToName}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Carrier <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={carrier}
                    onChange={e => setCarrier(e.target.value)}
                    placeholder="e.g. UPS, FedEx, USPS…"
                    className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Tracking Number <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={tracking}
                    onChange={e => setTracking(e.target.value)}
                    placeholder="Tracking number…"
                    className="w-full h-8 rounded border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>
              <div className="w-1/2">
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Shipping Cost</label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={shippingCost}
                    onChange={e => setShippingCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-8 rounded border border-gray-300 pl-5 pr-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                <AlertTriangle size={13} className="shrink-0" />
                <span>This will only update the local system. No shipment details will be pushed to the marketplace.</span>
              </div>

              {/* Summary of items */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Order Items</p>
                <div className="space-y-1">
                  {order.items.map(item => (
                    <div key={item.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-gray-50 border border-gray-100">
                      <div className="flex items-start gap-2 min-w-0">
                        <div>
                          <span className="font-mono font-semibold text-gray-800">{item.internalSku ?? item.sellerSku ?? '—'}</span>
                          {item.mappedGradeName && <span className="block text-[9px] font-semibold text-purple-600">Grade {item.mappedGradeName}</span>}
                        </div>
                        <span className="text-gray-400">×{item.quantityOrdered}</span>
                      </div>
                      {item.isSerializable && (
                        <span className="text-[9px] text-green-600 flex items-center gap-0.5 shrink-0">
                          <CheckCircle2 size={9} /> Serialized
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {submitErr && (
            <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />{submitErr}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSubmit} disabled={submitting || !canSubmit}
              className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1.5">
              {submitting ? <><RefreshCcw size={12} className="animate-spin" /> Marking Shipped…</> : <><Truck size={12} /> Mark as Shipped</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── BackMarket Serialize Modal ────────────────────────────────────────────────

function BmSerializeModal({ order, onClose, onSaved }: {
  order: Order
  onClose: () => void
  onSaved: (updatedItems: { orderItemId: string; serials: string[] }[]) => void
}) {
  // Initialize serial inputs from existing bmSerials or empty strings
  const [serialMap, setSerialMap] = useState<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {}
    for (const item of order.items) {
      const existing = item.bmSerials ?? []
      m[item.id] = Array.from({ length: item.quantityOrdered }, (_, i) => existing[i] ?? '')
    }
    return m
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allFilled = order.items.every(item =>
    (serialMap[item.id] ?? []).every(s => s.trim().length > 0),
  )

  async function save() {
    setSaving(true); setError(null)
    try {
      const items = order.items.map(item => ({
        orderItemId: item.id,
        serials: serialMap[item.id] ?? [],
      }))
      const res = await fetch(`/api/orders/${order.id}/bm-serialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      onSaved(items)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Assign Serial Numbers</h3>
            <p className="text-[10px] text-gray-400 font-mono">{order.amazonOrderId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {order.items.map(item => (
            <div key={item.id} className="space-y-2">
              <div className="flex items-center gap-2">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="w-8 h-8 rounded border object-cover shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{item.title ?? item.sellerSku ?? 'Unknown'}</p>
                  <p className="text-[10px] text-gray-400">SKU: {item.sellerSku ?? '—'} · Qty: {item.quantityOrdered}</p>
                </div>
              </div>
              {Array.from({ length: item.quantityOrdered }, (_, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-14 shrink-0">
                    {item.quantityOrdered > 1 ? `Unit ${idx + 1}` : 'Serial'}
                  </span>
                  <input
                    type="text"
                    value={serialMap[item.id]?.[idx] ?? ''}
                    onChange={e => {
                      const val = e.target.value
                      setSerialMap(prev => {
                        const arr = [...(prev[item.id] ?? [])]
                        arr[idx] = val
                        return { ...prev, [item.id]: arr }
                      })
                    }}
                    placeholder="Enter IMEI / Serial #"
                    className="flex-1 h-7 px-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 font-mono"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0 bg-gray-50/50 rounded-b-xl">
          {error && <p className="text-[10px] text-red-600 mr-2 truncate">{error}</p>}
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} className="h-8 px-3 rounded text-xs text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              onClick={save}
              disabled={saving || !allFilled}
              className="h-8 px-4 rounded text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Serials'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── BackMarket Manual Ship Modal ──────────────────────────────────────────────

function BmManualShipModal({ order, onClose, onShipped }: {
  order: Order; onClose: () => void; onShipped: () => void
}) {
  const [carrier, setCarrier]       = useState('')
  const [tracking, setTracking]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState<string | null>(null)

  const canSubmit = carrier.trim() && tracking.trim()

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true); setSubmitErr(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/bm-ship`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: carrier.trim(), tracking: tracking.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `${res.status}`)
      onShipped()
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Failed to ship')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <Truck size={15} className="text-emerald-600" /> Ship to Back Market
            </h3>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {order.olmNumber ? `OLM-${order.olmNumber}` : order.amazonOrderId}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
            <CheckCircle2 size={13} className="shrink-0" />
            <span>Carrier and tracking will be pushed to Back Market.</span>
          </div>
        </div>

        <div className="px-5 py-3 border-t shrink-0 space-y-2">
          {submitErr && (
            <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />{submitErr}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSubmit} disabled={submitting || !canSubmit}
              className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
              {submitting ? <><RefreshCcw size={12} className="animate-spin" /> Shipping…</> : <><Truck size={12} /> Ship Order</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── BM Retransmit Button ──────────────────────────────────────────────────────

function BmRetransmitButton({ orderId }: { orderId: string }) {
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState<'ok' | 'err' | null>(null)

  async function handleRetransmit() {
    setSending(true); setResult(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/bm-ship`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setResult('ok')
    } catch {
      setResult('err')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result === 'ok' && <span className="text-[10px] text-green-600 font-medium">Sent!</span>}
      {result === 'err' && <span className="text-[10px] text-red-600 font-medium">Failed</span>}
      <button onClick={handleRetransmit} disabled={sending}
        className="inline-flex items-center gap-1 h-6 px-2.5 rounded text-[10px] font-medium border border-gray-200 text-gray-500 hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-40 transition-colors bg-white">
        {sending ? <><RefreshCcw size={9} className="animate-spin" /> Sending…</> : <><RefreshCcw size={9} /> Re-send to Back Market</>}
      </button>
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
  type PendingSkuChange = { newSku: string | null; newTitle: string | null; originalSku: string | null; originalTitle: string | null; gradeId: string | null }
  const [pendingSkuChanges, setPendingSkuChanges] = useState<Map<string, PendingSkuChange>>(() => new Map())
  const [savingSkuChanges, setSavingSkuChanges]   = useState(false)

  // SKU autocomplete
  type SkuSuggestion = { sku: string; description: string }
  const [skuSuggestions, setSkuSuggestions]     = useState<SkuSuggestion[]>([])
  const [skuSuggestIdx, setSkuSuggestIdx]       = useState(-1)
  const skuDebounceRef                          = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Grade selection — shown after picking a SKU
  type GradeOption = { id: string; grade: string; description: string | null }
  const [grades, setGrades]               = useState<GradeOption[]>([])
  const [gradePickItemId, setGradePickItemId] = useState<string | null>(null) // which item is showing grade picker
  useEffect(() => {
    if (order.workflowStatus !== 'PENDING') return
    fetch('/api/grades').then(r => r.ok ? r.json() : { data: [] }).then((d: { data: GradeOption[] }) => setGrades(d.data ?? [])).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        gradeId:      null,
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
    // Show grade picker for this item
    if (grades.length > 0) setGradePickItemId(itemId)
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
          body: JSON.stringify({ sellerSku: change.newSku, gradeId: change.gradeId }),
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
  const taxSubtotal = order.items.reduce((s, i) => {
    return s + (i.itemTax ? parseFloat(i.itemTax) : 0)
  }, 0)
  const shippingSubtotal = order.items.reduce((s, i) => {
    return s + (i.shippingPrice ? parseFloat(i.shippingPrice) : 0)
  }, 0)
  const orderTotalNum = order.orderTotal
    ? parseFloat(order.orderTotal)
    : itemsSubtotal + taxSubtotal + shippingSubtotal

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
          {/* Marketplace logo */}
          {order.orderSource === 'backmarket' ? (
            <div className="shrink-0 w-9 h-9 rounded-lg bg-black flex items-center justify-center text-white">
              <BackMarketIcon size={24} />
            </div>
          ) : (
            <div className="shrink-0 w-9 h-9 rounded-lg bg-[#232F3E] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                <path d="M4 20c7 5 17 5 24 0" stroke="#FF9900" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M22 17l4 3-4 3" stroke="#FF9900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <text x="3" y="13" fontFamily="Arial" fontWeight="900" fontSize="10" fill="white" letterSpacing="-0.5">amazon</text>
              </svg>
            </div>
          )}

          {/* Order identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Order Number</span>
              {order.isPrime && <PrimeBadge />}
              <a
                href={order.orderSource === 'backmarket'
                  ? `https://www.backmarket.com/dashboard/sales/orders/${order.amazonOrderId}`
                  : `https://sellercentral.amazon.com/orders-v3/order/${order.amazonOrderId}`}
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
              <span className="text-xs text-gray-500">Store: <strong className="text-gray-700">{order.orderSource === 'backmarket' ? 'Back Market' : 'Amazon'}</strong></span>
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
                { label: 'Selling Channel', value: order.fulfillmentChannel ? (FULFILLMENT_LABEL[order.fulfillmentChannel] ?? order.fulfillmentChannel) : null },
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
              {taxSubtotal > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 leading-none mb-0.5">Tax</p>
                  <p className="text-xs font-medium text-gray-700">{fmt(String(taxSubtotal), order.currency)}</p>
                </div>
              )}
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
                                <div>
                                  <button
                                    onClick={isPendingOrder ? () => { setEditingSkuItemId(item.id); setEditingSkuValue(item.sellerSku ?? '') } : undefined}
                                    className={clsx(
                                      'font-mono text-[13px] font-semibold text-gray-900 text-left',
                                      isPendingOrder && 'group inline-flex items-center gap-1.5 hover:text-indigo-600 cursor-pointer',
                                    )}
                                  >
                                    {item.internalSku ?? item.sellerSku ?? <span className="text-gray-400 italic">—</span>}
                                    {isPendingOrder && <Pencil size={10} className="shrink-0 text-gray-300 group-hover:text-indigo-400 transition-colors" />}
                                    {/* Amber dot = unsaved staged change */}
                                    {pendingSkuChanges.has(item.id) && (
                                      <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved change — click Save Changes to apply" />
                                    )}
                                  </button>
                                  {/* Grade badge from pending change or MSKU mapping */}
                                  {pendingSkuChanges.get(item.id)?.gradeId ? (
                                    <span className="block text-[10px] font-semibold text-purple-700 mt-0.5">
                                      Grade {grades.find(g => g.id === pendingSkuChanges.get(item.id)?.gradeId)?.grade ?? ''}
                                    </span>
                                  ) : item.mappedGradeName ? (
                                    <span className="block text-[10px] font-semibold text-purple-700 mt-0.5">
                                      Grade {item.mappedGradeName}
                                    </span>
                                  ) : null}
                                  {/* Show marketplace SKU underneath when internal SKU differs */}
                                  {item.internalSku && item.sellerSku && item.internalSku !== item.sellerSku && (
                                    <span className="block font-mono text-[10px] text-gray-400 mt-0.5">{item.sellerSku}</span>
                                  )}
                                </div>
                              )}
                              {/* Grade picker dropdown — shown after picking a SKU */}
                              {isPendingOrder && gradePickItemId === item.id && grades.length > 0 && (
                                <div className="mt-1.5">
                                  <label className="text-[9px] font-medium text-gray-500 uppercase tracking-wide">Grade</label>
                                  <select
                                    autoFocus
                                    className="mt-0.5 block w-full text-[11px] border border-purple-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white"
                                    value={pendingSkuChanges.get(item.id)?.gradeId ?? ''}
                                    onChange={e => {
                                      const gId = e.target.value || null
                                      setPendingSkuChanges(prev => {
                                        const next = new Map(prev)
                                        const existing = next.get(item.id)
                                        if (existing) next.set(item.id, { ...existing, gradeId: gId })
                                        return next
                                      })
                                      setGradePickItemId(null)
                                    }}
                                    onBlur={() => setGradePickItemId(null)}
                                  >
                                    <option value="">No grade</option>
                                    {grades.map(g => <option key={g.id} value={g.id}>{g.grade}{g.description ? ` — ${g.description}` : ''}</option>)}
                                  </select>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              <div className="flex items-start gap-2">
                                {item.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.imageUrl}
                                    alt={item.sellerSku ?? 'Product'}
                                    width={44}
                                    height={44}
                                    className="rounded border border-gray-200 object-contain bg-gray-50 shrink-0"
                                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                                  />
                                ) : item.asin ? (
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
                            <td className="px-4 py-2.5 text-right tabular-nums align-top font-semibold text-gray-900">{item.quantityOrdered}</td>
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
                        {taxSubtotal > 0 && (
                          <div className="flex justify-between gap-6">
                            <dt className="text-gray-500">Tax:</dt>
                            <dd className="tabular-nums text-gray-700">{fmt(String(taxSubtotal), order.currency)}</dd>
                          </div>
                        )}
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

              {/* SHIPMENT INFO — for manually shipped orders (no label) */}
              {!order.label && (order.shipCarrier || order.shipTracking) && (
                <SectionCard title="Shipment" icon={<Truck size={11} />}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    {order.shipCarrier && (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Carrier</p>
                        <p className="font-semibold text-gray-900">{order.shipCarrier}</p>
                      </div>
                    )}
                    {order.shippedAt && (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Shipped Date</p>
                        <p className="font-medium text-gray-700">{fmtDate(order.shippedAt)}</p>
                      </div>
                    )}
                    {order.shipTracking && (
                      <div className="col-span-2 sm:col-span-4">
                        <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Tracking Number</p>
                        <p className="font-mono font-semibold text-gray-900 text-sm">{order.shipTracking}</p>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* SERIAL NUMBERS (internal inventory serials) */}
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
                              <td className="px-4 py-2 font-mono text-gray-600">{item?.internalSku ?? item?.sellerSku ?? '—'}{item?.mappedGradeName && <span className="block text-[9px] font-semibold text-purple-600">Grade {item.mappedGradeName}</span>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}

              {/* BACK MARKET SERIALS (IMEI / serial numbers stored on BM items) */}
              {order.orderSource === 'backmarket' && order.items.some(i => (i.bmSerials?.length ?? 0) > 0) && (
                <SectionCard
                  title={`Serial / IMEI Numbers (${order.items.reduce((s, i) => s + (i.bmSerials?.length ?? 0), 0)})`}
                  icon={<Hash size={11} />}
                  action={order.workflowStatus === 'SHIPPED' ? (
                    <BmRetransmitButton orderId={order.id} />
                  ) : undefined}
                >
                  <div className="-mx-4 -mt-3">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide w-8">#</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Serial / IMEI</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(() => {
                          let counter = 0
                          return order.items.flatMap(item =>
                            (item.bmSerials ?? []).map(serial => {
                              counter++
                              return (
                                <tr key={`${item.id}-${serial}`} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-400 tabular-nums">{counter}</td>
                                  <td className="px-4 py-2 font-mono font-semibold text-gray-900">{serial}</td>
                                  <td className="px-4 py-2 font-mono text-gray-600">{item.internalSku ?? item.sellerSku ?? '—'}</td>
                                </tr>
                              )
                            })
                          )
                        })()}
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
    if (!key.trim()) { setErr('API Key is required'); return }
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
            <label className="block text-xs font-medium text-gray-700 mb-1">API Secret <span className="text-gray-400 font-normal">(optional — only for V1 keys)</span></label>
            <input type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue" placeholder="Leave blank if using V2 API Key" value={secret} onChange={e => setSecret(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleConnect() }} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleConnect} disabled={saving || !key.trim()} className="px-4 py-1.5 text-sm bg-amazon-blue text-white rounded-lg hover:opacity-90 disabled:opacity-50">{saving ? 'Connecting…' : 'Connect'}</button>
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
  qzPrint?: { connected: boolean; defaultPrinter: string | null; printPdf: (b64: string, printer?: string) => Promise<void> }
}

const FROM_ZIP_KEY  = 'ss_from_zip'
const WH_KEY        = 'ss_warehouse_id'
const TEST_MODE_KEY = 'ss_test_mode'

const CARRIER_LOGOS: Record<string, string> = {
  usps: '/logos/usps.svg',
  stamps_com: '/logos/usps.svg',
  ups: '/logos/ups.svg',
  ups_walleted: '/logos/ups.svg',
  fedex: '/logos/fedex.svg',
  fedex_direct: '/logos/fedex.svg',
  dhl_express: '/logos/dhl.svg',
  dhl_express_worldwide: '/logos/dhl.svg',
}

function carrierLogo(carrierCode: string | null | undefined, serviceName?: string | null): string | null {
  const candidates = [carrierCode, serviceName].filter(Boolean).map(s => s!.toLowerCase())
  for (const key of candidates) {
    if (CARRIER_LOGOS[key]) return CARRIER_LOGOS[key]
    if (key.includes('usps') || key.includes('stamps')) return '/logos/usps.svg'
    if (key.includes('ups')) return '/logos/ups.svg'
    if (key.includes('fedex')) return '/logos/fedex.svg'
    if (key.includes('dhl')) return '/logos/dhl.svg'
  }
  return null
}

function CarrierLogo({ carrierCode, serviceName, size = 16 }: { carrierCode: string | null | undefined; serviceName?: string | null; size?: number }) {
  const src = carrierLogo(carrierCode, serviceName)
  if (!src) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size * 2.5} height={size} className="shrink-0 object-contain" />
}

function LabelPanel({ order, ssAccount, onClose, onLabelSaved, qzPrint }: LabelPanelProps) {
  const [lookup, setLookup]         = useState<SSLookupResult>({ status: 'loading' })
  const [warehouses, setWarehouses] = useState<SSWarehouse[]>([])
  const [whLoading, setWhLoading]   = useState(false)
  const [selectedWhId, setSelectedWhId] = useState<string>('')
  const [pkg, setPkg]               = useState<PackageDimensions>(DEFAULT_PKG)
  const [weight, setWeight]         = useState<Weight>(DEFAULT_WT)
  const [fromZip, setFromZip]       = useState<string>('')
  const [confirmation, setConfirmation] = useState<string>('none')
  const [labelShipDate, setLabelShipDate] = useState(() => new Date().toISOString().slice(0, 10))

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
  const [fedexDebug, setFedexDebug]     = useState<{ credentialsFound: boolean; requestParams?: unknown; rateCount?: number; error?: string } | null>(null)
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

  // ── Transparency code entry state ──
  const [pendingRate, setPendingRate]   = useState<SSRate | null>(null)
  const [tCodes, setTCodes]           = useState<Record<string, string[]>>({}) // orderItemId → codes[]
  const [tSubmitting, setTSubmitting] = useState(false)
  const [tError, setTError]           = useState<string | null>(null)

  const transparencyItems = useMemo(
    () => order.items.filter(i => i.isTransparency),
    [order.items],
  )
  const needsTransparency = transparencyItems.length > 0

  // Check if codes were already submitted (persisted on the order items)
  const codesAlreadySaved = useMemo(
    () => needsTransparency && transparencyItems.every(
      i => (i.transparencyCodes?.length ?? 0) >= i.quantityOrdered,
    ),
    [needsTransparency, transparencyItems],
  )

  // Initialize tCodes from any already-saved codes
  useEffect(() => {
    if (!needsTransparency) return
    const initial: Record<string, string[]> = {}
    for (const item of transparencyItems) {
      const existing = item.transparencyCodes ?? []
      initial[item.orderItemId] = Array.from(
        { length: item.quantityOrdered },
        (_, idx) => existing[idx] ?? '',
      )
    }
    setTCodes(initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

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
    setLoadingRates(true); setRatesErr(null); setRates(null); setAmazonServices(null); setPurchased(null); setJwtStatus(null); setFedexDebug(null)
    try {
      const { shipTo } = lookup
      const selectedWh = warehouses.find(w => String(w.warehouseId) === selectedWhId)
      const data = await apiPost<{ rates: SSRate[]; errors?: string[]; jwtExpired?: boolean; amazonServices?: { code: string; name: string; carrierCode: string; carrierName: string; shipmentCost?: number }[]; fedexDebug?: { credentialsFound: boolean; requestParams?: unknown; rateCount?: number; error?: string } }>(
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
          orderSource: order.orderSource ?? 'amazon',
          orderItems: order.items.map(item => ({ orderItemId: item.orderItemId, title: item.title, quantity: item.quantityOrdered })),
          shipDate: labelShipDate,
        })
      setRates(Array.isArray(data.rates) ? data.rates : [])
      if (data.fedexDebug) setFedexDebug(data.fedexDebug)
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

  async function submitTransparencyCodes(): Promise<boolean> {
    setTSubmitting(true); setTError(null)
    try {
      const payload = {
        items: transparencyItems.map(item => ({
          orderItemId: item.orderItemId,
          codes: tCodes[item.orderItemId] ?? [],
        })),
      }
      const res = await fetch(`/api/orders/${order.id}/transparency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to save codes' }))
        setTError(data.error ?? `Error ${res.status}`)
        return false
      }
      return true
    } catch (e) {
      setTError(e instanceof Error ? e.message : 'Failed to save transparency codes')
      return false
    } finally { setTSubmitting(false) }
  }

  async function handleBuyWithTransparency() {
    if (!pendingRate) return
    const ok = await submitTransparencyCodes()
    if (!ok) return
    // Codes saved — proceed with label purchase
    const rate = pendingRate
    setPendingRate(null)
    await executeBuyLabel(rate)
  }

  async function buyLabel(rate: SSRate) {
    // Gate: if order needs transparency codes and they haven't been saved yet
    if (needsTransparency && !codesAlreadySaved) {
      setPendingRate(rate)
      setPurchaseErr(null)
      return // Show transparency code entry UI instead
    }
    await executeBuyLabel(rate)
  }

  async function executeBuyLabel(rate: SSRate) {
    if (lookup.status !== 'found') return
    setPurchasing(`${rate.carrierCode}-${rate.serviceCode}`); setPurchaseErr(null)
    try {
      const isFedExDirect = rate.carrierCode === 'fedex_direct'
      const selectedWh = warehouses.find(w => String(w.warehouseId) === selectedWhId)
      const { shipTo } = lookup

      const label = isFedExDirect
        ? await apiPost<{ trackingNumber: string; labelData: string; labelFormat: string; shipmentCost?: number }>(
            '/api/fedex/create-label', {
              serviceCode: rate.serviceCode,
              fromName: selectedWh?.originAddress.name, fromPhone: selectedWh?.originAddress.phone,
              fromAddress1: selectedWh?.originAddress.street1,
              fromCity: selectedWh?.originAddress.city, fromState: selectedWh?.originAddress.state,
              fromPostalCode: fromZip, fromCountry: selectedWh?.originAddress.country ?? 'US',
              toName: shipTo.name, toPhone: shipTo.phone,
              toAddress1: shipTo.street1, toAddress2: shipTo.street2,
              toCity: shipTo.city, toState: shipTo.state,
              toPostalCode: shipTo.postalCode, toCountry: shipTo.country || 'US',
              residential: true,
              weight: { value: weight.value, units: weight.unit },
              dimensions: { units: pkg.unit, length: pkg.length, width: pkg.width, height: pkg.height },
              shipDate: labelShipDate, testLabel: testMode,
            },
          )
        : await apiPost<{ trackingNumber: string; labelData: string; labelFormat: string; shipmentCost?: number }>(
            '/api/shipstation/label-for-order', {
              orderId: lookup.ssOrderId, carrierCode: rate.carrierCode, serviceCode: rate.serviceCode,
              packageCode: 'package', confirmation, shipDate: labelShipDate,
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
            isAmazonBuyShipping: !!rate.rate_id,
          })

          // Auto-print via QZ Tray if connected (non-fatal)
          if (qzPrint?.connected && qzPrint.defaultPrinter && (label.labelFormat ?? 'pdf') === 'pdf') {
            try { await qzPrint.printPdf(label.labelData) } catch { /* non-fatal */ }
          }

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
            <button onClick={async () => {
                if (qzPrint?.connected && qzPrint.defaultPrinter && purchased.labelFormat === 'pdf') {
                  try { await qzPrint.printPdf(purchased.labelData); toast.success('Label sent to printer') } catch { downloadLabelData(purchased.labelData, purchased.labelFormat, `label-${order.amazonOrderId}`) }
                } else {
                  downloadLabelData(purchased.labelData, purchased.labelFormat, `label-${order.amazonOrderId}`)
                }
              }}
              className="w-full flex items-center justify-center gap-2 bg-green-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-green-700">
              {qzPrint?.connected && qzPrint.defaultPrinter ? <><Printer size={14} /> Print Label</> : <><Download size={14} /> Download Label</>}
            </button>
            <button onClick={() => { setPurchased(null); setRates(null) }} className="w-full text-xs text-gray-500 hover:text-gray-700 text-center">Buy another label</button>
          </div>
        )}

        {!purchased && (<>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
            {order.items.map(item => (
              <div key={item.id} className="flex items-start gap-2 text-xs">
                <span className="font-mono text-gray-600 shrink-0">{item.internalSku ?? item.sellerSku ?? '—'}{item.mappedGradeName && <span className="block text-[9px] font-semibold text-purple-600">Grade {item.mappedGradeName}</span>}</span>
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
              <div className="flex flex-col gap-1 shrink-0">
                <label className="text-xs font-medium text-gray-600">Ship Date</label>
                <input type="date" value={labelShipDate} onChange={e => { setLabelShipDate(e.target.value); setRates(null) }}
                  min={new Date().toISOString().slice(0, 10)}
                  className="h-8 rounded border border-gray-300 px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FF9900]" />
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

          {fedexDebug && (
            <details className="rounded-lg border border-gray-200 bg-gray-50 text-xs">
              <summary className="cursor-pointer px-3 py-2 font-medium text-gray-600 select-none">FedEx Debug Info</summary>
              <pre className="px-3 pb-3 pt-1 text-[11px] text-gray-500 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(fedexDebug, null, 2)}</pre>
            </details>
          )}

          {/* ── Transparency Code Entry (shown when user clicks Buy on an order that needs codes) ── */}
          {pendingRate && needsTransparency && (
            <section className="rounded-xl border-2 border-teal-300 bg-teal-50/50 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-teal-600" />
                <h3 className="text-sm font-semibold text-teal-800">Transparency Codes Required</h3>
              </div>
              <p className="text-xs text-teal-700">
                Enter the Transparency code for each unit before purchasing the label.
              </p>

              {transparencyItems.map(item => (
                <div key={item.orderItemId} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <div>
                      <span className="font-mono font-semibold text-gray-700">{item.internalSku ?? item.sellerSku ?? item.asin ?? '—'}</span>
                      {item.mappedGradeName && <span className="block text-[9px] font-semibold text-purple-600">Grade {item.mappedGradeName}</span>}
                    </div>
                    <span className="text-gray-400">×{item.quantityOrdered}</span>
                    <span className="text-gray-500 truncate">{item.title ?? ''}</span>
                  </div>
                  {Array.from({ length: item.quantityOrdered }, (_, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 w-16 shrink-0">Code {idx + 1}</label>
                      <input
                        type="text"
                        value={tCodes[item.orderItemId]?.[idx] ?? ''}
                        onChange={e => {
                          const val = e.target.value
                          setTCodes(prev => {
                            const codes = [...(prev[item.orderItemId] ?? Array(item.quantityOrdered).fill(''))]
                            codes[idx] = val
                            return { ...prev, [item.orderItemId]: codes }
                          })
                        }}
                        placeholder="Scan or enter transparency code"
                        className="flex-1 h-8 rounded border border-gray-300 px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
                        autoFocus={idx === 0}
                      />
                    </div>
                  ))}
                </div>
              ))}

              {tError && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{tError}</span>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleBuyWithTransparency}
                  disabled={tSubmitting || transparencyItems.some(i => (tCodes[i.orderItemId] ?? []).some(c => !c.trim()))}
                  className={clsx(
                    'flex-1 h-10 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors',
                    tSubmitting || transparencyItems.some(i => (tCodes[i.orderItemId] ?? []).some(c => !c.trim()))
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-teal-600 text-white hover:bg-teal-700',
                  )}
                >
                  {tSubmitting
                    ? <><RefreshCcw size={13} className="animate-spin" /> Saving codes…</>
                    : <><ShieldCheck size={13} /> Submit Codes & Buy Label</>}
                </button>
                <button
                  onClick={() => { setPendingRate(null); setTError(null) }}
                  disabled={tSubmitting}
                  className="px-4 h-10 rounded-md text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

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
                    <div className="min-w-0 flex items-center gap-2.5">
                      <CarrierLogo carrierCode={svc.carrierName} size={14} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{svc.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{svc.carrierName}</p>
                      </div>
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

          {rates !== null && rates.length > 0 && (() => {
            const ssRates = rates.filter(r => r.carrierCode !== 'fedex_direct')
            const fedexDirectRates = rates.filter(r => r.carrierCode === 'fedex_direct')
            const renderRate = (rate: SSRate, idx: number) => {
              const total = rate.shipmentCost + rate.otherCost, isBuying = purchasing === `${rate.carrierCode}-${rate.serviceCode}`
              return (
                <div key={`${rate.carrierCode}-${rate.serviceCode}-${idx}`} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#FF9900] transition-colors">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <CarrierLogo carrierCode={rate.carrierCode} size={14} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{rate.serviceName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{rate.carrierName ?? rate.carrierCode}{rate.transitDays != null ? ` · ${rate.transitDays}d` : ''}{rate.deliveryDate ? ` · Est. ${new Date(rate.deliveryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
                    </div>
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
            }
            return (
              <div className="space-y-4">
                {ssRates.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">ShipStation Rates ({ssRates.length})</h3>
                    {ssRates.map(renderRate)}
                  </section>
                )}
                {fedexDirectRates.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1.5"><CarrierLogo carrierCode="fedex_direct" size={12} /> FedEx Direct Rates ({fedexDirectRates.length})</h3>
                    {fedexDirectRates.map(renderRate)}
                  </section>
                )}
              </div>
            )
          })()}
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
  order: { amazonOrderId: string; olmNumber: number | null; shipToName: string | null; presetRateService: string | null }
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

// ─── Batch Gauge SVG ─────────────────────────────────────────────────────────

function BatchGauge({ completed, total, failed }: { completed: number; total: number; failed: number }) {
  const pct = total > 0 ? Math.min((completed + failed) / total, 1) : 0
  const size = 200
  const cx = size / 2, cy = size / 2 + 10
  const r = 78
  const startAngle = 135               // bottom-left
  const endAngle = 405                  // bottom-right (270° arc)
  const arcSpan = endAngle - startAngle // 270
  const toRad = (d: number) => (d * Math.PI) / 180

  // Background arc
  const bgStart = { x: cx + r * Math.cos(toRad(startAngle)), y: cy + r * Math.sin(toRad(startAngle)) }
  const bgEnd = { x: cx + r * Math.cos(toRad(endAngle)), y: cy + r * Math.sin(toRad(endAngle)) }
  const bgPath = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 1 1 ${bgEnd.x} ${bgEnd.y}`

  // Progress arc
  const progAngle = startAngle + arcSpan * pct
  const progEnd = { x: cx + r * Math.cos(toRad(progAngle)), y: cy + r * Math.sin(toRad(progAngle)) }
  const largeArc = pct * arcSpan > 180 ? 1 : 0
  const progPath = pct > 0 ? `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 ${largeArc} 1 ${progEnd.x} ${progEnd.y}` : ''

  // Needle
  const needleAngle = startAngle + arcSpan * pct
  const needleLen = r - 16
  const needleTip = { x: cx + needleLen * Math.cos(toRad(needleAngle)), y: cy + needleLen * Math.sin(toRad(needleAngle)) }

  const isDone = completed + failed >= total && total > 0
  const hasErrors = failed > 0
  const progressColor = isDone ? (hasErrors ? '#f59e0b' : '#22c55e') : '#6366f1'

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.65} viewBox={`0 0 ${size} ${size * 0.65}`}>
        {/* Background track */}
        <path d={bgPath} fill="none" stroke="#e5e7eb" strokeWidth={12} strokeLinecap="round" />
        {/* Progress arc */}
        {progPath && (
          <path d={progPath} fill="none" stroke={progressColor} strokeWidth={12} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }} />
        )}
        {/* Tick marks */}
        {Array.from({ length: 11 }).map((_, i) => {
          const angle = startAngle + (arcSpan / 10) * i
          const inner = r + 8
          const outer = r + 14
          return (
            <line key={i}
              x1={cx + inner * Math.cos(toRad(angle))} y1={cy + inner * Math.sin(toRad(angle))}
              x2={cx + outer * Math.cos(toRad(angle))} y2={cy + outer * Math.sin(toRad(angle))}
              stroke="#d1d5db" strokeWidth={1.5} strokeLinecap="round" />
          )
        })}
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y}
          stroke="#1f2937" strokeWidth={2.5} strokeLinecap="round"
          style={{ transition: 'x2 0.5s ease, y2 0.5s ease' }} />
        {/* Center cap */}
        <circle cx={cx} cy={cy} r={5} fill="#374151" />
      </svg>
      <div className="text-center -mt-1">
        <span className="text-3xl font-bold tabular-nums" style={{ color: progressColor }}>
          {completed + failed}
        </span>
        <span className="text-lg text-gray-400 font-medium"> / {total}</span>
      </div>
      <p className="text-xs text-gray-500 mt-0.5">
        {isDone
          ? hasErrors ? `Done — ${failed} failed` : 'All labels created'
          : 'Labels processed'}
      </p>
    </div>
  )
}

// ─── BatchItemGrid ───────────────────────────────────────────────────────────

const ITEM_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon?: 'spin' | 'check' | 'x' }> = {
  PENDING:   { label: 'Queued',     bg: 'bg-gray-50',   text: 'text-gray-500' },
  RUNNING:   { label: 'Processing', bg: 'bg-blue-50',   text: 'text-blue-700', icon: 'spin' },
  COMPLETED: { label: 'Success',    bg: 'bg-green-50',  text: 'text-green-700', icon: 'check' },
  FAILED:    { label: 'Error',      bg: 'bg-red-50',    text: 'text-red-700', icon: 'x' },
}

function BatchItemGrid({ items }: { items: LabelBatchItemStatus[] }) {
  return (
    <div className="border rounded-lg overflow-hidden flex-1 min-h-0">
      <div className="overflow-y-auto max-h-[40vh]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-gray-500">
              <th className="text-left px-3 py-1.5 font-semibold w-8">#</th>
              <th className="text-left px-3 py-1.5 font-semibold">Order</th>
              <th className="text-left px-3 py-1.5 font-semibold">Ship To</th>
              <th className="text-left px-3 py-1.5 font-semibold">Service</th>
              <th className="text-center px-3 py-1.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item, idx) => {
              const cfg = ITEM_STATUS_CONFIG[item.status] ?? ITEM_STATUS_CONFIG.PENDING
              return (
                <tr key={item.id} className={clsx(cfg.bg, item.status === 'RUNNING' && 'animate-pulse')}>
                  <td className="px-3 py-1.5 tabular-nums text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-gray-800">
                      {item.order.olmNumber ? `OLM-${item.order.olmNumber}` : item.order.amazonOrderId}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 truncate max-w-[120px]" title={item.order.shipToName ?? ''}>
                    {item.order.shipToName ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 truncate max-w-[120px]" title={item.order.presetRateService ?? ''}>
                    {item.order.presetRateService ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold', cfg.text)}>
                        {cfg.icon === 'spin' && <RefreshCcw size={9} className="animate-spin" />}
                        {cfg.icon === 'check' && <CheckCircle2 size={9} />}
                        {cfg.icon === 'x' && <XCircle size={9} />}
                        {cfg.label}
                      </span>
                      {item.status === 'FAILED' && item.error && (
                        <span className="text-[9px] text-red-500 leading-tight max-w-[160px] text-center" title={item.error}>
                          {item.error}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── LabelBatchModal ─────────────────────────────────────────────────────────

interface LabelBatchModalProps {
  orders: Order[]
  batchEligible: string[]
  skippedCount: number
  existingBatchId?: string | null
  onClose: () => void
  onBatchCreated: (batchId: string) => void
  onBatchComplete: () => void
  qzPrint?: { connected: boolean; defaultPrinter: string | null; printMultiplePdfs: (b64s: string[], printer?: string) => Promise<void> }
}

function LabelBatchModal({ orders, batchEligible, skippedCount, existingBatchId, onClose, onBatchCreated, onBatchComplete, qzPrint }: LabelBatchModalProps) {
  // Phase: 'confirm' | 'processing' | 'done'
  const [phase, setPhase] = useState<'confirm' | 'processing' | 'done'>(existingBatchId ? 'processing' : 'confirm')
  const [isTest, setIsTest] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(existingBatchId ?? null)
  const [pollData, setPollData] = useState<LabelBatchPollData | null>(null)
  const [showFailed, setShowFailed] = useState(false)
  const [printingAll, setPrintingAll] = useState(false)

  // Build shipping method breakdown from eligible orders
  const methodBreakdown = useMemo(() => {
    const groups: Record<string, { carrier: string; service: string; count: number; totalCost: number }> = {}
    for (const id of batchEligible) {
      const o = orders.find(x => x.id === id)
      if (!o) continue
      const carrier = o.presetRateCarrier ?? 'Unknown'
      const service = o.presetRateService ?? 'Unknown'
      const key = `${carrier}|${service}`
      if (!groups[key]) groups[key] = { carrier, service, count: 0, totalCost: 0 }
      groups[key].count++
      groups[key].totalCost += parseFloat(o.presetRateAmount ?? '0')
    }
    return Object.values(groups).sort((a, b) => b.count - a.count)
  }, [batchEligible, orders])

  const totalEstCost = methodBreakdown.reduce((s, m) => s + m.totalCost, 0)

  // Confirm → create batch
  async function handleConfirm() {
    setCreateErr(null)
    try {
      const data = await apiPost<{ batchId: string; totalOrders: number; skipped: number }>(
        '/api/orders/label-batch',
        { orderIds: batchEligible, isTest },
      )
      setBatchId(data.batchId)
      setPhase('processing')
      onBatchCreated(data.batchId)

      // Trigger batch processing in a separate long-running function invocation.
      // This fetch keeps the /continue endpoint alive for up to 5 min; we don't
      // await the result — the polling loop below tracks progress.
      fetch('/api/orders/label-batch/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: data.batchId }),
      }).catch(() => { /* polling will detect stale batch */ })
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Failed to create batch')
    }
  }

  // Poll batch progress — also re-triggers processing if the function timed out
  useEffect(() => {
    if (phase !== 'processing' || !batchId) return
    let stopped = false
    let lastProgress = 0    // completed + failed at last poll
    let stallCount   = 0    // consecutive polls with no progress

    async function poll() {
      try {
        const res = await fetch(`/api/orders/label-batch/${batchId}`)
        if (!res.ok) return
        const batch: LabelBatchPollData = await res.json()
        setPollData(batch)

        if (batch.status === 'COMPLETED' || batch.status === 'FAILED') {
          stopped = true
          setPhase('done')
          onBatchComplete()
          return
        }

        // Detect stall: if RUNNING but no progress for 3 consecutive polls (~6s),
        // re-trigger processing (the previous function likely timed out)
        const currentProgress = batch.completed + batch.failed
        if (batch.status === 'RUNNING' && currentProgress === lastProgress && currentProgress < batch.totalOrders) {
          stallCount++
          if (stallCount >= 8) {
            console.log('[LabelBatch] stall detected at %d/%d, re-triggering', currentProgress, batch.totalOrders)
            stallCount = 0
            fetch('/api/orders/label-batch/continue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batchId }),
            }).catch(() => {})
          }
        } else {
          stallCount = 0
        }
        lastProgress = currentProgress
      } catch { /* transient */ }
    }

    poll()
    const interval = setInterval(() => { if (!stopped) poll() }, 2000)
    return () => { stopped = true; clearInterval(interval) }
  }, [phase, batchId])

  const completed = pollData?.completed ?? 0
  const failed = pollData?.failed ?? 0
  const total = pollData?.totalOrders ?? batchEligible.length
  const failedItems = pollData?.items.filter(i => i.status === 'FAILED') ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-gray-50">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <Tag size={14} className="text-indigo-600" />
            {phase === 'confirm' ? 'Create Label Batch' : phase === 'processing' ? 'Purchasing Labels…' : 'Batch Complete'}
          </h3>
          {phase !== 'processing' && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
          )}
        </div>

        {/* ── Confirm Phase ─────────────────────────────────────── */}
        {phase === 'confirm' && (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-700">
              Purchase labels for{' '}
              <strong className="text-indigo-700">{batchEligible.length} order{batchEligible.length !== 1 ? 's' : ''}</strong>.
              The batch will process on the server — you can close the modal at any time.
            </p>

            {skippedCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                {skippedCount} order{skippedCount !== 1 ? 's' : ''} have no captured rate and will be skipped.
              </div>
            )}

            {/* Shipping method breakdown */}
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Shipping Method Breakdown</h4>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="text-left px-3 py-1.5 font-semibold">Carrier</th>
                      <th className="text-left px-3 py-1.5 font-semibold">Service</th>
                      <th className="text-right px-3 py-1.5 font-semibold">Labels</th>
                      <th className="text-right px-3 py-1.5 font-semibold">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {methodBreakdown.map((m, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium text-gray-800">{m.carrier}</td>
                        <td className="px-3 py-1.5 text-gray-600">{m.service}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-800">{m.count}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">${m.totalCost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold text-gray-800">
                      <td colSpan={2} className="px-3 py-1.5">Total</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{batchEligible.length}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">${totalEstCost.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              Create test labels (no charge)
            </label>

            {createErr && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {createErr}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose}
                className="px-3.5 py-2 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleConfirm}
                className="px-3.5 py-2 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center gap-1.5">
                <Tag size={11} /> Confirm &amp; Purchase
              </button>
            </div>
          </div>
        )}

        {/* ── Processing Phase ──────────────────────────────────── */}
        {phase === 'processing' && (
          <div className="px-5 py-4 flex flex-col min-h-0">
            <BatchGauge completed={completed} total={total} failed={failed} />
            <p className="text-center text-xs text-gray-400 mt-2 mb-3">
              {pollData?.isTest && <span className="bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-semibold mr-1">TEST</span>}
              Processing on the server… you can close this modal safely.
            </p>
            {pollData && <BatchItemGrid items={pollData.items} />}
          </div>
        )}

        {/* ── Done Phase ────────────────────────────────────────── */}
        {phase === 'done' && (
          <div className="px-5 py-4 flex flex-col min-h-0 gap-3">
            <BatchGauge completed={completed} total={total} failed={failed} />
            {pollData && <BatchItemGrid items={pollData.items} />}

            <div className="flex items-center justify-between pt-1">
              {completed > 0 && qzPrint?.connected && qzPrint.defaultPrinter ? (
                <button
                  type="button" disabled={printingAll}
                  onClick={async () => {
                    if (!batchId) return
                    setPrintingAll(true)
                    try {
                      const res = await fetch(`/api/orders/label-batch/${batchId}/labels`)
                      if (!res.ok) { toast.error('Failed to fetch batch labels'); return }
                      const { labels } = await res.json() as { labels: { orderId: string; labelData: string; labelFormat: string }[] }
                      const pdfLabels = labels.filter(l => l.labelFormat === 'pdf').map(l => l.labelData)
                      if (pdfLabels.length === 0) { toast.error('No PDF labels in batch'); return }
                      await qzPrint.printMultiplePdfs(pdfLabels)
                      toast.success(`${pdfLabels.length} labels sent to printer`)
                    } catch { toast.error('Batch print failed') }
                    finally { setPrintingAll(false) }
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {printingAll ? <RefreshCcw size={10} className="animate-spin" /> : <Printer size={12} />}
                  Print All Labels
                </button>
              ) : <div />}
              <button onClick={onClose}
                className="px-3.5 py-2 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
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
  const qz = useQzTray({ autoConnect: true })

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
  const [syncSource, setSyncSource]       = useState<'all' | 'amazon' | 'backmarket'>('all')
  const [syncStatus, setSyncStatus]       = useState<SyncJob | null>(null)
  const [bmSyncStatus, setBmSyncStatus]   = useState<SyncJob | null>(null)
  const [syncError, setSyncError]         = useState<string | null>(null)
  const [ssEnriching, setSsEnriching]     = useState(false)
  const [ssEnrichResult, setSsEnrichResult] = useState<{ enriched: number; addresses: number } | null>(null)
  const [ssProgress, setSsProgress]       = useState('')
  const [showSyncBar, setShowSyncBar]     = useState(false)
  const [lastSyncInfo, setLastSyncInfo]   = useState<Record<string, { completedAt: string; trigger: string; totalSynced: number } | null>>({})

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bmPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Buyer cancellation check state
  type CancelFlaggedOrder = { id: string; amazonOrderId: string; olmNumber: number | null; buyerCancelReason: string | null; workflowStatus: string }
  const [checkingCancels, setCheckingCancels]   = useState(false)
  const [cancelFlagged, setCancelFlagged]       = useState<CancelFlaggedOrder[] | null>(null)
  const [cancelCheckedCount, setCancelCheckedCount] = useState<number | null>(null)
  const [cancelCheckError, setCancelCheckError] = useState<string | null>(null)
  const [cancelProgress, setCancelProgress]     = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cancelDebug, setCancelDebug]           = useState<any>(null)

  const [ssAccount, setSSAccount]         = useState<SSAccount | null>(null)
  const [showConnectSS, setShowConnectSS] = useState(false)
  const [labelOrder, setLabelOrder]       = useState<Order | null>(null)
  const [processOrder, setProcessOrder]   = useState<Order | null>(null)
  const [verifyOrder, setVerifyOrder]     = useState<Order | null>(null)

  // Unprocess / cancel / reinstate state
  const [unprocessingId, setUnprocessingId]       = useState<string | null>(null)
  const [cancellingId, setCancellingId]           = useState<string | null>(null)
  const [bulkCancelling, setBulkCancelling]       = useState(false)
  const [bulkCancelResult, setBulkCancelResult]   = useState<{ cancelled: number; total: number; errors: string[] } | null>(null)
  const [reinstatingId, setReinstatingId]         = useState<string | null>(null)
  const [voidingId, setVoidingId]                 = useState<string | null>(null)
  const [voidSuccessMsg, setVoidSuccessMsg]       = useState<string | null>(null)

  // Wholesale state
  const [wholesaleOrders, setWholesaleOrders]             = useState<Order[]>([])
  const [wholesaleShipOrder, setWholesaleShipOrder]       = useState<Order | null>(null)
  const [wholesaleSerializeOrder, setWholesaleSerializeOrder] = useState<Order | null>(null)
  const [manualShipOrder, setManualShipOrder]             = useState<Order | null>(null)
  const [wholesaleProcessOrder, setWholesaleProcessOrder] = useState<Order | null>(null)

  // Order detail modal
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [unserializeOrder, setUnserializeOrder] = useState<Order | null>(null)

  // Shipping presets state
  const [presets, setPresets]                 = useState<ShippingPreset[]>([])
  // Package presets state
  const [packagePresets, setPackagePresets]           = useState<PackagePreset[]>([])
  const [selectedPackagePresetId, setSelectedPackagePresetId] = useState('')
  const [applyingPackagePreset, setApplyingPackagePreset]     = useState(false)
  const [pkgRatingOrderIds, setPkgRatingOrderIds]             = useState<Set<string>>(new Set())
  const [applyPkgResult, setApplyPkgResult]                   = useState<{ applied: number; total: number; errors: { orderId: string; amazonOrderId: string; error: string }[] } | null>(null)
  const [showPackagePresetModal, setShowPackagePresetModal]   = useState(false)
  // Default package presets state (apply defaults from product mapping)
  const [applyingDefaultPresets, setApplyingDefaultPresets]   = useState(false)
  const [defaultPresetApplyingIds, setDefaultPresetApplyingIds] = useState<Set<string>>(new Set())
  const [applyDefaultResult, setApplyDefaultResult]           = useState<{ applied: number; total: number; skipped: number; errors: { orderId: string; amazonOrderId: string; error: string }[] } | null>(null)
  const [filterPkgPreset, setFilterPkgPreset]                 = useState<'all' | 'assigned' | 'unassigned'>('all')
  // Rate shop using applied presets
  const [rateShoppingApplied, setRateShoppingApplied]         = useState(false)
  const [rateShopAppliedIds, setRateShopAppliedIds]           = useState<Set<string>>(new Set())
  const [rateShopAppliedResult, setRateShopAppliedResult]     = useState<{ applied: number; total: number; skipped: number; errors: { orderId: string; amazonOrderId: string; error: string }[] } | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetShipDate, setPresetShipDate]     = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [applyingPreset, setApplyingPreset]       = useState(false)
  const [ratingOrderIds, setRatingOrderIds]       = useState<Set<string>>(new Set())
  const [applyPresetResult, setApplyPresetResult] = useState<{ applied: number; total: number; errors: { orderId: string; amazonOrderId: string; error: string }[] } | null>(null)
  const [showPresetModal, setShowPresetModal]     = useState(false)
  const [showPickList, setShowPickList]           = useState(false)

  // Tab counts
  const [tabCounts, setTabCounts] = useState<{ pending: number; unshipped: number; awaiting: number; dueOutToday: number; shippedToday: number } | null>(null)

  // Label batch state
  const [activeBatchId,    setActiveBatchId]    = useState<string | null>(null)
  const [showBatchConfirm, setShowBatchConfirm] = useState(false)
  const [showBatchHistory, setShowBatchHistory] = useState(false)


  // BackMarket confirm order state
  const [confirmingBmId, setConfirmingBmId] = useState<string | null>(null)

  // BackMarket serialize modal
  const [bmSerializeOrder, setBmSerializeOrder] = useState<Order | null>(null)
  const [bmShippingId, setBmShippingId]         = useState<string | null>(null)
  const [bmShipError, setBmShipError]           = useState<string | null>(null)
  const [bmManualShipOrder, setBmManualShipOrder] = useState<Order | null>(null)

  // Ship-by-item scan state
  const [scanInput, setScanInput]               = useState('')
  const [scanLoading, setScanLoading]           = useState(false)
  const [scanError, setScanError]               = useState<string | null>(null)
  const [shipByItemData, setShipByItemData]     = useState<{ order: Order; serialNumber: string; serialSku: string } | null>(null)

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

  // Fetch last sync timestamps per marketplace
  const fetchLastSync = useCallback(() => {
    fetch('/api/orders/sync?lastSync=true')
      .then(r => r.ok ? r.json() : {})
      .then(d => setLastSyncInfo(d))
      .catch(() => {})
  }, [])
  useEffect(() => { fetchLastSync() }, [fetchLastSync])

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

  useEffect(() => { setPage(1); setFetchKey(k => k + 1); setSelectedOrderIds(new Set()) }, [search, selectedAccountId, pageSize, activeTab, sortBy, sortDir])

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

  function dismissSyncBarLater() {
    if (syncBarTimerRef.current) clearTimeout(syncBarTimerRef.current)
    syncBarTimerRef.current = setTimeout(() => setShowSyncBar(false), 5_000)
  }

  function startPollForJob(
    jobId: string,
    ref: typeof pollRef,
    setSt: typeof setSyncStatus,
    onDone: () => void,
    errorPrefix: string,
  ) {
    ref.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/sync?jobId=${jobId}`)
        if (!res.ok) return
        const job: SyncJob = await res.json()
        setSt(job)
        // Refresh tab counts in real-time while syncing
        if (selectedAccountId && job.status === 'RUNNING') {
          fetch(`/api/orders/counts?accountId=${selectedAccountId}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setTabCounts(d) })
            .catch(() => {})
        }
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(ref.current!); ref.current = null
          if (job.status === 'FAILED') setSyncError(prev => prev ? `${prev}; ${errorPrefix}` : (job.errorMessage ?? errorPrefix))
          onDone()
        }
      } catch { /* transient */ }
    }, 5_000)
  }

  async function startSync() {
    if (!selectedAccountId) return
    // Cancel any existing poll (including stale reconnects) before starting fresh
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (bmPollRef.current) { clearInterval(bmPollRef.current); bmPollRef.current = null }
    if (syncBarTimerRef.current) { clearTimeout(syncBarTimerRef.current); syncBarTimerRef.current = null }
    setSyncing(true); setSyncStatus(null); setBmSyncStatus(null); setSyncError(null)
    setShowSyncBar(true); setSsEnrichResult(null)
    try {
      const { jobId, bmJobId } = await apiPost<{ jobId?: string; bmJobId?: string }>('/api/orders/sync', { accountId: selectedAccountId, source: syncSource })

      // Track completion of both jobs
      let amazonDone = !jobId
      let bmDone = !bmJobId

      const checkAllDone = () => {
        if (amazonDone && bmDone) {
          setSyncing(false)
          setFetchKey(k => k + 1)
          fetchLastSync()
          // Auto-trigger ShipStation enrichment after sync completes
          if (selectedAccountId && (syncSource === 'amazon' || syncSource === 'all')) {
            checkShipStationSync().finally(() => dismissSyncBarLater())
          } else {
            dismissSyncBarLater()
          }
        }
      }

      if (jobId) startPollForJob(jobId, pollRef, setSyncStatus, () => { amazonDone = true; checkAllDone() }, 'Amazon sync failed')
      if (bmJobId) startPollForJob(bmJobId, bmPollRef, setBmSyncStatus, () => { bmDone = true; checkAllDone() }, 'BM sync failed')

      if (!jobId && !bmJobId) {
        setSyncing(false)
        setSyncError('No sync sources available')
        dismissSyncBarLater()
      }
    } catch (err) { setSyncError(err instanceof Error ? err.message : String(err)); setSyncing(false); dismissSyncBarLater() }
  }

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (bmPollRef.current) clearInterval(bmPollRef.current)
    if (syncBarTimerRef.current) clearTimeout(syncBarTimerRef.current)
  }, [])

  async function resetSync() {
    if (!selectedAccountId) return
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (bmPollRef.current) { clearInterval(bmPollRef.current); bmPollRef.current = null }
    if (syncBarTimerRef.current) { clearTimeout(syncBarTimerRef.current); syncBarTimerRef.current = null }
    try {
      await fetch(`/api/orders/sync?accountId=${encodeURIComponent(selectedAccountId)}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    setSyncing(false)
    setSyncStatus(null)
    setBmSyncStatus(null)
    setSyncError(null)
    setSsEnriching(false)
    setSsEnrichResult(null)
    setShowSyncBar(false)
  }

  async function confirmBackMarketOrder(order: Order) {
    setConfirmingBmId(order.id)
    try {
      const res = await fetch(`/api/orders/${order.id}/confirm-backmarket`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { alert(`Confirm failed: ${data.error}`); return }
      // Update local state to reflect acceptance
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, orderStatus: 'Accepted' } : o))
    } catch (e) { alert(e instanceof Error ? e.message : 'Confirm failed') }
    finally { setConfirmingBmId(null) }
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

  async function handleScanSerial(sn: string) {
    if (!sn.trim() || !selectedAccountId) return
    setScanLoading(true); setScanError(null)
    try {
      // 1. Look up the serial
      const lookupRes = await fetch(`/api/serials/lookup?sn=${encodeURIComponent(sn.trim())}`)
      if (!lookupRes.ok) {
        const j = await lookupRes.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? `Serial lookup failed (${lookupRes.status})`)
      }
      const serial: { status: string; product?: { sku: string }; grade?: { id: string } } = await lookupRes.json()
      if (serial.status !== 'IN_STOCK') throw new Error(`Serial "${sn.trim()}" is not in stock (status: ${serial.status})`)
      if (!serial.product?.sku) throw new Error(`Serial "${sn.trim()}" has no associated SKU`)

      // 2. Find matching order (pass gradeId to constrain graded items)
      const matchParams = new URLSearchParams({ sku: serial.product.sku, accountId: selectedAccountId })
      if (serial.grade?.id) matchParams.set('gradeId', serial.grade.id)
      const matchRes = await fetch(`/api/orders/match-by-sku?${matchParams}`)
      if (!matchRes.ok) {
        const j = await matchRes.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? `Order match failed (${matchRes.status})`)
      }
      const { match } = await matchRes.json()
      if (!match) throw new Error(`No awaiting order found for SKU "${serial.product.sku}"`)

      // 3. Open modal
      setShipByItemData({ order: match, serialNumber: sn.trim(), serialSku: serial.product.sku })
      setScanInput('')
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanLoading(false)
    }
  }

  async function checkCancellations() {
    if (!selectedAccountId) return
    setCheckingCancels(true); setCancelCheckError(null); setCancelFlagged(null); setCancelCheckedCount(null); setCancelProgress(null)
    try {
      const resp = await fetch('/api/orders/check-cancellations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId }),
      })

      // If the response is JSON (0 orders case), handle directly
      const ct = resp.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        const data = await resp.json()
        if (!resp.ok) throw new Error(data.error ?? 'Check failed')
        setCancelFlagged(data.flagged ?? [])
        setCancelCheckedCount(data.checked ?? 0)
        return
      }

      // SSE stream
      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No response stream')
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Parse SSE lines
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'debug') {
              console.log('[check-cancellations] API debug:', evt)
            } else if (evt.type === 'progress') {
              setCancelProgress(`Checking ${evt.checked} of ${evt.total}…`)
            } else if (evt.type === 'done') {
              setCancelFlagged(evt.flagged ?? [])
              setCancelCheckedCount(evt.checked ?? 0)
              if (evt._debug) setCancelDebug(evt._debug)
              setFetchKey(k => k + 1)
            } else if (evt.type === 'error') {
              throw new Error(evt.error)
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Check failed') {
              // Only rethrow if it's our explicit error, not a JSON parse issue
              if (line.slice(6).includes('"type":"error"')) throw parseErr
            }
          }
        }
      }
    } catch (err) {
      setCancelCheckError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setCheckingCancels(false)
      setCancelProgress(null)
    }
  }

  async function checkShipStationSync() {
    if (!selectedAccountId) return
    const useSelectedOnly = selectedOrderIds.size > 0
    const orderIds = useSelectedOnly ? Array.from(selectedOrderIds) : undefined
    const denominator = useSelectedOnly ? selectedOrderIds.size : 0
    setSsEnriching(true); setSsEnrichResult(null)
    setSsProgress(useSelectedOnly ? `0/${denominator} checked` : 'Starting…')
    try {
      const res = await fetch('/api/orders/enrich-shipstation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId, orderIds }),
      })
      if (!res.ok) throw new Error('SS sync failed')
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No stream')
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: { enriched: number; addresses: number } | null = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          const evt = JSON.parse(line)
          if (evt.phase === 'fetching') setSsProgress('Fetching SS orders…')
          else if (evt.phase === 'fetched') setSsProgress(`Fetched ${evt.total} SS orders`)
          else if (evt.phase === 'progress') setSsProgress(`${evt.done}/${evt.total}`)
          else if (evt.phase === 'checking') setSsProgress(`Checking ${evt.checked} orders…`)
          else if (evt.phase === 'updating') setSsProgress(`Updating ${evt.done}/${evt.of}…`)
          else if (evt.phase === 'done') {
            finalResult = { enriched: evt.enriched, addresses: evt.addresses }
            setSsProgress('')
          } else if (evt.phase === 'error') throw new Error(evt.error)
        }
      }
      if (finalResult) {
        setSsEnrichResult(finalResult)
        if (finalResult.enriched > 0 || finalResult.addresses > 0) setFetchKey(k => k + 1)
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'SS check failed')
    } finally {
      setSsEnriching(false); setSsProgress('')
    }
  }

  // On mount or account change: reconnect to any in-progress sync so the
  // progress bar reappears even if the user navigated away mid-sync.
  useEffect(() => {
    if (!selectedAccountId) return
    if (pollRef.current || bmPollRef.current) return  // already polling

    const TEN_MIN = 10 * 60 * 1000
    let cancelled = false
    fetch(`/api/orders/sync?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { amazon: SyncJob | null; backmarket: SyncJob | null } | null) => {
        if (cancelled || !data) return
        const { amazon, backmarket } = data
        const isActive = (j: SyncJob | null) =>
          j && (j.status === 'PENDING' || j.status === 'RUNNING') && Date.now() - new Date(j.startedAt).getTime() < TEN_MIN

        const hasAmazon = isActive(amazon)
        const hasBM = isActive(backmarket)
        if (!hasAmazon && !hasBM) return

        // Resume polling
        setSyncing(true)
        setShowSyncBar(true)
        if (syncBarTimerRef.current) { clearTimeout(syncBarTimerRef.current); syncBarTimerRef.current = null }

        let amazonDone = !hasAmazon
        let bmDone = !hasBM

        const checkAllDone = () => {
          if (amazonDone && bmDone) {
            setSyncing(false)
            setFetchKey(k => k + 1)
            dismissSyncBarLater()
          }
        }

        if (hasAmazon && amazon) {
          setSyncStatus(amazon)
          startPollForJob(amazon.id, pollRef, setSyncStatus, () => { amazonDone = true; checkAllDone() }, 'Amazon sync failed')
        }
        if (hasBM && backmarket) {
          setBmSyncStatus(backmarket)
          startPollForJob(backmarket.id, bmPollRef, setBmSyncStatus, () => { bmDone = true; checkAllDone() }, 'BM sync failed')
        }
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

  async function handleBulkCancel() {
    const ids = [...selectedOrderIds].filter(id => {
      const o = orders.find(x => x.id === id)
      return o && o.orderSource !== 'wholesale' && (o.workflowStatus === 'PENDING' || o.workflowStatus === 'PROCESSING')
    })
    if (ids.length === 0) return
    const hasProcessed = ids.some(id => orders.find(x => x.id === id)?.workflowStatus === 'PROCESSING')
    const msg = hasProcessed
      ? `Cancel ${ids.length} order${ids.length !== 1 ? 's' : ''}? This will release reserved inventory and cannot be undone.`
      : `Cancel ${ids.length} order${ids.length !== 1 ? 's' : ''}? This cannot be undone.`
    if (!confirm(msg)) return
    setBulkCancelling(true)
    setBulkCancelResult(null)
    try {
      const res = await apiPost('/api/orders/bulk-cancel', { orderIds: ids })
      const data = res as { succeeded: number; failed: number; results: { orderId: string; success: boolean; error?: string }[] }
      const errors = data.results
        .filter(r => !r.success)
        .map(r => {
          const o = orders.find(x => x.id === r.orderId)
          const label = o?.olmNumber != null ? `OLM-${o.olmNumber}` : o?.amazonOrderId ?? r.orderId
          return `${label}: ${r.error}`
        })
      setBulkCancelResult({ cancelled: data.succeeded, total: ids.length, errors })
      setSelectedOrderIds(new Set())
      setFetchKey(k => k + 1)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Bulk cancel failed')
    } finally {
      setBulkCancelling(false)
    }
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
      if (!o || o.presetRateError) return false
      if (!(o.presetRateId || (o.presetRateCarrier && o.appliedPresetId))) return false
      // Exclude serialized orders — they must use Manual Ship
      const totalSerializable = o.items.filter(i => i.isSerializable).reduce((s, i) => s + i.quantityOrdered, 0)
      const assigned = o.serialAssignments?.length ?? 0
      if (totalSerializable > 0 && assigned >= totalSerializable) return false
      return true
    }),
    [selectedOrderIds, orders],
  )

  async function handlePrintLabel(orderId: string) {
    try {
      const res  = await fetch(`/api/orders/${orderId}/label`)
      if (!res.ok) { alert('No label found for this order'); return }
      const data = await res.json() as { labelData: string; labelFormat: string }

      // Silent print via QZ Tray if connected, printer set, and format is PDF
      if (qz.connected && qz.defaultPrinter && data.labelFormat === 'pdf') {
        try {
          await qz.printPdf(data.labelData)
          toast.success('Label sent to printer')
          return
        } catch { /* fall through to browser */ }
      }

      // Fallback: open in browser
      const mime = data.labelFormat === 'pdf' ? 'application/pdf' : 'image/png'
      const blob = new Blob(
        [Uint8Array.from(atob(data.labelData), c => c.charCodeAt(0))],
        { type: mime },
      )
      window.open(URL.createObjectURL(blob), '_blank')
    } catch { alert('Failed to fetch label') }
  }

  async function handleVoidLabel(order: Order) {
    const isShipped = order.workflowStatus === 'SHIPPED'
    const msg = isShipped
      ? `Void the label for shipped order ${order.amazonOrderId}?\n\nThis will undo serial assignments, restore serials to IN_STOCK, and move the order back to Unshipped.`
      : `Void the shipping label for order ${order.amazonOrderId}?\n\nThe order will move back to Unshipped so you can create a new label.`
    if (!confirm(msg)) return
    setVoidingId(order.id)
    try {
      const res = await fetch(`/api/orders/${order.id}/void-label`, { method: 'POST' })
      const data = await res.json() as { error?: string }
      if (!res.ok) { alert(`Void failed: ${data.error}`); return }
      setFetchKey(k => k + 1)
      setVoidSuccessMsg(`Label voided for order ${order.amazonOrderId} — order moved back to Unshipped.`)
      setTimeout(() => setVoidSuccessMsg(null), 5000)
    } catch { alert('Failed to void label') }
    finally { setVoidingId(null) }
  }

  async function handleBmShip(order: Order) {
    setBmShippingId(order.id); setBmShipError(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/bm-ship`, { method: 'POST' })
      const data = await res.json() as { shipped?: boolean; error?: string }
      if (!res.ok) { setBmShipError(data.error ?? 'Ship failed'); return }
      setFetchKey(k => k + 1) // refresh list — order will move to shipped tab
    } catch { setBmShipError('Failed to ship on BackMarket') }
    finally { setBmShippingId(null) }
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
          // An order is "all FG" if every item has a grade-matching FG location with enough stock
          const allFG = data.items.every(item => {
            if (!item.productId) return false
            return item.locations.some(l =>
              l.isFinishedGoods && l.qty >= item.quantityOrdered
              && (item.gradeId ? l.gradeId === item.gradeId : true)
            )
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
        body:    JSON.stringify({ presetId: selectedPresetId, orderIds: ids, accountId: selectedAccountId, shipDate: presetShipDate }),
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
        body:    JSON.stringify({ presetId: selectedPackagePresetId, orderIds: ids, accountId: selectedAccountId, shipDate: presetShipDate }),
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
    }
  }

  async function applyDefaultPackagePresets() {
    if (selectedOrderIds.size === 0 || !selectedAccountId) return
    const ids = [...selectedOrderIds]
    setApplyingDefaultPresets(true)
    setApplyDefaultResult(null)
    setDefaultPresetApplyingIds(new Set(ids))

    try {
      const res = await fetch('/api/orders/apply-default-package-presets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderIds: ids, accountId: selectedAccountId }),
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
              type: 'applied' | 'done' | 'error'
              orderId?: string; presetId?: string | null; presetName?: string | null
              error?: string | null
              applied?: number; total?: number; skipped?: number
              errors?: { orderId: string; amazonOrderId: string; error: string }[]
            }

            if (event.type === 'applied' && event.orderId) {
              setOrders(prev => prev.map(o =>
                o.id === event.orderId
                  ? {
                      ...o,
                      appliedPackagePresetId: event.presetId ?? null,
                      appliedPackagePreset: event.presetId && event.presetName
                        ? { id: event.presetId, name: event.presetName }
                        : o.appliedPackagePreset,
                    }
                  : o,
              ))
              setDefaultPresetApplyingIds(prev => { const n = new Set(prev); n.delete(event.orderId!); return n })
            }

            if (event.type === 'done') {
              setApplyDefaultResult({ applied: event.applied ?? 0, total: event.total ?? ids.length, skipped: event.skipped ?? 0, errors: event.errors ?? [] })
            }

            if (event.type === 'error') throw new Error(event.error ?? 'Unknown error')
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }
    } catch (e) {
      setApplyDefaultResult({ applied: 0, total: ids.length, skipped: 0, errors: [{ orderId: '', amazonOrderId: '', error: e instanceof Error ? e.message : 'Failed' }] })
    } finally {
      setApplyingDefaultPresets(false)
      setDefaultPresetApplyingIds(new Set())
    }
  }

  async function rateShopAppliedPresets() {
    if (selectedOrderIds.size === 0 || !selectedAccountId) return
    const ids = [...selectedOrderIds]
    setRateShoppingApplied(true)
    setRateShopAppliedResult(null)
    setRateShopAppliedIds(new Set(ids))

    try {
      const res = await fetch('/api/orders/rate-shop-applied-presets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderIds: ids, accountId: selectedAccountId, shipDate: presetShipDate }),
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
              applied?: number; total?: number; skipped?: number
              errors?: { orderId: string; amazonOrderId: string; error: string }[]
            }

            if (event.type === 'rate' && event.orderId) {
              setOrders(prev => prev.map(o =>
                o.id === event.orderId
                  ? {
                      ...o,
                      presetRateAmount:    event.rateAmount != null ? String(event.rateAmount) : null,
                      presetRateCarrier:   event.rateCarrier   ?? null,
                      presetRateService:   event.rateService   ?? null,
                      presetRateId:        event.rateId        ?? null,
                      presetRateError:     event.error         ?? null,
                      presetRateCheckedAt: new Date().toISOString(),
                    }
                  : o,
              ))
              setRateShopAppliedIds(prev => { const n = new Set(prev); n.delete(event.orderId!); return n })
            }

            if (event.type === 'done') {
              setRateShopAppliedResult({ applied: event.applied ?? 0, total: event.total ?? ids.length, skipped: event.skipped ?? 0, errors: event.errors ?? [] })
            }

            if (event.type === 'error') throw new Error(event.error ?? 'Unknown error')
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }
    } catch (e) {
      setRateShopAppliedResult({ applied: 0, total: ids.length, skipped: 0, errors: [{ orderId: '', amazonOrderId: '', error: e instanceof Error ? e.message : 'Failed' }] })
    } finally {
      setRateShoppingApplied(false)
      setRateShopAppliedIds(new Set())
    }
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
  const colSpan             = 10 + (showActionCol ? 1 : 0)

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

  // Orders due out today or overdue (from server — counts ALL unshipped orders, not just current page)
  const dueCount = tabCounts?.dueOutToday ?? 0

  // Merge Amazon + wholesale orders, sorted client-side
  const displayOrders = useMemo(() => {
    let merged = [...orders, ...wholesaleOrders]
    // Pkg preset filter
    if (filterPkgPreset === 'assigned') merged = merged.filter(o => o.appliedPackagePresetId)
    else if (filterPkgPreset === 'unassigned') merged = merged.filter(o => !o.appliedPackagePresetId)

    // For wholesale orders, use lastUpdateDate (approval time) so recently approved orders sort to the top
    const effectiveDate = (o: Order) =>
      o.orderSource === 'wholesale' ? new Date(o.lastUpdateDate ?? o.purchaseDate).getTime() : new Date(o.purchaseDate).getTime()

    return merged.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'sku': {
          const skuA = a.items[0]?.sellerSku ?? ''
          const skuB = b.items[0]?.sellerSku ?? ''
          cmp = skuA.localeCompare(skuB)
          break
        }
        case 'olmNumber':
          cmp = (a.olmNumber ?? 0) - (b.olmNumber ?? 0)
          break
        case 'orderTotal':
          cmp = parseFloat(a.orderTotal ?? '0') - parseFloat(b.orderTotal ?? '0')
          break
        case 'shipToState':
          cmp = (a.shipToState ?? '').localeCompare(b.shipToState ?? '')
          break
        case 'workflowStatus':
          cmp = (a.workflowStatus ?? '').localeCompare(b.workflowStatus ?? '')
          break
        case 'presetRateAmount': {
          const rA = a.presetRateAmount != null ? parseFloat(a.presetRateAmount) : null
          const rB = b.presetRateAmount != null ? parseFloat(b.presetRateAmount) : null
          if (rA == null && rB == null) cmp = 0
          else if (rA == null) cmp = 1
          else if (rB == null) cmp = -1
          else cmp = rA - rB
          break
        }
        case 'latestShipDate': {
          const dA = a.latestShipDate ? new Date(a.latestShipDate).getTime() : 0
          const dB = b.latestShipDate ? new Date(b.latestShipDate).getTime() : 0
          cmp = dA - dB
          break
        }
        default: // purchaseDate
          cmp = effectiveDate(a) - effectiveDate(b)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [orders, wholesaleOrders, sortBy, sortDir, filterPkgPreset])

  // Status badge helper
  function statusBadge(status: string) {
    const cls =
      status === 'Unshipped'  ? 'bg-orange-100 text-orange-800' :
      status === 'Shipped'    ? 'bg-green-100  text-green-800'  :
      status === 'Pending'    ? 'bg-yellow-100 text-yellow-800' :
      'bg-gray-100 text-gray-700'
    return <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', cls)}>{status}</span>
  }

  const shippedTodayCount = tabCounts?.shippedToday ?? 0

  return (
    <div className="flex flex-col h-full relative">
      {/* Shipped today badge — positioned in the page header top-right */}
      <div className="absolute top-[-52px] right-6 z-10 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
        <Truck size={14} className="text-green-600" />
        <span className="text-xs font-medium text-green-700">Shipped Today</span>
        <span className="text-sm font-bold text-green-800 tabular-nums">{shippedTodayCount}</span>
      </div>

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
      {verifyOrder  && <VerifyOrderModal  order={verifyOrder}  onClose={() => setVerifyOrder(null)}  onVerified={() => { setVerifyOrder(null); setFetchKey(k => k + 1) }} />}
      {shipByItemData && (
        <ShipByItemModal
          order={shipByItemData.order}
          serialNumber={shipByItemData.serialNumber}
          serialSku={shipByItemData.serialSku}
          onClose={() => setShipByItemData(null)}
          onComplete={() => { setShipByItemData(null); setFetchKey(k => k + 1) }}
        />
      )}
      {wholesaleProcessOrder && <WholesaleProcessModal order={wholesaleProcessOrder} onClose={() => setWholesaleProcessOrder(null)} onProcessed={() => { setWholesaleProcessOrder(null); setFetchKey(k => k + 1) }} />}
      {wholesaleShipOrder && <WholesaleShipModal order={wholesaleShipOrder} onClose={() => setWholesaleShipOrder(null)} onShipped={() => { setWholesaleShipOrder(null); setFetchKey(k => k + 1) }} />}
      {wholesaleSerializeOrder && <WholesaleSerializeModal order={wholesaleSerializeOrder} onClose={() => setWholesaleSerializeOrder(null)} onSaved={() => { setWholesaleSerializeOrder(null); setFetchKey(k => k + 1) }} />}
      {manualShipOrder && <ManualShipModal order={manualShipOrder} onClose={() => setManualShipOrder(null)} onShipped={() => { setManualShipOrder(null); setFetchKey(k => k + 1) }} />}
      {unserializeOrder && <UnserializeModal order={unserializeOrder} onClose={() => setUnserializeOrder(null)} onUnserialized={() => { setUnserializeOrder(null); setFetchKey(k => k + 1) }} />}
      {bmSerializeOrder && (
        <BmSerializeModal
          order={bmSerializeOrder}
          onClose={() => setBmSerializeOrder(null)}
          onSaved={(updatedItems) => {
            setOrders(prev => prev.map(o => {
              if (o.id !== bmSerializeOrder.id) return o
              return {
                ...o,
                items: o.items.map(i => {
                  const match = updatedItems.find(u => u.orderItemId === i.id)
                  return match ? { ...i, bmSerials: match.serials } : i
                }),
              }
            }))
          }}
        />
      )}
      {bmManualShipOrder && (
        <BmManualShipModal
          order={bmManualShipOrder}
          onClose={() => setBmManualShipOrder(null)}
          onShipped={() => { setBmManualShipOrder(null); setFetchKey(k => k + 1) }}
        />
      )}
      {showPickList && (
        <PickListModal
          orderIds={Array.from(selectedOrderIds)}
          showLocations={activeTab !== 'pending'}
          onClose={() => setShowPickList(false)}
        />
      )}
      {labelOrder && <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setLabelOrder(null)} />}
      {labelOrder && <LabelPanel order={labelOrder} ssAccount={ssAccount} onClose={() => setLabelOrder(null)} onLabelSaved={() => { setLabelOrder(null); setFetchKey(k => k + 1) }} qzPrint={{ connected: qz.connected, defaultPrinter: qz.defaultPrinter, printPdf: qz.printPdf }} />}

      {/* Batch history modal */}
      {showBatchHistory && <BatchHistoryModal onClose={() => setShowBatchHistory(false)} />}

      {/* Batch label confirmation modal */}
      {showBatchConfirm && (
        <LabelBatchModal
          orders={orders}
          batchEligible={batchEligible}
          skippedCount={selectedOrderIds.size - batchEligible.length}
          existingBatchId={activeBatchId}
          onClose={() => { setShowBatchConfirm(false); setActiveBatchId(null) }}
          onBatchCreated={(id) => { setActiveBatchId(id) }}
          onBatchComplete={() => { setFetchKey(k => k + 1); setSelectedOrderIds(new Set()); setActiveBatchId(null) }}
          qzPrint={{ connected: qz.connected, defaultPrinter: qz.defaultPrinter, printMultiplePdfs: qz.printMultiplePdfs }}
        />
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
              <div>
                <span>No buyer cancellation requests found ({cancelCheckedCount} orders checked)</span>
                {cancelDebug && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-green-600 underline">Debug: API response shape</summary>
                    <pre className="mt-1 text-[10px] bg-white/60 rounded p-1.5 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                      {JSON.stringify(cancelDebug, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
          <button onClick={() => { setCancelFlagged(null); setCancelCheckedCount(null); setCancelDebug(null) }} className="shrink-0 mt-0.5">
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

      {/* Apply default package presets result banner */}
      {applyDefaultResult !== null && (
        <div className={clsx(
          'flex items-start justify-between gap-3 px-6 py-2 border-b text-xs',
          applyDefaultResult.errors.length > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-teal-50 border-teal-200 text-teal-800',
        )}>
          <div className="flex items-start gap-2">
            {applyDefaultResult.errors.length === 0
              ? <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-teal-600" />
              : <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
            }
            <div>
              <span className="font-semibold">
                Default Presets: {applyDefaultResult.applied} of {applyDefaultResult.total} order{applyDefaultResult.total !== 1 ? 's' : ''} assigned
                {applyDefaultResult.skipped > 0 && ` (${applyDefaultResult.skipped} skipped)`}
              </span>
              {applyDefaultResult.errors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {applyDefaultResult.errors.map((e, i) => (
                    <p key={i} className="text-[10px] font-mono text-amber-800">
                      {e.amazonOrderId || e.orderId}: {e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setApplyDefaultResult(null)} className="shrink-0 mt-0.5"><X size={13} /></button>
        </div>
      )}

      {/* Rate shop applied presets result banner */}
      {rateShopAppliedResult !== null && (
        <div className={clsx(
          'flex items-start justify-between gap-3 px-6 py-2 border-b text-xs',
          rateShopAppliedResult.errors.length > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-green-50 border-green-200 text-green-800',
        )}>
          <div className="flex items-start gap-2">
            {rateShopAppliedResult.errors.length === 0
              ? <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-green-600" />
              : <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
            }
            <div>
              <span className="font-semibold">
                Rate Shop: {rateShopAppliedResult.applied} of {rateShopAppliedResult.total} order{rateShopAppliedResult.total !== 1 ? 's' : ''} rated
                {rateShopAppliedResult.skipped > 0 && ` (${rateShopAppliedResult.skipped} skipped — no preset)`}
              </span>
              {rateShopAppliedResult.errors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {rateShopAppliedResult.errors.map((e, i) => (
                    <p key={i} className="text-[10px] font-mono text-amber-800">
                      {e.amazonOrderId || e.orderId}: {e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setRateShopAppliedResult(null)} className="shrink-0 mt-0.5"><X size={13} /></button>
        </div>
      )}

      {/* Bulk cancel result banner */}
      {bulkCancelResult !== null && (
        <div className={clsx(
          'flex items-start justify-between gap-3 px-6 py-2 border-b text-xs',
          bulkCancelResult.errors.length > 0
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-green-50 border-green-200 text-green-800',
        )}>
          <div className="flex items-start gap-2">
            {bulkCancelResult.errors.length === 0
              ? <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-green-600" />
              : <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
            }
            <div>
              <span className="font-semibold">
                {bulkCancelResult.cancelled} of {bulkCancelResult.total} order{bulkCancelResult.total !== 1 ? 's' : ''} cancelled
              </span>
              {bulkCancelResult.errors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {bulkCancelResult.errors.map((e, i) => (
                    <p key={i} className="text-[10px] font-mono text-amber-800">{e}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setBulkCancelResult(null)} className="shrink-0 mt-0.5"><X size={13} /></button>
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

      {/* ── Toolbar Row 1: Navigation & Search ─────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50">
        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Order ID or SKU…" value={search} onChange={e => setSearch(e.target.value)}
            className="h-8 pl-7 pr-2 rounded border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue w-48" />
        </div>

        {/* Scan-to-ship (awaiting tab only) */}
        {activeTab === 'awaiting' && (
          <div className="relative">
            <ScanLine size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Scan serial to ship…"
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleScanSerial(scanInput) }}
              disabled={scanLoading || !selectedAccountId}
              className="h-8 pl-7 pr-2 rounded border border-purple-300 bg-purple-50 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-500 w-52 placeholder:text-purple-300 disabled:opacity-50"
            />
            {scanLoading && <RefreshCcw size={11} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-purple-400" />}
          </div>
        )}

        <div className="flex-1" />

        {/* QZ Tray printer status */}
        {qz.connected && qz.defaultPrinter && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-200 px-2 py-1 rounded-full">
            <Printer size={10} />
            {qz.defaultPrinter}
          </span>
        )}

        {/* Sync status — tiny indicator in toolbar */}
        {syncing && <span className="text-[10px] text-gray-400 flex items-center gap-1"><RefreshCcw size={10} className="animate-spin" />Syncing…</span>}

        {/* Sync & data controls */}
        <div className="flex items-center gap-1.5">
          <button onClick={checkCancellations} disabled={checkingCancels || !selectedAccountId}
            className={clsx('flex items-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium transition-colors',
              checkingCancels || !selectedAccountId
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : cancelFlagged && cancelFlagged.length > 0
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-white border border-gray-300 text-gray-700 hover:border-amber-400 hover:text-amber-700')}>
            {checkingCancels
              ? <><RefreshCcw size={12} className="animate-spin" /> {cancelProgress ?? 'Checking…'}</>
              : <><AlertTriangle size={12} /> Cancels{cancelFlagged && cancelFlagged.length > 0 ? ` (${cancelFlagged.length})` : ''}</>
            }
          </button>
          <button onClick={checkShipStationSync} disabled={ssEnriching || !selectedAccountId || !ssAccount}
            className={clsx('flex items-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium transition-colors',
              ssEnriching || !selectedAccountId || !ssAccount
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : ssEnrichResult && ssEnrichResult.enriched > 0
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-white border border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-700')}
            title={selectedOrderIds.size > 0 ? `Sync ${selectedOrderIds.size} selected orders` : 'Sync all orders needing SS data'}>
            {ssEnriching
              ? <><RefreshCcw size={12} className="animate-spin" /> {ssProgress || 'SS…'}</>
              : <><Link2 size={12} /> SS Sync{selectedOrderIds.size > 0 ? ` (${selectedOrderIds.size})` : ssEnrichResult ? ` (${ssEnrichResult.enriched})` : ''}</>
            }
          </button>
          <div className="flex items-center">
            <select
              value={syncSource}
              onChange={e => setSyncSource(e.target.value as 'all' | 'amazon' | 'backmarket')}
              disabled={syncing}
              className="h-8 rounded-l border border-r-0 border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue"
            >
              <option value="all">All</option>
              <option value="amazon">Amazon</option>
              <option value="backmarket">Back Market</option>
            </select>
            <button onClick={startSync} disabled={syncing || !selectedAccountId}
              className={clsx('flex items-center gap-1.5 h-8 px-3 rounded-r text-xs font-medium transition-colors',
                syncing || !selectedAccountId ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-amazon-blue text-white hover:bg-blue-700')}>
              <Package size={12} />{syncing ? 'Syncing…' : 'Sync'}
            </button>
          </div>
          {syncing && (
            <button onClick={resetSync} title="Reset stuck sync job"
              className="flex items-center gap-1 h-8 px-2 rounded text-xs font-medium bg-white border border-red-300 text-red-600 hover:bg-red-50">
              <XCircle size={12} /> Reset
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-300" />

        {/* ShipStation status */}
        {ssAccount ? (
          <div className="flex items-center gap-1">
            <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded">
              <CheckCircle2 size={11} /> {ssAccount.name}
            </span>
            <a href="/shipstation" title="ShipStation Settings" className="p-1 text-gray-400 hover:text-amazon-blue rounded"><Settings size={13} /></a>
          </div>
        ) : (
          <button onClick={() => setShowConnectSS(true)} className="flex items-center gap-1 h-8 px-2.5 rounded border border-dashed border-gray-300 text-xs text-gray-600 hover:border-amazon-blue hover:text-amazon-blue transition-colors">
            <Link2 size={12} /> Connect SS
          </button>
        )}
      </div>

      {/* ── Toolbar Row 2: Presets & Rate Shopping ──────────────────────────── */}
      {(activeTab === 'pending' || activeTab === 'unshipped') && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 border-b bg-white">
          {/* ── Package Presets: Apply Defaults → Filter → Rate Shop ── */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-0.5">Pkg Preset</span>
            <button onClick={applyDefaultPackagePresets}
              disabled={applyingDefaultPresets || selectedOrderIds.size === 0 || !selectedAccountId}
              title="Auto-apply default package presets from product SKU mappings"
              className={clsx('flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium whitespace-nowrap transition-colors',
                applyingDefaultPresets || selectedOrderIds.size === 0 || !selectedAccountId
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-teal-600 text-white hover:bg-teal-700')}>
              {applyingDefaultPresets
                ? <><RefreshCcw size={11} className="animate-spin" /> {defaultPresetApplyingIds.size > 0 ? `${defaultPresetApplyingIds.size} left` : 'Applying…'}</>
                : <><Package size={11} /> Apply Defaults{selectedOrderIds.size > 0 ? ` (${selectedOrderIds.size})` : ''}</>
              }
            </button>
            <select value={filterPkgPreset} onChange={e => setFilterPkgPreset(e.target.value as 'all' | 'assigned' | 'unassigned')}
              className="h-7 rounded border border-gray-300 px-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-500">
              <option value="all">All Orders</option>
              <option value="assigned">Has Pkg Preset</option>
              <option value="unassigned">No Pkg Preset</option>
            </select>
            <button onClick={rateShopAppliedPresets}
              disabled={rateShoppingApplied || selectedOrderIds.size === 0 || !selectedAccountId}
              title="Rate shop using each order's applied package preset"
              className={clsx('flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium whitespace-nowrap transition-colors',
                rateShoppingApplied || selectedOrderIds.size === 0 || !selectedAccountId
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-amber-600 text-white hover:bg-amber-700')}>
              {rateShoppingApplied
                ? <><RefreshCcw size={11} className="animate-spin" /> {rateShopAppliedIds.size > 0 ? `${rateShopAppliedIds.size} left` : 'Rating…'}</>
                : <><Truck size={11} /> Rate Shop{selectedOrderIds.size > 0 ? ` (${selectedOrderIds.size})` : ''}</>
              }
            </button>
            <button onClick={() => setShowPackagePresetModal(true)} title="Manage package presets"
              className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 text-gray-400 hover:border-teal-500 hover:text-teal-600 transition-colors">
              <Settings size={11} />
            </button>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-gray-200" />

          {/* ── Manual Rate Shop (pick preset + carrier) ── */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-0.5">Manual</span>
            {packagePresets.length > 0 && (
              <select value={selectedPackagePresetId} onChange={e => setSelectedPackagePresetId(e.target.value)}
                className="h-7 rounded border border-gray-300 px-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[140px]">
                <option value="">— Pkg —</option>
                {packagePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button onClick={applyPackagePreset}
              disabled={applyingPackagePreset || selectedOrderIds.size === 0 || !selectedPackagePresetId || !selectedAccountId}
              className={clsx('flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium whitespace-nowrap transition-colors',
                applyingPackagePreset || selectedOrderIds.size === 0 || !selectedPackagePresetId || !selectedAccountId
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700')}>
              {applyingPackagePreset
                ? <><RefreshCcw size={11} className="animate-spin" /> {pkgRatingOrderIds.size > 0 ? `${pkgRatingOrderIds.size} left` : 'Pricing…'}</>
                : <><Truck size={11} /> Rate Shop</>
              }
            </button>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-gray-200" />

          {/* ── Shipping Preset ── */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-0.5">Shipping</span>
            {presets.length > 0 && (
              <select value={selectedPresetId} onChange={e => setSelectedPresetId(e.target.value)}
                className="h-7 rounded border border-gray-300 px-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[140px]">
                <option value="">— Preset —</option>
                {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <input type="date" value={presetShipDate} onChange={e => setPresetShipDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="h-7 rounded border border-gray-300 px-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              title="Ship date" />
            <button onClick={applyPreset}
              disabled={applyingPreset || selectedOrderIds.size === 0 || !selectedPresetId || !selectedAccountId}
              className={clsx('flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium whitespace-nowrap transition-colors',
                applyingPreset || selectedOrderIds.size === 0 || !selectedPresetId || !selectedAccountId
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700')}>
              {applyingPreset
                ? <><RefreshCcw size={11} className="animate-spin" /> {ratingOrderIds.size > 0 ? `${ratingOrderIds.size} left` : 'Rating…'}</>
                : <><Truck size={11} /> Apply</>
              }
            </button>
            <button onClick={() => setShowPresetModal(true)} title="Manage shipping presets"
              className="h-7 w-7 flex items-center justify-center rounded border border-gray-200 text-gray-400 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
              <Settings size={11} />
            </button>
          </div>
        </div>
      )}

      {/* ── Toolbar Row 3: Bulk Actions ──────────────────────────────────────── */}
      {(selectedOrderIds.size > 0 || activeTab === 'unshipped' || activeTab === 'pending') && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b bg-gray-50">
          {/* Bulk process (pending tab) */}
          {activeTab === 'pending' && selectedOrderIds.size > 0 && (
            <button
              onClick={handleBulkProcess}
              disabled={bulkProcessing}
              className={clsx(
                'flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium whitespace-nowrap transition-colors',
                bulkProcessing
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-amazon-blue text-white hover:bg-blue-700',
              )}
            >
              {bulkProcessing
                ? <><RefreshCcw size={11} className="animate-spin" /> Loading…</>
                : <><ClipboardCheck size={11} /> Process ({selectedOrderIds.size})</>
              }
            </button>
          )}

          {/* Bulk cancel (pending + unshipped tabs) */}
          {(activeTab === 'pending' || activeTab === 'unshipped') && selectedOrderIds.size > 0 && (
            <button
              onClick={handleBulkCancel}
              disabled={bulkCancelling}
              className={clsx(
                'flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium whitespace-nowrap transition-colors',
                bulkCancelling
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700',
              )}
            >
              {bulkCancelling
                ? <><RefreshCcw size={11} className="animate-spin" /> Cancelling…</>
                : <><XCircle size={11} /> Cancel ({selectedOrderIds.size})</>
              }
            </button>
          )}

          {/* Create label batch (unshipped tab) */}
          {activeTab === 'unshipped' && selectedOrderIds.size > 0 && (
            <button
              onClick={() => setShowBatchConfirm(true)}
              disabled={applyingPreset || applyingPackagePreset || batchEligible.length !== selectedOrderIds.size}
              title={batchEligible.length !== selectedOrderIds.size ? `${selectedOrderIds.size - batchEligible.length} selected order(s) need a shopped rate first` : undefined}
              className={clsx('flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium whitespace-nowrap transition-colors',
                applyingPreset || applyingPackagePreset || batchEligible.length !== selectedOrderIds.size
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700')}
            >
              <Tag size={11} /> Label Batch ({batchEligible.length}/{selectedOrderIds.size})
            </button>
          )}

          {/* Pick list */}
          {selectedOrderIds.size > 0 && (
            <button onClick={() => setShowPickList(true)}
              className="flex items-center gap-1 h-7 px-2.5 rounded border border-gray-300 text-xs text-gray-600 hover:border-green-500 hover:text-green-700 whitespace-nowrap transition-colors">
              <FileText size={11} /> Pick List ({selectedOrderIds.size})
            </button>
          )}

          {/* Batch history */}
          <button
            onClick={() => setShowBatchHistory(true)}
            className="flex items-center gap-1 h-7 px-2.5 rounded border border-gray-200 text-xs text-gray-500 hover:border-indigo-400 hover:text-indigo-700 whitespace-nowrap transition-colors"
            title="View label batch history"
          >
            <History size={11} /> Batches
          </button>

          <div className="flex-1" />
        </div>
      )}

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

      {/* Last sync info */}
      {(lastSyncInfo.amazon || lastSyncInfo.backmarket) && (
        <div className="flex items-center gap-4 px-4 py-1 border-b bg-gray-50 text-[10px] text-gray-500">
          <Clock size={11} className="text-gray-400 shrink-0" />
          {lastSyncInfo.amazon && (
            <span>
              Amazon: <span className="font-medium text-gray-700">{new Date(lastSyncInfo.amazon.completedAt).toLocaleString()}</span>
              {' '}<span className={lastSyncInfo.amazon.trigger === 'cron' ? 'text-blue-600' : 'text-amber-600'}>({lastSyncInfo.amazon.trigger === 'cron' ? 'Auto' : 'Manual'})</span>
              {' '}<span className="text-gray-400">({lastSyncInfo.amazon.totalSynced} synced)</span>
            </span>
          )}
          {lastSyncInfo.backmarket && (
            <span>
              Back Market: <span className="font-medium text-gray-700">{new Date(lastSyncInfo.backmarket.completedAt).toLocaleString()}</span>
              {' '}<span className={lastSyncInfo.backmarket.trigger === 'cron' ? 'text-blue-600' : 'text-amber-600'}>({lastSyncInfo.backmarket.trigger === 'cron' ? 'Auto' : 'Manual'})</span>
              {' '}<span className="text-gray-400">({lastSyncInfo.backmarket.totalSynced} synced)</span>
            </span>
          )}
        </div>
      )}

      {/* Label batch status — when modal is closed but batch is still active, show mini indicator */}
      {activeBatchId && !showBatchConfirm && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-800 cursor-pointer hover:bg-indigo-100 transition-colors"
          onClick={() => setShowBatchConfirm(true)}>
          <RefreshCcw size={12} className="animate-spin shrink-0 text-indigo-500" />
          <span>Label batch in progress — <span className="font-semibold underline">click to view</span></span>
          <button onClick={(e) => { e.stopPropagation(); setActiveBatchId(null); setFetchKey(k => k + 1); setSelectedOrderIds(new Set()) }} className="ml-auto text-indigo-400 hover:text-indigo-700"><X size={13} /></button>
        </div>
      )}

      {voidSuccessMsg && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
          <CheckCircle2 size={14} className="shrink-0 text-green-600" />
          <span className="flex-1">{voidSuccessMsg}</span>
          <button onClick={() => setVoidSuccessMsg(null)} className="text-green-600 hover:text-green-800"><X size={13} /></button>
        </div>
      )}

      {scanError && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-purple-50 border border-purple-200 px-3 py-2 text-xs text-purple-800">
          <AlertCircle size={14} className="shrink-0 text-purple-600" />
          <span className="flex-1">{scanError}</span>
          <button onClick={() => setScanError(null)} className="text-purple-600 hover:text-purple-800"><X size={13} /></button>
        </div>
      )}

      {/* Sync progress bar */}
      {showSyncBar && (
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 space-y-1.5">
          {/* Amazon bar */}
          {syncStatus && <SyncProgressRow label="Amazon" job={syncStatus} color="blue" />}
          {/* BackMarket bar */}
          {bmSyncStatus && <SyncProgressRow label="BM" job={bmSyncStatus} color="teal" />}
          {/* SS enrichment bar */}
          {ssEnriching && (
            <SyncProgressRow label="SS" job={null} color="purple" indeterminateText={ssProgress || 'Linking ShipStation orders…'} />
          )}
          {!syncing && !ssEnriching && ssEnrichResult && (
            <SyncProgressRow label="SS" job={null} color="purple" completedText={`${ssEnrichResult.enriched} linked, ${ssEnrichResult.addresses} addresses`} />
          )}
          {/* Indeterminate state when nothing reported yet */}
          {syncing && !syncStatus && !bmSyncStatus && (
            <SyncProgressRow label="Sync" job={null} color="blue" indeterminateText="Starting sync…" />
          )}
        </div>
      )}

      {/* Multi-qty alert */}
      {(() => {
        const multiQtyCount = Array.from(selectedOrderIds).filter(id => {
          const o = orders.find(x => x.id === id)
          return o && o.items.some(i => i.quantityOrdered > 1)
        }).length
        return multiQtyCount > 0 ? (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium">
            <AlertTriangle size={12} className="shrink-0" />
            {multiQtyCount} Multi-QTY Order{multiQtyCount !== 1 ? 's' : ''} Selected
          </div>
        ) : null
      })()}

      {/* Table */}
      <div className="flex-1 overflow-auto dark:bg-gray-900">
        <table className="w-full text-xs dark:text-gray-200">
          <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
            <tr>
              <th className="px-1.5 py-2 text-center w-7">
                <input type="checkbox"
                  checked={displayOrders.length > 0 && displayOrders.every(o => selectedOrderIds.has(o.id))}
                  onChange={e => {
                    if (e.target.checked) setSelectedOrderIds(new Set(displayOrders.map(o => o.id)))
                    else setSelectedOrderIds(new Set())
                  }}
                  className="rounded border-gray-500 text-indigo-400 focus:ring-indigo-500"
                />
              </th>
              <th onClick={() => handleSort('olmNumber')}
                className="px-1.5 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors">
                <span className="inline-flex items-center gap-1">Order
                  <span className={clsx('text-[10px]', sortBy === 'olmNumber' ? 'text-amazon-orange' : 'text-gray-500')}>{sortBy === 'olmNumber' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </span>
              </th>
              <th onClick={() => handleSort('latestShipDate')}
                className="px-1.5 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors">
                <span className="inline-flex items-center gap-1">Dates
                  <span className={clsx('text-[10px]', sortBy === 'latestShipDate' || sortBy === 'purchaseDate' || sortBy === 'latestDeliveryDate' ? 'text-amazon-orange' : 'text-gray-500')}>{sortBy === 'latestShipDate' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </span>
              </th>
              <th onClick={() => handleSort('sku')}
                className="px-1.5 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors">
                <span className="inline-flex items-center gap-1">Item
                  <span className={clsx('text-[10px]', sortBy === 'sku' ? 'text-amazon-orange' : 'text-gray-500')}>{sortBy === 'sku' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </span>
              </th>
              <th className="px-1 py-2 text-center font-semibold text-gray-100 whitespace-nowrap w-8">Qty</th>
              <th onClick={() => handleSort('orderTotal')}
                className="px-1.5 py-2 text-right font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors">
                <span className="inline-flex items-center justify-end gap-1">Total
                  <span className={clsx('text-[10px]', sortBy === 'orderTotal' ? 'text-amazon-orange' : 'text-gray-500')}>{sortBy === 'orderTotal' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </span>
              </th>
              <th onClick={() => handleSort('shipToState')}
                className="px-1.5 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors">
                <span className="inline-flex items-center gap-1">{activeTab === 'shipped' || activeTab === 'awaiting' ? 'Tracking' : 'Ship To'}
                  <span className={clsx('text-[10px]', sortBy === 'shipToState' ? 'text-amazon-orange' : 'text-gray-500')}>{sortBy === 'shipToState' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </span>
              </th>
              <th onClick={() => handleSort('workflowStatus')}
                className="px-1.5 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors">
                <span className="inline-flex items-center gap-1">Status
                  <span className={clsx('text-[10px]', sortBy === 'workflowStatus' ? 'text-amazon-orange' : 'text-gray-500')}>{sortBy === 'workflowStatus' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </span>
              </th>
              <th className="px-1.5 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Preset</th>
              <th onClick={() => handleSort('presetRateAmount')}
                className="px-1.5 py-2 text-right font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors">
                <span className="inline-flex items-center justify-end gap-1">Rate
                  <span className={clsx('text-[10px]', sortBy === 'presetRateAmount' ? 'text-amazon-orange' : 'text-gray-500')}>{sortBy === 'presetRateAmount' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                </span>
              </th>
              {showActionCol && (
                <th className="px-1.5 py-2 text-center font-semibold text-gray-100 whitespace-nowrap">
                  {showProcessCol ? 'Actions' : showShipCol ? 'Ship' : showReinstateCol ? 'Reinstate' : showShippedPrintCol ? 'Actions' : 'Verify'}
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
            {!loading && displayOrders.length === 0 && (
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
                  'border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors align-middle',
                  hasCancelRequest
                    ? 'bg-amber-50 hover:bg-amber-100/60 dark:bg-amber-900/30 dark:hover:bg-amber-900/50'
                    : (order.orderSource === 'amazon' || order.orderSource === 'backmarket') && order.ssOrderId == null && !order.shipToCity
                      ? 'bg-yellow-50/70 hover:bg-yellow-100/50 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/30'
                      : rowIdx % 2 === 0
                        ? 'bg-white hover:bg-blue-50/50 dark:bg-gray-900 dark:hover:bg-gray-800/70'
                        : 'bg-gray-50 hover:bg-blue-50/50 dark:bg-gray-800/50 dark:hover:bg-gray-800/70',
                )}>
                  {/* Checkbox */}
                  <td className="px-1.5 py-1 text-center w-7">
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
                  {/* Order */}
                  <td className="px-1.5 py-1 whitespace-nowrap">
                    <div className="flex flex-col">
                      {order.orderSource === 'wholesale' ? (
                        <>
                          <div className="flex items-center gap-1">
                            <WholesaleIcon />
                            <span className="font-mono text-[11px] font-semibold text-emerald-700">
                              {order.wholesaleOrderNumber ?? order.amazonOrderId}
                            </span>
                          </div>
                          {order.wholesaleCustomerName && (
                            <span className="text-[9px] text-gray-400 leading-tight">{order.wholesaleCustomerName}</span>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-0.5 flex-wrap">
                            <button onClick={() => setDetailOrder(order)} className="flex items-center gap-0.5 group" title="View order details">
                              {order.olmNumber != null
                                ? <span className="font-mono text-[11px] font-semibold text-amazon-blue group-hover:underline">OLM-{order.olmNumber}</span>
                                : <span className="font-mono text-[11px] text-gray-400 italic">—</span>
                              }
                              <Eye size={9} className="text-gray-300 group-hover:text-amazon-blue transition-colors" />
                            </button>
                            {order.orderSource === 'backmarket' ? <BackMarketBadge /> : <AmazonSmileIcon />}
                            {order.isPrime && <PrimeBadge />}
                            {order.requiresTransparency && (
                              <span title="Transparency code required" className="inline-flex items-center gap-0.5 text-[8px] font-semibold bg-teal-100 text-teal-800 border border-teal-300 px-0.5 py-px rounded">
                                <ShieldCheck size={7} /> T
                              </span>
                            )}
                            {(order.orderSource === 'amazon' || order.orderSource === 'backmarket') && order.ssOrderId == null && !order.shipToCity && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  const btn = e.currentTarget
                                  btn.disabled = true
                                  btn.textContent = '…'
                                  try {
                                    const res = await fetch(`/api/orders/${order.id}/ss-pull`, { method: 'POST' })
                                    const data = await res.json()
                                    if (data.found) {
                                      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, ssOrderId: data.ssOrderId } : o))
                                      btn.textContent = '✓'
                                      btn.className = btn.className.replace('bg-yellow-100 text-yellow-800 border-yellow-300', 'bg-green-100 text-green-800 border-green-300')
                                    } else {
                                      btn.textContent = '✗'
                                      btn.title = data.error ?? 'Not found in ShipStation'
                                      setTimeout(() => { btn.textContent = 'SS Pull'; btn.disabled = false }, 2000)
                                    }
                                  } catch {
                                    btn.textContent = '✗'
                                    setTimeout(() => { btn.textContent = 'SS Pull'; btn.disabled = false }, 2000)
                                  }
                                }}
                                title="Pull this order from ShipStation"
                                className="inline-flex items-center gap-0.5 text-[8px] font-semibold bg-yellow-100 text-yellow-800 border border-yellow-300 px-0.5 py-px rounded hover:bg-yellow-200 transition-colors cursor-pointer"
                              >
                                <Link2 size={7} /> SS
                              </button>
                            )}
                            {order.isBuyerRequestedCancel && (
                              <span title={order.buyerCancelReason ? `Buyer cancel reason: ${order.buyerCancelReason}` : 'Buyer requested cancellation'}
                                className="inline-flex items-center gap-0.5 text-[8px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 px-0.5 py-px rounded">
                                <AlertTriangle size={7} /> CANCEL
                              </span>
                            )}
                          </div>
                          <a
                            href={order.orderSource === 'backmarket'
                              ? `https://www.backmarket.com/dashboard/sales/orders/${order.amazonOrderId}`
                              : `https://sellercentral.amazon.com/orders-v3/order/${order.amazonOrderId}`}
                            target="_blank" rel="noopener noreferrer"
                            className="font-mono text-[9px] text-gray-400 hover:text-amazon-blue hover:underline"
                          >
                            {order.amazonOrderId}
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                  {/* Dates — Purchase / Ship By / Deliver By stacked */}
                  <td className="px-1.5 py-1 whitespace-nowrap">
                    <div className="flex flex-col leading-tight">
                      <span className="text-[10px] text-gray-500">{fmtDate(order.purchaseDate)}</span>
                      {order.latestShipDate ? (() => {
                        const dayDiff = shipByDiff(order.latestShipDate)
                        const [sy, sm, sd] = pstDateStr(order.latestShipDate).split('-').map(Number)
                        const label = dayDiff === 0
                          ? 'Today'
                          : new Date(sy, sm - 1, sd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        const isShippedOrder = order.workflowStatus === 'SHIPPED'
                        return (
                          <span className={clsx('text-[10px] font-semibold',
                            !isShippedOrder && dayDiff < 0  ? 'text-red-600' :
                            !isShippedOrder && dayDiff === 0 ? 'text-amber-600' :
                            'text-gray-600'
                          )}>
                            {!isShippedOrder && dayDiff < 0 && '⚠ '}Ship {label}
                          </span>
                        )
                      })() : null}
                      {order.latestDeliveryDate ? (() => {
                        const [dy, dm, dd] = pstDateStr(order.latestDeliveryDate).split('-').map(Number)
                        const label = new Date(dy, dm - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        return <span className="text-[10px] text-gray-400">Del {label}</span>
                      })() : null}
                    </div>
                  </td>
                  {/* Item — SKU + Product name */}
                  <td className="px-1.5 py-1">
                    <div className={clsx('flex flex-col', multi && 'divide-y divide-gray-200')}>
                      {order.items.map(i => (
                        <div key={i.id} className={clsx('leading-tight', multi && 'py-0.5 first:pt-0 last:pb-0')}>
                          <span className="whitespace-nowrap">
                            <span className="font-mono text-[11px] font-semibold text-gray-900">{i.internalSku ?? i.sellerSku ?? '—'}</span>
                            {i.mappedGradeName && <span className="text-[9px] font-semibold text-purple-600 ml-1">Grade {i.mappedGradeName}</span>}
                          </span>
                          {i.title && <span className="block text-[9px] text-gray-500 truncate max-w-[180px]" title={i.title}>{i.title}</span>}
                        </div>
                      ))}
                    </div>
                  </td>
                  {/* Qty */}
                  <td className="px-1 py-1 text-center whitespace-nowrap w-8">
                    <div className={clsx('flex flex-col', multi && 'divide-y divide-gray-200')}>
                      {order.items.map(i => (
                        <span key={i.id} className={clsx('text-[11px] leading-tight tabular-nums', multi && 'py-0.5 first:pt-0 last:pb-0', i.quantityOrdered > 1 ? 'font-bold text-red-600' : 'text-gray-700')}>
                          {i.quantityOrdered}
                        </span>
                      ))}
                    </div>
                  </td>
                  {/* Total */}
                  <td className="px-1.5 py-1 text-right whitespace-nowrap text-[11px] font-semibold text-gray-800 tabular-nums">{orderTotal(order)}</td>
                  {/* Ship To */}
                  <td className="px-1.5 py-1 whitespace-nowrap text-[10px] text-gray-700">
                    {(activeTab === 'awaiting' || activeTab === 'shipped') && order.label
                      ? <span className="font-mono text-[9px] text-purple-700 font-medium">{order.label.trackingNumber}</span>
                      : (activeTab === 'shipped') && order.shipTracking
                        ? <span className="font-mono text-[9px] text-emerald-700 font-medium">{order.shipTracking}</span>
                        : [order.shipToCity, order.shipToState].filter(Boolean).join(', ') || '—'
                    }
                  </td>
                  {/* Status + Ship Method stacked */}
                  <td className="px-1.5 py-1 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <span className={clsx('inline-flex items-center px-1 py-px rounded text-[9px] font-medium w-fit',
                        WORKFLOW_BADGE[order.workflowStatus] ?? 'bg-gray-100 text-gray-600 border border-gray-200')}>
                        {WORKFLOW_LABEL[order.workflowStatus] ?? order.workflowStatus}
                      </span>
                      {order.orderSource === 'wholesale' ? (
                        order.shipCarrier
                          ? <span className="text-[9px] text-emerald-600 font-medium">{order.shipCarrier}</span>
                          : null
                      ) : order.shipmentServiceLevel ? (
                        <span className={clsx('text-[9px] font-medium',
                          /next.?day|overnight|priority/i.test(order.shipmentServiceLevel) ? 'text-red-600' :
                          /second.?day|2.?day|expedited/i.test(order.shipmentServiceLevel) ? 'text-orange-600' :
                          /same.?day/i.test(order.shipmentServiceLevel) ? 'text-purple-600' : 'text-gray-500',
                        )}>
                          {order.shipmentServiceLevel}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {/* Preset */}
                  <td className="px-1.5 py-1 whitespace-nowrap">
                    {defaultPresetApplyingIds.has(order.id) ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-teal-600">
                        <RefreshCcw size={9} className="animate-spin" /> …
                      </span>
                    ) : order.appliedPackagePreset ? (
                      <span className="inline-flex items-center rounded-full bg-teal-100 text-teal-700 px-1.5 py-px text-[9px] font-medium">
                        {order.appliedPackagePreset.name}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-[9px]">—</span>
                    )}
                  </td>
                  {/* Rate */}
                  <td className={clsx('px-1.5 py-1 text-right', order.presetRateError && !ratingOrderIds.has(order.id) && !pkgRatingOrderIds.has(order.id) && !rateShopAppliedIds.has(order.id) ? 'whitespace-normal' : 'whitespace-nowrap')}>
                    {(ratingOrderIds.has(order.id) || pkgRatingOrderIds.has(order.id) || rateShopAppliedIds.has(order.id)) ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-600">
                        <RefreshCcw size={9} className="animate-spin" /> Rating…
                      </span>
                    ) : order.presetRateError ? (
                      <div title={order.presetRateError} className="flex flex-col items-end cursor-help max-w-[90px]">
                        <span className="inline-flex items-center gap-0.5 text-[9px] text-red-600">
                          <AlertCircle size={9} className="shrink-0" /> Err
                        </span>
                        <span className="text-[8px] text-red-400 leading-tight text-right line-clamp-1 break-words whitespace-normal">
                          {order.presetRateError}
                        </span>
                      </div>
                    ) : order.presetRateAmount ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[11px] font-semibold text-gray-900 tabular-nums">
                          {fmt(order.presetRateAmount)}
                        </span>
                        <CarrierLogo carrierCode={order.presetRateCarrier} serviceName={order.presetRateService} size={20} />
                        {order.presetRateService && (
                          <span className="text-[8px] text-gray-400 text-right whitespace-nowrap">{order.presetRateService}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300 text-[9px]">—</span>
                    )}
                  </td>
                  {/* Action column */}
                  {showProcessCol && (
                    <td className="px-1.5 py-1 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        {order.orderSource === 'wholesale' ? (
                          <button onClick={() => setWholesaleProcessOrder(order)}
                            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                            <ClipboardCheck size={10} /> Process
                          </button>
                        ) : (
                          <>
                            <button onClick={() => setProcessOrder(order)}
                              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-amazon-blue text-white hover:bg-blue-700">
                              <ClipboardCheck size={10} /> Process
                            </button>
                            <button onClick={() => handleCancel(order)} disabled={cancellingId === order.id}
                              title="Cancel order" className="inline-flex items-center justify-center h-6 w-6 rounded text-[10px] text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors">
                              {cancellingId === order.id ? <RefreshCcw size={10} className="animate-spin" /> : <XCircle size={11} />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                  {showShipCol && (
                    <td className="px-1.5 py-1 text-center whitespace-nowrap">
                      {order.orderSource === 'wholesale' ? (
                        <div className="flex items-center justify-center gap-1">
                          {(() => {
                            const wsTotalSerializable = order.items.filter(i => i.isSerializable).reduce((s, i) => s + i.quantityOrdered, 0)
                            const wsAssigned = order.serialAssignments?.length ?? 0
                            const wsFullySerialized = wsTotalSerializable > 0 && wsAssigned >= wsTotalSerializable
                            const wsPartiallySerialized = wsTotalSerializable > 0 && wsAssigned > 0 && wsAssigned < wsTotalSerializable
                            const wsNeedsSerialization = wsTotalSerializable > 0 && wsAssigned === 0

                            return (
                              <>
                                {/* Serialize button */}
                                {wsNeedsSerialization && (
                                  <button onClick={() => setWholesaleSerializeOrder(order)}
                                    className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors">
                                    <Hash size={10} /> Serialize
                                  </button>
                                )}
                                {wsPartiallySerialized && (
                                  <button onClick={() => setWholesaleSerializeOrder(order)}
                                    className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors">
                                    <Hash size={10} /> Serialize ({wsAssigned}/{wsTotalSerializable})
                                  </button>
                                )}
                                {wsFullySerialized && (
                                  <span className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                                    <CheckCircle2 size={10} /> Serialized
                                  </span>
                                )}
                                {/* Ship button — always visible for non-serializable, or when fully serialized, or as legacy all-at-once */}
                                {(wsTotalSerializable === 0 || wsFullySerialized || wsNeedsSerialization) && (
                                  <button onClick={() => setWholesaleShipOrder(order)}
                                    className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                                    <Truck size={10} /> Ship
                                  </button>
                                )}
                                {/* SN unserialize button — when serialized */}
                                {wsFullySerialized && (
                                  <button
                                    onClick={() => setUnserializeOrder(order)}
                                    title={`Serialized (${wsAssigned}/${wsTotalSerializable}) — click to manage`}
                                    className="inline-flex items-center gap-[3px] h-6 px-[5px] rounded bg-gray-900 text-white hover:bg-gray-700 transition-colors cursor-pointer"
                                  >
                                    <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <rect x="0" y="0" width="1.5" height="12" fill="white"/>
                                      <rect x="2.5" y="0" width="2.5" height="12" fill="white"/>
                                      <rect x="6" y="0" width="1" height="12" fill="white"/>
                                      <rect x="8" y="0" width="1.5" height="12" fill="white"/>
                                      <rect x="10.5" y="0" width="2.5" height="12" fill="white"/>
                                    </svg>
                                    <span className="text-[9px] font-bold tracking-wide leading-none">SN</span>
                                  </button>
                                )}
                              </>
                            )
                          })()}
                        </div>
                      ) : order.orderSource === 'backmarket' ? (
                        <div className="flex items-center justify-center gap-1">
                          {order.orderStatus === 'Unshipped' ? (
                            <button
                              onClick={() => confirmBackMarketOrder(order)}
                              disabled={confirmingBmId === order.id}
                              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-[#05C35E] text-white hover:bg-[#04a84f] disabled:opacity-50"
                            >
                              {confirmingBmId === order.id
                                ? <><RefreshCcw size={10} className="animate-spin" /> Confirming…</>
                                : <><CheckCircle2 size={10} /> Confirm</>}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-200">
                              <CheckCircle2 size={10} /> Accepted
                            </span>
                          )}
                          {order.orderStatus !== 'Unshipped' && (
                            <button onClick={() => setLabelOrder(order)}
                              className={clsx('inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium transition-colors',
                                ssAccount ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                              <Truck size={10} /> Ship
                            </button>
                          )}
                          <button onClick={() => handleUnprocess(order)} disabled={isUnprocessing} title="Unprocess — release inventory reservation"
                            className="inline-flex items-center justify-center h-6 w-6 rounded text-[10px] text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40 transition-colors">
                            {isUnprocessing ? <RefreshCcw size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          {(() => {
                            const totalSerializable = order.items.filter(i => i.isSerializable).reduce((s, i) => s + i.quantityOrdered, 0)
                            const assigned = order.serialAssignments?.length ?? 0
                            const isFullySerialized = totalSerializable > 0 && assigned >= totalSerializable
                            return (
                              <>
                                {!isFullySerialized && (
                                  <button onClick={() => setLabelOrder(order)}
                                    className={clsx('inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium transition-colors',
                                      ssAccount ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                                    <Truck size={10} /> Ship
                                  </button>
                                )}
                                {isFullySerialized ? (
                                  <button onClick={() => setManualShipOrder(order)}
                                    title="Manual Ship — mark as shipped without marketplace push"
                                    className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                                    <Truck size={10} /> Manual
                                  </button>
                                ) : (
                                  <button onClick={() => setVerifyOrder(order)}
                                    title="Assign serial numbers to items"
                                    className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors">
                                    <Hash size={10} /> Serialize
                                  </button>
                                )}
                                {totalSerializable > 0 && assigned >= totalSerializable && (
                                  <button
                                    onClick={() => setUnserializeOrder(order)}
                                    title={`Serialized (${assigned}/${totalSerializable}) — click to manage`}
                                    className="inline-flex items-center gap-[3px] h-6 px-[5px] rounded bg-gray-900 text-white hover:bg-gray-700 transition-colors cursor-pointer"
                                  >
                                    <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <rect x="0" y="0" width="1.5" height="12" fill="white"/>
                                      <rect x="2.5" y="0" width="2.5" height="12" fill="white"/>
                                      <rect x="6" y="0" width="1" height="12" fill="white"/>
                                      <rect x="8" y="0" width="1.5" height="12" fill="white"/>
                                      <rect x="10.5" y="0" width="2.5" height="12" fill="white"/>
                                    </svg>
                                    <span className="text-[9px] font-bold tracking-wide leading-none">SN</span>
                                  </button>
                                )}
                              </>
                            )
                          })()}
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
                    <td className="px-1.5 py-1 text-center whitespace-nowrap">
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
                        {(() => {
                          const totalSerializable = order.items.filter(i => i.isSerializable).reduce((s, i) => s + i.quantityOrdered, 0)
                          const assigned = order.serialAssignments?.length ?? 0
                          const isFullySerialized = totalSerializable > 0 && assigned >= totalSerializable
                          return (
                            <>
                              {isFullySerialized && (
                                <button onClick={() => setManualShipOrder(order)}
                                  title="Manual Ship — mark as shipped without marketplace push"
                                  className="inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                                  <Truck size={10} />
                                </button>
                              )}
                              {totalSerializable > 0 && assigned >= totalSerializable && (
                                <button
                                  onClick={() => setUnserializeOrder(order)}
                                  title={`Serialized (${assigned}/${totalSerializable}) — click to manage`}
                                  className="inline-flex items-center gap-[3px] h-6 px-[5px] rounded bg-gray-900 text-white hover:bg-gray-700 transition-colors cursor-pointer"
                                >
                                  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="0" y="0" width="1.5" height="12" fill="white"/>
                                    <rect x="2.5" y="0" width="2.5" height="12" fill="white"/>
                                    <rect x="6" y="0" width="1" height="12" fill="white"/>
                                    <rect x="8" y="0" width="1.5" height="12" fill="white"/>
                                    <rect x="10.5" y="0" width="2.5" height="12" fill="white"/>
                                  </svg>
                                  <span className="text-[9px] font-bold tracking-wide leading-none">SN</span>
                                </button>
                              )}
                            </>
                          )
                        })()}
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
                    <td className="px-1.5 py-1 text-center whitespace-nowrap">
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
                    <td className="px-1.5 py-1 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        {order.label && order.orderSource !== 'wholesale' && (
                          <button
                            type="button"
                            title="Print shipping label"
                            onClick={() => handlePrintLabel(order.id)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                          >
                            <Printer size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Download invoice PDF"
                          onClick={() => void generateOrderInvoicePDF(order)}
                          className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-amazon-blue"
                        >
                          <FileText size={14} />
                        </button>
                        {order.label && order.orderSource !== 'wholesale' && (Date.now() - new Date(order.label.createdAt).getTime() < 24 * 60 * 60 * 1000) && (
                          <button
                            onClick={() => handleVoidLabel(order)}
                            disabled={voidingId === order.id}
                            title="Void shipping label"
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            {voidingId === order.id ? <RefreshCcw size={12} className="animate-spin" /> : <Ban size={14} />}
                          </button>
                        )}
                      </div>
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

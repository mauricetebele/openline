'use client'
import { useEffect, useState } from 'react'
import {
  X, AlertCircle, CheckCircle2, Loader2, RotateCcw,
  ChevronDown, ChevronRight, Package, Warehouse, ArrowRight,
} from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string
  orderItemId: string
  sellerSku: string | null
  asin: string | null
  title: string | null
  quantityOrdered: number
}

interface Order {
  id: string
  amazonOrderId: string
  orderStatus: string
  items: OrderItem[]
  fulfillment?: {
    carrier: string | null
    trackingNumber: string | null
    shippedAt: string
  } | null
}

interface ReturnItem {
  orderItemId: string
  sellerSku: string | null
  asin: string | null
  title: string | null
  maxQty: number
  quantityReturned: number
  condition: string
  include: boolean
  restockToInventory: boolean
}

interface Location {
  id: string
  name: string
}

interface Warehouse {
  id: string
  name: string
  locations: Location[]
}

interface ExistingRMA {
  id: string
  rmaNumber: string
  reason: string
  status: string
  createdAt: string
  items: { sellerSku: string | null; quantityReturned: number; condition: string; restockToInventory: boolean }[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RETURN_REASONS = [
  'Customer Changed Mind',
  'Defective / Not Working',
  'Damaged in Shipping',
  'Wrong Item Sent',
  'Item Not as Described',
  'Duplicate Order',
  'Other',
]

const ITEM_CONDITIONS = [
  'New / Unopened',
  'Like New',
  'Used - Good',
  'Used - Acceptable',
  'Damaged',
]

const STATUS_COLORS: Record<string, string> = {
  REQUESTED:    'bg-blue-100 text-blue-700',
  SHIPPED_BACK: 'bg-yellow-100 text-yellow-700',
  RECEIVED:     'bg-purple-100 text-purple-700',
  RESTOCKED:    'bg-green-100 text-green-700',
  CLOSED:       'bg-gray-100 text-gray-600',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateRMANumber(amazonOrderId: string) {
  const suffix = amazonOrderId.replace(/-/g, '').slice(-8).toUpperCase()
  return `RMA-${suffix}`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── ErrorBanner ──────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose}><X size={13} /></button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReturnModal({
  order,
  onClose,
  onReturnCreated,
}: {
  order: Order
  onClose: () => void
  onReturnCreated: () => void
}) {
  const isShipped =
    order.fulfillment !== null ||
    ['Shipped', 'PartiallyShipped'].includes(order.orderStatus)

  // ── State ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<ReturnItem[]>(
    order.items.map((item) => ({
      orderItemId: item.orderItemId,
      sellerSku: item.sellerSku,
      asin: item.asin,
      title: item.title,
      maxQty: item.quantityOrdered,
      quantityReturned: item.quantityOrdered,
      condition: 'Used - Good',
      include: true,
      restockToInventory: false,
    })),
  )

  const [rmaNumber,          setRmaNumber]          = useState(generateRMANumber(order.amazonOrderId))
  const [reason,             setReason]             = useState(RETURN_REASONS[0])
  const [notes,              setNotes]              = useState('')
  const [warehouses,         setWarehouses]         = useState<Warehouse[]>([])
  const [warehousesLoading,  setWarehousesLoading]  = useState(false)
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [selectedLocationId,  setSelectedLocationId]  = useState('')
  const [saving,             setSaving]             = useState(false)
  const [err,                setErr]                = useState('')
  const [success,            setSuccess]            = useState(false)
  const [restockResults,     setRestockResults]     = useState<{ sku: string; restocked: boolean; reason?: string }[]>([])
  const [existingRMAs,       setExistingRMAs]       = useState<ExistingRMA[]>([])
  const [existingLoading,    setExistingLoading]    = useState(true)

  const anyRestock = items.some((i) => i.include && i.restockToInventory)

  // ── Fetch existing RMAs ────────────────────────────────────────────────────
  useEffect(() => {
    setExistingLoading(true)
    fetch(`/api/rma?amazonOrderId=${encodeURIComponent(order.amazonOrderId)}`)
      .then((r) => r.json())
      .then((data) => setExistingRMAs(data.data ?? []))
      .catch(() => {})
      .finally(() => setExistingLoading(false))
  }, [order.amazonOrderId])

  // ── Fetch warehouses when restock is toggled on ────────────────────────────
  useEffect(() => {
    if (!anyRestock || warehouses.length > 0) return
    setWarehousesLoading(true)
    fetch('/api/warehouses')
      .then((r) => r.json())
      .then((data) => {
        const wh: Warehouse[] = Array.isArray(data) ? data : (data.data ?? [])
        setWarehouses(wh)
        if (wh.length > 0) {
          setSelectedWarehouseId(wh[0].id)
          if (wh[0].locations.length > 0) setSelectedLocationId(wh[0].locations[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setWarehousesLoading(false))
  }, [anyRestock, warehouses.length])

  // ── Update location when warehouse changes ─────────────────────────────────
  useEffect(() => {
    const wh = warehouses.find((w) => w.id === selectedWarehouseId)
    if (wh?.locations.length) setSelectedLocationId(wh.locations[0].id)
    else setSelectedLocationId('')
  }, [selectedWarehouseId, warehouses])

  // ── Item helpers ───────────────────────────────────────────────────────────
  function updateItem<K extends keyof ReturnItem>(idx: number, key: K, value: ReturnItem[K]) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [key]: value } : item)))
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    const toReturn = items.filter((i) => i.include)
    if (toReturn.length === 0) { setErr('Select at least one item to return'); return }
    if (anyRestock && !selectedLocationId) { setErr('Select an inventory location for restocking'); return }
    if (!rmaNumber.trim()) { setErr('RMA number is required'); return }

    setSaving(true); setErr('')
    try {
      const res = await fetch('/api/rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rmaNumber: rmaNumber.trim(),
          amazonOrderId: order.amazonOrderId,
          reason,
          notes: notes.trim() || null,
          items: toReturn.map((item) => ({
            orderItemId: item.orderItemId,
            sellerSku: item.sellerSku,
            asin: item.asin,
            title: item.title,
            quantityReturned: item.quantityReturned,
            condition: item.condition,
            restockToInventory: item.restockToInventory,
            locationId: item.restockToInventory ? selectedLocationId : null,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create return')

      setRestockResults(data.restockResults ?? [])
      setSuccess(true)
      onReturnCreated()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create return')
    } finally {
      setSaving(false)
    }
  }

  const currentLocations = warehouses.find((w) => w.id === selectedWarehouseId)?.locations ?? []

  // ── Not shipped state ──────────────────────────────────────────────────────
  if (!isShipped) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <RotateCcw size={15} className="text-gray-400" />
              Create Return
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="px-5 py-8 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
              <Package size={22} className="text-orange-400" />
            </div>
            <p className="font-semibold text-gray-800">Cannot Create Return</p>
            <p className="text-sm text-gray-500">
              A return can only be created after the order has been shipped.
              This order has status <span className="font-mono font-semibold text-gray-700">{order.orderStatus}</span>.
            </p>
          </div>
          <div className="px-5 pb-5">
            <button onClick={onClose}
              className="w-full h-9 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <CheckCircle2 size={15} className="text-green-500" />
              Return Created
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 font-medium">
              RMA <span className="font-mono">{rmaNumber}</span> created successfully.
            </div>

            {restockResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Inventory Restock Results</p>
                {restockResults.map((r, i) => (
                  <div key={i} className={clsx(
                    'flex items-center gap-2 text-xs rounded-md px-3 py-2 border',
                    r.restocked ? 'bg-green-50 border-green-200 text-green-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700',
                  )}>
                    {r.restocked
                      ? <CheckCircle2 size={12} />
                      : <AlertCircle size={12} />}
                    <span className="font-mono font-medium">{r.sku}</span>
                    <span>{r.restocked ? 'restocked to inventory' : (r.reason ?? 'not restocked')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="px-5 pb-5">
            <button onClick={onClose}
              className="w-full h-9 rounded-lg bg-amazon-blue text-white text-sm font-medium hover:opacity-90">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex flex-col sm:overflow-y-auto sm:bg-black/50 sm:items-start sm:justify-center sm:pt-10 sm:px-4 sm:pb-10">
      <div className="bg-white flex-1 flex flex-col sm:flex-none sm:rounded-xl sm:shadow-2xl w-full sm:max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3.5 border-b bg-gray-50 sm:rounded-t-xl shrink-0">
          <button type="button" onClick={onClose}
            className="p-1.5 -ml-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0">
            <ChevronRight size={18} className="rotate-180" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <RotateCcw size={14} className="text-orange-500" />
              Create Return / RMA
            </p>
            <p className="text-xs font-mono text-gray-500 mt-0.5 truncate">{order.amazonOrderId}</p>
          </div>
          {/* X only on desktop where there's no back arrow context */}
          <button type="button" onClick={onClose} className="hidden sm:block text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto">

          {/* ── Existing RMAs ─────────────────────────────────────────────────── */}
          {!existingLoading && existingRMAs.length > 0 && (
            <div className="px-5 pt-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Existing Returns for this Order
              </p>
              <div className="space-y-2">
                {existingRMAs.map((rma) => (
                  <div key={rma.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div>
                      <span className="text-xs font-mono font-semibold text-gray-800">{rma.rmaNumber}</span>
                      <span className="ml-2 text-xs text-gray-500">{rma.reason}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">{fmtDate(rma.createdAt)}</span>
                      <span className={clsx(
                        'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                        STATUS_COLORS[rma.status] ?? 'bg-gray-100 text-gray-600',
                      )}>
                        {rma.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Items to Return ────────────────────────────────────────────────── */}
          <div className="px-5 pt-4">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Items to Return
            </p>
            <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
              {items.map((item, idx) => (
                <div key={item.orderItemId}
                  className={clsx('px-4 py-3 transition-colors', !item.include && 'opacity-50 bg-gray-50')}>

                  {/* Item header row */}
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={item.include}
                      onChange={(e) => updateItem(idx, 'include', e.target.checked)}
                      className="mt-0.5 rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue" />

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 leading-snug">
                        {item.title ?? '(No title)'}
                      </p>
                      {item.sellerSku && (
                        <p className="text-[11px] text-gray-500 font-mono mt-0.5">SKU: {item.sellerSku}</p>
                      )}
                    </div>
                  </div>

                  {/* Item options row (only when included) */}
                  {item.include && (
                    <div className="mt-2.5 ml-6 flex flex-wrap gap-3 items-end">
                      {/* Quantity */}
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-1">Qty to Return</label>
                        <div className="flex items-center gap-1">
                          <button type="button"
                            onClick={() => updateItem(idx, 'quantityReturned', Math.max(1, item.quantityReturned - 1))}
                            className="w-6 h-6 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-100 flex items-center justify-center">
                            −
                          </button>
                          <span className="w-6 text-center text-xs font-semibold text-gray-800">
                            {item.quantityReturned}
                          </span>
                          <button type="button"
                            onClick={() => updateItem(idx, 'quantityReturned', Math.min(item.maxQty, item.quantityReturned + 1))}
                            className="w-6 h-6 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-100 flex items-center justify-center">
                            +
                          </button>
                          <span className="text-[10px] text-gray-400 ml-1">of {item.maxQty}</span>
                        </div>
                      </div>

                      {/* Condition */}
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-1">Condition</label>
                        <div className="relative">
                          <select value={item.condition}
                            onChange={(e) => updateItem(idx, 'condition', e.target.value)}
                            className="h-7 pl-2 pr-6 rounded border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue bg-white appearance-none">
                            {ITEM_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* Restock toggle */}
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={item.restockToInventory}
                          onChange={(e) => updateItem(idx, 'restockToInventory', e.target.checked)}
                          className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                        <span className="text-[11px] text-gray-600 font-medium flex items-center gap-1">
                          <Warehouse size={11} className="text-gray-400" />
                          Restock to inventory
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Inventory Location (shown only when restock requested) ──────────── */}
          {anyRestock && (
            <div className="px-5 pt-4">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Restock Location
              </p>
              <div className="border border-green-200 bg-green-50/40 rounded-lg px-4 py-3 space-y-3">
                <div className="flex items-center gap-2 text-xs text-green-700">
                  <ArrowRight size={12} />
                  Items marked for restock will be added to your inventory at the location below.
                </div>

                {warehousesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 size={12} className="animate-spin" /> Loading warehouses…
                  </div>
                ) : warehouses.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">
                    No warehouses found. Create one on the Warehouses page first.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-medium text-gray-600 mb-1">Warehouse</label>
                      <div className="relative">
                        <select value={selectedWarehouseId}
                          onChange={(e) => setSelectedWarehouseId(e.target.value)}
                          className="w-full h-8 pl-2 pr-6 rounded border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue bg-white appearance-none">
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                        <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-600 mb-1">Location</label>
                      <div className="relative">
                        <select value={selectedLocationId}
                          onChange={(e) => setSelectedLocationId(e.target.value)}
                          disabled={currentLocations.length === 0}
                          className="w-full h-8 pl-2 pr-6 rounded border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue bg-white appearance-none disabled:opacity-50">
                          {currentLocations.length === 0
                            ? <option value="">No locations in this warehouse</option>
                            : currentLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)
                          }
                        </select>
                        <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Return Details ─────────────────────────────────────────────────── */}
          <div className="px-5 pt-4 pb-5 space-y-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Return Details
            </p>

            {/* RMA number */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">RMA Number</label>
                <input type="text" value={rmaNumber} onChange={(e) => setRmaNumber(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Return Reason</label>
                <div className="relative">
                  <select value={reason} onChange={(e) => setReason(e.target.value)}
                    className="w-full h-9 pl-3 pr-7 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue bg-white appearance-none">
                    {RETURN_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Any additional notes about this return…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none" />
            </div>

            {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t bg-gray-50 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-100">
            Cancel
          </button>
          <div className="flex-1" />
          <button type="button" onClick={handleSubmit} disabled={saving}
            className="flex items-center gap-2 h-9 px-5 rounded-md bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {saving ? 'Creating…' : 'Create Return'}
          </button>
        </div>
      </div>
    </div>
  )
}

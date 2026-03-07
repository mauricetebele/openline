'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Barcode, X, Loader2, MapPin, ArrowRight, ShoppingCart, Package, RotateCcw, Pencil, Plus, Minus, ArrowRightLeft, Upload } from 'lucide-react'
import { clsx } from 'clsx'

interface HistoryEvent {
  id: string
  eventType: string
  createdAt: string
  notes: string | null
  receipt?: { id: string; receivedAt: string } | null
  purchaseOrder?: { id: string; poNumber: number; vendor?: { name: string } | null } | null
  order?: { id: string; olmNumber: number | null; amazonOrderId: string; orderSource: string; shipToName: string | null; label?: { trackingNumber: string; carrier: string | null } | null } | null
  location?: { name: string; warehouse: { name: string } } | null
  fromLocation?: { name: string; warehouse: { name: string } } | null
  fromProduct?: { sku: string; description: string } | null
  toProduct?: { sku: string; description: string } | null
}

interface SerialResult {
  id: string
  serialNumber: string
  status: string
  binLocation: string | null
  product: { sku: string; description: string }
  grade?: { grade: string } | null
  location: { name: string; warehouse: { name: string } }
  history: HistoryEvent[]
}

const STATUS_COLOR: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700',
  SOLD: 'bg-blue-100 text-blue-700',
  RETURNED: 'bg-yellow-100 text-yellow-700',
  DAMAGED: 'bg-red-100 text-red-700',
}

const EVENT_ICON: Record<string, React.ElementType> = {
  PO_RECEIPT: Package,
  LOCATION_MOVE: MapPin,
  SKU_CONVERSION: ArrowRightLeft,
  SALE: ShoppingCart,
  ASSIGNED: ArrowRight,
  UNASSIGNED: RotateCcw,
  VOID_REINSTATE: RotateCcw,
  BIN_ASSIGNED: MapPin,
  NOTE_ADDED: Pencil,
  MANUAL_ADD: Plus,
  MANUAL_REMOVE: Minus,
  MIGRATION: Upload,
  MP_RMA_RETURN: RotateCcw,
}

const EVENT_LABEL: Record<string, string> = {
  PO_RECEIPT: 'Received',
  LOCATION_MOVE: 'Moved',
  SKU_CONVERSION: 'Converted',
  SALE: 'Sold',
  ASSIGNED: 'Assigned',
  UNASSIGNED: 'Unassigned',
  VOID_REINSTATE: 'Void/Reinstate',
  BIN_ASSIGNED: 'Bin Set',
  NOTE_ADDED: 'Note',
  MANUAL_ADD: 'Added',
  MANUAL_REMOVE: 'Removed',
  MIGRATION: 'Migrated',
  MP_RMA_RETURN: 'MP Return',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function eventDetail(e: HistoryEvent): string {
  switch (e.eventType) {
    case 'PO_RECEIPT':
      return e.purchaseOrder ? `PO #${e.purchaseOrder.poNumber}${e.purchaseOrder.vendor ? ` — ${e.purchaseOrder.vendor.name}` : ''}` : ''
    case 'LOCATION_MOVE':
      return [
        e.fromLocation ? `${e.fromLocation.warehouse.name} / ${e.fromLocation.name}` : '',
        e.location ? `${e.location.warehouse.name} / ${e.location.name}` : '',
      ].filter(Boolean).join(' → ')
    case 'SALE':
      return e.order ? `${e.order.olmNumber ? `OLM-${e.order.olmNumber}` : e.order.amazonOrderId}${e.order.shipToName ? ` — ${e.order.shipToName}` : ''}` : ''
    case 'SKU_CONVERSION':
      return [e.fromProduct?.sku, e.toProduct?.sku].filter(Boolean).join(' → ')
    case 'MP_RMA_RETURN':
      return e.order ? `${e.order.olmNumber ? `OLM-${e.order.olmNumber}` : e.order.amazonOrderId}` : ''
    default:
      return e.notes ?? ''
  }
}

export default function SerialQuickLookup({ mobile }: { mobile?: boolean }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SerialResult | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController>()

  const doLookup = useCallback(async (sn: string) => {
    abortRef.current?.abort()
    const trimmed = sn.trim()
    if (!trimmed) { setResult(null); setNotFound(false); setOpen(false); return }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setNotFound(false)

    try {
      const res = await fetch(`/api/serials/lookup?sn=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal })
      if (res.status === 404) {
        setResult(null); setNotFound(true); setOpen(true)
      } else if (res.ok) {
        const json = await res.json()
        setResult(json); setNotFound(false); setOpen(true)
      }
    } catch { /* aborted */ }
    finally { if (!ctrl.signal.aborted) setLoading(false) }
  }, [])

  // Submit on Enter
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      doLookup(query)
    }
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setQuery('') }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div ref={containerRef} className={clsx('relative', mobile ? 'w-full' : 'w-56')}>
      <div className={clsx(
        'flex items-center gap-2 rounded-md border transition-colors',
        mobile
          ? 'bg-gray-800 border-white/10 px-3 py-2'
          : 'bg-white/10 border-transparent hover:border-white/20 focus-within:border-white/30 px-2.5 py-1.5',
      )}>
        {loading
          ? <Loader2 size={14} className="text-gray-400 animate-spin shrink-0" />
          : <Barcode size={14} className="text-gray-400 shrink-0" />}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (result || notFound) setOpen(true) }}
          placeholder="Serial # lookup"
          className="bg-transparent text-sm text-white placeholder:text-gray-500 outline-none w-full"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResult(null); setNotFound(false); setOpen(false) }}
            className="text-gray-500 hover:text-gray-300 shrink-0">
            <X size={14} />
          </button>
        )}
      </div>

      {open && result && (
        <div className={clsx(
          'absolute z-[9999] mt-1 min-w-[380px] max-h-[480px] overflow-y-auto',
          'bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl',
          mobile ? 'left-0 w-full' : 'right-0',
        )}>
          {/* Serial header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">{result.serialNumber}</span>
              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', STATUS_COLOR[result.status] ?? 'bg-gray-100 text-gray-600')}>
                {result.status.replace('_', ' ')}
              </span>
              {result.grade && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 font-medium">
                  {result.grade.grade}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {result.product.sku} — {result.product.description}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              {result.location.warehouse.name} / {result.location.name}
              {result.binLocation ? ` · Bin ${result.binLocation}` : ''}
            </p>
          </div>

          {/* History timeline */}
          <div className="px-4 py-2">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">History</p>
            {result.history.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No history events</p>
            ) : (
              <div className="space-y-0">
                {[...result.history].reverse().map(ev => {
                  const Icon = EVENT_ICON[ev.eventType] ?? Package
                  const detail = eventDetail(ev)
                  return (
                    <div key={ev.id} className="flex items-start gap-2.5 py-1.5 border-b border-gray-50 dark:border-white/5 last:border-0">
                      <Icon size={12} className="text-gray-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {EVENT_LABEL[ev.eventType] ?? ev.eventType}
                          </span>
                          <span className="text-[10px] text-gray-400">{formatDate(ev.createdAt)}</span>
                        </div>
                        {detail && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{detail}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {open && notFound && (
        <div className={clsx(
          'absolute z-[9999] mt-1 min-w-[300px]',
          'bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl px-4 py-3',
          mobile ? 'left-0 w-full' : 'right-0',
        )}>
          <p className="text-xs text-gray-500">Serial not found</p>
        </div>
      )}
    </div>
  )
}

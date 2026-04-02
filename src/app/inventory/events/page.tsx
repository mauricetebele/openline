'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Search, X, Filter, RefreshCw, ChevronDown, ChevronUp, Package2 } from 'lucide-react'
import { clsx } from 'clsx'
import AppShell from '@/components/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRow {
  key:          string
  eventType:    string
  direction:    'add' | 'remove' | 'move'
  detailLabel:  string
  sku:          string
  description:  string
  grade:        string | null
  qty:          number
  location:     string | null
  fromLocation: string | null
  toLocation:   string | null
  fromSku:      string | null
  toSku:        string | null
  notes:        string | null
  poNumber:     string | null
  userName:     string | null
  createdAt:    string
  serials:      string[]
  beforeQty:    number | null
  afterQty:     number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { value: '',               label: 'All Types' },
  { value: 'PO_RECEIPT',     label: 'PO Receipt' },
  { value: 'MANUAL_ADD',     label: 'Manual Add' },
  { value: 'LOCATION_MOVE',  label: 'Move' },
  { value: 'SKU_CONVERSION', label: 'SKU Convert' },
  { value: 'SALE',           label: 'Sale' },
  { value: 'MANUAL_REMOVE',  label: 'Manual Remove' },
]

const LIMITS = [25, 50, 100, 200]

const DIR_STYLE: Record<string, string> = {
  add:    'bg-green-100 text-green-700',
  remove: 'bg-red-100 text-red-700',
  move:   'bg-blue-100 text-blue-700',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ row, onClose }: { row: EventRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="text-sm font-semibold text-gray-900">{row.detailLabel} — {row.sku}</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmt(row.createdAt)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">SKU</p>
              <p className="font-mono text-gray-800">{row.sku}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Description</p>
              <p className="text-gray-700 text-xs">{row.description}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Grade</p>
              <p className="text-gray-700">{row.grade ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Type</p>
              <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', DIR_STYLE[row.direction])}>
                {row.direction}
              </span>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Quantity</p>
              <p className="text-gray-800 font-medium">{row.qty}</p>
            </div>

            {row.eventType === 'LOCATION_MOVE' ? (
              <>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">From Location</p>
                  <p className="text-gray-700">{row.fromLocation ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">To Location</p>
                  <p className="text-gray-700">{row.toLocation ?? '—'}</p>
                </div>
              </>
            ) : (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Location</p>
                <p className="text-gray-700">{row.location ?? '—'}</p>
              </div>
            )}

            {row.eventType === 'SKU_CONVERSION' && (
              <>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Converted From SKU</p>
                  <p className="font-mono text-gray-700">{row.fromSku ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Converted To SKU</p>
                  <p className="font-mono text-gray-700">{row.toSku ?? row.sku}</p>
                </div>
              </>
            )}

            {row.poNumber && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">PO Number</p>
                <p className="font-mono text-gray-700">{row.poNumber}</p>
              </div>
            )}

            {row.beforeQty !== null && (
              <>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Before Qty</p>
                  <p className="text-gray-800 font-medium">{row.beforeQty}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">After Qty</p>
                  <p className="text-gray-800 font-medium">{row.afterQty}</p>
                </div>
              </>
            )}

            {row.notes && (
              <div className="col-span-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Notes</p>
                <p className="text-gray-700 text-xs">{row.notes}</p>
              </div>
            )}
          </div>

          {/* Serial numbers */}
          {row.serials.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Serial Number{row.serials.length !== 1 ? 's' : ''} ({row.serials.length})
              </p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 max-h-48 overflow-y-auto divide-y divide-gray-100">
                {row.serials.map((sn, i) => (
                  <p key={i} className="px-3 py-1.5 font-mono text-xs text-gray-700">{sn}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 py-4 border-t">
          <button onClick={onClose}
            className="h-9 px-4 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InventoryEventsPage() {
  const [rows, setRows]           = useState<EventRow[]>([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(false)
  const [detail, setDetail]       = useState<EventRow | null>(null)

  // Filter state
  const [sku,       setSku]       = useState('')
  const [eventType, setEventType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [limit,     setLimit]     = useState(50)

  // Applied filter (what was last submitted)
  const [applied, setApplied] = useState({ sku: '', eventType: '', startDate: '', endDate: '' })

  const skuInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (applied.sku)       params.set('sku',       applied.sku)
      if (applied.eventType) params.set('eventType', applied.eventType)
      if (applied.startDate) params.set('startDate', applied.startDate)
      if (applied.endDate)   params.set('endDate',   applied.endDate)
      const res  = await fetch(`/api/inventory/events?${params}`)
      const data = await res.json()
      setRows(data.data ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [page, limit, applied])

  useEffect(() => { load() }, [load])

  function handleFilter(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setApplied({ sku, eventType, startDate, endDate })
  }

  function handleReset() {
    setSku(''); setEventType(''); setStartDate(''); setEndDate('')
    setPage(1)
    setApplied({ sku: '', eventType: '', startDate: '', endDate: '' })
    skuInputRef.current?.focus()
  }

  const totalPages = Math.ceil(total / limit)
  const hasFilters = applied.sku || applied.eventType || applied.startDate || applied.endDate
  const showQty    = !!applied.sku  // before/after only computed when SKU filtered

  return (
    <AppShell>
      <div className="flex-1 overflow-auto px-6 py-5 space-y-5">

        {/* Page header */}
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventory Transaction History</h1>
          <p className="text-sm text-gray-500 mt-0.5">Every inventory movement event aggregated by SKU</p>
        </div>

        {/* Filter panel */}
        <form onSubmit={handleFilter} className="card p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* SKU */}
            <div className="lg:col-span-2">
              <label className="label">SKU</label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={skuInputRef}
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                  placeholder="e.g. IP14P-128-BLK"
                  className="input pl-8"
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Event type */}
            <div>
              <label className="label">Event Type</label>
              <select
                value={eventType}
                onChange={e => setEventType(e.target.value)}
                className="input"
              >
                {EVENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Start date */}
            <div>
              <label className="label">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="input"
              />
            </div>

            {/* End date */}
            <div>
              <label className="label">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button type="submit" className="btn-primary">
              <Filter size={14} />
              Filter
            </button>
            <button type="button" onClick={handleReset} className="btn-ghost">
              Reset All
            </button>
            {hasFilters && (
              <span className="text-xs text-amazon-blue font-medium ml-1">Filters applied</span>
            )}
          </div>
        </form>

        {/* Results */}
        <div className="card">
          {/* Results header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <p className="text-sm text-gray-600">
              {loading ? 'Loading…' : (
                <>Showing <strong>{(page - 1) * limit + 1}–{Math.min(page * limit, total)}</strong> of <strong>{total.toLocaleString()}</strong> records</>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={load} disabled={loading} className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
              <select
                value={limit}
                onChange={e => { setLimit(Number(e.target.value)); setPage(1) }}
                className="h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              >
                {LIMITS.map(l => <option key={l} value={l}>{l} / page</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-20 text-center">
              <Package2 size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-400">
                {hasFilters ? 'No events match your filters' : 'No inventory events recorded yet'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-left">Grade</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-right w-16">Qty</th>
                    <th className="px-4 py-3 text-left">Details</th>
                    <th className="px-4 py-3 text-left">Transaction Date</th>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Location</th>
                    {showQty && (
                      <>
                        <th className="px-4 py-3 text-right w-28">Before Qty</th>
                        <th className="px-4 py-3 text-right w-28">After Qty</th>
                      </>
                    )}
                    <th className="px-4 py-3 w-20 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(row => (
                    <tr key={row.key} className="hover:bg-gray-50 group">
                      <td className="px-4 py-3 font-mono text-xs text-gray-800 whitespace-nowrap">
                        {row.sku}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {row.grade ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                          DIR_STYLE[row.direction],
                        )}>
                          {row.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">{row.qty}</td>
                      <td className="px-4 py-3">
                        <span className="text-gray-700">{row.detailLabel}</span>
                        {row.poNumber && (
                          <span className="ml-1 text-xs text-gray-400">· {row.poNumber}</span>
                        )}
                        {row.notes && (
                          <span className="ml-1 text-xs text-gray-400 truncate max-w-[140px] inline-block align-bottom">
                            · {row.notes}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {fmt(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {row.userName ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {row.eventType === 'LOCATION_MOVE'
                          ? <span>{row.fromLocation ?? '—'} → {row.toLocation ?? '—'}</span>
                          : <span>{row.location ?? '—'}</span>
                        }
                      </td>
                      {showQty && (
                        <>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {row.beforeQty ?? <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {row.afterQty ?? <span className="text-gray-300">—</span>}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => setDetail(row)}
                          className="inline-flex items-center h-6 px-2.5 rounded-full bg-green-500 text-white text-[10px] font-semibold hover:bg-green-600 transition-colors"
                        >
                          Detail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer row count */}
          {!loading && rows.length > 0 && (
            <div className="px-4 py-3 border-t text-sm text-gray-600">
              Showing <strong>{(page - 1) * limit + 1}–{Math.min(page * limit, total)}</strong> of <strong>{total.toLocaleString()}</strong> records
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="h-8 px-3 rounded border border-gray-300 text-xs hover:bg-gray-50 disabled:opacity-40">
                Previous
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="h-8 px-3 rounded border border-gray-300 text-xs hover:bg-gray-50 disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        )}

        {!showQty && rows.length > 0 && (
          <p className="text-xs text-gray-400 text-center">
            💡 Filter by a specific SKU to see Before / After quantities
          </p>
        )}
      </div>

      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
    </AppShell>
  )
}

'use client'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, X, Package, Hash, Clock, ChevronDown, ChevronUp, ChevronRight, ShoppingCart, Search, ArrowRightLeft, CheckSquare, Square, Tag, Plus, RefreshCcw, CheckCircle2, ChevronsUpDown, Barcode } from 'lucide-react'
import SNLookupModal from './SNLookupModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Warehouse { id: string; name: string }
interface Location  { id: string; name: string; warehouseId: string; warehouse: Warehouse }
interface Product   { id: string; description: string; sku: string; isSerializable: boolean }

interface InventoryGrade { id: string; grade: string; description: string | null }

interface InventoryItem {
  id: string
  qty: number
  reserved: number
  onHand: number
  unitCost: number | null
  product: Product
  location: Location
  grade: InventoryGrade | null
}

interface Serial { id: string; serialNumber: string; binLocation: string | null; createdAt: string }

interface HistoryEvent {
  id:            string
  eventType:     string
  createdAt:     string
  notes:         string | null
  receipt:       { id: string; receivedAt: string } | null
  purchaseOrder: { id: string; poNumber: number; vendor: { name: string } } | null
  order:         { id: string; olmNumber: number | null; amazonOrderId: string; orderSource: string; shipToName: string | null; shipToCity: string | null; shipToState: string | null; orderTotal: string | null; currency: string | null; label: { trackingNumber: string; carrier: string | null; serviceCode: string | null; shipmentCost: string | null } | null } | null
  location:      { name: string; warehouse: { name: string } } | null
  fromLocation:  { name: string; warehouse: { name: string } } | null
  fromProduct:   { id: string; description: string; sku: string } | null
  toProduct:     { id: string; description: string; sku: string } | null
}

interface BulkSerial {
  id:           string
  serialNumber: string
  status:       string
  binLocation:  string | null
  product:      { id: string; description: string; sku: string }
  location:     { id: string; name: string; warehouse: { id: string; name: string } }
  grade:        { id: string; grade: string } | null
}

interface SimpleProduct {
  id: string; description: string; sku: string; isSerializable: boolean
}

interface SimpleGrade { id: string; grade: string; description: string | null }

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900"><X size={14} /></button>
    </div>
  )
}

// ─── Serial Row (with expandable history) ─────────────────────────────────────

function SerialRow({ serial, index }: { serial: Serial; index: number }) {
  const [expanded, setExpanded]   = useState(false)
  const [history,  setHistory]    = useState<HistoryEvent[]>([])
  const [loading,  setLoading]    = useState(false)
  const [loaded,   setLoaded]     = useState(false)
  const [err,      setErr]        = useState('')

  async function toggle() {
    if (!expanded && !loaded) {
      setLoading(true)
      try {
        const res  = await fetch(`/api/serials/${serial.id}/history`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to load')
        setHistory(data.data)
        setLoaded(true)
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : 'Failed to load history')
      } finally {
        setLoading(false)
      }
    }
    setExpanded(e => !e)
  }

  const EVENT_LABEL: Record<string, string> = {
    PO_RECEIPT: 'PO Receipt',
  }

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* Serial row */}
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-xs text-gray-400 w-6 text-right shrink-0">{index + 1}.</span>
        {expanded
          ? <ChevronDown  size={12} className="text-gray-400 shrink-0" />
          : <ChevronRight size={12} className="text-gray-400 shrink-0" />
        }
        <span className="font-mono text-sm text-gray-800 flex-1">{serial.serialNumber}</span>
        <span className="text-xs text-gray-400 shrink-0">
          {new Date(serial.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
          <Clock size={11} />
          History
        </div>
      </button>

      {/* History panel */}
      {expanded && (
        <div className="bg-gray-50 border-t border-gray-100 px-3 pb-3 pt-2">
          {loading ? (
            <p className="text-xs text-gray-400 py-2 pl-10">Loading history…</p>
          ) : err ? (
            <p className="text-xs text-red-500 py-2 pl-10">{err}</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 pl-10 italic">No history recorded</p>
          ) : (
            <div className="pl-10 space-y-2">
              {history.map((event, ei) => (
                <div key={event.id} className="relative pl-4">
                  {/* Timeline line */}
                  {ei < history.length - 1 && (
                    <span className="absolute left-[7px] top-5 bottom-0 w-px bg-gray-200" />
                  )}
                  {/* Timeline dot */}
                  <span className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-amazon-blue flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-amazon-blue" />
                  </span>

                  <div className="bg-white rounded-md border border-gray-200 px-3 py-2">
                    {/* Event header */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5">
                        {event.eventType === 'LOCATION_MOVE' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium">
                            <ArrowRightLeft size={10} />
                            Location Move
                          </span>
                        ) : event.eventType === 'SKU_CONVERSION' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 text-xs font-medium">
                            <Tag size={10} />
                            SKU Conversion
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs font-medium">
                            <ShoppingCart size={10} />
                            {EVENT_LABEL[event.eventType] ?? event.eventType}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {new Date(event.createdAt).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Event details */}
                    <div className="space-y-0.5 text-xs text-gray-600">
                      {event.eventType === 'LOCATION_MOVE' ? (
                        <>
                          {event.fromLocation && (
                            <p>
                              <span className="text-gray-400">From:</span>{' '}
                              <span className="font-medium text-gray-800">
                                {event.fromLocation.warehouse.name} / {event.fromLocation.name}
                              </span>
                            </p>
                          )}
                          {event.location && (
                            <p>
                              <span className="text-gray-400">To:</span>{' '}
                              <span className="font-medium text-gray-800">
                                {event.location.warehouse.name} / {event.location.name}
                              </span>
                            </p>
                          )}
                        </>
                      ) : event.eventType === 'SKU_CONVERSION' ? (
                        <>
                          {event.fromProduct && (
                            <p>
                              <span className="text-gray-400">From:</span>{' '}
                              <span className="font-mono font-medium text-gray-800">{event.fromProduct.sku}</span>
                              <span className="text-gray-400"> · {event.fromProduct.description}</span>
                            </p>
                          )}
                          {event.toProduct && (
                            <p>
                              <span className="text-gray-400">To:</span>{' '}
                              <span className="font-mono font-medium text-gray-800">{event.toProduct.sku}</span>
                              <span className="text-gray-400"> · {event.toProduct.description}</span>
                            </p>
                          )}
                        </>
                      ) : (event.eventType === 'SALE' || event.eventType === 'ASSIGNED' || event.eventType === 'UNASSIGNED') && event.order ? (
                        <>
                          {event.order.olmNumber && (
                            <p>
                              <span className="text-gray-400">OLM #:</span>{' '}
                              <span className="font-semibold font-mono text-gray-800">OLM-{event.order.olmNumber}</span>
                            </p>
                          )}
                          <p>
                            <span className="text-gray-400">{event.order.orderSource === 'backmarket' ? 'BackMarket #:' : 'Amazon #:'}</span>{' '}
                            <span className="font-semibold font-mono text-gray-800">{event.order.amazonOrderId}</span>
                          </p>
                          {event.order.shipToName && (
                            <p>
                              <span className="text-gray-400">Buyer:</span>{' '}
                              <span className="font-medium text-gray-800">{event.order.shipToName}</span>
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          {event.purchaseOrder && (
                            <p>
                              <span className="text-gray-400">PO:</span>{' '}
                              <span className="font-medium text-gray-800">#{event.purchaseOrder.poNumber}</span>
                              {' '}· {event.purchaseOrder.vendor.name}
                            </p>
                          )}
                          {event.receipt && (
                            <p>
                              <span className="text-gray-400">Received:</span>{' '}
                              <span className="font-medium text-gray-800">
                                {new Date(event.receipt.receivedAt).toLocaleString('en-US', {
                                  month: 'short', day: 'numeric', year: 'numeric',
                                  hour: 'numeric', minute: '2-digit',
                                })}
                              </span>
                            </p>
                          )}
                          {event.location && (
                            <p>
                              <span className="text-gray-400">Location:</span>{' '}
                              <span className="font-medium text-gray-800">
                                {event.location.warehouse.name} / {event.location.name}
                              </span>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Serial Row (for SerialsModal) ────────────────────────────────────────────

function ModalSerialRow({ serial, index }: { serial: Serial; index: number }) {
  const [expanded, setExpanded]   = useState(false)
  const [history,  setHistory]    = useState<HistoryEvent[]>([])
  const [loading,  setLoading]    = useState(false)
  const [loaded,   setLoaded]     = useState(false)

  async function toggle() {
    if (!expanded && !loaded) {
      setLoading(true)
      try {
        const res  = await fetch(`/api/serials/${serial.id}/history`)
        const data = await res.json()
        if (res.ok) { setHistory(data.data); setLoaded(true) }
      } finally {
        setLoading(false)
      }
    }
    setExpanded(e => !e)
  }

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
        <span className="text-xs text-gray-400 w-6 text-right shrink-0">{index + 1}.</span>
        <button type="button" onClick={toggle} className="font-mono text-sm text-gray-800 flex-1 text-left hover:text-amazon-blue flex items-center gap-1.5">
          {expanded ? <ChevronDown size={12} className="text-gray-400 shrink-0" /> : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
          {serial.serialNumber}
        </button>
        <span className="w-20 text-center font-mono text-xs text-gray-500">{serial.binLocation ?? '—'}</span>
        <span className="text-xs text-gray-400 w-24 shrink-0 text-right">
          {new Date(serial.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <button type="button" onClick={toggle} className="flex items-center gap-1 text-xs text-gray-400 shrink-0 hover:text-gray-600">
          <Clock size={11} /> History
        </button>
      </div>
      {expanded && (
        <div className="bg-gray-50 border-t border-gray-100 px-3 pb-3 pt-2">
          {loading ? (
            <p className="text-xs text-gray-400 py-2 pl-10">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 pl-10 italic">No history recorded</p>
          ) : (
            <div className="pl-10 space-y-1.5">
              {history.map(event => (
                <div key={event.id} className="bg-white rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-700">{event.eventType.replace(/_/g, ' ')}</span>
                    <span className="text-gray-400">
                      {new Date(event.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  {event.location && (
                    <p className="mt-0.5"><span className="text-gray-400">Location:</span> {event.location.warehouse.name} / {event.location.name}</p>
                  )}
                  {event.fromLocation && (
                    <p className="mt-0.5"><span className="text-gray-400">From:</span> {event.fromLocation.warehouse.name} / {event.fromLocation.name}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── SKU Convert Modal ────────────────────────────────────────────────────────

function SKUConvertModal({ onClose }: { onClose: () => void }) {
  const [input,       setInput]       = useState('')
  const [results,     setResults]     = useState<{ found: BulkSerial[]; notFound: string[] } | null>(null)
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState('')
  const [successMsg,  setSuccessMsg]  = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  async function handleLookup() {
    const lines = input.split('\n').map(s => s.trim()).filter(Boolean)
    if (!lines.length) return
    setLoading(true)
    setErr('')
    setSuccessMsg('')
    setResults(null)
    setSelected(new Set())
    try {
      const res  = await fetch('/api/serials/bulk-lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ serials: lines }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')
      setResults(data)
      // Auto-select only IN_STOCK / RETURNED / DAMAGED — not SOLD
      const eligible = (data.found as BulkSerial[]).filter(s => s.status !== 'SOLD')
      setSelected(new Set(eligible.map(s => s.id)))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const eligible    = results?.found.filter(s => s.status !== 'SOLD') ?? []
  const allSelected = eligible.length > 0 && selected.size === eligible.length
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(eligible.map(s => s.id)))
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  async function handleConvert(toProductId: string) {
    const ids = Array.from(selected)
    const res = await fetch('/api/serials/convert-sku', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ serialIds: ids, toProductId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Conversion failed')

    setShowConfirm(false)
    setSuccessMsg(`${data.convertedCount} unit${data.convertedCount !== 1 ? 's' : ''} converted successfully.`)

    // Refresh grid
    const lines = input.split('\n').map(s => s.trim()).filter(Boolean)
    const refreshRes  = await fetch('/api/serials/bulk-lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serials: lines }),
    })
    const refreshData = await refreshRes.json()
    if (refreshRes.ok) { setResults(refreshData); setSelected(new Set()) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[760px] max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-amazon-blue" />
            <h2 className="text-sm font-semibold text-gray-900">Convert SKU</h2>
            <span className="text-xs text-gray-400">— reassign serial numbers to a different SKU</span>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {/* Input */}
        <div className="px-5 py-4 border-b shrink-0">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); setSuccessMsg('') }}
            placeholder={"Scan or paste serial numbers, one per line…\nSN001\nSN002\nSN003"}
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">
              {input.split('\n').filter(s => s.trim()).length} line{input.split('\n').filter(s => s.trim()).length !== 1 ? 's' : ''} entered
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setInput(''); setResults(null); setSelected(new Set()); setErr(''); setSuccessMsg('') }}
                className="h-8 px-3 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
                Clear
              </button>
              <button type="button" onClick={handleLookup} disabled={loading || !input.trim()}
                className="h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5">
                <Search size={13} />
                {loading ? 'Looking up…' : 'Lookup'}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {err && <div className="px-5 pt-4"><ErrorBanner msg={err} onClose={() => setErr('')} /></div>}

          {successMsg && (
            <div className="mx-5 mt-4 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
              <span className="flex-1">{successMsg}</span>
              <button type="button" onClick={() => setSuccessMsg('')} className="text-green-500 hover:text-green-700"><X size={13} /></button>
            </div>
          )}

          {!results && !err && !loading && (
            <div className="py-16 text-center">
              <Tag size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">Enter serial numbers above and click Lookup</p>
            </div>
          )}

          {results && (
            <div className="px-5 py-4 space-y-3">
              {results.notFound.length > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span><span className="font-semibold">Not found:</span> {results.notFound.join(', ')}</span>
                </div>
              )}

              {results.found.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No serialized inventory found for the entered serial numbers.</p>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2.5 w-10">
                          <button type="button" onClick={toggleAll} className="flex items-center justify-center text-gray-400 hover:text-amazon-blue">
                            {allSelected ? <CheckSquare size={15} className="text-amazon-blue" /> : <Square size={15} />}
                          </button>
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Current SKU</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Serial #</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {results.found.map(serial => {
                        const isSold    = serial.status === 'SOLD'
                        const checked   = selected.has(serial.id)
                        return (
                          <tr
                            key={serial.id}
                            onClick={() => !isSold && toggleOne(serial.id)}
                            className={`transition-colors ${isSold ? 'opacity-50 cursor-not-allowed bg-gray-50' : checked ? 'bg-blue-50 hover:bg-blue-100 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'}`}
                          >
                            <td className="px-3 py-2.5 text-center">
                              {isSold ? (
                                <span className="flex items-center justify-center text-gray-200"><Square size={15} /></span>
                              ) : (
                                <span className={`flex items-center justify-center ${checked ? 'text-amazon-blue' : 'text-gray-300'}`}>
                                  {checked ? <CheckSquare size={15} /> : <Square size={15} />}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{serial.product.sku}</td>
                            <td className="px-3 py-2.5 font-mono text-sm text-gray-900 font-medium">{serial.serialNumber}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                serial.status === 'IN_STOCK'  ? 'bg-green-100 text-green-700' :
                                serial.status === 'SOLD'      ? 'bg-gray-100 text-gray-500'   :
                                serial.status === 'RETURNED'  ? 'bg-blue-100 text-blue-700'   :
                                                                'bg-red-100 text-red-700'
                              }`}>
                                {serial.status === 'IN_STOCK' ? 'In Stock' : serial.status === 'SOLD' ? 'Sold — ineligible' : serial.status === 'RETURNED' ? 'Returned' : 'Damaged'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {serial.location.warehouse.name}<span className="text-gray-400 mx-1">/</span>{serial.location.name}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t shrink-0 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {someSelected ? `${selected.size} unit${selected.size !== 1 ? 's' : ''} selected` : 'No units selected'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
              Close
            </button>
            <button type="button" onClick={() => setShowConfirm(true)} disabled={!someSelected}
              className="h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5">
              <Tag size={13} />
              Convert {someSelected ? selected.size : ''} Unit{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>

      {showConfirm && (
        <SKUConvertConfirmModal
          count={selected.size}
          onConvert={handleConvert}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}

function SKUConvertConfirmModal({
  count, onConvert, onClose,
}: {
  count:     number
  onConvert: (toProductId: string) => Promise<void>
  onClose:   () => void
}) {
  const [products,     setProducts]     = useState<SimpleProduct[]>([])
  const [toProductId,  setToProductId]  = useState('')
  const [converting,   setConverting]   = useState(false)
  const [err,          setErr]          = useState('')

  useEffect(() => {
    fetch('/api/products?serializable=true')
      .then(r => r.json())
      .then(d => setProducts(d.data ?? []))
      .catch(() => {})
  }, [])

  async function handleConfirm() {
    if (!toProductId) return
    setConverting(true)
    setErr('')
    try {
      await onConvert(toProductId)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Conversion failed')
      setConverting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[420px]">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
            Convert {count} Unit{count !== 1 ? 's' : ''} To?
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Target SKU / Product</label>
            <select
              value={toProductId}
              onChange={e => setToProductId(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            >
              <option value="">Select target product…</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.sku} — {p.description}</option>
              ))}
            </select>
          </div>
          {toProductId && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              This will reassign {count} serial number{count !== 1 ? 's' : ''} to the selected SKU and adjust inventory counts accordingly.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between">
          <button type="button" onClick={onClose}
            className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={!toProductId || converting}
            className="h-8 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5">
            <Tag size={13} />
            {converting ? 'Converting…' : 'Confirm Convert'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Move Inventory Modal ─────────────────────────────────────────────────────

type WarehouseWithLocs = { id: string; name: string; locations: { id: string; name: string }[] }

function MoveConfirmModal({
  count,
  onMove,
  onClose,
}: {
  count:   number
  onMove:  (locationId: string) => Promise<void>
  onClose: () => void
}) {
  const [warehouses,  setWarehouses]  = useState<WarehouseWithLocs[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId,  setLocationId]  = useState('')
  const [moving,      setMoving]      = useState(false)
  const [err,         setErr]         = useState('')

  useEffect(() => {
    fetch('/api/warehouses')
      .then(r => r.json())
      .then(d => setWarehouses(d.data ?? []))
      .catch(() => {})
  }, [])

  const locations = warehouses.find(w => w.id === warehouseId)?.locations ?? []

  async function handleConfirm() {
    if (!locationId) return
    setMoving(true)
    setErr('')
    try {
      await onMove(locationId)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Move failed')
      setMoving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[380px]">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
            Move {count} Unit{count !== 1 ? 's' : ''} To?
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse</label>
            <select
              value={warehouseId}
              onChange={e => { setWarehouseId(e.target.value); setLocationId('') }}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            >
              <option value="">Select warehouse…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              disabled={!warehouseId}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Select location…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between">
          <button type="button" onClick={onClose}
            className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!locationId || moving}
            className="h-8 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            <ArrowRightLeft size={13} />
            {moving ? 'Moving…' : 'Confirm Move'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MoveInventoryModal({ onClose }: { onClose: () => void }) {
  const [input,        setInput]        = useState('')
  const [results,      setResults]      = useState<{ found: BulkSerial[]; notFound: string[] } | null>(null)
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [loading,      setLoading]      = useState(false)
  const [err,          setErr]          = useState('')
  const [successMsg,   setSuccessMsg]   = useState('')
  const [showConfirm,  setShowConfirm]  = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  async function handleLookup() {
    const lines = input.split('\n').map(s => s.trim()).filter(Boolean)
    if (!lines.length) return
    setLoading(true)
    setErr('')
    setSuccessMsg('')
    setResults(null)
    setSelected(new Set())
    try {
      const res  = await fetch('/api/serials/bulk-lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ serials: lines }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')
      setResults(data)
      setSelected(new Set((data.found as BulkSerial[]).map(s => s.id)))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const allSelected  = !!results?.found.length && selected.size === results.found.length
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(results?.found.map(s => s.id) ?? []))
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  async function handleMove(locationId: string) {
    const ids = Array.from(selected)
    const res = await fetch('/api/serials/move', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ serialIds: ids, locationId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Move failed')

    setShowConfirm(false)
    setSuccessMsg(`${data.movedCount} unit${data.movedCount !== 1 ? 's' : ''} moved successfully.`)

    // Re-run lookup to refresh grid with updated locations
    const lines = input.split('\n').map(s => s.trim()).filter(Boolean)
    const refreshRes  = await fetch('/api/serials/bulk-lookup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ serials: lines }),
    })
    const refreshData = await refreshRes.json()
    if (refreshRes.ok) {
      setResults(refreshData)
      setSelected(new Set())
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[760px] max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={15} className="text-amazon-blue" />
            <h2 className="text-sm font-semibold text-gray-900">Move Inventory</h2>
            <span className="text-xs text-gray-400">— scan or paste serial numbers below</span>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Input area */}
        <div className="px-5 py-4 border-b shrink-0">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); setSuccessMsg('') }}
            placeholder={"Scan or paste serial numbers, one per line…\nSN001\nSN002\nSN003"}
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">
              {input.split('\n').filter(s => s.trim()).length} serial{input.split('\n').filter(s => s.trim()).length !== 1 ? 's' : ''} entered
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setInput(''); setResults(null); setSelected(new Set()); setErr(''); setSuccessMsg('') }}
                className="h-8 px-3 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
                Clear
              </button>
              <button
                type="button"
                onClick={handleLookup}
                disabled={loading || !input.trim()}
                className="h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Search size={13} />
                {loading ? 'Looking up…' : 'Lookup'}
              </button>
            </div>
          </div>
        </div>

        {/* Results grid */}
        <div className="flex-1 overflow-y-auto">
          {err && (
            <div className="px-5 pt-4">
              <ErrorBanner msg={err} onClose={() => setErr('')} />
            </div>
          )}

          {successMsg && (
            <div className="mx-5 mt-4 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
              <span className="flex-1">{successMsg}</span>
              <button type="button" onClick={() => setSuccessMsg('')} className="text-green-500 hover:text-green-700"><X size={13} /></button>
            </div>
          )}

          {!results && !err && !loading && (
            <div className="py-16 text-center">
              <ArrowRightLeft size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">Enter serial numbers above and click Lookup</p>
            </div>
          )}

          {results && (
            <div className="px-5 py-4 space-y-3">

              {/* Not-found warning */}
              {results.notFound.length > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold">Not found:</span>{' '}
                    {results.notFound.join(', ')}
                  </span>
                </div>
              )}

              {results.found.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No serialized inventory found for the entered serial numbers.</p>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-3 py-2.5 w-10">
                          <button type="button" onClick={toggleAll} className="flex items-center justify-center text-gray-400 hover:text-amazon-blue">
                            {allSelected
                              ? <CheckSquare size={15} className="text-amazon-blue" />
                              : <Square size={15} />
                            }
                          </button>
                        </th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Serial #</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Current Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {results.found.map(serial => {
                        const checked = selected.has(serial.id)
                        return (
                          <tr
                            key={serial.id}
                            onClick={() => toggleOne(serial.id)}
                            className={`cursor-pointer transition-colors ${checked ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}
                          >
                            <td className="px-3 py-2.5 text-center">
                              <span className={`flex items-center justify-center ${checked ? 'text-amazon-blue' : 'text-gray-300'}`}>
                                {checked ? <CheckSquare size={15} /> : <Square size={15} />}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{serial.product.sku}</td>
                            <td className="px-3 py-2.5 font-mono text-sm text-gray-900 font-medium">{serial.serialNumber}</td>
                            <td className="px-3 py-2.5 text-gray-700">
                              {serial.location.warehouse.name}
                              <span className="text-gray-400 mx-1">/</span>
                              {serial.location.name}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t shrink-0 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {someSelected ? `${selected.size} unit${selected.size !== 1 ? 's' : ''} selected` : 'No units selected'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
              Close
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={!someSelected}
              className="h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              <ArrowRightLeft size={13} />
              Move {someSelected ? selected.size : ''} Unit{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>

      {showConfirm && (
        <MoveConfirmModal
          count={selected.size}
          onMove={handleMove}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}


// ─── Regrade Modal ───────────────────────────────────────────────────────────

function RegradeModal({ warehouses, onClose }: {
  warehouses: Array<{ id: string; name: string; locations: { id: string; name: string }[] }>
  onClose:   () => void
}) {
  const [mode, setMode] = useState<'serial' | 'item'>('serial')

  // ── Shared ──────────────────────────────────────────────────────────────────
  const [err,        setErr]        = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ── Serial mode ─────────────────────────────────────────────────────────────
  const [input,         setInput]         = useState('')
  const [results,       setResults]       = useState<{ found: BulkSerial[]; notFound: string[] } | null>(null)
  const [selected,      setSelected]      = useState<Set<string>>(new Set())
  const [toGradeId,     setToGradeId]     = useState('')
  const [gradeOptions,  setGradeOptions]  = useState<SimpleGrade[]>([])
  const [loadingLookup, setLoadingLookup] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (mode === 'serial') textareaRef.current?.focus() }, [mode])

  async function handleLookup() {
    const lines = input.split('\n').map(s => s.trim()).filter(Boolean)
    if (!lines.length) return
    setLoadingLookup(true)
    setErr('')
    setSuccessMsg('')
    setResults(null)
    setSelected(new Set())
    setToGradeId('')
    setGradeOptions([])
    try {
      const res  = await fetch('/api/serials/bulk-lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ serials: lines }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')
      setResults(data)
      const found = data.found as BulkSerial[]
      setSelected(new Set(found.map(s => s.id)))
      // Fetch global grade options for regrade
      if (found.length > 0) {
        const gradeRes  = await fetch('/api/grades')
        const gradeData = await gradeRes.json()
        setGradeOptions(gradeData.data ?? [])
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoadingLookup(false)
    }
  }

  const allSelected  = !!results?.found.length && selected.size === results.found.length
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(results?.found.map(s => s.id) ?? []))
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  const selectedSerials = results?.found.filter(s => selected.has(s.id)) ?? []
  const multiProduct    = new Set(selectedSerials.map(s => s.product.id)).size > 1
  const canRegradeSerial = someSelected && !multiProduct && !!toGradeId && !submitting

  async function handleRegradeSerials() {
    setSubmitting(true)
    setErr('')
    try {
      const res  = await fetch('/api/inventory/regrade', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'serial', serialIds: Array.from(selected), toGradeId: toGradeId || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Regrade failed')
      setSuccessMsg(`${data.regraded} unit${data.regraded !== 1 ? 's' : ''} regraded successfully.`)
      // Refresh lookup to show updated grades
      const lines = input.split('\n').map(s => s.trim()).filter(Boolean)
      const refreshRes  = await fetch('/api/serials/bulk-lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ serials: lines }),
      })
      const refreshData = await refreshRes.json()
      if (refreshRes.ok) { setResults(refreshData); setSelected(new Set()) }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Regrade failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Item mode ────────────────────────────────────────────────────────────────
  const [sku,           setSku]           = useState('')
  const [suggestions,   setSuggestions]   = useState<SimpleProduct[]>([])
  const [showDropdown,  setShowDropdown]  = useState(false)
  const [itemProduct,   setItemProduct]   = useState<SimpleProduct | null>(null)
  const [itemGrades,    setItemGrades]    = useState<SimpleGrade[]>([])
  const [skuLoading,    setSkuLoading]    = useState(false)
  const [skuErr,        setSkuErr]        = useState('')
  const [warehouseId,   setWarehouseId]   = useState('')
  const [locationId,    setLocationId]    = useState('')
  const [fromGradeId,   setFromGradeId]   = useState('')
  const [toItemGradeId, setToItemGradeId] = useState('')
  const [qtyStr,        setQtyStr]        = useState('1')
  const qtyNum    = Math.max(1, parseInt(qtyStr) || 0)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setLocationId('') }, [warehouseId])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleItemSkuChange(val: string) {
    setSku(val)
    setItemProduct(null)
    setItemGrades([])
    setFromGradeId('')
    setToItemGradeId('')
    setSkuErr('')
    setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val.trim()) { setShowDropdown(false); return }
    debounceRef.current = setTimeout(async () => {
      setSkuLoading(true)
      try {
        const res  = await fetch(`/api/products?search=${encodeURIComponent(val.trim())}`)
        const data = await res.json()
        const list: SimpleProduct[] = data.data ?? []
        setSuggestions(list)
        setShowDropdown(list.length > 0)
        const exact = list.find(p => p.sku.toLowerCase() === val.trim().toLowerCase())
        if (exact) await selectItemProduct(exact)
        else if (list.length === 0) setSkuErr('No matching SKUs found')
      } catch { setSkuErr('Lookup failed') }
      finally  { setSkuLoading(false) }
    }, 250)
  }

  async function selectItemProduct(p: SimpleProduct) {
    setSku(p.sku)
    setItemProduct(p)
    setSuggestions([])
    setShowDropdown(false)
    setSkuErr('')
    setFromGradeId('')
    setToItemGradeId('')
    try {
      const res  = await fetch('/api/grades')
      const data = await res.json()
      setItemGrades(data.data ?? [])
    } catch { setItemGrades([]) }
  }

  const filteredLocations = warehouses.find(w => w.id === warehouseId)?.locations ?? []
  const canSubmitItem = !!itemProduct && !!locationId && !!fromGradeId && !!toItemGradeId && fromGradeId !== toItemGradeId && qtyNum >= 1 && !submitting

  async function handleRegradeItem() {
    if (!canSubmitItem) return
    setSubmitting(true)
    setErr('')
    setSuccessMsg('')
    try {
      const res  = await fetch('/api/inventory/regrade', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:        'item',
          productId:   itemProduct!.id,
          locationId,
          fromGradeId: fromGradeId || null,
          toGradeId:   toItemGradeId || null,
          qty:         qtyNum,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Regrade failed')
      setSuccessMsg(`${data.regraded} unit${data.regraded !== 1 ? 's' : ''} regraded successfully.`)
      setFromGradeId('')
      setToItemGradeId('')
      setQtyStr('1')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Regrade failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[760px] max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-indigo-600" />
            <h2 className="text-sm font-semibold text-gray-900">Regrade Inventory</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b px-5 shrink-0">
          {(['serial', 'item'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setErr(''); setSuccessMsg('') }}
              className={`py-2.5 px-4 text-xs font-medium border-b-2 -mb-px transition-colors ${
                mode === m
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {m === 'serial' ? 'Serialized Units' : 'Non-Serialized (by Qty)'}
            </button>
          ))}
        </div>

        {mode === 'serial' ? (
          <>
            {/* Input area */}
            <div className="px-5 py-4 border-b shrink-0">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); setSuccessMsg('') }}
                placeholder={"Scan or paste serial numbers, one per line…\nSN001\nSN002"}
                rows={4}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">
                  {input.split('\n').filter(s => s.trim()).length} serial{input.split('\n').filter(s => s.trim()).length !== 1 ? 's' : ''} entered
                </span>
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => { setInput(''); setResults(null); setSelected(new Set()); setErr(''); setSuccessMsg('') }}
                    className="h-8 px-3 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
                    Clear
                  </button>
                  <button type="button" onClick={handleLookup} disabled={loadingLookup || !input.trim()}
                    className="h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50 flex items-center gap-1.5">
                    <Search size={13} />
                    {loadingLookup ? 'Looking up…' : 'Lookup'}
                  </button>
                </div>
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {err && <div className="px-5 pt-4"><ErrorBanner msg={err} onClose={() => setErr('')} /></div>}
              {successMsg && (
                <div className="mx-5 mt-4 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                  <span className="flex-1">{successMsg}</span>
                  <button type="button" onClick={() => setSuccessMsg('')} className="text-green-500 hover:text-green-700"><X size={13} /></button>
                </div>
              )}
              {!results && !err && !loadingLookup && (
                <div className="py-16 text-center">
                  <Tag size={32} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400">Enter serial numbers above and click Lookup</p>
                </div>
              )}
              {results && (
                <div className="px-5 py-4 space-y-3">
                  {results.notFound.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      <span><span className="font-semibold">Not found:</span> {results.notFound.join(', ')}</span>
                    </div>
                  )}
                  {multiProduct && someSelected && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      <span>Selected serials belong to different products. Regrade one product at a time.</span>
                    </div>
                  )}
                  {results.found.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No serialized inventory found for the entered serial numbers.</p>
                  ) : (
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-3 py-2.5 w-10">
                              <button type="button" onClick={toggleAll} className="flex items-center justify-center text-gray-400 hover:text-amazon-blue">
                                {allSelected ? <CheckSquare size={15} className="text-amazon-blue" /> : <Square size={15} />}
                              </button>
                            </th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Serial #</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Current Grade</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {results.found.map(serial => {
                            const checked = selected.has(serial.id)
                            return (
                              <tr key={serial.id} onClick={() => toggleOne(serial.id)}
                                className={`cursor-pointer transition-colors ${checked ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}>
                                <td className="px-3 py-2.5 text-center">
                                  <span className={`flex items-center justify-center ${checked ? 'text-amazon-blue' : 'text-gray-300'}`}>
                                    {checked ? <CheckSquare size={15} /> : <Square size={15} />}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{serial.product.sku}</td>
                                <td className="px-3 py-2.5 font-mono text-sm text-gray-900 font-medium">{serial.serialNumber}</td>
                                <td className="px-3 py-2.5 text-gray-700">
                                  {serial.location.warehouse.name}<span className="text-gray-400 mx-1">/</span>{serial.location.name}
                                </td>
                                <td className="px-3 py-2.5">
                                  {serial.grade
                                    ? <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{serial.grade.grade}</span>
                                    : <span className="text-gray-400 text-xs">—</span>
                                  }
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Grade picker */}
                  {results.found.length > 0 && !multiProduct && gradeOptions.length > 0 && (
                    <div className="flex items-center gap-3 pt-1">
                      <label className="text-xs font-medium text-gray-600 shrink-0">Regrade selected to:</label>
                      <select value={toGradeId} onChange={e => setToGradeId(e.target.value)}
                        className="h-8 flex-1 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">Select grade…</option>
                        {gradeOptions.map(g => (
                          <option key={g.id} value={g.id}>{g.grade}{g.description ? ` — ${g.description}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {results.found.length > 0 && !multiProduct && gradeOptions.length === 0 && (
                    <p className="text-xs text-amber-600">No grades configured for this product. Add grades in the Products section first.</p>
                  )}
                </div>
              )}
            </div>

            {/* Serial mode footer */}
            <div className="px-5 py-3 border-t shrink-0 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {someSelected ? `${selected.size} unit${selected.size !== 1 ? 's' : ''} selected` : 'No units selected'}
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose}
                  className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                  Close
                </button>
                <button type="button" onClick={handleRegradeSerials} disabled={!canRegradeSerial}
                  className="h-8 px-4 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                  <Tag size={13} />
                  {submitting ? 'Regrading…' : `Regrade ${someSelected ? selected.size : ''} Unit${selected.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Item mode body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}
              {successMsg && (
                <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                  <span className="flex-1">{successMsg}</span>
                  <button type="button" onClick={() => setSuccessMsg('')} className="text-green-500 hover:text-green-700"><X size={13} /></button>
                </div>
              )}

              {/* SKU autocomplete */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SKU <span className="text-red-500">*</span></label>
                <div className="relative" ref={dropdownRef}>
                  <input
                    value={sku}
                    onChange={e => handleItemSkuChange(e.target.value)}
                    onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
                    placeholder="Type to search SKU…"
                    className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {skuLoading && <span className="absolute right-3 top-2.5 text-xs text-gray-400">Searching…</span>}
                  {showDropdown && suggestions.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {suggestions.map(p => (
                        <button key={p.id} type="button" onMouseDown={() => selectItemProduct(p)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                          <span className="font-mono text-xs text-gray-500 mr-2">{p.sku}</span>{p.description}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {skuErr && <p className="mt-1 text-xs text-red-600">{skuErr}</p>}
              </div>

              {/* Warehouse + Location */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse <span className="text-red-500">*</span></label>
                  <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Select…</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location <span className="text-red-500">*</span></label>
                  <select value={locationId} onChange={e => setLocationId(e.target.value)} disabled={!warehouseId}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
                    <option value="">Select…</option>
                    {filteredLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              </div>

              {/* From / To grades */}
              {itemGrades.length > 0 ? (
                <>
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">From Grade <span className="text-red-500">*</span></label>
                      <select value={fromGradeId} onChange={e => setFromGradeId(e.target.value)}
                        className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">Select…</option>
                        {itemGrades.map(g => <option key={g.id} value={g.id}>{g.grade}{g.description ? ` — ${g.description}` : ''}</option>)}
                      </select>
                    </div>
                    <div className="text-center text-gray-400 pb-2 text-lg">→</div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">To Grade <span className="text-red-500">*</span></label>
                      <select value={toItemGradeId} onChange={e => setToItemGradeId(e.target.value)}
                        className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">Select…</option>
                        {itemGrades.filter(g => g.id !== fromGradeId).map(g => (
                          <option key={g.id} value={g.id}>{g.grade}{g.description ? ` — ${g.description}` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Quantity <span className="text-red-500">*</span></label>
                    <input type="number" min={1} value={qtyStr} onChange={e => setQtyStr(e.target.value)}
                      className="w-24 h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </>
              ) : itemProduct ? (
                <p className="text-xs text-amber-600">This product has no grades configured. Add grades in the Products section first.</p>
              ) : null}
            </div>

            {/* Item mode footer */}
            <div className="px-5 py-3 border-t shrink-0 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose}
                className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Close
              </button>
              <button type="button" onClick={handleRegradeItem} disabled={!canSubmitItem}
                className="h-8 px-4 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
                <Tag size={13} />
                {submitting ? 'Regrading…' : 'Regrade'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Serials Modal ────────────────────────────────────────────────────────────

function SerialsModal({
  product,
  location,
  onClose,
}: {
  product: Product
  location: Location
  onClose: () => void
}) {
  const [serials, setSerials] = useState<Serial[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')
  const [copied,  setCopied]  = useState(false)

  function copySerials() {
    const text = serials.map(s => s.serialNumber).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr('')
      try {
        const res  = await fetch(`/api/inventory/serials?productId=${product.id}&locationId=${location.id}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(data.error ?? 'Failed to load')
        setSerials(data.data)
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [product.id, location.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[82vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{product.description}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono">{product.sku}</span> · {location.warehouse.name} / {location.name}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
          ) : err ? (
            <div className="px-5 py-4">
              <ErrorBanner msg={err} onClose={() => setErr('')} />
            </div>
          ) : serials.length === 0 ? (
            <div className="py-10 text-center">
              <Hash size={28} className="mx-auto text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">No serial numbers in stock at this location</p>
            </div>
          ) : (
            <div>
              <div className="px-5 pt-3 pb-2 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {serials.length} unit{serials.length !== 1 ? 's' : ''} in stock
                </p>
                <button
                  type="button"
                  onClick={copySerials}
                  className="flex items-center gap-1 text-xs text-amazon-blue hover:text-blue-700 font-medium transition-colors"
                >
                  {copied ? <><CheckCircle2 size={12} /> Copied!</> : 'Copy All'}
                </button>
              </div>

              {/* Table header */}
              <div className="border-t border-gray-100">
                <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                  <span className="w-6 shrink-0 text-right">#</span>
                  <span className="flex-1">Serial Number</span>
                  <span className="w-20 text-center">Bin</span>
                  <span className="w-24 shrink-0 text-right">Date</span>
                  <span className="w-14 shrink-0" />
                </div>
                {serials.map((s, i) => (
                  <ModalSerialRow key={s.id} serial={s} index={i} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t shrink-0 flex justify-end">
          <button type="button" onClick={onClose}
            className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Manual Add Modal ─────────────────────────────────────────────────────────

const ADD_REASONS    = ['New Stock', 'Return', 'Order Edit'] as const
const REMOVE_REASONS = ['Damaged', 'Lost', 'Theft', 'Adjustment', 'Other'] as const

function AddRemoveInventoryModal({ warehouses, onClose, onDone }: {
  warehouses: Array<{ id: string; name: string; locations: { id: string; name: string }[] }>
  onClose: () => void
  onDone:  () => void
}) {
  const [mode, setMode] = useState<'add' | 'remove'>('add')

  // ── Shared: warehouse + location ────────────────────────────────────────────
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId,  setLocationId]  = useState('')
  useEffect(() => { setLocationId('') }, [warehouseId])
  const filteredLocations = warehouses.find(w => w.id === warehouseId)?.locations ?? []

  // ── ADD tab state ────────────────────────────────────────────────────────────
  const [sku,          setSku]          = useState('')
  const [suggestions,  setSuggestions]  = useState<SimpleProduct[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [product,      setProduct]      = useState<SimpleProduct | null>(null)
  const [skuLoading,   setSkuLoading]   = useState(false)
  const [skuErr,       setSkuErr]       = useState('')
  const [grades,       setGrades]       = useState<SimpleGrade[]>([])
  const [gradeId,      setGradeId]      = useState<string | null>(null)
  const [qtyStr,       setQtyStr]       = useState('1')
  const qty = Math.max(1, parseInt(qtyStr) || 0)
  const [addReason,    setAddReason]    = useState<string>('New Stock')
  const [serials,      setSerials]      = useState<string[]>([])
  const [bulkText,     setBulkText]     = useState('')
  const [bulkErr,      setBulkErr]      = useState('')
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addErr,        setAddErr]        = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const serialRefs  = useRef<(HTMLInputElement | null)[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (product?.isSerializable) {
      setSerials(prev => {
        const next = prev.slice(0, qty)
        while (next.length < qty) next.push('')
        return next
      })
    } else {
      setSerials([])
    }
  }, [qty, product?.isSerializable])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleSkuChange(val: string) {
    setSku(val); setProduct(null); setGrades([]); setGradeId(null)
    setSkuErr(''); setBulkText(''); setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val.trim()) { setShowDropdown(false); return }
    debounceRef.current = setTimeout(async () => {
      setSkuLoading(true)
      try {
        const res  = await fetch(`/api/products?search=${encodeURIComponent(val.trim())}`)
        const data = await res.json()
        const list: SimpleProduct[] = data.data ?? []
        setSuggestions(list); setShowDropdown(list.length > 0)
        const exact = list.find(p => p.sku.toLowerCase() === val.trim().toLowerCase())
        if (exact) { await selectProduct(exact) }
        else if (list.length === 0) setSkuErr('No matching SKUs found')
      } catch { setSkuErr('Lookup failed') }
      finally  { setSkuLoading(false) }
    }, 250)
  }

  async function selectProduct(p: SimpleProduct) {
    setSku(p.sku); setProduct(p); setSuggestions([]); setShowDropdown(false)
    setSkuErr(''); setBulkText(''); setGradeId(null)
    try {
      const res  = await fetch('/api/grades')
      const data = await res.json()
      setGrades(data.data ?? [])
    } catch { setGrades([]) }
  }

  function handleBulkChange(text: string) {
    setBulkText(text); setBulkErr('')
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
    if (lines.length && lines.length !== qty)
      setBulkErr(`${lines.length} serial${lines.length !== 1 ? 's' : ''} pasted — need exactly ${qty}`)
  }

  function confirmBulkPaste() {
    const lines = bulkText.split('\n').map(s => s.trim()).filter(Boolean)
    if (lines.length !== qty) return
    setSerials(lines); setBulkText(''); setBulkErr('')
  }

  const bulkLines = bulkText.split('\n').map(s => s.trim()).filter(Boolean)
  const bulkReady = bulkLines.length === qty

  function handleSerialKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter') { e.preventDefault(); serialRefs.current[index + 1]?.focus() }
  }

  const serialsFilled   = serials.length === qty && serials.every(s => s.trim())
  const serialsComplete = !product?.isSerializable || serialsFilled
  const [serialValidationErr, setSerialValidationErr] = useState('')
  const [serialsValidated, setSerialsValidated]       = useState(false)
  const canAdd = !!product && !!locationId && qty >= 1 && serialsComplete && !addSubmitting && (!product?.isSerializable || serialsValidated)

  const [serialsValidating, setSerialsValidating] = useState(false)

  // Auto-validate when all serials are filled
  useEffect(() => {
    setSerialsValidated(false); setSerialValidationErr('')
    if (!product?.isSerializable || !serialsFilled) return
    const timer = setTimeout(() => validateSerials(), 300)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serials, serialsFilled, product?.isSerializable])

  async function validateSerials() {
    if (!product?.isSerializable || !serialsFilled) return
    setSerialValidationErr(''); setSerialsValidating(true)
    try {
      const trimmed = serials.map(s => s.trim())
      // Check for duplicates within submission
      const unique = new Set(trimmed.map(s => s.toUpperCase()))
      if (unique.size !== trimmed.length) {
        setSerialValidationErr('Duplicate serial numbers in submission')
        setSerialsValidating(false)
        return
      }
      // Check against DB
      const res = await fetch('/api/serial-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serials: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Validation failed')
      const inStock = (data.found ?? []).filter((s: { status: string }) => s.status === 'IN_STOCK')
      if (inStock.length > 0) {
        const dupes = inStock.map((s: { serialNumber: string; sku: string }) => `${s.serialNumber} (${s.sku})`).join(', ')
        setSerialValidationErr(`Already in stock: ${dupes}`)
        setSerialsValidating(false)
        return
      }
      setSerialsValidated(true)
    } catch (e) {
      setSerialValidationErr(e instanceof Error ? e.message : 'Validation failed')
    } finally {
      setSerialsValidating(false)
    }
  }

  async function handleAdd() {
    if (!canAdd) return
    setAddSubmitting(true); setAddErr('')
    try {
      const res = await fetch('/api/inventory/manual-add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: product!.sku, locationId, qty, reason: addReason,
          ...(gradeId ? { gradeId } : {}),
          ...(product!.isSerializable ? { serials: serials.map(s => s.trim()) } : {}),
        }),
      })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? `HTTP ${res.status}`) }
      onDone(); onClose()
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'Failed to add inventory')
    } finally { setAddSubmitting(false) }
  }

  // ── REMOVE tab state ──────────────────────────────────────────────────────────
  const [removeInput,      setRemoveInput]      = useState('')
  const [removeResults,    setRemoveResults]    = useState<{ found: BulkSerial[]; notFound: string[] } | null>(null)
  const [removeLoading,    setRemoveLoading]    = useState(false)
  const [removeReason,     setRemoveReason]     = useState<string>('Damaged')
  const [removeSubmitting, setRemoveSubmitting] = useState(false)
  const [removeErr,        setRemoveErr]        = useState('')
  const [removeSuccessMsg, setRemoveSuccessMsg] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const locationSelected = !!warehouseId && !!locationId
  const serialCount      = removeInput.split('\n').filter(s => s.trim()).length

  async function handleRemoveLookup() {
    const lines = removeInput.split('\n').map(s => s.trim()).filter(Boolean)
    if (!lines.length) return
    setRemoveLoading(true); setRemoveErr(''); setRemoveSuccessMsg(''); setRemoveResults(null)
    try {
      const res  = await fetch('/api/serials/bulk-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serials: lines }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')
      const atLocation    = (data.found as BulkSerial[]).filter(s => s.location.id === locationId)
      const notAtLocation = (data.found as BulkSerial[])
        .filter(s => s.location.id !== locationId)
        .map(s => `${s.serialNumber} (at ${s.location.warehouse.name}/${s.location.name})`)
      setRemoveResults({ found: atLocation, notFound: [...data.notFound, ...notAtLocation] })
    } catch (e: unknown) {
      setRemoveErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally { setRemoveLoading(false) }
  }

  async function handleRemove() {
    if (!removeResults?.found.length) return
    setRemoveSubmitting(true); setRemoveErr('')
    try {
      const res  = await fetch('/api/inventory/manual-remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, serials: removeResults.found.map(s => s.serialNumber), reason: removeReason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Remove failed')
      setRemoveSuccessMsg(`${data.removedCount} unit${data.removedCount !== 1 ? 's' : ''} removed successfully.`)
      setRemoveResults(null); setRemoveInput(''); onDone()
    } catch (e: unknown) {
      setRemoveErr(e instanceof Error ? e.message : 'Remove failed')
    } finally { setRemoveSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <Package size={15} className="text-amazon-blue" /> Add / Remove Inventory
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0 px-5">
          {(['add', 'remove'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`py-2.5 px-4 text-xs font-medium border-b-2 -mb-px transition-colors ${
                mode === m
                  ? (m === 'add' ? 'border-amazon-blue text-amazon-blue' : 'border-red-500 text-red-600')
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {m === 'add' ? 'Add Inventory' : 'Remove Inventory'}
            </button>
          ))}
        </div>

        {/* Shared: Warehouse + Location */}
        <div className="px-5 pt-4 pb-3 border-b shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse <span className="text-red-500">*</span></label>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                <option value="">— Select —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Location <span className="text-red-500">*</span></label>
              <select value={locationId} onChange={e => setLocationId(e.target.value)} disabled={!warehouseId}
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:opacity-50">
                <option value="">— Select —</option>
                {filteredLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {mode === 'add' ? (
          <>
            {/* ADD body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

              {/* SKU autocomplete */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SKU <span className="text-red-500">*</span></label>
                <div className="relative" ref={dropdownRef}>
                  <input value={sku} onChange={e => handleSkuChange(e.target.value)}
                    onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
                    placeholder="Type to search SKU…" autoComplete="off"
                    className="w-full h-8 rounded border border-gray-300 px-2 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                  {skuLoading && <RefreshCcw size={12} className="absolute right-2 top-2 animate-spin text-gray-400" />}
                  {showDropdown && suggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
                      {suggestions.map(p => (
                        <button key={p.id} type="button" onMouseDown={() => selectProduct(p)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 border-b border-gray-100 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-xs font-semibold text-gray-800 truncate">{p.sku}</p>
                            <p className="text-[10px] text-gray-500 truncate">{p.description}</p>
                          </div>
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${p.isSerializable ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                            {p.isSerializable ? 'Serial' : 'Non-serial'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {skuErr && !showDropdown && <p className="text-xs text-red-600 mt-1">{skuErr}</p>}
                {product && (
                  <div className="mt-1.5 flex items-center gap-2 p-2 rounded bg-green-50 border border-green-200">
                    <span className="text-xs text-green-700 flex-1 font-medium">{product.description}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${product.isSerializable ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                      {product.isSerializable ? 'Serialized' : 'Non-serial'}
                    </span>
                  </div>
                )}
              </div>

              {/* Grade picker */}
              {grades.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Grade</label>
                  <select value={gradeId ?? ''} onChange={e => setGradeId(e.target.value || null)}
                    className="w-full h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                    <option value="">— Select grade —</option>
                    {grades.map(g => (
                      <option key={g.id} value={g.id}>{g.grade}{g.description ? ` — ${g.description}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Qty + Reason */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Quantity <span className="text-red-500">*</span></label>
                  <input type="text" inputMode="numeric" value={qtyStr}
                    onChange={e => { if (/^\d*$/.test(e.target.value)) setQtyStr(e.target.value) }}
                    onBlur={() => { if (!qtyStr || parseInt(qtyStr) < 1) setQtyStr('1') }}
                    className="w-full h-8 rounded border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Reason <span className="text-red-500">*</span></label>
                  <select value={addReason} onChange={e => setAddReason(e.target.value)}
                    className="w-full h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amazon-blue">
                    {ADD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              {/* Serials */}
              {product?.isSerializable && qty >= 1 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                      <Hash size={11} /> Serial Numbers <span className="text-red-500">*</span>
                    </label>
                    <span className={`text-[10px] font-medium tabular-nums ${serialsFilled ? 'text-green-600' : 'text-gray-400'}`}>
                      {serials.filter(s => s.trim()).length} / {qty} entered
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <textarea value={bulkText} onChange={e => handleBulkChange(e.target.value)}
                      placeholder={`Paste ${qty} serial${qty !== 1 ? 's' : ''} here, one per line…`} rows={3}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue resize-none" />
                    <div className="flex items-center gap-2">
                      {bulkErr && <p className="text-[10px] text-amber-600 flex-1">{bulkErr}</p>}
                      {!bulkErr && bulkText && !bulkReady && <p className="text-[10px] text-gray-400 flex-1">{bulkLines.length} / {qty} serials</p>}
                      {!bulkErr && bulkReady && <p className="text-[10px] text-green-600 flex-1">{qty} serial{qty !== 1 ? 's' : ''} ready</p>}
                      <button type="button" onClick={confirmBulkPaste} disabled={!bulkReady}
                        className="shrink-0 h-6 px-3 rounded text-[10px] font-medium bg-amazon-blue text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                        Confirm
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {serials.map((sn, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 w-5 text-right shrink-0 tabular-nums">{i + 1}</span>
                        <input ref={el => { serialRefs.current[i] = el }} value={sn}
                          onChange={e => setSerials(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                          onKeyDown={e => handleSerialKeyDown(e, i)}
                          placeholder={`Serial ${i + 1}`}
                          className={`flex-1 h-7 rounded border px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue ${sn.trim() ? 'border-green-300 bg-green-50' : 'border-gray-300'}`} />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400">Tip: scan barcodes directly — Enter auto-advances to the next field.</p>
                  {serialsValidating && (
                    <div className="flex items-center gap-2 p-2 rounded bg-blue-50 border border-blue-200 text-blue-700 text-xs mt-1">
                      <RefreshCcw size={12} className="animate-spin shrink-0" /> Validating serials…
                    </div>
                  )}
                  {serialValidationErr && (
                    <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs mt-1">
                      <AlertCircle size={12} className="shrink-0 mt-0.5" />{serialValidationErr}
                    </div>
                  )}
                  {serialsValidated && (
                    <div className="flex items-center gap-2 p-2 rounded bg-green-50 border border-green-200 text-green-700 text-xs mt-1">
                      <CheckCircle2 size={12} className="shrink-0" /> All serials validated — ready to add.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ADD footer */}
            <div className="px-5 py-3 border-t shrink-0 space-y-2">
              {addErr && (
                <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />{addErr}
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={handleAdd} disabled={!canAdd}
                  className="px-3 py-1.5 text-xs bg-amazon-blue text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                  {addSubmitting ? <><RefreshCcw size={12} className="animate-spin" /> Adding…</> : <><Plus size={12} /> Add Inventory</>}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* REMOVE body */}
            <div className={`px-5 py-4 border-b shrink-0 transition-opacity ${locationSelected ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Reason <span className="text-red-500">*</span></label>
                <select value={removeReason} onChange={e => setRemoveReason(e.target.value)}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-red-400">
                  {REMOVE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Serial Numbers <span className="text-red-500">*</span></label>
              <textarea ref={textareaRef} value={removeInput}
                onChange={e => { setRemoveInput(e.target.value); setRemoveSuccessMsg(''); setRemoveResults(null) }}
                placeholder={locationSelected ? 'Scan or paste serial numbers, one per line…' : 'Select a warehouse and location above first…'}
                rows={4} disabled={!locationSelected}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-red-400 disabled:bg-gray-50" />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">{serialCount} serial{serialCount !== 1 ? 's' : ''} entered</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setRemoveInput(''); setRemoveResults(null); setRemoveErr(''); setRemoveSuccessMsg('') }}
                    disabled={!removeInput.trim()}
                    className="h-8 px-3 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">Clear</button>
                  <button type="button" onClick={handleRemoveLookup}
                    disabled={removeLoading || !removeInput.trim() || !locationSelected}
                    className="h-8 px-3 rounded bg-gray-800 text-white text-xs font-medium hover:bg-gray-900 disabled:opacity-50 flex items-center gap-1.5">
                    <Search size={12} />{removeLoading ? 'Looking up…' : 'Lookup'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {removeErr && <div className="px-5 pt-4"><ErrorBanner msg={removeErr} onClose={() => setRemoveErr('')} /></div>}
              {removeSuccessMsg && (
                <div className="mx-5 mt-4 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                  <span className="flex-1">{removeSuccessMsg}</span>
                  <button type="button" onClick={() => setRemoveSuccessMsg('')} className="text-green-500 hover:text-green-700"><X size={13} /></button>
                </div>
              )}
              {!removeResults && !removeErr && !removeLoading && (
                <div className="py-12 text-center">
                  <Package size={24} className="mx-auto text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">{locationSelected ? 'Enter serial numbers above and click Lookup' : 'Select a location first'}</p>
                </div>
              )}
              {removeResults && (
                <div className="px-5 py-4 space-y-3">
                  {removeResults.notFound.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      <span><span className="font-semibold">Not found at this location:</span> {removeResults.notFound.join(', ')}</span>
                    </div>
                  )}
                  {removeResults.found.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No IN_STOCK serials found at this location.</p>
                  ) : (
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-red-50 border-b border-gray-200">
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Serial #</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Grade</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {removeResults.found.map(serial => (
                            <tr key={serial.id} className="bg-red-50/30">
                              <td className="px-3 py-2 font-mono text-gray-600">{serial.product.sku}</td>
                              <td className="px-3 py-2 font-mono font-medium text-gray-900">{serial.serialNumber}</td>
                              <td className="px-3 py-2">
                                {serial.grade
                                  ? <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{serial.grade.grade}</span>
                                  : <span className="text-gray-400">—</span>}
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

            {/* REMOVE footer */}
            <div className="px-5 py-3 border-t shrink-0 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {removeResults?.found.length
                  ? <span className="text-red-600 font-medium">{removeResults.found.length} unit{removeResults.found.length !== 1 ? 's' : ''} will be removed</span>
                  : 'No units to remove'
                }
              </p>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={handleRemove} disabled={!removeResults?.found.length || removeSubmitting}
                  className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
                  {removeSubmitting
                    ? <><RefreshCcw size={12} className="animate-spin" /> Removing…</>
                    : `Remove ${removeResults?.found.length ?? ''} Unit${(removeResults?.found.length ?? 0) !== 1 ? 's' : ''}`
                  }
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// ─── Main Component ───────────────────────────────────────────────────────────

type OpenModal = 'add' | 'sn-lookup' | 'move' | 'convert' | 'regrade'

export default function InventoryView({ openModal }: { openModal?: OpenModal } = {}) {
  const router = useRouter()
  const [items,        setItems]        = useState<InventoryItem[]>([])
  const [warehouses,   setWarehouses]   = useState<(Warehouse & { locations: { id: string; name: string }[] })[]>([])
  const [loading,      setLoading]      = useState(true)
  const [err,          setErr]          = useState('')
  const [warehouseId,  setWarehouseId]  = useState('')
  const [locationId,   setLocationId]   = useState('')
  const [search,       setSearch]       = useState('')
  const [serialTarget,  setSerialTarget]  = useState<{ product: Product; location: Location } | null>(null)
  const [showLookup,    setShowLookup]    = useState(false)
  const [showMove,      setShowMove]      = useState(false)
  const [showConvert,   setShowConvert]   = useState(false)
  const [showInventory, setShowInventory] = useState(false)
  const [showRegrade,   setShowRegrade]   = useState(false)

  // Sort state
  type SortKey = 'sku' | 'description' | 'grade' | 'warehouse' | 'location' | 'type' | 'onHand' | 'reserved' | 'available' | 'value'
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedItems = useMemo(() => {
    if (!sortKey) return items
    const sorted = [...items]
    const dir = sortDir === 'asc' ? 1 : -1
    sorted.sort((a, b) => {
      let av: string | number, bv: string | number
      switch (sortKey) {
        case 'sku':         av = a.product.sku; bv = b.product.sku; break
        case 'description': av = a.product.description; bv = b.product.description; break
        case 'grade':       av = a.grade?.grade ?? ''; bv = b.grade?.grade ?? ''; break
        case 'warehouse':   av = a.location.warehouse.name; bv = b.location.warehouse.name; break
        case 'location':    av = a.location.name; bv = b.location.name; break
        case 'type':        av = a.product.isSerializable ? 1 : 0; bv = b.product.isSerializable ? 1 : 0; break
        case 'onHand':      av = a.onHand; bv = b.onHand; break
        case 'reserved':    av = a.reserved; bv = b.reserved; break
        case 'available':   av = a.qty; bv = b.qty; break
        case 'value':       av = (a.unitCost ?? 0) * a.onHand; bv = (b.unitCost ?? 0) * b.onHand; break
        default:            return 0
      }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir
      return ((av as number) - (bv as number)) * dir
    })
    return sorted
  }, [items, sortKey, sortDir])

  // Auto-open modal when navigating to a sub-route
  useEffect(() => {
    if (openModal === 'add')        setShowInventory(true)
    else if (openModal === 'sn-lookup') setShowLookup(true)
    else if (openModal === 'move')  setShowMove(true)
    else if (openModal === 'convert') setShowConvert(true)
    else if (openModal === 'regrade') setShowRegrade(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetch('/api/warehouses')
      .then(r => r.json())
      .then(d => setWarehouses(d.data ?? []))
      .catch(() => {})
  }, [])


  useEffect(() => { setLocationId('') }, [warehouseId])

  const filteredLocations = warehouses.find(w => w.id === warehouseId)?.locations ?? []

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams()
      if (warehouseId) params.set('warehouseId', warehouseId)
      if (locationId)  params.set('locationId',  locationId)
      if (search)      params.set('search',       search)
      const res  = await fetch(`/api/inventory?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setItems(data.data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [warehouseId, locationId, search])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  const totalOnHand    = items.reduce((s, i) => s + i.onHand, 0)
  const totalReserved  = items.reduce((s, i) => s + i.reserved, 0)
  const totalAvailable = items.reduce((s, i) => s + i.qty, 0)

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={warehouseId}
          onChange={e => setWarehouseId(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          <option value="">All warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>

        <select
          value={locationId}
          onChange={e => setLocationId(e.target.value)}
          disabled={!warehouseId}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">All locations</option>
          {filteredLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search product or SKU…"
          className="h-9 w-56 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        />

        {items.length > 0 && (
          <span className="text-xs text-gray-400">
            {items.length} SKU{items.length !== 1 ? 's' : ''} ·{' '}
            <span className="font-medium text-gray-600">{totalOnHand.toLocaleString()} on hand</span>
            {totalReserved > 0 && (
              <> · <span className="text-amber-600">{totalReserved.toLocaleString()} reserved</span> · {totalAvailable.toLocaleString()} available</>
            )}
          </span>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setShowInventory(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={14} />
          Add / Remove Inventory
        </button>

        <button
          type="button"
          onClick={() => setShowConvert(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <Tag size={14} className="text-gray-500" />
          Convert SKU
        </button>

        <button
          type="button"
          onClick={() => setShowMove(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <ArrowRightLeft size={14} className="text-gray-500" />
          Move Inventory
        </button>

        <button
          type="button"
          onClick={() => setShowRegrade(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <Tag size={14} className="text-indigo-500" />
          Regrade
        </button>

        <button
          type="button"
          onClick={() => setShowLookup(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <Search size={14} className="text-gray-500" />
          SN Lookup
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center">
          <Package size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">No inventory found</p>
          {(warehouseId || locationId || search) && (
            <button type="button" onClick={() => { setWarehouseId(''); setLocationId(''); setSearch('') }}
              className="mt-3 text-sm text-amazon-blue hover:underline">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {([
                  ['sku', 'SKU', 'text-left'],
                  ['description', 'Description', 'text-left'],
                  ['grade', 'Grade', 'text-left'],
                  ['warehouse', 'Warehouse', 'text-left'],
                  ['location', 'Location', 'text-left'],
                  ['type', 'Type', 'text-center'],
                  ['onHand', 'On Hand', 'text-right'],
                  ['reserved', 'Reserved', 'text-right'],
                  ['available', 'Available', 'text-right'],
                  ['value', 'Value', 'text-right'],
                ] as [SortKey, string, string][]).map(([key, label, align]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className={`px-2 py-1.5 ${align} text-[10px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 transition-colors`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {label}
                      {sortKey === key
                        ? sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
                        : <ChevronsUpDown size={10} className="text-gray-300" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedItems.map(item => {
                const value = item.unitCost != null ? item.onHand * item.unitCost : null
                return (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1 font-mono text-xs font-semibold text-gray-900 whitespace-nowrap">{item.product.sku}</td>
                  <td className="px-2 py-1 text-gray-600 truncate max-w-[200px]">{item.product.description}</td>
                  <td className="px-2 py-1">
                    {item.grade ? (
                      <span className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[10px] font-semibold">
                        {item.grade.grade}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{item.location.warehouse.name}</td>
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{item.location.name}</td>
                  <td className="px-2 py-1 text-center">
                    {item.product.isSerializable
                      ? <span title="Serialized"><Barcode size={14} className="inline text-purple-600" /></span>
                      : <span className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500">Non-serial</span>}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {item.product.isSerializable ? (
                      <button
                        type="button"
                        onClick={() => setSerialTarget({ product: item.product, location: item.location })}
                        className="font-semibold text-amazon-blue hover:underline tabular-nums"
                      >
                        {item.onHand}
                      </button>
                    ) : (
                      <span className="font-semibold text-gray-900 tabular-nums">{item.onHand}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {item.reserved > 0 ? (
                      <span className="font-medium text-amber-600">{item.reserved}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-900 tabular-nums">
                    {item.qty}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-700 whitespace-nowrap">
                    {value != null ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {serialTarget && (
        <SerialsModal
          product={serialTarget.product}
          location={serialTarget.location}
          onClose={() => setSerialTarget(null)}
        />
      )}

      {showConvert && (
        <SKUConvertModal onClose={() => { setShowConvert(false); if (openModal === 'convert') router.replace('/inventory') }} />
      )}

      {showMove && (
        <MoveInventoryModal onClose={() => { setShowMove(false); if (openModal === 'move') router.replace('/inventory') }} />
      )}

      {showRegrade && (
        <RegradeModal
          warehouses={warehouses}
          onClose={() => { setShowRegrade(false); if (openModal === 'regrade') router.replace('/inventory') }}
        />
      )}

      {showLookup && (
        <SNLookupModal onClose={() => { setShowLookup(false); if (openModal === 'sn-lookup') router.replace('/inventory') }} />
      )}

      {showInventory && (
        <AddRemoveInventoryModal
          warehouses={warehouses}
          onClose={() => { setShowInventory(false); if (openModal === 'add') router.replace('/inventory') }}
          onDone={() => load()}
        />
      )}
    </div>
  )
}

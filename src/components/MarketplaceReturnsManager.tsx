'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X, Search, CheckCircle2, RotateCcw, Package, ChevronDown, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type RMAStatus = 'OPEN' | 'RECEIVED'

interface RMASerial {
  id: string
  serialNumber: string
  inventorySerialId: string | null
  receivedAt: string | null
  locationId: string | null
  gradeId: string | null
  note: string | null
  location?: { id: string; name: string; warehouse: { id: string; name: string } } | null
  grade?: { id: string; grade: string } | null
  inventorySerial?: { gradeId: string | null; grade: { id: string; grade: string } | null } | null
}

interface RMAItem {
  id: string
  orderItemId: string
  productId: string | null
  sellerSku: string | null
  asin: string | null
  title: string | null
  quantityReturned: number
  returnReason: string | null
  product?: { id: string; sku: string; description: string; isSerializable: boolean } | null
  orderItem?: { id: string; quantityOrdered: number; sellerSku: string | null; title: string | null }
  serials: RMASerial[]
}

interface MarketplaceRMA {
  id: string
  rmaNumber: string
  status: RMAStatus
  notes: string | null
  createdAt: string
  updatedAt: string
  order: {
    id: string
    olmNumber: number | null
    amazonOrderId: string
    orderSource: string
    shipToName: string | null
    shipToCity?: string | null
    shipToState?: string | null
  }
  items: RMAItem[]
}

interface OrderSearchResult {
  id: string
  olmNumber: number | null
  amazonOrderId: string
  orderSource: string
  shipToName: string | null
  shipToCity: string | null
  shipToState: string | null
  purchaseDate: string
  items: Array<{
    id: string
    orderItemId: string
    asin: string | null
    sellerSku: string | null
    title: string | null
    quantityOrdered: number
    quantityShipped: number
    serialAssignments: Array<{
      inventorySerial: {
        id: string
        serialNumber: string
        productId: string
        product: { id: string; sku: string; description: string; isSerializable: boolean }
        grade: { id: string; grade: string } | null
      }
    }>
  }>
}

interface Warehouse { id: string; name: string; locations: Location[] }
interface Location { id: string; name: string; warehouseId: string }
interface Grade { id: string; grade: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RMAStatus, string> = {
  OPEN: 'Open',
  RECEIVED: 'Received',
}
const STATUS_COLOR: Record<RMAStatus, string> = {
  OPEN: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
}
const SOURCE_COLOR: Record<string, string> = {
  amazon: 'bg-orange-100 text-orange-700',
  backmarket: 'bg-blue-100 text-blue-700',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarketplaceReturnsManager() {
  const [rmas, setRmas] = useState<MarketplaceRMA[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | RMAStatus>('')

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Modals
  const [showOrderSearch, setShowOrderSearch] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<OrderSearchResult | null>(null)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receiveRmaId, setReceiveRmaId] = useState<string | null>(null)
  const [deletingRmaId, setDeletingRmaId] = useState<string | null>(null)

  // ─── Fetch RMA List ───────────────────────────────────────────────────────
  const fetchRmas = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/marketplace-rma?${params}`)
      const json = await res.json()
      setRmas(json.data ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [search, statusFilter])

  useEffect(() => { fetchRmas() }, [fetchRmas])

  // ─── Open Receive/Detail ──────────────────────────────────────────────────
  function handleRowClick(rma: MarketplaceRMA) {
    setReceiveRmaId(rma.id)
    setShowReceiveModal(true)
  }

  // ─── After create/receive ─────────────────────────────────────────────────
  function handleCreated() {
    setSelectedOrder(null)
    setShowOrderSearch(false)
    fetchRmas()
  }

  function handleReceived() {
    setShowReceiveModal(false)
    setReceiveRmaId(null)
    fetchRmas()
  }

  async function handleDeleteRma(rmaId: string) {
    try {
      const res = await fetch(`/api/marketplace-rma/${rmaId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Delete failed' }))
        alert(json.error ?? 'Failed to delete return')
        return
      }
      setDeletingRmaId(null)
      fetchRmas()
    } catch {
      alert('Failed to delete return')
    }
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search RMA #, customer, order..."
            className="h-9 pl-8 pr-3 w-64 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | RMAStatus)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="RECEIVED">Received</option>
        </select>

        {rmas.length > 0 && (
          <span className="text-xs text-gray-400">
            {rmas.length} return{rmas.length !== 1 ? 's' : ''}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setShowOrderSearch(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <Plus size={14} /> New Return
        </button>
      </div>

      {/* Table or empty state */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
      ) : rmas.length === 0 ? (
        <div className="py-20 text-center">
          <RotateCcw size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">
            {search || statusFilter ? 'No returns match your filters' : 'No marketplace returns yet'}
          </p>
          {!search && !statusFilter && (
            <button onClick={() => setShowOrderSearch(true)} className="mt-3 text-sm text-amazon-blue hover:underline">
              Create your first return
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-8 px-2 py-3"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">MP-RMA #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">OLM #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Marketplace Order</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rmas.map((rma) => {
                const isExpanded = expandedId === rma.id
                return (
                  <React.Fragment key={rma.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : rma.id)}
                      className="group hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-2 py-3 text-gray-400">
                        <ChevronDown size={14} className={clsx('transition-transform', isExpanded && 'rotate-180')} />
                      </td>
                      <td className="px-4 py-3 font-semibold whitespace-nowrap">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRowClick(rma) }}
                          className="text-amazon-blue hover:underline"
                        >
                          {rma.rmaNumber}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{rma.order.olmNumber ? `#${rma.order.olmNumber}` : '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{rma.order.amazonOrderId}</td>
                      <td className="px-4 py-3 text-gray-700">{rma.order.shipToName ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', SOURCE_COLOR[rma.order.orderSource] ?? 'bg-gray-100 text-gray-600')}>
                          {rma.order.orderSource}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_COLOR[rma.status])}>
                          {STATUS_LABEL[rma.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {new Date(rma.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm">{rma.items.reduce((sum, i) => sum + i.quantityReturned, 0)}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="bg-gray-50/70 px-6 py-4">
                          {rma.notes && (
                            <p className="text-xs text-gray-500 mb-3"><span className="font-semibold text-gray-600">Notes:</span> {rma.notes}</p>
                          )}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400 uppercase tracking-wider">
                                <th className="pb-2 pr-4 font-semibold">SKU</th>
                                <th className="pb-2 pr-4 font-semibold">Title</th>
                                <th className="pb-2 pr-4 font-semibold">Serial #</th>
                                <th className="pb-2 pr-4 font-semibold">Return Reason</th>
                                <th className="pb-2 pr-4 font-semibold">Received</th>
                                <th className="pb-2 pr-4 font-semibold">Location</th>
                                <th className="pb-2 pr-4 font-semibold">Grade</th>
                                <th className="pb-2 font-semibold">Note</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {rma.items.map((item) =>
                                item.serials.length > 0
                                  ? item.serials.map((s) => (
                                      <tr key={s.id}>
                                        <td className="py-1.5 pr-4 text-gray-700 font-medium">{item.sellerSku ?? '—'}</td>
                                        <td className="py-1.5 pr-4 text-gray-600 max-w-[200px] truncate">{item.title ?? '—'}</td>
                                        <td className="py-1.5 pr-4 font-mono text-gray-900">{s.serialNumber}</td>
                                        <td className="py-1.5 pr-4 text-gray-600">{item.returnReason ?? '—'}</td>
                                        <td className="py-1.5 pr-4">
                                          {s.receivedAt ? (
                                            <span className="inline-flex items-center gap-1 text-green-600">
                                              <CheckCircle2 size={12} />
                                              {new Date(s.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            </span>
                                          ) : (
                                            <span className="text-yellow-600">Pending</span>
                                          )}
                                        </td>
                                        <td className="py-1.5 pr-4 text-gray-600">
                                          {s.location ? `${s.location.warehouse.name} / ${s.location.name}` : '—'}
                                        </td>
                                        <td className="py-1.5 pr-4 text-gray-600">{s.grade?.grade ?? '—'}</td>
                                        <td className="py-1.5 text-gray-500">{s.note ?? '—'}</td>
                                      </tr>
                                    ))
                                  : (
                                      <tr key={item.id}>
                                        <td className="py-1.5 pr-4 text-gray-700 font-medium">{item.sellerSku ?? '—'}</td>
                                        <td className="py-1.5 pr-4 text-gray-600 max-w-[200px] truncate">{item.title ?? '—'}</td>
                                        <td className="py-1.5 pr-4 text-gray-400">—</td>
                                        <td className="py-1.5 pr-4 text-gray-600">{item.returnReason ?? '—'}</td>
                                        <td className="py-1.5 pr-4 text-gray-600">Qty: {item.quantityReturned}</td>
                                        <td className="py-1.5 pr-4 text-gray-400">—</td>
                                        <td className="py-1.5 pr-4 text-gray-400">—</td>
                                        <td className="py-1.5 text-gray-400">—</td>
                                      </tr>
                                    ),
                              )}
                            </tbody>
                          </table>
                          {rma.status === 'OPEN' && (
                            <div className="mt-3 flex items-center gap-3">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRowClick(rma) }}
                                className="text-xs font-medium text-amazon-blue hover:underline"
                              >
                                Receive Returns
                              </button>
                              {deletingRmaId === rma.id ? (
                                <span className="inline-flex items-center gap-1.5 text-xs">
                                  <span className="text-red-600 font-medium">Delete this return?</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteRma(rma.id) }}
                                    className="text-xs font-semibold text-red-600 hover:text-red-800"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setDeletingRmaId(null) }}
                                    className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                                  >
                                    No
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeletingRmaId(rma.id) }}
                                  className="text-xs font-medium text-red-500 hover:text-red-700 inline-flex items-center gap-0.5"
                                  title="Delete this return"
                                >
                                  <Trash2 size={11} /> Delete
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Order Search Modal */}
      {showOrderSearch && !selectedOrder && (
        <OrderSearchModal
          onClose={() => setShowOrderSearch(false)}
          onSelect={(order) => setSelectedOrder(order)}
        />
      )}

      {/* Create Return Modal */}
      {selectedOrder && (
        <CreateReturnModal
          order={selectedOrder}
          onClose={() => { setSelectedOrder(null); setShowOrderSearch(false) }}
          onCreated={handleCreated}
        />
      )}

      {/* Receive Modal */}
      {showReceiveModal && receiveRmaId && (
        <ReceiveReturnModal
          rmaId={receiveRmaId}
          onClose={() => { setShowReceiveModal(false); setReceiveRmaId(null) }}
          onReceived={handleReceived}
        />
      )}
    </div>
  )
}

// ─── Order Search Modal ─────────────────────────────────────────────────────

function OrderSearchModal({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect: (order: OrderSearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OrderSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/marketplace-rma/order-search?q=${encodeURIComponent(query.trim())}`)
        const json = await res.json()
        setResults(json.data ?? [])
      } catch { /* ignore */ }
      setSearching(false)
    }, 400)
    return () => clearTimeout(timerRef.current)
  }, [query])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Find Shipped Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="px-6 py-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by customer name, OLM #, or marketplace order ID..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amazon-blue focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
          {searching && <p className="text-center text-gray-400 text-sm py-4">Searching...</p>}
          {!searching && query && results.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-4">No shipped orders found</p>
          )}
          {results.map((order) => (
            <button
              key={order.id}
              onClick={() => onSelect(order)}
              className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-amazon-blue hover:bg-blue-50/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {order.olmNumber && (
                    <span className="font-semibold text-gray-900">OLM-{order.olmNumber}</span>
                  )}
                  <span className="font-mono text-xs text-gray-500">{order.amazonOrderId}</span>
                </div>
                <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize', SOURCE_COLOR[order.orderSource] ?? 'bg-gray-100 text-gray-600')}>
                  {order.orderSource}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span>{order.shipToName}</span>
                {(order.shipToCity || order.shipToState) && (
                  <span className="text-gray-400">
                    {[order.shipToCity, order.shipToState].filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {order.items.length} item{order.items.length !== 1 ? 's' : ''} &middot; {new Date(order.purchaseDate).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Create Return Modal ────────────────────────────────────────────────────

function CreateReturnModal({
  order,
  onClose,
  onCreated,
}: {
  order: OrderSearchResult
  onClose: () => void
  onCreated: () => void
}) {
  // Step 1: select returns, Step 2: receive returns
  const [step, setStep] = useState<1 | 2>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdRma, setCreatedRma] = useState<MarketplaceRMA | null>(null)

  // Step 1 state: selections
  const [selectedSerials, setSelectedSerials] = useState<Set<string>>(new Set())
  const [nonSerialQtys, setNonSerialQtys] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [returnReasons, setReturnReasons] = useState<Array<{ id: string; label: string }>>([])
  // Return reason per order item id
  const [itemReasons, setItemReasons] = useState<Record<string, string>>({})

  // Fetch return reasons
  useEffect(() => {
    fetch('/api/rma-return-reasons')
      .then(r => r.json())
      .then(j => setReturnReasons(j.data ?? []))
      .catch(() => {})
  }, [])

  // Step 2 state: receiving info
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [serialReceive, setSerialReceive] = useState<Record<string, {
    warehouseId: string; locationId: string; gradeId: string; note: string
  }>>({})
  const [nonSerialReceive, setNonSerialReceive] = useState<Record<string, {
    warehouseId: string; locationId: string; gradeId: string
  }>>({})
  const [globalGrades, setGlobalGrades] = useState<Grade[]>([])
  const [receiving, setReceiving] = useState(false)

  // Fetch warehouses + grades when step 2
  useEffect(() => {
    if (step !== 2) return
    Promise.all([
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/grades').then(r => r.json()),
    ]).then(([whJson, grJson]) => {
      setWarehouses(whJson.data ?? whJson ?? [])
      setGlobalGrades(grJson.data ?? [])
    }).catch(() => {})
  }, [step])

  // Collect all items with serials and non-serial items
  const serializedItems: Array<{
    orderItem: OrderSearchResult['items'][0]
    serial: OrderSearchResult['items'][0]['serialAssignments'][0]['inventorySerial']
  }> = []
  const nonSerializedItems: OrderSearchResult['items'][0][] = []

  for (const item of order.items) {
    if (item.serialAssignments.length > 0) {
      for (const sa of item.serialAssignments) {
        serializedItems.push({ orderItem: item, serial: sa.inventorySerial })
      }
    } else {
      nonSerializedItems.push(item)
    }
  }

  const hasSelection = selectedSerials.size > 0 || Object.values(nonSerialQtys).some(q => q > 0)

  // ─── Step 1: Create RMA ─────────────────────────────────────────────────
  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      const items: Array<{
        orderItemId: string
        productId?: string
        sellerSku?: string
        asin?: string
        title?: string
        quantityReturned: number
        returnReason?: string
        serials?: Array<{ serialNumber: string; inventorySerialId: string }>
      }> = []

      // Group selected serials by orderItem
      const serialsByItem = new Map<string, typeof serializedItems>()
      for (const si of serializedItems) {
        if (!selectedSerials.has(si.serial.id)) continue
        const group = serialsByItem.get(si.orderItem.id) ?? []
        group.push(si)
        serialsByItem.set(si.orderItem.id, group)
      }

      Array.from(serialsByItem.entries()).forEach(([orderItemId, group]) => {
        const first = group[0]
        items.push({
          orderItemId,
          productId: first.serial.product.id,
          sellerSku: first.orderItem.sellerSku ?? undefined,
          asin: first.orderItem.asin ?? undefined,
          title: first.orderItem.title ?? undefined,
          quantityReturned: group.length,
          returnReason: itemReasons[orderItemId] || undefined,
          serials: group.map((g: typeof serializedItems[0]) => ({
            serialNumber: g.serial.serialNumber,
            inventorySerialId: g.serial.id,
          })),
        })
      })

      // Non-serial items
      for (const item of nonSerializedItems) {
        const qty = nonSerialQtys[item.id] ?? 0
        if (qty <= 0) continue
        items.push({
          orderItemId: item.id,
          sellerSku: item.sellerSku ?? undefined,
          asin: item.asin ?? undefined,
          title: item.title ?? undefined,
          quantityReturned: qty,
          returnReason: itemReasons[item.id] || undefined,
        })
      }

      const res = await fetch('/api/marketplace-rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, notes: notes.trim() || undefined, items }),
      })

      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to create RMA')
      }

      const rma = await res.json()
      setCreatedRma(rma)

      // Initialize step 2 state — default grade to the serial's shipped grade
      const gradeBySerialId = new Map<string, string>()
      for (const si of serializedItems) {
        if (si.serial.gradeId) gradeBySerialId.set(si.serial.id, si.serial.gradeId)
      }
      const serialRec: typeof serialReceive = {}
      for (const item of rma.items ?? []) {
        for (const s of item.serials ?? []) {
          const shippedGradeId = s.inventorySerialId ? (gradeBySerialId.get(s.inventorySerialId) ?? '') : ''
          serialRec[s.id] = { warehouseId: '', locationId: '', gradeId: shippedGradeId, note: '' }
        }
      }
      setSerialReceive(serialRec)

      // Non-serial receive state
      const nsRec: typeof nonSerialReceive = {}
      for (const item of rma.items ?? []) {
        if ((item.serials ?? []).length === 0) {
          nsRec[item.id] = { warehouseId: '', locationId: '', gradeId: '' }
        }
      }
      setNonSerialReceive(nsRec)

      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setSaving(false)
  }

  // ─── Step 2: Receive Returns ────────────────────────────────────────────
  const allSerialsReady = Object.values(serialReceive).every(s => s.locationId)
  const allNonSerialsReady = Object.values(nonSerialReceive).every(s => s.locationId)
  const canReceive = allSerialsReady && allNonSerialsReady && !receiving

  async function handleReceive() {
    if (!createdRma) return
    setReceiving(true)
    setError('')
    try {
      const serialUpdates = Object.entries(serialReceive).map(([rmaSerialId, data]) => {
        const rmaSerial = createdRma.items.flatMap(i => i.serials).find(s => s.id === rmaSerialId)
        return {
          rmaSerialId,
          inventorySerialId: rmaSerial?.inventorySerialId ?? undefined,
          locationId: data.locationId,
          gradeId: data.gradeId || null,
          note: data.note || undefined,
        }
      })

      const nonSerialItems = Object.entries(nonSerialReceive).map(([rmaItemId, data]) => {
        const rmaItem = createdRma.items.find(i => i.id === rmaItemId)
        return {
          rmaItemId,
          productId: rmaItem?.productId ?? '',
          locationId: data.locationId,
          gradeId: data.gradeId || null,
          quantityReturned: rmaItem?.quantityReturned ?? 1,
        }
      }).filter(i => i.productId)

      const res = await fetch(`/api/marketplace-rma/${createdRma.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialUpdates, nonSerialItems: nonSerialItems.length ? nonSerialItems : undefined }),
      })

      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to receive returns')
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setReceiving(false)
  }

  // Apply to all
  const [applyAllWh, setApplyAllWh] = useState('')
  const [applyAllLoc, setApplyAllLoc] = useState('')

  function handleApplyToAll() {
    if (!applyAllWh || !applyAllLoc) return
    setSerialReceive(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], warehouseId: applyAllWh, locationId: applyAllLoc }
      }
      return next
    })
    setNonSerialReceive(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], warehouseId: applyAllWh, locationId: applyAllLoc }
      }
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {step === 1 ? 'Select Returns' : `Receive Returns — ${createdRma?.rmaNumber}`}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {order.olmNumber ? `OLM-${order.olmNumber}` : ''} {order.amazonOrderId} &middot; {order.shipToName}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Step 1: Select Returns */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Serialized items */}
            {serializedItems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Serialized Items</h3>
                <div className="space-y-2">
                  {serializedItems.map(({ orderItem, serial }) => (
                    <label
                      key={serial.id}
                      className={clsx(
                        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        selectedSerials.has(serial.id)
                          ? 'border-amazon-blue bg-blue-50/50'
                          : 'border-gray-200 hover:bg-gray-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSerials.has(serial.id)}
                        onChange={() => {
                          setSelectedSerials(prev => {
                            const next = new Set(prev)
                            next.has(serial.id) ? next.delete(serial.id) : next.add(serial.id)
                            return next
                          })
                        }}
                        className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-gray-900">{serial.serialNumber}</span>
                          <span className="text-xs text-gray-500">{serial.product.sku}</span>
                          {serial.grade && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                              {serial.grade.grade}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{orderItem.title}</p>
                      </div>
                      <select
                        value={itemReasons[orderItem.id] ?? ''}
                        onChange={(e) => {
                          e.stopPropagation()
                          setItemReasons(prev => ({ ...prev, [orderItem.id]: e.target.value }))
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="border border-gray-200 rounded px-2 py-1 text-sm shrink-0"
                      >
                        <option value="">Return reason...</option>
                        {returnReasons.map(r => (
                          <option key={r.id} value={r.label}>{r.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Non-serialized items */}
            {nonSerializedItems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Non-Serialized Items</h3>
                <div className="space-y-2">
                  {nonSerializedItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200"
                    >
                      <Package size={16} className="text-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{item.sellerSku}</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{item.title}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={itemReasons[item.id] ?? ''}
                          onChange={(e) => setItemReasons(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        >
                          <option value="">Return reason...</option>
                          {returnReasons.map(r => (
                            <option key={r.id} value={r.label}>{r.label}</option>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400">Qty:</span>
                        <select
                          value={nonSerialQtys[item.id] ?? 0}
                          onChange={(e) => setNonSerialQtys(prev => ({
                            ...prev,
                            [item.id]: parseInt(e.target.value, 10),
                          }))}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        >
                          <option value={0}>0</option>
                          {Array.from({ length: item.quantityOrdered }, (_, i) => i + 1).map(n => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400">of {item.quantityOrdered}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amazon-blue focus:border-transparent"
                placeholder="Reason for return..."
              />
            </div>
          </div>
        )}

        {/* Step 2: Receive Returns */}
        {step === 2 && createdRma && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Apply to all */}
            <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap items-end gap-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider self-center">Apply to all:</span>
              <div className="flex-1 min-w-[140px]">
                <select
                  value={applyAllWh}
                  onChange={(e) => { setApplyAllWh(e.target.value); setApplyAllLoc('') }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Warehouse...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <select
                  value={applyAllLoc}
                  onChange={(e) => setApplyAllLoc(e.target.value)}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  disabled={!applyAllWh}
                >
                  <option value="">Location...</option>
                  {warehouses.find(w => w.id === applyAllWh)?.locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleApplyToAll}
                disabled={!applyAllWh || !applyAllLoc}
                className="px-3 py-1.5 text-sm font-medium rounded bg-amazon-blue text-white disabled:opacity-40 hover:bg-amazon-blue/90 transition"
              >
                Apply
              </button>
            </div>

            {/* Serial rows */}
            {createdRma.items.filter(i => i.serials.length > 0).map(item => (
              <div key={item.id} className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  {item.sellerSku ?? item.title ?? 'Item'}
                </h3>
                {item.serials.map(serial => {
                  const state = serialReceive[serial.id] ?? { warehouseId: '', locationId: '', gradeId: '', note: '' }
                  const filteredLocs = warehouses.find(w => w.id === state.warehouseId)?.locations ?? []
                  return (
                    <div key={serial.id} className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-gray-200">
                      <span className="font-mono text-sm font-medium text-gray-900 min-w-[120px]">{serial.serialNumber}</span>
                      <select
                        value={state.warehouseId}
                        onChange={(e) => setSerialReceive(prev => ({
                          ...prev,
                          [serial.id]: { ...prev[serial.id], warehouseId: e.target.value, locationId: '' },
                        }))}
                        className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                      >
                        <option value="">Warehouse...</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <select
                        value={state.locationId}
                        onChange={(e) => setSerialReceive(prev => ({
                          ...prev,
                          [serial.id]: { ...prev[serial.id], locationId: e.target.value },
                        }))}
                        className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                        disabled={!state.warehouseId}
                      >
                        <option value="">Location...</option>
                        {filteredLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      {globalGrades.length > 0 && (
                        <select
                          value={state.gradeId}
                          onChange={(e) => setSerialReceive(prev => ({
                            ...prev,
                            [serial.id]: { ...prev[serial.id], gradeId: e.target.value },
                          }))}
                          className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[80px]"
                        >
                          <option value="">Grade...</option>
                          {globalGrades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
                        </select>
                      )}
                      <input
                        value={state.note}
                        onChange={(e) => setSerialReceive(prev => ({
                          ...prev,
                          [serial.id]: { ...prev[serial.id], note: e.target.value },
                        }))}
                        placeholder="Note..."
                        className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[100px]"
                      />
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Non-serial rows */}
            {createdRma.items.filter(i => i.serials.length === 0).map(item => {
              const state = nonSerialReceive[item.id] ?? { warehouseId: '', locationId: '', gradeId: '' }
              const filteredLocs = warehouses.find(w => w.id === state.warehouseId)?.locations ?? []
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-gray-200">
                  <div className="min-w-[120px]">
                    <span className="text-sm font-medium text-gray-900">{item.sellerSku ?? item.title}</span>
                    <span className="text-xs text-gray-400 ml-2">x{item.quantityReturned}</span>
                  </div>
                  <select
                    value={state.warehouseId}
                    onChange={(e) => setNonSerialReceive(prev => ({
                      ...prev,
                      [item.id]: { ...prev[item.id], warehouseId: e.target.value, locationId: '' },
                    }))}
                    className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                  >
                    <option value="">Warehouse...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <select
                    value={state.locationId}
                    onChange={(e) => setNonSerialReceive(prev => ({
                      ...prev,
                      [item.id]: { ...prev[item.id], locationId: e.target.value },
                    }))}
                    className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                    disabled={!state.warehouseId}
                  >
                    <option value="">Location...</option>
                    {filteredLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  {globalGrades.length > 0 && (
                    <select
                      value={state.gradeId}
                      onChange={(e) => setNonSerialReceive(prev => ({
                        ...prev,
                        [item.id]: { ...prev[item.id], gradeId: e.target.value },
                      }))}
                      className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[80px]"
                    >
                      <option value="">Grade...</option>
                      {globalGrades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition"
          >
            Cancel
          </button>
          {step === 1 && (
            <button
              onClick={handleCreate}
              disabled={!hasSelection || saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-amazon-blue rounded-lg shadow hover:bg-amazon-blue/90 disabled:opacity-40 transition"
            >
              {saving ? 'Creating...' : 'Create RMA'}
            </button>
          )}
          {step === 2 && (
            <button
              onClick={handleReceive}
              disabled={!canReceive}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg shadow hover:bg-green-700 disabled:opacity-40 transition"
            >
              <CheckCircle2 size={16} />
              {receiving ? 'Receiving...' : 'Receive'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Receive Return Modal (for existing RMAs) ──────────────────────────────

function ReceiveReturnModal({
  rmaId,
  onClose,
  onReceived,
}: {
  rmaId: string
  onClose: () => void
  onReceived: () => void
}) {
  const [rma, setRma] = useState<MarketplaceRMA | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [globalGrades, setGlobalGrades] = useState<Grade[]>([])

  const [serialReceive, setSerialReceive] = useState<Record<string, {
    warehouseId: string; locationId: string; gradeId: string; note: string
  }>>({})
  const [nonSerialReceive, setNonSerialReceive] = useState<Record<string, {
    warehouseId: string; locationId: string; gradeId: string
  }>>({})
  const [receiving, setReceiving] = useState(false)

  const [applyAllWh, setApplyAllWh] = useState('')
  const [applyAllLoc, setApplyAllLoc] = useState('')

  // Fetch RMA details, warehouses, and grades
  useEffect(() => {
    Promise.all([
      fetch(`/api/marketplace-rma/${rmaId}`).then(r => r.json()),
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/grades').then(r => r.json()),
    ]).then(([rmaJson, whJson, grJson]) => {
      const rmaData = rmaJson.data
      setRma(rmaData)
      setWarehouses(whJson.data ?? whJson ?? [])
      setGlobalGrades(grJson.data ?? [])

      if (rmaData) {
        // Init serial receive state
        const sr: typeof serialReceive = {}
        for (const item of rmaData.items) {
          for (const s of item.serials) {
            if (s.receivedAt) {
              // Already received - show existing data
              sr[s.id] = {
                warehouseId: s.location?.warehouse?.id ?? '',
                locationId: s.locationId ?? '',
                gradeId: s.gradeId ?? '',
                note: s.note ?? '',
              }
            } else {
              // Default grade to the serial's shipped grade
              const shippedGradeId = s.inventorySerial?.gradeId ?? ''
              sr[s.id] = { warehouseId: '', locationId: '', gradeId: shippedGradeId, note: '' }
            }
          }
        }
        setSerialReceive(sr)

        // Non-serial receive
        const nsr: typeof nonSerialReceive = {}
        for (const item of rmaData.items) {
          if (item.serials.length === 0) {
            nsr[item.id] = { warehouseId: '', locationId: '', gradeId: '' }
          }
        }
        setNonSerialReceive(nsr)
      }

      setLoading(false)
    }).catch(() => setLoading(false))
  }, [rmaId])

  function handleApplyToAll() {
    if (!applyAllWh || !applyAllLoc) return
    setSerialReceive(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], warehouseId: applyAllWh, locationId: applyAllLoc }
      }
      return next
    })
    setNonSerialReceive(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], warehouseId: applyAllWh, locationId: applyAllLoc }
      }
      return next
    })
  }

  const isReceived = rma?.status === 'RECEIVED'
  const allSerialsReady = Object.values(serialReceive).every(s => s.locationId)
  const allNonSerialsReady = Object.values(nonSerialReceive).every(s => s.locationId)
  const canReceive = !isReceived && allSerialsReady && allNonSerialsReady && !receiving

  async function handleReceive() {
    if (!rma) return
    setReceiving(true)
    setError('')
    try {
      const serialUpdates = Object.entries(serialReceive).map(([rmaSerialId, data]) => {
        const rmaSerial = rma.items.flatMap(i => i.serials).find(s => s.id === rmaSerialId)
        return {
          rmaSerialId,
          inventorySerialId: rmaSerial?.inventorySerialId ?? undefined,
          locationId: data.locationId,
          gradeId: data.gradeId || null,
          note: data.note || undefined,
        }
      })

      const nonSerialItems = Object.entries(nonSerialReceive).map(([rmaItemId, data]) => {
        const rmaItem = rma.items.find(i => i.id === rmaItemId)
        return {
          rmaItemId,
          productId: rmaItem?.productId ?? rmaItem?.product?.id ?? '',
          locationId: data.locationId,
          gradeId: data.gradeId || null,
          quantityReturned: rmaItem?.quantityReturned ?? 1,
        }
      }).filter(i => i.productId)

      const res = await fetch(`/api/marketplace-rma/${rma.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialUpdates, nonSerialItems: nonSerialItems.length ? nonSerialItems : undefined }),
      })

      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to receive')
      }

      onReceived()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setReceiving(false)
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl p-8 text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!rma) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl p-8 text-red-500">RMA not found</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">{rma.rmaNumber}</h2>
              <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLOR[rma.status])}>
                {STATUS_LABEL[rma.status]}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {rma.order.olmNumber ? `OLM-${rma.order.olmNumber}` : ''} {rma.order.amazonOrderId} &middot; {rma.order.shipToName}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Apply to all (only for OPEN) */}
          {!isReceived && (Object.keys(serialReceive).length > 0 || Object.keys(nonSerialReceive).length > 0) && (
            <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap items-end gap-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider self-center">Apply to all:</span>
              <select
                value={applyAllWh}
                onChange={(e) => { setApplyAllWh(e.target.value); setApplyAllLoc('') }}
                className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
              >
                <option value="">Warehouse...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select
                value={applyAllLoc}
                onChange={(e) => setApplyAllLoc(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                disabled={!applyAllWh}
              >
                <option value="">Location...</option>
                {warehouses.find(w => w.id === applyAllWh)?.locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button
                onClick={handleApplyToAll}
                disabled={!applyAllWh || !applyAllLoc}
                className="px-3 py-1.5 text-sm font-medium rounded bg-amazon-blue text-white disabled:opacity-40 hover:bg-amazon-blue/90 transition"
              >
                Apply
              </button>
            </div>
          )}

          {/* Items */}
          {rma.items.map(item => {
            const productGrades = globalGrades
            return (
              <div key={item.id} className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  {item.sellerSku ?? item.product?.sku ?? item.title ?? 'Item'}
                  {item.title && <span className="font-normal text-gray-400 ml-2">{item.title}</span>}
                </h3>
                {item.serials.length > 0 ? (
                  item.serials.map(serial => {
                    const state = serialReceive[serial.id] ?? { warehouseId: '', locationId: '', gradeId: '', note: '' }
                    const filteredLocs = warehouses.find(w => w.id === state.warehouseId)?.locations ?? []
                    return (
                      <div key={serial.id} className={clsx(
                        'flex flex-wrap items-center gap-2 p-3 rounded-lg border',
                        serial.receivedAt ? 'border-green-200 bg-green-50/30' : 'border-gray-200',
                      )}>
                        <span className="font-mono text-sm font-medium text-gray-900 min-w-[120px]">
                          {serial.serialNumber}
                          {serial.receivedAt && <CheckCircle2 size={14} className="inline ml-1 text-green-500" />}
                        </span>
                        {isReceived ? (
                          <span className="text-sm text-gray-500">
                            {serial.location?.warehouse?.name} / {serial.location?.name}
                            {serial.grade && ` (${serial.grade.grade})`}
                            {serial.note && ` — ${serial.note}`}
                          </span>
                        ) : (
                          <>
                            <select
                              value={state.warehouseId}
                              onChange={(e) => setSerialReceive(prev => ({
                                ...prev,
                                [serial.id]: { ...prev[serial.id], warehouseId: e.target.value, locationId: '' },
                              }))}
                              className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                            >
                              <option value="">Warehouse...</option>
                              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                            <select
                              value={state.locationId}
                              onChange={(e) => setSerialReceive(prev => ({
                                ...prev,
                                [serial.id]: { ...prev[serial.id], locationId: e.target.value },
                              }))}
                              className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                              disabled={!state.warehouseId}
                            >
                              <option value="">Location...</option>
                              {filteredLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                            {productGrades.length > 0 && (
                              <select
                                value={state.gradeId}
                                onChange={(e) => setSerialReceive(prev => ({
                                  ...prev,
                                  [serial.id]: { ...prev[serial.id], gradeId: e.target.value },
                                }))}
                                className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[80px]"
                              >
                                <option value="">Grade...</option>
                                {productGrades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
                              </select>
                            )}
                            <input
                              value={state.note}
                              onChange={(e) => setSerialReceive(prev => ({
                                ...prev,
                                [serial.id]: { ...prev[serial.id], note: e.target.value },
                              }))}
                              placeholder="Note..."
                              className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[100px]"
                            />
                          </>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-gray-200">
                    <div className="min-w-[120px]">
                      <span className="text-sm font-medium text-gray-900">{item.sellerSku ?? item.title}</span>
                      <span className="text-xs text-gray-400 ml-2">x{item.quantityReturned}</span>
                    </div>
                    {isReceived ? (
                      <span className="text-sm text-gray-500">Received</span>
                    ) : (
                      <>
                        {(() => {
                          const state = nonSerialReceive[item.id] ?? { warehouseId: '', locationId: '', gradeId: '' }
                          const filteredLocs = warehouses.find(w => w.id === state.warehouseId)?.locations ?? []
                          return (
                            <>
                              <select
                                value={state.warehouseId}
                                onChange={(e) => setNonSerialReceive(prev => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], warehouseId: e.target.value, locationId: '' },
                                }))}
                                className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                              >
                                <option value="">Warehouse...</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                              </select>
                              <select
                                value={state.locationId}
                                onChange={(e) => setNonSerialReceive(prev => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], locationId: e.target.value },
                                }))}
                                className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                                disabled={!state.warehouseId}
                              >
                                <option value="">Location...</option>
                                {filteredLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </select>
                              {productGrades.length > 0 && (
                                <select
                                  value={state.gradeId}
                                  onChange={(e) => setNonSerialReceive(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], gradeId: e.target.value },
                                  }))}
                                  className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[80px]"
                                >
                                  <option value="">Grade...</option>
                                  {productGrades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
                                </select>
                              )}
                            </>
                          )
                        })()}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Notes */}
          {rma.notes && (
            <div className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">Notes:</span> {rma.notes}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition">
            {isReceived ? 'Close' : 'Cancel'}
          </button>
          {!isReceived && (
            <button
              onClick={handleReceive}
              disabled={!canReceive}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg shadow hover:bg-green-700 disabled:opacity-40 transition"
            >
              <CheckCircle2 size={16} />
              {receiving ? 'Receiving...' : 'Receive'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

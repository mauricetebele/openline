'use client'
import { createPortal } from 'react-dom'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Search, Trash2, X, AlertCircle, Tags, RefreshCw, Link2, Unlink, Upload } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MskuProduct {
  id: string
  sku: string
  description: string
}

interface MskuGrade {
  id: string
  grade: string
}

interface MarketplaceSku {
  id: string
  productId: string
  product: MskuProduct
  gradeId: string | null
  grade: MskuGrade | null
  marketplace: string
  accountId: string | null
  sellerSku: string
  syncQty: boolean
}

interface MarketplaceListing {
  id: string
  marketplace: string
  sellerSku: string
  title: string | null
  accountId: string | null
  fulfillmentChannel: string | null
  lastSyncedAt: string
  mskuId: string | null
  msku: {
    id: string
    product: MskuProduct
    grade: MskuGrade | null
  } | null
}

interface ProductSearchResult {
  id: string
  sku: string
  description: string
}

interface GradeOption {
  id: string
  grade: string
}

interface QtyBreakdown {
  mskuId: string
  onHand: number
  reserved: number
  pendingOrders: number
  available: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(url: string) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiPatch(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiDelete(url: string) {
  const res = await fetch(url, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'all',         label: 'All' },
  { key: 'amazon',      label: 'Amazon' },
  { key: 'backmarket',  label: 'Back Market' },
  { key: 'wholesale',   label: 'Wholesale' },
] as const

type TabKey = typeof TABS[number]['key']

type ViewMode = 'mapped' | 'synced'

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Success Toast ────────────────────────────────────────────────────────────

function SuccessToast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-green-900">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Product Search Input ─────────────────────────────────────────────────────

function ProductSearchInput({
  selected,
  onSelect,
  onClear,
}: {
  selected: ProductSearchResult | null
  onSelect: (p: ProductSearchResult) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await apiFetch(`/api/products?search=${encodeURIComponent(query.trim())}`)
        setResults(data.data ?? [])
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (selected) {
    return (
      <div className="flex items-center gap-2 h-8 rounded border border-gray-300 bg-gray-50 px-2 text-xs">
        <span className="font-mono text-gray-700">{selected.sku}</span>
        <span className="text-gray-400 truncate flex-1">{selected.description}</span>
        <button type="button" onClick={() => { onClear(); setQuery('') }} className="text-gray-400 hover:text-gray-600">
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search products…"
          className="w-full h-8 rounded border border-gray-300 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 border border-gray-300 border-t-amazon-blue rounded-full animate-spin" />
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onSelect(p); setQuery(''); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50"
            >
              <span className="font-mono text-gray-700 shrink-0">{p.sku}</span>
              <span className="text-gray-500 truncate">{p.description}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && results.length === 0 && !loading && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-400">
          No products found
        </div>
      )}
    </div>
  )
}

// ─── Qty Badge with Portal Tooltip ───────────────────────────────────────────

function QtyBadge({ breakdown }: { breakdown: QtyBreakdown }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  function handleEnter() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ top: r.bottom + 8, left: r.left + r.width / 2 })
    }
    setHover(true)
  }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setHover(false)}
        className="inline-flex items-center justify-center font-mono text-xs font-semibold text-blue-700 bg-blue-50 rounded px-2 py-0.5 cursor-default"
      >
        {breakdown.available}
      </span>
      {hover && createPortal(
        <div
          style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
          className="fixed z-[9999]"
        >
          <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mb-1" />
          <div className="bg-gray-900 text-white text-[11px] rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
            <div className="font-semibold mb-1">Qty Breakdown</div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-300">On Hand</span>
              <span className="font-mono">{breakdown.onHand}</span>
            </div>
            {breakdown.reserved > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-300">Reserved</span>
                <span className="font-mono text-yellow-300">-{breakdown.reserved}</span>
              </div>
            )}
            {breakdown.pendingOrders > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-gray-300">Pending Orders</span>
                <span className="font-mono text-red-300">-{breakdown.pendingOrders}</span>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-gray-700 mt-1 pt-1">
              <span className="text-gray-300">Available</span>
              <span className="font-mono font-bold">{breakdown.available}</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ─── Fulfillment Badge ───────────────────────────────────────────────────────

function FulfillmentBadge({ channel }: { channel: string | null }) {
  if (!channel) return null
  const isFBA = channel === 'FBA'
  return (
    <span className={clsx(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold',
      isFBA ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-600',
    )}>
      {isFBA ? 'FBA' : 'MFN'}
    </span>
  )
}

// ─── Inline Mapping Row ──────────────────────────────────────────────────────

function InlineMappingRow({
  listing,
  onMapped,
  onError,
}: {
  listing: MarketplaceListing
  onMapped: () => void
  onError: (msg: string) => void
}) {
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null)
  const [grades, setGrades] = useState<GradeOption[]>([])
  const [gradeId, setGradeId] = useState('')
  const [mapping, setMapping] = useState(false)

  // Load grades when product changes
  useEffect(() => {
    if (!selectedProduct) { setGrades([]); setGradeId(''); return }
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/api/products/${selectedProduct.id}/grades`)
        if (!cancelled) {
          setGrades((data.data ?? []).map((g: { id: string; grade: string }) => ({ id: g.id, grade: g.grade })))
          setGradeId('')
        }
      } catch {
        if (!cancelled) setGrades([])
      }
    })()
    return () => { cancelled = true }
  }, [selectedProduct])

  async function handleMap() {
    if (!selectedProduct) { onError('Select a product first'); return }
    setMapping(true)
    try {
      await apiPost('/api/marketplace-skus/map', {
        listingId: listing.id,
        productId: selectedProduct.id,
        gradeId: gradeId || null,
      })
      onMapped()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Mapping failed')
    } finally {
      setMapping(false)
    }
  }

  return (
    <tr className="hover:bg-gray-50 bg-amber-50/30">
      <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">{listing.sellerSku}</td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700">
          Unmapped
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={listing.title ?? ''}>
        {listing.title ?? '—'}
      </td>
      <td className="px-4 py-3">
        <span className={clsx(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
          listing.marketplace === 'amazon' && 'bg-orange-100 text-orange-700',
          listing.marketplace === 'backmarket' && 'bg-green-100 text-green-700',
        )}>
          {listing.marketplace === 'backmarket' ? 'Back Market' : listing.marketplace}
        </span>
      </td>
      <td className="px-4 py-3">
        <FulfillmentBadge channel={listing.fulfillmentChannel} />
      </td>
      <td className="px-4 py-3 font-mono text-xs text-gray-500">{listing.accountId ?? '—'}</td>
      {/* Inline mapping controls */}
      <td className="px-4 py-2" colSpan={2}>
        <div className="flex items-center gap-2">
          <div className="w-48">
            <ProductSearchInput
              selected={selectedProduct}
              onSelect={setSelectedProduct}
              onClear={() => setSelectedProduct(null)}
            />
          </div>
          <select
            value={gradeId}
            onChange={e => setGradeId(e.target.value)}
            disabled={!selectedProduct || grades.length === 0}
            className="h-8 w-28 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">No grade</option>
            {grades.map(g => (
              <option key={g.id} value={g.id}>{g.grade}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleMap}
            disabled={mapping || !selectedProduct}
            className="flex items-center gap-1 h-8 px-3 rounded bg-amazon-blue text-white text-xs font-medium hover:bg-amazon-blue/90 disabled:opacity-50 shrink-0"
          >
            <Link2 size={12} />
            {mapping ? 'Mapping…' : 'Map'}
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MarketplaceSkuManager() {
  const [skus, setSkus] = useState<MarketplaceSku[]>([])
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<TabKey>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('mapped')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [syncing, setSyncing] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [syncPage, setSyncPage] = useState(1)
  const SYNC_PAGE_SIZE = 100
  const [qtyMap, setQtyMap] = useState<Record<string, QtyBreakdown>>({})

  // Add form state
  const [showForm, setShowForm] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null)
  const [grades, setGrades] = useState<GradeOption[]>([])
  const [formGradeId, setFormGradeId] = useState('')
  const [formMarketplace, setFormMarketplace] = useState('amazon')
  const [formAccountId, setFormAccountId] = useState('')
  const [formSellerSku, setFormSellerSku] = useState('')
  const [adding, setAdding] = useState(false)

  const loadSkus = useCallback(async () => {
    try {
      const data = await apiFetch('/api/marketplace-skus')
      setSkus(data.data ?? [])
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [])

  const loadListings = useCallback(async () => {
    try {
      const data = await apiFetch('/api/marketplace-skus/sync')
      setListings(data.data ?? [])
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load listings')
    }
  }, [])

  const loadQtyBreakdown = useCallback(async () => {
    try {
      const data = await apiFetch('/api/marketplace-skus/qty-breakdown')
      const map: Record<string, QtyBreakdown> = {}
      for (const b of (data.data ?? []) as QtyBreakdown[]) {
        map[b.mskuId] = b
      }
      setQtyMap(map)
    } catch {
      // Non-critical — don't block the UI
    }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadSkus(), loadListings(), loadQtyBreakdown()])
    setLoading(false)
  }, [loadSkus, loadListings, loadQtyBreakdown])

  useEffect(() => { loadAll() }, [loadAll])

  // Reset synced listings page when filters change
  useEffect(() => { setSyncPage(1) }, [tab, filterText, viewMode])

  // Load grades when product changes
  useEffect(() => {
    if (!selectedProduct) { setGrades([]); setFormGradeId(''); return }
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/api/products/${selectedProduct.id}/grades`)
        if (!cancelled) {
          setGrades((data.data ?? []).map((g: { id: string; grade: string }) => ({ id: g.id, grade: g.grade })))
          setFormGradeId('')
        }
      } catch {
        if (!cancelled) setGrades([])
      }
    })()
    return () => { cancelled = true }
  }, [selectedProduct])

  async function handleSync(marketplace: 'amazon' | 'backmarket') {
    setSyncing(marketplace)
    setErr('')
    try {
      const data = await apiPost('/api/marketplace-skus/sync', { marketplace })
      setToast(`Synced ${data.synced} ${marketplace === 'backmarket' ? 'Back Market' : 'Amazon'} listings (${data.new} new)`)
      loadAll()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(null)
    }
  }

  async function handleAdd() {
    if (!selectedProduct) { setErr('Product is required'); return }
    if (!formSellerSku.trim()) { setErr('Seller SKU is required'); return }
    setAdding(true)
    setErr('')
    try {
      await apiPost('/api/marketplace-skus', {
        productId: selectedProduct.id,
        gradeId: formGradeId || null,
        marketplace: formMarketplace,
        accountId: formAccountId.trim() || null,
        sellerSku: formSellerSku.trim(),
      })
      setSelectedProduct(null)
      setFormGradeId('')
      setFormMarketplace('amazon')
      setFormAccountId('')
      setFormSellerSku('')
      setShowForm(false)
      loadAll()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await apiDelete(`/api/marketplace-skus/${id}`)
      loadAll()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleToggleSyncQty(id: string, currentValue: boolean) {
    setTogglingIds((prev) => new Set(prev).add(id))
    try {
      await apiPatch(`/api/marketplace-skus/${id}`, { syncQty: !currentValue })
      setSkus((prev) => prev.map((s) => (s.id === id ? { ...s, syncQty: !currentValue } : s)))
      // Immediately push qty for this SKU only when enabling sync
      if (!currentValue) {
        const data = await apiPost('/api/marketplace-skus/push-qty', { mskuId: id })
        const pushed = data.pushed?.[0]
        if (pushed) {
          setToast(`Pushed qty ${pushed.quantity} for ${pushed.sellerSku}`)
        }
      }
      loadQtyBreakdown()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handlePushQty() {
    setPushing(true)
    setErr('')
    try {
      const data = await apiPost('/api/marketplace-skus/push-qty', {})
      const pushCount = data.pushed?.length ?? 0
      const errCount = data.errors?.length ?? 0
      setToast(
        `Pushed quantities for ${pushCount} SKU${pushCount !== 1 ? 's' : ''}` +
        (errCount > 0 ? ` (${errCount} error${errCount !== 1 ? 's' : ''})` : ''),
      )
      loadQtyBreakdown()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Push failed')
    } finally {
      setPushing(false)
    }
  }

  // Filter mapped SKUs by tab and search
  const filteredSkus = skus.filter(s => {
    if (tab !== 'all' && s.marketplace !== tab) return false
    if (filterText.trim()) {
      const q = filterText.toLowerCase()
      return (
        s.sellerSku.toLowerCase().includes(q) ||
        s.product.sku.toLowerCase().includes(q) ||
        s.product.description.toLowerCase().includes(q) ||
        (s.grade?.grade ?? '').toLowerCase().includes(q) ||
        (s.accountId ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // Filter synced listings
  const unmappedListings = listings.filter(l => {
    if (l.mskuId) return false // already mapped
    if (tab !== 'all' && l.marketplace !== tab) return false
    if (filterText.trim()) {
      const q = filterText.toLowerCase()
      return (
        l.sellerSku.toLowerCase().includes(q) ||
        (l.title ?? '').toLowerCase().includes(q) ||
        (l.accountId ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const mappedListings = listings.filter(l => {
    if (!l.mskuId) return false
    if (tab !== 'all' && l.marketplace !== tab) return false
    if (filterText.trim()) {
      const q = filterText.toLowerCase()
      return (
        l.sellerSku.toLowerCase().includes(q) ||
        (l.title ?? '').toLowerCase().includes(q) ||
        (l.msku?.product.sku ?? '').toLowerCase().includes(q) ||
        (l.msku?.product.description ?? '').toLowerCase().includes(q) ||
        (l.accountId ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // Count per marketplace
  const counts: Record<string, number> = { all: skus.length }
  for (const s of skus) counts[s.marketplace] = (counts[s.marketplace] ?? 0) + 1

  const unmappedCount = listings.filter(l => !l.mskuId).length

  // Paginate synced listings: unmapped first, then mapped
  const allSyncedListings = [...unmappedListings, ...mappedListings]
  const syncTotalPages = Math.max(1, Math.ceil(allSyncedListings.length / SYNC_PAGE_SIZE))
  const syncPageStart = (syncPage - 1) * SYNC_PAGE_SIZE
  const syncPageEnd = syncPageStart + SYNC_PAGE_SIZE
  const pagedSyncedListings = allSyncedListings.slice(syncPageStart, syncPageEnd)

  return (
    <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Filter SKUs…"
            className="h-9 w-64 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        <div className="flex-1" />

        {/* Sync buttons */}
        <button
          type="button"
          onClick={() => handleSync('amazon')}
          disabled={syncing !== null}
          className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-orange-300 text-orange-700 text-sm font-medium hover:bg-orange-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(syncing === 'amazon' && 'animate-spin')} />
          Sync Amazon
        </button>
        <button
          type="button"
          onClick={() => handleSync('backmarket')}
          disabled={syncing !== null}
          className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-green-300 text-green-700 text-sm font-medium hover:bg-green-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(syncing === 'backmarket' && 'animate-spin')} />
          Sync Back Market
        </button>

        <button
          type="button"
          onClick={handlePushQty}
          disabled={pushing}
          className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-blue-300 text-blue-700 text-sm font-medium hover:bg-blue-50 disabled:opacity-50"
        >
          <Upload size={14} className={clsx(pushing && 'animate-pulse')} />
          {pushing ? 'Pushing…' : 'Push Quantities'}
        </button>

        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <Plus size={14} />
          Add Marketplace SKU
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}
      {toast && <SuccessToast msg={toast} onClose={() => setToast('')} />}

      {/* Add form */}
      {showForm && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_1fr_1fr] gap-3 items-end">
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-1">Product <span className="text-red-500">*</span></label>
              <ProductSearchInput
                selected={selectedProduct}
                onSelect={setSelectedProduct}
                onClear={() => setSelectedProduct(null)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-1">Grade</label>
              <select
                value={formGradeId}
                onChange={e => setFormGradeId(e.target.value)}
                disabled={!selectedProduct}
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">— No grade —</option>
                {grades.map(g => (
                  <option key={g.id} value={g.id}>{g.grade}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-1">Marketplace <span className="text-red-500">*</span></label>
              <select
                value={formMarketplace}
                onChange={e => setFormMarketplace(e.target.value)}
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              >
                <option value="amazon">Amazon</option>
                <option value="backmarket">Back Market</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-1">Account ID</label>
              <input
                type="text"
                value={formAccountId}
                onChange={e => setFormAccountId(e.target.value)}
                placeholder="optional"
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-600 mb-1">Seller SKU <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formSellerSku}
                onChange={e => setFormSellerSku(e.target.value)}
                placeholder="IP14P-128-BLK-A"
                className="w-full h-8 rounded border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-8 px-4 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding}
              className="h-8 px-4 rounded bg-amazon-blue text-white text-xs font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              {adding ? 'Adding…' : 'Add SKU'}
            </button>
          </div>
        </div>
      )}

      {/* View mode toggle + Tabs */}
      <div className="flex items-center gap-4 border-b border-gray-200">
        <div className="flex items-center gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                tab === t.key
                  ? 'border-amazon-blue text-amazon-blue'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              )}
            >
              {t.label}
              {counts[t.key] != null && (
                <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Mapped / Synced toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('mapped')}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium rounded transition-colors',
              viewMode === 'mapped'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            Mapped SKUs
          </button>
          <button
            type="button"
            onClick={() => setViewMode('synced')}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium rounded transition-colors',
              viewMode === 'synced'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            Synced Listings
            {unmappedCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                {unmappedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
      ) : viewMode === 'mapped' ? (
        /* ─── Mapped SKUs Table ─── */
        filteredSkus.length === 0 ? (
          <div className="py-20 text-center">
            <Tags size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {filterText ? 'No SKUs match your filter' : 'No marketplace SKUs yet'}
            </p>
            {!filterText && !showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-3 text-sm text-amazon-blue hover:underline"
              >
                Add your first marketplace SKU
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-visible rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Seller SKU</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Parent SKU</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Grade</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Marketplace</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Account ID</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Sync Qty</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Pushing</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSkus.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 group">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">{s.sellerSku}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{s.product.sku}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{s.grade?.grade ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px] truncate" title={s.product.description}>{s.product.description}</td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                        s.marketplace === 'amazon' && 'bg-orange-100 text-orange-700',
                        s.marketplace === 'backmarket' && 'bg-green-100 text-green-700',
                        s.marketplace === 'wholesale' && 'bg-blue-100 text-blue-700',
                      )}>
                        {s.marketplace === 'backmarket' ? 'Back Market' : s.marketplace}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.accountId ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleSyncQty(s.id, s.syncQty)}
                        disabled={togglingIds.has(s.id)}
                        className={clsx(
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amazon-blue focus:ring-offset-1 disabled:opacity-50',
                          s.syncQty ? 'bg-green-500' : 'bg-gray-300',
                        )}
                      >
                        <span
                          className={clsx(
                            'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                            s.syncQty ? 'translate-x-[18px]' : 'translate-x-[3px]',
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {s.syncQty && qtyMap[s.id] ? (
                        <QtyBadge breakdown={qtyMap[s.id]} />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-60"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* ─── Synced Listings View ─── */
        (unmappedListings.length === 0 && mappedListings.length === 0) ? (
          <div className="py-20 text-center">
            <RefreshCw size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {filterText ? 'No listings match your filter' : 'No synced listings yet'}
            </p>
            {!filterText && (
              <p className="mt-2 text-xs text-gray-400">
                Use the Sync buttons above to pull listings from Amazon or Back Market.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Seller SKU</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Title / Product</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Marketplace</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Fulfillment</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Account ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide" colSpan={2}>Mapping</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pagedSyncedListings.map(l =>
                    !l.mskuId ? (
                      <InlineMappingRow
                        key={l.id}
                        listing={l}
                        onMapped={loadAll}
                        onError={setErr}
                      />
                    ) : (
                      <tr key={l.id} className="hover:bg-gray-50 group">
                        <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">{l.sellerSku}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-700">
                            Mapped
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          <span className="font-mono text-gray-700">{l.msku?.product.sku}</span>
                          {l.msku?.grade && <span className="ml-1.5 text-gray-400">({l.msku.grade.grade})</span>}
                          <span className="ml-2 text-gray-400 truncate">{l.msku?.product.description}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                            l.marketplace === 'amazon' && 'bg-orange-100 text-orange-700',
                            l.marketplace === 'backmarket' && 'bg-green-100 text-green-700',
                          )}>
                            {l.marketplace === 'backmarket' ? 'Back Market' : l.marketplace}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <FulfillmentBadge channel={l.fulfillmentChannel} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{l.accountId ?? '—'}</td>
                        <td className="px-4 py-3" colSpan={2}>
                          <button
                            type="button"
                            onClick={() => {
                              if (l.msku) handleDelete(l.msku.id)
                            }}
                            disabled={!l.msku || deletingId === l.msku?.id}
                            className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-60"
                            title="Unlink mapping"
                          >
                            <Unlink size={13} />
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {syncTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-gray-500">
                  {syncPageStart + 1}–{Math.min(syncPageEnd, allSyncedListings.length)} of {allSyncedListings.length} listings
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSyncPage(1)}
                    disabled={syncPage === 1}
                    className="h-8 px-2 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    First
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncPage(p => Math.max(1, p - 1))}
                    disabled={syncPage === 1}
                    className="h-8 px-2 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <span className="px-3 text-xs text-gray-700">
                    Page {syncPage} of {syncTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSyncPage(p => Math.min(syncTotalPages, p + 1))}
                    disabled={syncPage === syncTotalPages}
                    className="h-8 px-2 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncPage(syncTotalPages)}
                    disabled={syncPage === syncTotalPages}
                    className="h-8 px-2 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  )
}

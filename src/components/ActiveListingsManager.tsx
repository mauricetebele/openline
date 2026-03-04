'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, RefreshCcw, Check, X, Loader2, TrendingUp } from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveListing {
  id: string
  sku: string
  asin: string | null
  productTitle: string | null
  fulfillmentChannel: string
  quantity: number
  price: string | null
  minPrice: string | null
  maxPrice: string | null
  sold24h: number
  sold3d: number
  sold7d: number
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface SyncJob {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = parseFloat(String(value))
  return isNaN(n) ? '—' : `$${n.toFixed(2)}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActiveListingsManager() {
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [accountsError, setAccountsError] = useState<string | null>(null)

  const [listings, setListings] = useState<ActiveListing[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: 50, total: 0, totalPages: 0,
  })
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [sortField, setSortField] = useState('sku')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Inline price editing
  const [editingSku, setEditingSku] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingSku, setSavingSku] = useState<string | null>(null)
  const [flashSku, setFlashSku] = useState<{ sku: string; type: 'success' | 'error' } | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Sync
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncJob | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Velocity sync
  const [syncingVelocity, setSyncingVelocity] = useState(false)
  const [velocityStatus, setVelocityStatus] = useState<string | null>(null)
  const [velocityError, setVelocityError] = useState<string | null>(null)

  const [fetchKey, setFetchKey] = useState(0)

  // ─── Load accounts ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/accounts')
      .then(async (r) => {
        if (!r.ok) {
          const json = await r.json().catch(() => ({}))
          throw new Error(json.error ?? `${r.status} ${r.statusText}`)
        }
        return r.json()
      })
      .then((data: AmazonAccountDTO[]) => {
        if (!Array.isArray(data) || data.length === 0) {
          setAccountsError('No Amazon accounts connected. Go to Connect Amazon to add one.')
          return
        }
        setAccounts(data)
        setSelectedAccountId(data[0].id)
      })
      .catch((err: Error) => setAccountsError(err.message))
  }, [])

  // Fields that are computed per-page and sorted client-side
  const CLIENT_SORT_FIELDS = new Set(['sold24h', 'sold3d', 'sold7d'])

  // ─── Fetch listings ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAccountId) return

    let cancelled = false
    setLoading(true)

    const params = new URLSearchParams({
      accountId: selectedAccountId,
      page: String(page),
      pageSize: String(pageSize),
      status: 'Active',
    })
    if (search) params.set('search', search)
    if (channelFilter) params.set('channel', channelFilter)
    // Only send server-sortable fields to the API
    if (!CLIENT_SORT_FIELDS.has(sortField)) {
      params.set('sortField', sortField)
      params.set('sortDir', sortDir)
    }

    fetch(`/api/pricing?${params}`)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error ?? `${res.status} ${res.statusText}`)
        }
        return res.json()
      })
      .then(({ data, pagination: p }) => {
        if (cancelled) return
        setListings(data)
        setPagination(p)
      })
      .catch((err) => {
        if (!cancelled) console.error('[ActiveListingsManager] fetch failed:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedAccountId, page, pageSize, search, channelFilter, sortField, sortDir, fetchKey])

  // Client-side sort for computed fields (sales velocity)
  const sortedListings = useMemo(() => {
    if (!CLIENT_SORT_FIELDS.has(sortField)) return listings
    return [...listings].sort((a, b) => {
      const key = sortField as keyof ActiveListing
      const aVal = (a[key] as number) ?? 0
      const bVal = (b[key] as number) ?? 0
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })
  }, [listings, sortField, sortDir])

  // ─── Inline price edit ─────────────────────────────────────────────────
  function startEdit(listing: ActiveListing) {
    setEditingSku(listing.sku)
    setEditValue(listing.price !== null ? parseFloat(String(listing.price)).toFixed(2) : '')
    setPriceError(null)
    setTimeout(() => editInputRef.current?.select(), 0)
  }

  function cancelEdit() {
    setEditingSku(null)
    setEditValue('')
    setPriceError(null)
  }

  async function savePrice(listing: ActiveListing) {
    const newPrice = parseFloat(editValue)
    if (isNaN(newPrice) || newPrice <= 0) {
      setPriceError('Enter a valid price')
      return
    }

    // Client-side min/max validation
    const min = listing.minPrice !== null ? parseFloat(String(listing.minPrice)) : null
    const max = listing.maxPrice !== null ? parseFloat(String(listing.maxPrice)) : null
    if (min !== null && !isNaN(min) && newPrice < min) {
      setPriceError(`Below min $${min.toFixed(2)}`)
      return
    }
    if (max !== null && !isNaN(max) && newPrice > max) {
      setPriceError(`Above max $${max.toFixed(2)}`)
      return
    }

    setSavingSku(listing.sku)
    setEditingSku(null)
    setPriceError(null)

    try {
      const res = await fetch('/api/listings/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId, sku: listing.sku, price: newPrice }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${res.status}`)

      // Update local state
      setListings((prev) =>
        prev.map((l) => l.sku === listing.sku ? { ...l, price: String(newPrice) } : l),
      )
      setFlashSku({ sku: listing.sku, type: 'success' })
    } catch (err) {
      console.error('[ActiveListingsManager] price update failed:', err)
      setFlashSku({ sku: listing.sku, type: 'error' })
    } finally {
      setSavingSku(null)
      setTimeout(() => setFlashSku(null), 2000)
    }
  }

  // ─── Sync catalog ──────────────────────────────────────────────────────
  async function startSync() {
    if (!selectedAccountId || syncing) return
    setSyncing(true)
    setSyncError(null)
    setSyncStatus(null)

    try {
      const res = await fetch('/api/listings/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `${res.status} ${res.statusText}`)
      }
      const { jobId } = await res.json()

      pollRef.current = setInterval(async () => {
        try {
          const jr = await fetch(`/api/listings/sync?jobId=${jobId}`)
          const job: SyncJob = await jr.json()
          setSyncStatus(job)
          if (job.status === 'COMPLETED' || job.status === 'FAILED') {
            clearInterval(pollRef.current!)
            pollRef.current = null
            setSyncing(false)
            if (job.status === 'COMPLETED') {
              setPage(1)
              setFetchKey((k) => k + 1)
            }
          }
        } catch { /* ignore polling errors */ }
      }, 3000)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
      setSyncing(false)
    }
  }

  // ─── Sync sales velocity ──────────────────────────────────────────────
  async function startVelocitySync() {
    if (!selectedAccountId || syncingVelocity) return
    setSyncingVelocity(true)
    setVelocityError(null)
    setVelocityStatus(null)

    try {
      const res = await fetch('/api/listings/sync-velocity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`)

      setVelocityStatus(
        `Sales synced — ${json.skusUpdated} SKUs updated, ${json.totalOrderRows} order rows processed.`,
      )
      setFetchKey((k) => k + 1)
    } catch (err) {
      setVelocityError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncingVelocity(false)
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // ─── Render ────────────────────────────────────────────────────────────

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <span className="ml-1 text-gray-300">↕</span>
    return <span className="ml-1 text-amazon-blue">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  if (accountsError) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {accountsError}
        </div>
      </div>
    )
  }

  if (accounts.length === 0) {
    return <div className="p-6 text-sm text-gray-500">Loading accounts…</div>
  }

  const totalLabel = pagination.total.toLocaleString()

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b bg-white shrink-0">
        {/* Account */}
        <select
          value={selectedAccountId}
          onChange={(e) => { setSelectedAccountId(e.target.value); setPage(1) }}
          className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amazon-blue/30"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.marketplaceName} — {a.sellerId}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search SKU, ASIN, title…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amazon-blue/30"
          />
        </div>

        {/* Channel filter */}
        <select
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setPage(1) }}
          className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amazon-blue/30"
        >
          <option value="">All channels</option>
          <option value="MFN">MFN only</option>
          <option value="FBA">FBA only</option>
        </select>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500">{totalLabel} listings</span>
          <button
            onClick={startVelocitySync}
            disabled={syncingVelocity}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              syncingVelocity
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-white text-amazon-blue border border-amazon-blue hover:bg-amazon-blue/5',
            )}
          >
            <TrendingUp size={14} className={syncingVelocity ? 'animate-pulse' : ''} />
            {syncingVelocity ? 'Syncing Sales…' : 'Sync Sales'}
          </button>
          <button
            onClick={startSync}
            disabled={syncing}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              syncing
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-amazon-blue text-white hover:bg-amazon-blue/90',
            )}
          >
            <RefreshCcw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Catalog'}
          </button>
        </div>
      </div>

      {/* ── Sync status banner ── */}
      {(syncStatus || syncError) && (
        <div className={clsx(
          'px-4 py-2 text-sm border-b',
          syncError
            ? 'bg-red-50 text-red-700 border-red-200'
            : syncStatus?.status === 'COMPLETED'
            ? 'bg-green-50 text-green-700 border-green-200'
            : syncStatus?.status === 'FAILED'
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-amber-50 text-amber-700 border-amber-200',
        )}>
          {syncError
            ? `Sync error: ${syncError}`
            : syncStatus?.status === 'COMPLETED'
            ? `Sync complete — ${syncStatus.totalUpserted.toLocaleString()} listings upserted.`
            : syncStatus?.status === 'FAILED'
            ? `Sync failed: ${syncStatus.errorMessage}`
            : `Syncing catalog… ${syncStatus?.totalUpserted?.toLocaleString() ?? 0} of ${syncStatus?.totalFound?.toLocaleString() ?? '?'} upserted`}
        </div>
      )}

      {/* ── Velocity sync status banner ── */}
      {(velocityStatus || velocityError) && (
        <div className={clsx(
          'px-4 py-2 text-sm border-b',
          velocityError
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-green-50 text-green-700 border-green-200',
        )}>
          {velocityError ? `Sales sync error: ${velocityError}` : velocityStatus}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 border-b z-10">
            <tr>
              {(
                [
                  { label: 'SKU',     field: 'sku',               align: 'left'  },
                  { label: 'ASIN',    field: 'asin',              align: 'left'  },
                  { label: 'Title',   field: 'productTitle',      align: 'left'  },
                  { label: 'Channel', field: 'fulfillmentChannel',align: 'left'  },
                  { label: 'Price',   field: 'price',             align: 'right' },
                  { label: 'Min',     field: 'minPrice',          align: 'right' },
                  { label: 'Max',     field: 'maxPrice',          align: 'right' },
                  { label: 'Qty',     field: 'quantity',          align: 'right' },
                  { label: '24h',    field: 'sold24h',           align: 'right' },
                  { label: '3d',     field: 'sold3d',            align: 'right' },
                  { label: '7d',     field: 'sold7d',            align: 'right' },
                ] as { label: string; field: string; align: string }[]
              ).map(({ label, field, align }) => (
                <th
                  key={label}
                  onClick={() => handleSort(field)}
                  className={clsx(
                    'px-4 py-2 font-medium text-gray-600 whitespace-nowrap select-none cursor-pointer hover:text-amazon-blue hover:bg-gray-100',
                    align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {label}
                  <SortIcon field={field} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-gray-400">Loading…</td>
              </tr>
            ) : listings.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-gray-400">
                  No active listings found. Click Sync Catalog to import from Amazon.
                </td>
              </tr>
            ) : (
              sortedListings.map((listing) => {
                const isSaving = savingSku === listing.sku
                const flash = flashSku?.sku === listing.sku ? flashSku.type : null
                const isEditing = editingSku === listing.sku

                return (
                  <tr
                    key={listing.id}
                    className={clsx(
                      'hover:bg-gray-50 transition-colors',
                      flash === 'success' && 'bg-green-50',
                      flash === 'error' && 'bg-red-50',
                    )}
                  >
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap" title={listing.sku}>
                      {listing.sku}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                      {listing.asin ? (
                        <a
                          href={`https://www.amazon.com/dp/${listing.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amazon-blue hover:underline"
                        >
                          {listing.asin}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 max-w-[280px]">
                      <span className="line-clamp-1 text-gray-800" title={listing.productTitle ?? ''}>
                        {listing.productTitle ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                        listing.fulfillmentChannel === 'FBA'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800',
                      )}>
                        {listing.fulfillmentChannel}
                      </span>
                    </td>

                    {/* ── Price cell (editable) ── */}
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {isSaving ? (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <Loader2 size={13} className="animate-spin" />
                        </span>
                      ) : isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          <span className="text-gray-400 text-xs">$</span>
                          <input
                            ref={editInputRef}
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={editValue}
                            onChange={(e) => { setEditValue(e.target.value); setPriceError(null) }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') savePrice(listing)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            className={clsx(
                              'w-20 text-right text-sm font-mono border rounded px-1.5 py-0.5 focus:outline-none focus:ring-2',
                              priceError
                                ? 'border-red-300 focus:ring-red-300'
                                : 'border-amazon-blue focus:ring-amazon-blue/30',
                            )}
                            autoFocus
                          />
                          <button
                            onClick={() => savePrice(listing)}
                            className="text-green-600 hover:text-green-800 p-0.5"
                            title="Save"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                          {priceError && (
                            <span className="text-[10px] text-red-500 absolute mt-7 right-4">
                              {priceError}
                            </span>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(listing)}
                          className="font-mono text-gray-900 hover:text-amazon-blue hover:underline cursor-pointer transition-colors"
                          title="Click to edit price"
                        >
                          {fmt(listing.price)}
                        </button>
                      )}
                    </td>

                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-gray-500 text-xs">
                      {fmt(listing.minPrice)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-gray-500 text-xs">
                      {fmt(listing.maxPrice)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-sm font-semibold text-gray-900">
                      {listing.quantity}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-sm text-gray-700">
                      {listing.sold24h}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-sm text-gray-700">
                      {listing.sold3d}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-sm text-gray-700">
                      {listing.sold7d}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t bg-white shrink-0 text-sm">
          <span className="text-gray-500">
            Page {pagination.page} of {pagination.totalPages} ({totalLabel} total)
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors"
            >
              Prev
            </button>
            <button
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

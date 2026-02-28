'use client'
import { useState, useEffect, useRef } from 'react'
import {
  Search, RefreshCcw, ChevronDown, ChevronRight, CheckCircle, Star, Info, UserCheck, Package,
} from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricingListing {
  id: string
  sku: string
  asin: string | null
  productTitle: string | null
  condition: string | null
  fulfillmentChannel: string
  listingStatus: string | null
  quantity: number
  price: string | null
  minPrice: string | null
  maxPrice: string | null
  lastSyncedAt: string
  competitorCount: number
  lowestCompetitorLandedPrice: string | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface CompetitiveOffer {
  id: string
  sellerId: string
  sellerName: string | null
  isMyOffer: boolean
  fulfillmentType: string
  listingPrice: string
  shippingPrice: string
  landedPrice: string
  isPrime: boolean
  isBuyBoxWinner: boolean
  condition: string
  feedbackRating: string | null
  feedbackCount: number | null
}

interface SyncJob {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
}

// Amazon's own known seller IDs — shown as "Amazon" in the UI
const AMAZON_SELLER_IDS = new Set([
  'A2R2RITDJNW1Q', // Amazon.com US retail
  'A3P5ROKL5A1OLE', // Amazon.co.uk
  'A3JWKAKR8XB7XF', // Amazon.de
  'A1VC38T7YXB528', // Amazon.co.jp
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = parseFloat(String(value))
  return isNaN(n) ? '—' : `$${n.toFixed(2)}`
}

function sellerLabel(sellerId: string, isMyOffer: boolean, sellerName: string | null): string {
  if (isMyOffer) return 'You'
  if (AMAZON_SELLER_IDS.has(sellerId)) return 'Amazon'
  if (sellerName) return sellerName
  // Fall back to truncated seller ID while name is being resolved
  return sellerId.length > 14 ? `${sellerId.slice(0, 14)}…` : sellerId
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PricingManager() {
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [accountsError, setAccountsError] = useState<string | null>(null)

  const [listings, setListings] = useState<PricingListing[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: 50, total: 0, totalPages: 0,
  })
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [sortField, setSortField] = useState('sku')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Expandable competitor rows
  const [expandedAsin, setExpandedAsin] = useState<string | null>(null)
  const [competitorData, setCompetitorData] = useState<
    Record<string, { offers: CompetitiveOffer[]; lastFetchedAt: string | null; loading: boolean; error: string | null }>
  >({})

  // Sync
  const [syncStatus, setSyncStatus] = useState<SyncJob | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Refresh names
  const [refreshingNames, setRefreshingNames] = useState(false)
  const [refreshNamesResult, setRefreshNamesResult] = useState<string | null>(null)

  // Sync FBA inventory
  const [syncingFbaQty, setSyncingFbaQty] = useState(false)
  const [fbaQtyResult, setFbaQtyResult] = useState<string | null>(null)

  // ─── Load accounts ───────────────────────────────────────────────────────
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

  // fetchKey bumps to force a re-fetch after sync without changing filter state
  const [fetchKey, setFetchKey] = useState(0)

  // ─── Fetch listings ──────────────────────────────────────────────────────
  // Single useEffect watching every dependency directly — avoids stale-closure
  // races from the useCallback + useEffect indirection pattern.
  useEffect(() => {
    if (!selectedAccountId) return

    let cancelled = false
    setLoading(true)

    const params = new URLSearchParams({
      accountId: selectedAccountId,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (search) params.set('search', search)
    if (channelFilter) params.set('channel', channelFilter)
    if (statusFilter) params.set('status', statusFilter)
    params.set('sortField', sortField)
    params.set('sortDir', sortDir)

    fetch(`/api/pricing?${params}`)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error ?? `${res.status} ${res.statusText}`)
        }
        return res.json()
      })
      .then(({ data, pagination: p, statuses: s }) => {
        if (cancelled) return
        setListings(data)
        setPagination(p)
        if (s) setStatuses(s)
        setExpandedAsin(null)
      })
      .catch((err) => {
        if (!cancelled) console.error('[PricingManager] fetch failed:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedAccountId, page, pageSize, search, channelFilter, statusFilter, sortField, sortDir, fetchKey])

  // Helper used by sync poller to refresh after a completed sync
  function fetchListings(opts?: { resetPage?: boolean }) {
    if (opts?.resetPage) setPage(1)
    setFetchKey((k) => k + 1)
  }

  // ─── Toggle competitor expansion ─────────────────────────────────────────
  async function toggleCompetitors(asin: string) {
    if (expandedAsin === asin) {
      setExpandedAsin(null)
      return
    }
    setExpandedAsin(asin)

    // Only fetch once per asin per page load
    if (competitorData[asin]) return

    setCompetitorData((prev) => ({ ...prev, [asin]: { offers: [], lastFetchedAt: null, loading: true, error: null } }))

    try {
      const params = new URLSearchParams({ accountId: selectedAccountId, asin })
      const res = await fetch(`/api/pricing/competitors?${params}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `${res.status} ${res.statusText}`)
      }
      const { data, lastFetchedAt } = await res.json()
      setCompetitorData((prev) => ({
        ...prev,
        [asin]: { offers: data, lastFetchedAt, loading: false, error: null },
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[PricingManager] competitors fetch failed:', msg)
      setCompetitorData((prev) => ({
        ...prev,
        [asin]: { offers: [], lastFetchedAt: null, loading: false, error: msg },
      }))
    }
  }

  // ─── Sync catalog ────────────────────────────────────────────────────────
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
            if (job.status === 'COMPLETED') fetchListings({ resetPage: true })
          }
        } catch { /* ignore polling errors */ }
      }, 3000)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err))
      setSyncing(false)
    }
  }

  // ─── Refresh seller names ────────────────────────────────────────────────
  async function refreshNames() {
    if (!selectedAccountId || refreshingNames) return
    setRefreshingNames(true)
    setRefreshNamesResult(null)
    try {
      const res = await fetch('/api/pricing/refresh-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${res.status}`)
      setRefreshNamesResult(`Resolved ${json.resolved} of ${json.total} seller names`)
      // Clear competitor cache so re-expanded rows pick up new names
      setCompetitorData({})
    } catch (err) {
      setRefreshNamesResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRefreshingNames(false)
    }
  }

  // ─── Sync FBA inventory quantities ───────────────────────────────────────
  async function syncFbaQty() {
    if (!selectedAccountId || syncingFbaQty) return
    setSyncingFbaQty(true)
    setFbaQtyResult(null)
    try {
      const res = await fetch('/api/pricing/sync-fba-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${res.status}`)
      setFbaQtyResult(`Updated ${json.updated} of ${json.total} FBA SKUs`)
      setFetchKey((k) => k + 1)
    } catch (err) {
      setFbaQtyResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncingFbaQty(false)
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────

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
            onKeyDown={(e) => e.key === 'Enter' && fetchListings({ resetPage: true })}
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

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amazon-blue/30"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500">{totalLabel} listings</span>
          <button
            onClick={syncFbaQty}
            disabled={syncingFbaQty || syncing}
            title="Pull current FBA fulfillable quantities from Amazon inventory API"
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border',
              syncingFbaQty || syncing
                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
            )}
          >
            <Package size={14} className={syncingFbaQty ? 'animate-pulse' : ''} />
            {syncingFbaQty ? 'Syncing…' : 'Sync FBA Qty'}
          </button>
          <button
            onClick={refreshNames}
            disabled={refreshingNames || syncing}
            title="Resolve seller names for all competitors from public Amazon pages"
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border',
              refreshingNames || syncing
                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
            )}
          >
            <UserCheck size={14} className={refreshingNames ? 'animate-pulse' : ''} />
            {refreshingNames ? 'Refreshing…' : 'Refresh Names'}
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

      {/* ── FBA qty sync result ── */}
      {fbaQtyResult && (
        <div className={clsx(
          'px-4 py-2 text-sm border-b',
          fbaQtyResult.startsWith('Error')
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-green-50 text-green-700 border-green-200',
        )}>
          {fbaQtyResult}
        </div>
      )}

      {/* ── Refresh names result ── */}
      {refreshNamesResult && (
        <div className={clsx(
          'px-4 py-2 text-sm border-b',
          refreshNamesResult.startsWith('Error')
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-green-50 text-green-700 border-green-200',
        )}>
          {refreshNamesResult}
        </div>
      )}

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
            ? `Sync complete — ${syncStatus.totalUpserted.toLocaleString()} listings upserted. Competitive pricing data is refreshing in the background.`
            : syncStatus?.status === 'FAILED'
            ? `Sync failed: ${syncStatus.errorMessage}`
            : `Syncing catalog… ${syncStatus?.totalFound?.toLocaleString() ?? 0} found so far`}
        </div>
      )}

      {/* ── API note banner ── */}
      <div className="flex items-start gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 shrink-0">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Competitor data is pulled from Amazon&apos;s Selling Partner API after each sync.
          Seller names are resolved automatically from public Amazon pages and cached.
          Use &ldquo;Refresh names&rdquo; in any expanded row to force a re-fetch for that ASIN&apos;s sellers.
          Inventory quantities are not available via the official API.
        </span>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 border-b z-10">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600 whitespace-nowrap w-6" />
              {(
                [
                  { label: 'SKU',        field: 'sku',               align: 'left'  },
                  { label: 'ASIN',       field: 'asin',              align: 'left'  },
                  { label: 'Title',      field: 'productTitle',      align: 'left'  },
                  { label: 'Type',       field: 'fulfillmentChannel',align: 'left'  },
                  { label: 'Status',     field: 'listingStatus',     align: 'left'  },
                  { label: 'Condition',  field: 'condition',         align: 'left'  },
                  { label: 'Qty',        field: 'quantity',          align: 'right' },
                  { label: 'Your Price', field: 'price',             align: 'right' },
                  { label: 'Min',        field: 'minPrice',          align: 'right' },
                  { label: 'Max',        field: 'maxPrice',          align: 'right' },
                  { label: 'Competitors',field: null,                align: 'right' },
                  { label: 'Lowest',     field: null,                align: 'right' },
                ] as { label: string; field: string | null; align: string }[]
              ).map(({ label, field, align }) => (
                <th
                  key={label}
                  onClick={() => field && handleSort(field)}
                  className={clsx(
                    'px-4 py-2 font-medium text-gray-600 whitespace-nowrap select-none',
                    align === 'right' ? 'text-right' : 'text-left',
                    field ? 'cursor-pointer hover:text-amazon-blue hover:bg-gray-100' : '',
                  )}
                >
                  {label}
                  {field && <SortIcon field={field} />}
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
                  No listings found. Click Sync Catalog to import from Amazon.
                </td>
              </tr>
            ) : (
              listings.map((listing) => {
                const isExpanded = expandedAsin === listing.asin && listing.asin !== null
                const compData = listing.asin ? competitorData[listing.asin] : undefined

                return [
                  // ── Main row ──
                  <tr
                    key={listing.id}
                    className={clsx(
                      'hover:bg-gray-50 transition-colors',
                      isExpanded && 'bg-blue-50/40',
                    )}
                  >
                    {/* Expand toggle */}
                    <td className="px-2 py-2 w-6">
                      {listing.asin ? (
                        <button
                          onClick={() => toggleCompetitors(listing.asin!)}
                          className="text-gray-400 hover:text-amazon-blue transition-colors"
                          title={isExpanded ? 'Collapse competitors' : 'View competitors'}
                        >
                          {isExpanded
                            ? <ChevronDown size={14} />
                            : <ChevronRight size={14} />}
                        </button>
                      ) : null}
                    </td>

                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap max-w-[160px] truncate" title={listing.sku}>
                      {listing.sku}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-gray-600">
                      {listing.asin ?? '—'}
                    </td>
                    <td className="px-4 py-2 max-w-[240px]">
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
                    <td className="px-4 py-2 whitespace-nowrap text-gray-600 text-xs">
                      {listing.listingStatus ?? '—'}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">
                      {listing.condition ? (
                        <span className={clsx(
                          'inline-flex px-2 py-0.5 rounded-full text-xs font-medium',
                          listing.condition.toLowerCase().startsWith('new')
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-yellow-100 text-yellow-800',
                        )}>
                          {listing.condition}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-sm font-semibold text-gray-900">
                      {listing.quantity}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-gray-900">
                      {fmt(listing.price)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-gray-500 text-xs">
                      {fmt(listing.minPrice)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-gray-500 text-xs">
                      {fmt(listing.maxPrice)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {listing.asin ? (
                        <button
                          onClick={() => toggleCompetitors(listing.asin!)}
                          className={clsx(
                            'text-xs font-medium transition-colors',
                            listing.competitorCount > 0
                              ? 'text-amazon-blue hover:underline'
                              : 'text-gray-400',
                          )}
                        >
                          {listing.competitorCount > 0
                            ? `${listing.competitorCount} offer${listing.competitorCount !== 1 ? 's' : ''}`
                            : 'No data'}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap text-xs">
                      {fmt(listing.lowestCompetitorLandedPrice)}
                    </td>
                  </tr>,

                  // ── Expanded competitor sub-table ──
                  isExpanded && (
                    <tr key={`${listing.id}-competitors`} className="bg-blue-50/30">
                      <td colSpan={13} className="px-0 py-0">
                        <div className="mx-4 my-2 rounded-lg border border-blue-100 overflow-hidden bg-white shadow-sm">
                          {/* Sub-table header */}
                          <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                            <span className="text-xs font-semibold text-blue-800">
                              Competitor Offers — {listing.asin}
                            </span>
                            <div className="flex items-center gap-3">
                              {compData?.lastFetchedAt && (
                                <span className="text-[10px] text-gray-400">
                                  Last updated: {new Date(compData.lastFetchedAt).toLocaleString()}
                                </span>
                              )}
                              {/* Force-refresh seller names for this ASIN's offers */}
                              {compData && !compData.loading && compData.offers.length > 0 && (
                                <button
                                  onClick={async () => {
                                    const asin = listing.asin!
                                    const mid = accounts.find(a => a.id === selectedAccountId)?.marketplaceId ?? 'ATVPDKIKX0DER'
                                    const sellerIds = compData.offers
                                      .map((o) => o.sellerId)
                                      .filter((id) => id && id !== 'unknown')

                                    // Mark loading while we refresh names
                                    setCompetitorData((prev) => ({
                                      ...prev,
                                      [asin]: { ...prev[asin], loading: true },
                                    }))

                                    // Resolve each seller name via debug endpoint (clears null cache + re-fetches)
                                    for (const sid of sellerIds) {
                                      await fetch(`/api/pricing/debug-seller?sellerId=${sid}&marketplaceId=${mid}`)
                                    }

                                    // Re-fetch competitor data to pick up resolved names (stay expanded)
                                    try {
                                      const params = new URLSearchParams({ accountId: selectedAccountId, asin })
                                      const res = await fetch(`/api/pricing/competitors?${params}`)
                                      if (!res.ok) throw new Error(`${res.status}`)
                                      const { data, lastFetchedAt } = await res.json()
                                      setCompetitorData((prev) => ({
                                        ...prev,
                                        [asin]: { offers: data, lastFetchedAt, loading: false, error: null },
                                      }))
                                    } catch (err) {
                                      setCompetitorData((prev) => ({
                                        ...prev,
                                        [asin]: { ...prev[asin], loading: false, error: String(err) },
                                      }))
                                    }
                                  }}
                                  className="text-[10px] text-amazon-blue hover:underline"
                                >
                                  Refresh names
                                </button>
                              )}
                            </div>
                          </div>

                          {compData?.loading ? (
                            <div className="px-4 py-3 text-xs text-gray-400">Loading competitor data…</div>
                          ) : compData?.error ? (
                            <div className="px-4 py-3 text-xs text-red-600">
                              Error loading competitors: {compData.error}
                            </div>
                          ) : !compData || compData.offers.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-gray-400">
                              No competitive offer data yet. Sync your catalog to fetch competitor prices.
                            </div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 border-b">
                                <tr>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-500">Seller</th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-500">Condition</th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-500">Fulfillment</th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-500">Prime</th>
                                  <th className="text-right px-3 py-1.5 font-medium text-gray-500">Listing Price</th>
                                  <th className="text-right px-3 py-1.5 font-medium text-gray-500">+ Shipping</th>
                                  <th className="text-right px-3 py-1.5 font-medium text-gray-500">Landed Price</th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-500">Rating</th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-500">Buy Box</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {compData.offers.map((offer) => (
                                  <tr
                                    key={offer.id}
                                    className={clsx(
                                      'transition-colors',
                                      offer.isMyOffer
                                        ? 'bg-green-50 border-l-4 border-l-green-500'
                                        : offer.isBuyBoxWinner
                                        ? 'bg-amber-50'
                                        : 'hover:bg-gray-50',
                                    )}
                                  >
                                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                                      <span
                                        className={clsx(
                                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold',
                                          offer.isMyOffer
                                            ? 'bg-green-500 text-white'
                                            : AMAZON_SELLER_IDS.has(offer.sellerId)
                                            ? 'bg-orange-100 text-orange-800'
                                            : 'bg-gray-100 text-gray-700',
                                        )}
                                        title={`Seller ID: ${offer.sellerId}`}
                                      >
                                        {sellerLabel(offer.sellerId, offer.isMyOffer, offer.sellerName)}
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5 whitespace-nowrap">
                                      <span className={clsx(
                                        'px-1.5 py-0.5 rounded text-[11px] font-medium',
                                        offer.condition?.toLowerCase().startsWith('new')
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : offer.condition
                                          ? 'bg-yellow-100 text-yellow-800'
                                          : 'text-gray-400',
                                      )}>
                                        {offer.condition || '—'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5">
                                      <span className={clsx(
                                        'px-1.5 py-0.5 rounded text-[11px] font-semibold',
                                        offer.fulfillmentType === 'FBA'
                                          ? 'bg-blue-100 text-blue-700'
                                          : 'bg-gray-100 text-gray-600',
                                      )}>
                                        {offer.fulfillmentType}
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {offer.isPrime ? (
                                        <span className="flex items-center gap-1 text-blue-600 font-semibold">
                                          <CheckCircle size={11} />Prime
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className={clsx('px-3 py-1.5 text-right font-mono', offer.isMyOffer && 'font-bold text-green-700')}>
                                      {fmt(offer.listingPrice)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono text-gray-500">
                                      {parseFloat(offer.shippingPrice) > 0
                                        ? `+${fmt(offer.shippingPrice)}`
                                        : <span className="text-gray-400">Free</span>}
                                    </td>
                                    <td className={clsx('px-3 py-1.5 text-right font-mono font-semibold', offer.isMyOffer && 'text-green-700')}>
                                      {fmt(offer.landedPrice)}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {offer.feedbackRating !== null ? (
                                        <span className="flex items-center gap-1 text-gray-600">
                                          <Star size={10} className="text-amber-400 fill-amber-400" />
                                          {parseFloat(offer.feedbackRating).toFixed(0)}%
                                          {offer.feedbackCount !== null && (
                                            <span className="text-gray-400">
                                              ({offer.feedbackCount.toLocaleString()})
                                            </span>
                                          )}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {offer.isBuyBoxWinner ? (
                                        <span className="flex items-center gap-1 text-amber-700 font-semibold">
                                          <CheckCircle size={11} className="text-amber-500" />
                                          Winner
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                ]
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

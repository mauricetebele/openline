'use client'
import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { Search, RefreshCcw, ExternalLink, Loader2, Filter } from 'lucide-react'
import { clsx } from 'clsx'

interface MFNReturnRow {
  id: string
  orderId: string
  orderDate: string | null
  rmaId: string | null
  trackingNumber: string | null
  returnDate: string | null
  returnValue: number | null
  currency: string
  asin: string | null
  sku: string | null
  title: string | null
  itemPrice: number | null
  orderAmount: number | null
  quantity: number | null
  returnReason: string | null
  returnStatus: string | null
  resolution: string | null
  returnCarrier: string | null
  carrierStatus: string | null
  deliveredAt: string | null
  estimatedDelivery: string | null
  trackingUpdatedAt: string | null
  refundedAmount: number | null
  expectedSerial: string | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface SyncJob {
  id: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
}

function trackingUrl(tracking: string): string {
  const t = tracking.trim().toUpperCase()
  if (/^TBA\d{12,}$/.test(t)) return `https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?_encoding=UTF8&itemId=&orderId=${tracking}`
  if (t.startsWith('1Z') && t.length === 18) return `https://www.ups.com/track?tracknum=${tracking}`
  if (/^\d{9}$/.test(t) || /^\d{18}$/.test(t)) return `https://www.ups.com/track?tracknum=${tracking}`
  if (/^9[2-5]\d{18,}$/.test(t) || /^[0-9]{20,22}$/.test(t)) return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${tracking}`
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t)) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`
  return `https://www.google.com/search?q=${encodeURIComponent(tracking + ' tracking')}`
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-gray-400 text-xs">-</span>
  const s = status.toLowerCase()
  const isTransit = s.includes('transit') || s.includes('on the way') || s.includes('we have your package') || s.includes('dropped off') || s.includes('out for delivery')
  const cls = s.includes('delivered')
    ? 'badge-green'
    : isTransit
    ? 'badge-blue'
    : s.includes('ready for ups')
    ? 'badge-orange'
    : s.includes('exception') || s.includes('delay')
    ? 'badge-orange'
    : 'badge-gray'
  return <span className={cls}>{status}</span>
}

export default function MFNReturnsManager() {
  const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const
  const [returns, setReturns] = useState<MFNReturnRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [trackingStatus, setTrackingStatus] = useState('')
  const [fetchKey, setFetchKey] = useState(0)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync date range
  const [syncStart, setSyncStart] = useState('')
  const [syncEnd, setSyncEnd] = useState('')

  // Tracking refresh state
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [bulkTracking, setBulkTracking] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: 0 })
  const bulkCancelledRef = useRef(false)

  // ── Fetch returns ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const params = new URLSearchParams()
    params.set('page', String(pagination.page))
    params.set('limit', String(pageSize))
    if (search) params.set('search', search)
    if (trackingStatus) params.set('trackingStatus', trackingStatus)

    fetch(`/api/returns?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setReturns(data.data)
        setPagination(data.pagination)
      })
      .catch((err) => {
        if (!cancelled) console.error('[MFNReturns] fetch failed:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [pagination.page, pageSize, search, trackingStatus, fetchKey])

  function goToPage(p: number) {
    setPagination((prev) => ({ ...prev, page: p }))
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  async function triggerSync(daysBack?: number) {
    setSyncing(true)
    try {
      let startDate: string | undefined
      let endDate: string | undefined

      if (daysBack != null) {
        const end = new Date()
        const start = new Date(end.getTime() - daysBack * 86_400_000)
        startDate = start.toISOString()
        endDate = end.toISOString()
      } else if (syncStart && syncEnd) {
        startDate = new Date(syncStart).toISOString()
        endDate = new Date(syncEnd + 'T23:59:59').toISOString()
      }

      const res = await fetch('/api/returns/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      })
      if (!res.ok) throw new Error('Sync request failed')
      const job: SyncJob = await res.json()
      setSyncJob({ ...job, status: 'RUNNING' })
      startPolling(job.id)
    } catch (err) {
      console.error('[MFNReturns] sync error:', err)
      setSyncing(false)
    }
  }

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/returns/sync?jobId=${jobId}`)
        if (!res.ok) return
        const job: SyncJob = await res.json()
        setSyncJob(job)
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setSyncing(false)
          if (job.status === 'COMPLETED') setFetchKey((k) => k + 1)
        }
      } catch { /* transient */ }
    }, 3_000)
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // ── Tracking refresh ──────────────────────────────────────────────────────
  async function refreshTracking(id: string) {
    setRefreshingId(id)
    try {
      const res = await fetch(`/api/returns/${id}/tracking`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error ?? 'Tracking refresh failed')
        return
      }
      const updated = await res.json()
      setReturns((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, carrierStatus: updated.carrierStatus, deliveredAt: updated.deliveredAt, estimatedDelivery: updated.estimatedDelivery, trackingUpdatedAt: updated.trackingUpdatedAt }
            : r,
        ),
      )
    } catch {
      alert('Tracking refresh failed')
    } finally {
      setRefreshingId(null)
    }
  }

  // ── Bulk tracking refresh ────────────────────────────────────────────────
  async function refreshAllTracking() {
    const trackable = returns.filter((r) => r.trackingNumber)
    if (trackable.length === 0) return

    bulkCancelledRef.current = false
    setBulkTracking(true)
    setBulkProgress({ done: 0, total: trackable.length, failed: 0 })

    const CONCURRENCY = 3
    let done = 0
    let failed = 0

    async function processOne(r: MFNReturnRow) {
      if (bulkCancelledRef.current) return
      try {
        const res = await fetch(`/api/returns/${r.id}/tracking`, { method: 'POST' })
        if (res.ok) {
          const updated = await res.json()
          setReturns((prev) =>
            prev.map((row) =>
              row.id === r.id
                ? { ...row, carrierStatus: updated.carrierStatus, deliveredAt: updated.deliveredAt, estimatedDelivery: updated.estimatedDelivery, trackingUpdatedAt: updated.trackingUpdatedAt }
                : row,
            ),
          )
        } else {
          failed++
        }
      } catch {
        failed++
      }
      done++
      setBulkProgress({ done, total: trackable.length, failed })
    }

    // Process in batches of CONCURRENCY
    for (let i = 0; i < trackable.length; i += CONCURRENCY) {
      if (bulkCancelledRef.current) break
      const batch = trackable.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(processOne))
    }

    setBulkTracking(false)
  }

  function cancelBulkTracking() {
    bulkCancelledRef.current = true
    setBulkTracking(false)
  }

  // ── Search with debounce ──────────────────────────────────────────────────
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleSearch(val: string) {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      setSearch(val)
      setPagination((prev) => ({ ...prev, page: 1 }))
    }, 300)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
        {/* Quick sync buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => triggerSync(1)}
            disabled={syncing}
            className="btn-secondary text-xs px-2.5 py-1.5"
          >
            Last 1 Day
          </button>
          <button
            onClick={() => triggerSync(7)}
            disabled={syncing}
            className="btn-secondary text-xs px-2.5 py-1.5"
          >
            Last 7 Days
          </button>
          <button
            onClick={() => triggerSync(30)}
            disabled={syncing}
            className="btn-secondary text-xs px-2.5 py-1.5"
          >
            Last 30 Days
          </button>
        </div>

        {/* Custom date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={syncStart}
            onChange={(e) => setSyncStart(e.target.value)}
            className="input text-xs px-2 py-1.5 w-32"
          />
          <span className="text-gray-400 text-xs">to</span>
          <input
            type="date"
            value={syncEnd}
            onChange={(e) => setSyncEnd(e.target.value)}
            className="input text-xs px-2 py-1.5 w-32"
          />
          <button
            onClick={() => triggerSync()}
            disabled={syncing || !syncStart || !syncEnd}
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            <RefreshCcw size={12} className={clsx(syncing && 'animate-spin')} />
            {syncing ? 'Syncing...' : 'Sync Range'}
          </button>
        </div>

        {syncJob && (
          <span className="text-xs text-gray-500">
            {syncJob.status === 'RUNNING'
              ? `Syncing... ${syncJob.totalUpserted} rows`
              : syncJob.status === 'COMPLETED'
              ? `Done - ${syncJob.totalUpserted} of ${syncJob.totalFound} synced`
              : `Failed: ${syncJob.errorMessage ?? 'Unknown error'}`}
          </span>
        )}

        <div className="flex-1" />

        {/* Track All button */}
        <div className="flex items-center gap-2">
          {bulkTracking ? (
            <>
              <span className="text-xs text-gray-500">
                Tracking {bulkProgress.done}/{bulkProgress.total}
                {bulkProgress.failed > 0 && <span className="text-red-500 ml-1">({bulkProgress.failed} failed)</span>}
              </span>
              <button
                onClick={cancelBulkTracking}
                className="btn-secondary text-xs px-2.5 py-1.5 text-red-600"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={refreshAllTracking}
              disabled={syncing || returns.filter((r) => r.trackingNumber).length === 0}
              className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5"
              title="Refresh tracking status for all visible returns"
            >
              <RefreshCcw size={12} />
              Track All
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1">
          <Filter size={12} className="text-gray-400 mr-1" />
          {([
            ['', 'All'],
            ['delivered', 'Delivered'],
            ['in_transit', 'In Transit'],
            ['not_shipped', 'Not Yet Shipped'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setTrackingStatus(value)
                setPagination((prev) => ({ ...prev, page: 1 }))
              }}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-full border transition-colors',
                trackingStatus === value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search order ID, RMA, ASIN..."
            onChange={(e) => handleSearch(e.target.value)}
            className="input pl-9 w-64 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800 z-10">
            <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-2">Amazon Order ID</th>
              <th className="px-4 py-2">Product Title</th>
              <th className="px-4 py-2">ASIN</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Refunded</th>
              <th className="px-4 py-2">RMA #</th>
              <th className="px-4 py-2">Return Tracking #</th>
              <th className="px-4 py-2">Expected Serial</th>
              <th className="px-4 py-2">Find My</th>
              <th className="px-4 py-2">Return Date</th>
              <th className="px-4 py-2">UPS Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {loading && returns.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-gray-400">
                  <Loader2 className="mx-auto animate-spin mb-2" size={20} />
                  Loading...
                </td>
              </tr>
            ) : returns.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-gray-400">
                  No MFN returns found. Click &quot;Sync Returns&quot; to pull from Amazon.
                </td>
              </tr>
            ) : (
              returns.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  {/* Order ID */}
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    <a
                      href={`https://sellercentral.amazon.com/orders-v3/order/${r.orderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {r.orderId}
                    </a>
                  </td>

                  {/* Title */}
                  <td className="px-4 py-2 max-w-[200px] truncate" title={r.title ?? ''}>
                    {r.title ?? <span className="text-gray-400">-</span>}
                  </td>

                  {/* ASIN */}
                  <td className="px-4 py-2 font-mono text-xs">{r.asin ?? '-'}</td>

                  {/* Price */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.itemPrice != null
                      ? `$${r.itemPrice.toFixed(2)}`
                      : r.returnValue != null
                      ? `$${r.returnValue.toFixed(2)}`
                      : r.orderAmount != null
                      ? `$${r.orderAmount.toFixed(2)}`
                      : '-'}
                  </td>

                  {/* Refunded */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.refundedAmount != null
                      ? <span className="text-red-600 font-medium">${r.refundedAmount.toFixed(2)}</span>
                      : <span className="text-gray-400">-</span>}
                  </td>

                  {/* RMA */}
                  <td className="px-4 py-2 font-mono text-xs">{r.rmaId ?? '-'}</td>

                  {/* Tracking */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.trackingNumber ? (
                      <a
                        href={trackingUrl(r.trackingNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs font-mono"
                      >
                        {r.trackingNumber}
                        <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>

                  {/* Expected Serial */}
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.expectedSerial ?? <span className="text-gray-400">-</span>}
                  </td>

                  {/* Find My (placeholder) */}
                  <td className="px-4 py-2 text-gray-400 text-xs">-</td>

                  {/* Return Date */}
                  <td className="px-4 py-2 whitespace-nowrap text-xs">
                    {r.returnDate ? format(new Date(r.returnDate), 'MMM d, yyyy') : '-'}
                  </td>

                  {/* UPS Status */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <StatusBadge status={r.carrierStatus} />
                        {r.deliveredAt && (
                          <span className="text-[10px] text-gray-400 mt-0.5">
                            {format(new Date(r.deliveredAt), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                      {r.trackingNumber && (
                        <button
                          onClick={() => refreshTracking(r.id)}
                          disabled={refreshingId === r.id || bulkTracking}
                          className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30"
                          title="Refresh tracking status"
                        >
                          {refreshingId === r.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RefreshCcw size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-6 py-3 border-t bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-gray-500">
            {pagination.total > 0
              ? `Showing ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} of ${pagination.total}`
              : 'No results'}
          </span>
          <div className="flex items-center gap-1.5">
            <label className="text-gray-500 text-xs">Rows:</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPagination((prev) => ({ ...prev, page: 1 }))
              }}
              className="input text-xs px-2 py-1 w-20"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(1)}
              disabled={pagination.page <= 1}
              className="btn-secondary text-xs px-2 py-1"
            >
              First
            </button>
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="btn-secondary text-xs px-3 py-1"
            >
              Prev
            </button>
            <span className="text-gray-500 text-xs">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="btn-secondary text-xs px-3 py-1"
            >
              Next
            </button>
            <button
              onClick={() => goToPage(pagination.totalPages)}
              disabled={pagination.page >= pagination.totalPages}
              className="btn-secondary text-xs px-2 py-1"
            >
              Last
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

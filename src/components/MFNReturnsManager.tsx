'use client'
import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { Search, RefreshCcw, ExternalLink, Loader2 } from 'lucide-react'
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
  const cls = s.includes('delivered')
    ? 'badge-green'
    : s.includes('transit') || s.includes('on the way')
    ? 'badge-blue'
    : s.includes('exception') || s.includes('delay')
    ? 'badge-orange'
    : 'badge-gray'
  return <span className={cls}>{status}</span>
}

export default function MFNReturnsManager() {
  const [returns, setReturns] = useState<MFNReturnRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
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

  // ── Fetch returns ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const params = new URLSearchParams()
    params.set('page', String(pagination.page))
    params.set('limit', '25')
    if (search) params.set('search', search)

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
  }, [pagination.page, search, fetchKey])

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
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{r.orderId}</td>

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
                      <StatusBadge status={r.carrierStatus} />
                      {r.trackingNumber && (
                        <button
                          onClick={() => refreshTracking(r.id)}
                          disabled={refreshingId === r.id}
                          className="text-gray-400 hover:text-gray-600 transition-colors"
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
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-sm">
          <span className="text-gray-500">
            Showing {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="btn-secondary text-xs px-3 py-1"
            >
              Prev
            </button>
            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="btn-secondary text-xs px-3 py-1"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

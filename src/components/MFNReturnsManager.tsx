'use client'
import { useState, useEffect, useRef } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  Search, RefreshCcw, ExternalLink, Loader2, Filter, CheckCircle, XCircle,
  Package, Truck, Calendar, DollarSign, Smartphone, ChevronLeft, ChevronRight,
  AlertTriangle, Clock, Hash,
} from 'lucide-react'
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
  fmiStatus: string | null
  fmiCheckedAt: string | null
  mpRmaId: string | null
  mpRmaNumber: string | null
  mpRmaStatus: string | null
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

function getTrackingStatusInfo(status: string | null): { label: string; color: string; dotColor: string } {
  if (!status) return { label: 'No Status', color: 'text-gray-400', dotColor: 'bg-gray-300 dark:bg-gray-600' }
  const s = status.toLowerCase()
  if (s.includes('delivered')) return { label: 'Delivered', color: 'text-emerald-600 dark:text-emerald-400', dotColor: 'bg-emerald-500' }
  if (s.includes('transit') || s.includes('on the way') || s.includes('we have your package') || s.includes('dropped off') || s.includes('out for delivery'))
    return { label: 'In Transit', color: 'text-blue-600 dark:text-blue-400', dotColor: 'bg-blue-500' }
  if (s.includes('ready for ups')) return { label: 'Ready for Pickup', color: 'text-amber-600 dark:text-amber-400', dotColor: 'bg-amber-500' }
  if (s.includes('exception') || s.includes('delay')) return { label: 'Exception', color: 'text-orange-600 dark:text-orange-400', dotColor: 'bg-orange-500' }
  return { label: status, color: 'text-gray-500 dark:text-gray-400', dotColor: 'bg-gray-400' }
}

function getPrice(r: MFNReturnRow): number | null {
  if (r.itemPrice != null) return r.itemPrice
  if (r.returnValue != null) return r.returnValue
  if (r.orderAmount != null) return r.orderAmount
  return null
}

export default function MFNReturnsManager() {
  const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500] as const
  const [returns, setReturns] = useState<MFNReturnRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [trackingStatus, setTrackingStatus] = useState('')
  const [inSystemOnly, setInSystemOnly] = useState(false)
  const [hasMpRma, setHasMpRma] = useState(false)
  const [fetchKey, setFetchKey] = useState(0)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sync date range
  const [syncStart, setSyncStart] = useState('')
  const [syncEnd, setSyncEnd] = useState('')

  // Find My iPhone check state
  const [fmiChecking, setFmiChecking] = useState<Set<string>>(new Set())

  // Tracking refresh state
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [bulkTracking, setBulkTracking] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: 0 })
  const bulkCancelledRef = useRef(false)

  // ── Fetch returns ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set('page', String(pagination.page))
    params.set('limit', String(pageSize))
    if (search) params.set('search', search)
    if (trackingStatus) params.set('trackingStatus', trackingStatus)
    if (inSystemOnly) params.set('inSystem', 'true')
    if (hasMpRma) params.set('hasMpRma', 'true')

    fetch(`/api/returns?${params}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`API ${res.status}: ${body}`)
        }
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setReturns(data.data)
        setPagination(data.pagination)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[MFNReturns] fetch failed:', err)
          setError(String(err?.message ?? err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [pagination.page, pageSize, search, trackingStatus, inSystemOnly, hasMpRma, fetchKey])

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

  // ── Find My iPhone (iCloud Lock) check via SICKW Basic Info ──────────────
  async function checkFindMy(returnId: string, serial: string) {
    setFmiChecking(prev => { const n = new Set(prev); n.add(returnId); return n })
    try {
      const res = await fetch('/api/sickw/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imei: serial, serviceId: 30, serviceName: 'Basic Info' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Check failed')

      const resultStr: string = json.data?.result ?? ''
      const lockMatch = resultStr.match(/iCloud Lock:\s*(?:<[^>]*>)?\s*(ON|OFF)/i)
      const fmiStatus = lockMatch ? lockMatch[1].toUpperCase() : 'UNKNOWN'

      await fetch('/api/returns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: returnId, fmiStatus }),
      })

      setReturns(prev => prev.map(r => r.id === returnId ? { ...r, fmiStatus, fmiCheckedAt: new Date().toISOString() } : r))
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Failed'
      setReturns(prev => prev.map(r => r.id === returnId ? { ...r, fmiStatus: `ERROR: ${errMsg}` } : r))
    } finally {
      setFmiChecking(prev => { const n = new Set(prev); n.delete(returnId); return n })
    }
  }

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

  // ── FMI badge renderer ────────────────────────────────────────────────────
  function renderFmiBadge(r: MFNReturnRow) {
    if (fmiChecking.has(r.id)) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
          <Loader2 size={12} className="animate-spin" />
          Checking...
        </span>
      )
    }
    if (r.fmiStatus === 'ON') {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-semibold border border-red-200 dark:border-red-500/20">
            <XCircle size={12} />
            iCloud ON
          </span>
          {r.expectedSerial && (
            <button onClick={() => checkFindMy(r.id, r.expectedSerial!)} title="Re-check" className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
              <RefreshCcw size={12} />
            </button>
          )}
        </span>
      )
    }
    if (r.fmiStatus === 'OFF') {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold border border-emerald-200 dark:border-emerald-500/20">
            <CheckCircle size={12} />
            iCloud OFF
          </span>
          {r.expectedSerial && (
            <button onClick={() => checkFindMy(r.id, r.expectedSerial!)} title="Re-check" className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
              <RefreshCcw size={12} />
            </button>
          )}
        </span>
      )
    }
    if (r.fmiStatus?.startsWith('ERROR')) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium border border-amber-200 dark:border-amber-500/20" title={r.fmiStatus}>
            <AlertTriangle size={12} />
            Error
          </span>
          {r.expectedSerial && (
            <button onClick={() => checkFindMy(r.id, r.expectedSerial!)} title="Retry" className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
              <RefreshCcw size={12} />
            </button>
          )}
        </span>
      )
    }
    if (r.expectedSerial) {
      return (
        <button
          onClick={() => checkFindMy(r.id, r.expectedSerial!)}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
        >
          <Smartphone size={12} />
          Check iCloud
        </button>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        {/* Row 1: Search + Filters */}
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search order ID, RMA, ASIN, SKU, product..."
              onChange={(e) => handleSearch(e.target.value)}
              className="input pl-10 w-full text-sm h-9"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-gray-400" />
            {([
              ['', 'All'],
              ['delivered', 'Delivered'],
              ['in_transit', 'In Transit'],
              ['not_shipped', 'Not Shipped'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setTrackingStatus(value)
                  setPagination((prev) => ({ ...prev, page: 1 }))
                }}
                className={clsx(
                  'text-xs px-3 py-1.5 rounded-lg font-medium transition-all',
                  trackingStatus === value
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
                )}
              >
                {label}
              </button>
            ))}
            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
            <button
              onClick={() => {
                setInSystemOnly(v => !v)
                setPagination((prev) => ({ ...prev, page: 1 }))
              }}
              className={clsx(
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-all',
                inSystemOnly
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              In System
            </button>
            <button
              onClick={() => {
                setHasMpRma(v => !v)
                setPagination((prev) => ({ ...prev, page: 1 }))
              }}
              className={clsx(
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-all',
                hasMpRma
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              Has MP-RMA
            </button>
          </div>

          <div className="flex-1" />

          {/* Bulk tracking */}
          {bulkTracking ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 size={14} className="animate-spin text-blue-500" />
                {bulkProgress.done}/{bulkProgress.total}
                {bulkProgress.failed > 0 && <span className="text-red-500">({bulkProgress.failed} failed)</span>}
              </div>
              <button onClick={cancelBulkTracking} className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={refreshAllTracking}
              disabled={syncing || returns.filter((r) => r.trackingNumber).length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
              title="Refresh tracking for all visible returns"
            >
              <RefreshCcw size={13} />
              Track All
            </button>
          )}
        </div>

        {/* Row 2: Sync controls */}
        <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mr-1">Sync</span>
          {[
            { label: '1 Day', days: 1 },
            { label: '7 Days', days: 7 },
            { label: '30 Days', days: 30 },
          ].map(({ label, days }) => (
            <button
              key={days}
              onClick={() => triggerSync(days)}
              disabled={syncing}
              className="text-xs px-2.5 py-1 rounded-md font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {label}
            </button>
          ))}
          <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />
          <input type="date" value={syncStart} onChange={(e) => setSyncStart(e.target.value)} className="input text-xs px-2 py-1 w-32 h-7" />
          <span className="text-gray-400 text-xs">to</span>
          <input type="date" value={syncEnd} onChange={(e) => setSyncEnd(e.target.value)} className="input text-xs px-2 py-1 w-32 h-7" />
          <button
            onClick={() => triggerSync()}
            disabled={syncing || !syncStart || !syncEnd}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-md font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            <RefreshCcw size={11} className={clsx(syncing && 'animate-spin')} />
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          {syncJob && (
            <span className={clsx(
              'text-xs font-medium ml-1',
              syncJob.status === 'RUNNING' ? 'text-blue-600 dark:text-blue-400' :
              syncJob.status === 'COMPLETED' ? 'text-emerald-600 dark:text-emerald-400' :
              'text-red-600 dark:text-red-400',
            )}>
              {syncJob.status === 'RUNNING'
                ? `Syncing... ${syncJob.totalUpserted} rows`
                : syncJob.status === 'COMPLETED'
                ? `Done — ${syncJob.totalUpserted} of ${syncJob.totalFound} synced`
                : `Failed: ${syncJob.errorMessage ?? 'Unknown error'}`}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* ── Returns List ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && returns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="animate-spin text-blue-500 mb-3" size={28} />
            <p className="text-gray-400 text-sm">Loading returns...</p>
          </div>
        ) : returns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Package size={44} className="text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No MFN returns found</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Sync returns from Amazon to see them here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {returns.map((r) => {
              const price = getPrice(r)
              const trackingInfo = getTrackingStatusInfo(r.carrierStatus)
              const timeAgo = r.returnDate
                ? formatDistanceToNowStrict(new Date(r.returnDate), { addSuffix: true })
                : null

              return (
                <div
                  key={r.id}
                  className={clsx(
                    'group rounded-xl border bg-white dark:bg-gray-900 transition-all hover:shadow-md',
                    r.fmiStatus === 'ON'
                      ? 'border-red-200 dark:border-red-500/20 bg-red-50/30 dark:bg-red-500/[0.03]'
                      : 'border-gray-200 dark:border-gray-700/60 hover:border-gray-300 dark:hover:border-gray-600',
                  )}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4">
                    {/* Left: Order + Product info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <a
                          href={`https://sellercentral.amazon.com/orders-v3/order/${r.orderId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline font-mono"
                        >
                          {r.orderId}
                        </a>
                        {r.rmaId && (
                          <span className="text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                            RMA {r.rmaId}
                          </span>
                        )}
                        {r.mpRmaNumber && (
                          <a
                            href={`/marketplace-returns?search=${encodeURIComponent(r.mpRmaNumber)}`}
                            className={clsx(
                              'text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 hover:opacity-80 transition-opacity',
                              r.mpRmaStatus === 'RECEIVED'
                                ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400',
                            )}
                          >
                            {r.mpRmaNumber}
                            <span className="text-[9px] opacity-70">{r.mpRmaStatus === 'RECEIVED' ? 'Received' : 'Open'}</span>
                          </a>
                        )}
                        {r.returnReason && (
                          <span className="hidden lg:inline text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded truncate max-w-[200px]" title={r.returnReason}>
                            {r.returnReason}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-900 dark:text-gray-100 truncate" title={r.title ?? undefined}>
                        {r.title ?? <span className="text-gray-400 italic">Unknown product</span>}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        {r.asin && (
                          <span className="flex items-center gap-1 font-mono">
                            <Hash size={10} />
                            {r.asin}
                          </span>
                        )}
                        {r.sku && <span className="font-mono">{r.sku}</span>}
                        {r.quantity != null && r.quantity > 1 && (
                          <span className="text-amber-500 font-semibold">Qty {r.quantity}</span>
                        )}
                      </div>
                    </div>

                    {/* Middle: Price, Date, Tracking */}
                    <div className="flex items-center gap-6 shrink-0">
                      {/* Price */}
                      <div className="text-right min-w-[70px]">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {price != null ? (
                            <span className="flex items-center justify-end gap-1">
                              <DollarSign size={12} className="text-gray-400" />
                              {price.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </p>
                        {r.refundedAmount != null && (
                          <p className="text-xs text-red-500 font-medium">-${r.refundedAmount.toFixed(2)}</p>
                        )}
                      </div>

                      {/* Return date */}
                      <div className="text-center min-w-[80px]">
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Calendar size={11} />
                          {r.returnDate ? format(new Date(r.returnDate), 'MMM d, yyyy') : '—'}
                        </div>
                        {timeAgo && (
                          <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo}</p>
                        )}
                      </div>

                      {/* Tracking */}
                      <div className="min-w-[160px]">
                        {r.trackingNumber ? (
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={clsx('w-2 h-2 rounded-full shrink-0', trackingInfo.dotColor)} />
                                <span className={clsx('text-xs font-medium', trackingInfo.color)}>{trackingInfo.label}</span>
                              </div>
                              <a
                                href={trackingUrl(r.trackingNumber)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-blue-500 hover:underline font-mono inline-flex items-center gap-0.5"
                              >
                                {r.trackingNumber.length > 20
                                  ? r.trackingNumber.slice(0, 10) + '...' + r.trackingNumber.slice(-6)
                                  : r.trackingNumber}
                                <ExternalLink size={9} />
                              </a>
                              {r.deliveredAt && (
                                <p className="text-[10px] text-gray-400 mt-0.5">
                                  {format(new Date(r.deliveredAt), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => refreshTracking(r.id)}
                              disabled={refreshingId === r.id || bulkTracking}
                              className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:opacity-30 transition-colors"
                              title="Refresh tracking"
                            >
                              {refreshingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                            </button>
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-gray-400">
                            <Truck size={13} />
                            No tracking
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Serial + FMI */}
                    <div className="flex items-center gap-3 shrink-0 min-w-[220px] justify-end">
                      {r.expectedSerial && (
                        <div className="text-right mr-1">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Serial</p>
                          <p className="text-xs font-mono text-gray-700 dark:text-gray-300">{r.expectedSerial}</p>
                        </div>
                      )}
                      {renderFmiBadge(r)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-t bg-white dark:bg-gray-900 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {pagination.total > 0
              ? `${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(pagination.page * pagination.pageSize, pagination.total)} of ${pagination.total}`
              : 'No results'}
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPagination((prev) => ({ ...prev, page: 1 }))
            }}
            className="input text-xs px-2 py-1 w-20"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size} rows</option>
            ))}
          </select>
        </div>
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            {/* Page numbers */}
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
              let page: number
              if (pagination.totalPages <= 5) {
                page = i + 1
              } else if (pagination.page <= 3) {
                page = i + 1
              } else if (pagination.page >= pagination.totalPages - 2) {
                page = pagination.totalPages - 4 + i
              } else {
                page = pagination.page - 2 + i
              }
              return (
                <button
                  key={page}
                  onClick={() => goToPage(page)}
                  className={clsx(
                    'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                    pagination.page === page
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800',
                  )}
                >
                  {page}
                </button>
              )
            })}
            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

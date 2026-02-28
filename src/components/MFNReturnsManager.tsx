'use client'
import { useEffect, useState, useCallback } from 'react'
import { Search, RefreshCw, RotateCcw, AlertCircle, X, ExternalLink, Loader2, Info, ChevronUp, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { trackingUrl, detectCarrier } from '@/lib/ups-tracking'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AmazonAccount { id: string; sellerId: string; marketplaceName: string }

interface MFNReturn {
  id: string
  orderId: string
  orderDate: string | null
  rmaId: string | null
  trackingNumber: string | null
  returnValue: string | null
  currency: string
  returnDate: string | null
  title: string | null
  asin: string | null
  sku: string | null
  quantity: number | null
  returnReason: string | null
  returnStatus: string | null
  carrierStatus: string | null
  deliveredAt: string | null
  estimatedDelivery: string | null
  trackingUpdatedAt: string | null
}

interface SyncJob {
  id: string
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function orderAgeDays(orderDate: string | null): number | null {
  if (!orderDate) return null
  const diff = Date.now() - new Date(orderDate).getTime()
  return Math.floor(diff / 86_400_000)
}

function AgeChip({ days }: { days: number | null }) {
  if (days === null) return <span className="text-gray-300">—</span>
  const color =
    days > 365 ? 'bg-red-100 text-red-700' :
    days > 180 ? 'bg-amber-100 text-amber-700' :
    days > 90  ? 'bg-yellow-100 text-yellow-700' :
                 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${color}`}>
      {days}d
    </span>
  )
}

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900"><X size={14} /></button>
    </div>
  )
}

// ─── Sync Panel ───────────────────────────────────────────────────────────────

function SyncPanel({
  accounts,
  onSynced,
  onClose,
}: {
  accounts: AmazonAccount[]
  onSynced: () => void
  onClose: () => void
}) {
  const today      = new Date().toISOString().slice(0, 10)
  const ninetyAgo  = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [startDate, setStartDate] = useState(ninetyAgo)
  const [endDate,   setEndDate]   = useState(today)
  const [job,       setJob]       = useState<SyncJob | null>(null)
  const [polling,   setPolling]   = useState(false)
  const [err,       setErr]       = useState('')

  async function handleSync() {
    setErr('')
    if (!accountId) { setErr('Select an Amazon account'); return }

    const res = await fetch('/api/returns/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId,
        startDate: new Date(startDate).toISOString(),
        endDate:   new Date(endDate).toISOString(),
      }),
    })
    const data = await res.json()
    if (!res.ok) { setErr(data.error ?? 'Failed to start sync'); return }

    setPolling(true)
    pollJob(data.jobId)
  }

  function pollJob(jobId: string) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/returns/sync?jobId=${jobId}`)
      const data: SyncJob = await res.json()
      setJob(data)

      if (data.status === 'COMPLETED') {
        clearInterval(interval)
        setPolling(false)
        onSynced()
      }
      if (data.status === 'FAILED') {
        clearInterval(interval)
        setPolling(false)
        setErr(data.errorMessage ?? 'Sync failed')
      }
    }, 5_000)
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={!polling ? onClose : undefined} />
      <div className="w-[420px] bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Import MFN Returns</h2>
          {!polling && (
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex-1 px-5 py-5 space-y-4">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {job?.status === 'COMPLETED' ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
              <p className="font-semibold mb-1">Import complete</p>
              <p>{job.totalUpserted} returns imported ({job.totalFound} found in report)</p>
            </div>
          ) : job?.status === 'IN_PROGRESS' ? (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
              <div className="flex items-center gap-2 text-sm text-blue-800 mb-3">
                <Loader2 size={14} className="animate-spin" />
                <span>Requesting report from Amazon…</span>
              </div>
              <p className="text-xs text-blue-600">
                Amazon takes up to 5 minutes to generate the returns report.
                This panel will update automatically.
              </p>
              {job.totalFound > 0 && (
                <p className="mt-2 text-xs text-blue-700 font-medium">
                  Processing: {job.totalUpserted} / {job.totalFound}
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Account */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Amazon Account <span className="text-red-500">*</span>
                </label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.marketplaceName} — {a.sellerId}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    max={today}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  />
                </div>
              </div>

              <p className="text-xs text-gray-400">
                Amazon generates a flat-file returns report for the selected date range.
                Larger date ranges may take longer.
              </p>
            </>
          )}
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          {job?.status === 'COMPLETED' ? (
            <button type="button" onClick={onClose}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">
              Done
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={polling}
                className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                Cancel
              </button>
              <button type="button" onClick={handleSync} disabled={polling}
                className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60">
                {polling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {polling ? 'Importing…' : 'Start Import'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tracking Cell ────────────────────────────────────────────────────────────

function TrackingCell({ ret, onRefreshed }: { ret: MFNReturn; onRefreshed: () => void }) {
  const [refreshing, setRefreshing] = useState(false)
  const [fetchErr, setFetchErr]     = useState('')

  if (!ret.trackingNumber) return <span className="text-gray-300">—</span>

  const carrier = detectCarrier(ret.trackingNumber)
  const url = trackingUrl(ret.trackingNumber)

  // Treat stale failure strings stored in the DB the same as no status
  const hasRealStatus = ret.carrierStatus &&
    ret.carrierStatus !== 'Unable to fetch status'

  async function handleRefresh() {
    setRefreshing(true)
    setFetchErr('')
    try {
      const res = await fetch(`/api/returns/${ret.id}/refresh-tracking`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setFetchErr(data.error ?? 'Could not fetch status')
      } else {
        onRefreshed()
      }
    } catch {
      setFetchErr('Network error — please try again')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs text-gray-700">{ret.trackingNumber}</span>
        <span className="text-[10px] text-gray-400 font-medium">{carrier}</span>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="text-gray-400 hover:text-amazon-blue" title={`Track on ${carrier}`}>
          <ExternalLink size={11} />
        </a>
      </div>

      {fetchErr ? (
        <div className="flex items-start gap-1 max-w-[220px]">
          <AlertCircle size={10} className="text-red-400 mt-0.5 shrink-0" />
          <span className="text-[10px] text-red-500 leading-snug">{fetchErr}</span>
          <button type="button" onClick={() => setFetchErr('')}
            className="text-gray-300 hover:text-gray-500 shrink-0 ml-auto">
            <X size={10} />
          </button>
        </div>
      ) : hasRealStatus ? (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-gray-500">
              {ret.carrierStatus === 'Shipment Ready for UPS' ? 'Not Yet Shipped' : ret.carrierStatus}
            </span>
            <button type="button" onClick={handleRefresh} disabled={refreshing}
              className="text-gray-300 hover:text-gray-500 disabled:opacity-40" title="Refresh status">
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          {ret.deliveredAt && (
            <span className="text-[10px] text-green-600 font-medium">
              Delivered {fmtDate(ret.deliveredAt)}
            </span>
          )}
          {!ret.deliveredAt && ret.estimatedDelivery && (
            <span className="text-[10px] text-blue-500">
              Est. {fmtDate(ret.estimatedDelivery)}
            </span>
          )}
        </div>
      ) : (
        <button type="button" onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-1 text-[11px] text-amazon-blue hover:underline disabled:opacity-40">
          {refreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          {refreshing ? 'Checking…' : 'Check status'}
        </button>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MFNReturnsManager() {
  const [returns, setReturns]         = useState<MFNReturn[]>([])
  const [accounts, setAccounts]       = useState<AmazonAccount[]>([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(1)
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState('')
  const [search, setSearch]           = useState('')
  const [showSync, setShowSync]       = useState(false)
  const [autoRefreshing, setAutoRefreshing]   = useState(false)
  const [autoRefreshDone, setAutoRefreshDone] = useState(0)
  const [autoRefreshTotal, setAutoRefreshTotal] = useState(0)
  const [trackingFilter, setTrackingFilter] = useState('all')
  const [returnDateFrom, setReturnDateFrom] = useState('')
  const [returnDateTo, setReturnDateTo]     = useState('')
  const [sortDir, setSortDir]               = useState<'desc' | 'asc'>('desc')
  const [scheduledToday, setScheduledToday] = useState<number | null>(null)
  const [deliveredToday, setDeliveredToday] = useState<number | null>(null)
  const LIMIT = 50

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (search.trim()) params.set('search', search.trim())
      if (trackingFilter !== 'all') params.set('trackingFilter', trackingFilter)
      if (returnDateFrom) params.set('returnDateFrom', returnDateFrom)
      if (returnDateTo)   params.set('returnDateTo', returnDateTo)
      params.set('sortDir', sortDir)
      const res = await fetch(`/api/returns?${params}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setReturns(data.data)
      setTotal(data.total)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, search, trackingFilter, returnDateFrom, returnDateTo, sortDir])

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.data ?? d ?? []))
      .catch(() => {})
  }, [])

  // Count returns with a UPS estimated delivery of today (not yet delivered)
  useEffect(() => {
    fetch('/api/returns/scheduled-today')
      .then((r) => r.ok ? r.json() : { count: 0, deliveredToday: 0 })
      .then((d) => { setScheduledToday(d.count ?? 0); setDeliveredToday(d.deliveredToday ?? 0) })
      .catch(() => { setScheduledToday(0); setDeliveredToday(0) })
  }, [])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  // Auto-refresh tracking — runs once on mount.
  // Fetches up to 1000 records that have a tracking number but no status yet
  // (across ALL pages, not just the current one), then sweeps them in sequence.
  useEffect(() => {
    let cancelled = false

    async function sweep() {
      // Fetch stale records independently of current page / filters
      let staleIds: string[] = []
      try {
        const res = await fetch('/api/returns?trackingFilter=not_checked&limit=1000')
        if (!res.ok || cancelled) return
        const data = await res.json()
        staleIds = (data.data as { id: string }[]).map((r) => r.id)
      } catch {
        return
      }

      if (staleIds.length === 0 || cancelled) return

      setAutoRefreshing(true)
      setAutoRefreshDone(0)
      setAutoRefreshTotal(staleIds.length)

      let done = 0
      for (const id of staleIds) {
        if (cancelled) break
        try {
          await fetch(`/api/returns/${id}/refresh-tracking`, { method: 'POST' })
          done++
          if (!cancelled) setAutoRefreshDone(done)
        } catch {
          // ignore individual failures — UPS creds not set, non-UPS carrier, etc.
        }
      }

      if (!cancelled) {
        setAutoRefreshing(false)
        if (done > 0) load() // reload visible page to show updated statuses
      }
    }

    sweep()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Today's delivery indicators */}
      {(scheduledToday !== null || deliveredToday !== null) && (scheduledToday! > 0 || deliveredToday! > 0) && (
        <div className="flex flex-wrap gap-3 mb-4">
          {scheduledToday !== null && scheduledToday > 0 && (
            <div className="flex items-center gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-white text-xs font-bold">
                {scheduledToday}
              </span>
              <span className="text-sm font-medium text-amber-800">
                {scheduledToday === 1
                  ? '1 return scheduled for UPS delivery today'
                  : `${scheduledToday} returns scheduled for UPS delivery today`}
              </span>
            </div>
          )}
          {deliveredToday !== null && deliveredToday > 0 && (
            <div className="flex items-center gap-2.5 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-500 text-white text-xs font-bold">
                {deliveredToday}
              </span>
              <span className="text-sm font-medium text-green-800">
                {deliveredToday === 1
                  ? '1 return delivered today'
                  : `${deliveredToday} returns delivered today`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            autoComplete="off"
            placeholder="Search order ID, SKU, tracking…"
            className="h-9 w-64 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        {/* Tracking status filter */}
        <select
          value={trackingFilter}
          onChange={(e) => { setTrackingFilter(e.target.value); setPage(1) }}
          className="h-9 rounded-md border border-gray-300 px-2 pr-7 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          <option value="all">All Tracking</option>
          <option value="delivered">Delivered</option>
          <option value="in_transit">In Transit</option>
          <option value="not_checked">Not Checked Yet</option>
          <option value="no_tracking">No Tracking #</option>
        </select>

        {/* Return date range */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 whitespace-nowrap">Return date:</span>
          <input
            type="date"
            value={returnDateFrom}
            onChange={(e) => { setReturnDateFrom(e.target.value); setPage(1) }}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            value={returnDateTo}
            onChange={(e) => { setReturnDateTo(e.target.value); setPage(1) }}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          {(returnDateFrom || returnDateTo) && (
            <button
              type="button"
              onClick={() => { setReturnDateFrom(''); setReturnDateTo(''); setPage(1) }}
              className="text-gray-400 hover:text-gray-600"
              title="Clear date filter"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex-1" />

        {autoRefreshing && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 size={12} className="animate-spin" />
            Refreshing tracking ({autoRefreshDone}/{autoRefreshTotal})…
          </span>
        )}

        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
          (search || trackingFilter !== 'all' || returnDateFrom || returnDateTo)
            ? 'bg-amazon-blue/10 text-amazon-blue ring-1 ring-amazon-blue/30'
            : 'bg-gray-100 text-gray-600'
        }`}>
          {total.toLocaleString()} {(search || trackingFilter !== 'all' || returnDateFrom || returnDateTo) ? 'filtered' : ''} return{total !== 1 ? 's' : ''}
        </span>

        <button
          type="button"
          onClick={() => setShowSync(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <RefreshCw size={14} />
          Import from Amazon
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
      ) : returns.length === 0 ? (
        <div className="py-20 text-center">
          <RotateCcw size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">
            {search ? 'No returns match your search' : 'No returns imported yet'}
          </p>
          {!search && (
            <button type="button" onClick={() => setShowSync(true)}
              className="mt-3 text-sm text-amazon-blue hover:underline">
              Import returns from Amazon
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-800 border-b-2 border-gray-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Order ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Order Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Order Age</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); setPage(1) }}
                      className="flex items-center gap-1 hover:text-white transition-colors"
                    >
                      Return Request Date
                      {sortDir === 'desc' ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      RMA #
                      <span title="Amazon does not include RMA numbers in the flat-file report. They are only visible in Seller Central's Manage Returns UI.">
                        <Info size={10} className="text-gray-500 cursor-help" />
                      </span>
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Return Tracking</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">SKU</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Value</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-300 uppercase tracking-wide whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {returns.map((ret, rowIdx) => (
                  <tr key={ret.id} className={rowIdx % 2 === 0 ? 'bg-white hover:bg-blue-50/50' : 'bg-gray-50 hover:bg-blue-50/50'}>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      <a
                        href={`https://sellercentral.amazon.com/orders-v3/order/${ret.orderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amazon-blue hover:underline"
                      >
                        {ret.orderId}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {fmtDate(ret.orderDate) ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <AgeChip days={orderAgeDays(ret.orderDate)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {fmtDate(ret.returnDate) ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {ret.rmaId ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <TrackingCell ret={ret} onRefreshed={load} />
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      {ret.title ? (
                        <p className="text-xs text-gray-700 truncate" title={ret.title}>{ret.title}</p>
                      ) : (
                        <span className="text-gray-400 text-xs">{ret.asin ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                      {ret.sku ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-700 whitespace-nowrap">
                      {ret.quantity ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                      {ret.returnValue != null
                        ? `$${parseFloat(ret.returnValue).toFixed(2)}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {ret.returnStatus ? (
                        <span className={clsx(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
                          ret.returnStatus.toUpperCase().includes('REIMBURSE')
                            ? 'bg-green-100 text-green-700'
                            : ret.returnStatus.toUpperCase().includes('RETURN')
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600',
                        )}>
                          {ret.returnStatus}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>{(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="h-8 px-3 rounded border border-gray-300 text-xs hover:bg-gray-50 disabled:opacity-40">
                  Previous
                </button>
                <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="h-8 px-3 rounded border border-gray-300 text-xs hover:bg-gray-50 disabled:opacity-40">
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showSync && accounts.length > 0 && (
        <SyncPanel
          accounts={accounts}
          onSynced={() => { setShowSync(false); load() }}
          onClose={() => setShowSync(false)}
        />
      )}

      {showSync && accounts.length === 0 && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <p className="text-sm font-medium text-gray-900 mb-2">No Amazon account connected</p>
            <p className="text-xs text-gray-500 mb-4">
              Connect your Amazon Seller account first from the Connect Amazon page.
            </p>
            <button type="button" onClick={() => setShowSync(false)}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium w-full">
              OK
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

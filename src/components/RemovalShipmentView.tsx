'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Search, RefreshCcw, ChevronDown, ChevronRight, PackageMinus, X, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AmazonAccount {
  id: string
  sellerId: string
  marketplaceName: string
}

interface ImportJob {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
}

interface RemovalOrder {
  id: string
  removalOrderId: string
  orderType: string | null
  orderStatus: string | null
  orderSource: string | null
  requestDate: string | null
  lastUpdatedDate: string | null
  _count: { items: number }
  totals: {
    requested: number
    shipped: number
    inProcess: number
    cancelled: number
    disposed: number
  }
}

interface RemovalOrderItem {
  id: string
  sellerSku: string
  fnsku: string
  disposition: string | null
  requestedQty: number
  cancelledQty: number
  disposedQty: number
  shippedQty: number
  inProcessQty: number
  removalFee: string | null
  currency: string | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: string | null) {
  const s = (status ?? '').toLowerCase()
  if (s === 'completed') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  if (s === 'pending')   return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
  if (s === 'cancelled') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RemovalShipmentView() {
  // Accounts & sync
  const [accounts, setAccounts] = useState<AmazonAccount[]>([])
  const [syncAccountId, setSyncAccountId] = useState('')
  const [syncStart, setSyncStart] = useState('')
  const [syncEnd, setSyncEnd] = useState('')
  const [showSync, setShowSync] = useState(false)
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null)
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Data
  const [orders, setOrders] = useState<RemovalOrder[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('requestDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Expanded rows
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<RemovalOrderItem[]>([])
  const [expandLoading, setExpandLoading] = useState(false)

  // Load accounts
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((data: AmazonAccount[]) => {
        setAccounts(data)
        if (data.length > 0) setSyncAccountId(data[0].id)
      })
      .catch(() => {})
  }, [])

  // Fetch orders
  const fetchOrders = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '25',
        sortBy,
        sortDir,
      })
      if (search) params.set('search', search)
      const res = await fetch(`/api/removal-shipments?${params}`)
      const json = await res.json()
      setOrders(json.data ?? [])
      setPagination(json.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 })
    } catch { /* ignore */ }
    setLoading(false)
  }, [search, sortBy, sortDir])

  useEffect(() => { fetchOrders(1) }, [fetchOrders])

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (jobPollRef.current) clearInterval(jobPollRef.current) }
  }, [])

  // ── Sync logic ──────────────────────────────────────────────────────────────

  function startJobPolling(jobId: string) {
    if (jobPollRef.current) clearInterval(jobPollRef.current)
    jobPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/removal-shipments/sync?jobId=${jobId}`)
        if (!res.ok) return
        const job: ImportJob = await res.json()
        setActiveJob(job)
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(jobPollRef.current!)
          jobPollRef.current = null
          if (job.status === 'COMPLETED') fetchOrders(1)
        }
      } catch { /* transient poll error */ }
    }, 3_000)
  }

  function daysBackRange(daysBack: number) {
    const end = new Date(Date.now() - 5 * 60 * 1000)
    const start = new Date(end.getTime() - daysBack * 86_400_000)
    return { start, end }
  }

  const isSyncing = activeJob && (activeJob.status === 'RUNNING' || activeJob.status === 'PENDING')

  async function triggerSync(daysBack?: number) {
    if (!syncAccountId) return
    let startDt: Date, endDt: Date
    if (daysBack != null) {
      const r = daysBackRange(daysBack)
      startDt = r.start; endDt = r.end
    } else {
      if (!syncStart || !syncEnd) { alert('Select start and end dates'); return }
      startDt = new Date(syncStart)
      endDt = new Date(syncEnd + 'T23:59:59')
    }

    const body = JSON.stringify({ accountId: syncAccountId, startDate: startDt.toISOString(), endDate: endDt.toISOString() })
    try {
      const res = await fetch('/api/removal-shipments/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (res.ok) {
        const { jobId } = await res.json()
        setActiveJob({ id: jobId, status: 'PENDING', totalFound: 0, totalUpserted: 0, errorMessage: null })
        startJobPolling(jobId)
      } else {
        setActiveJob({ id: '', status: 'FAILED', totalFound: 0, totalUpserted: 0, errorMessage: 'Failed to start sync' })
      }
    } catch {
      setActiveJob({ id: '', status: 'FAILED', totalFound: 0, totalUpserted: 0, errorMessage: 'Network error' })
    }
  }

  // ── Expand row ──────────────────────────────────────────────────────────────

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    setExpandLoading(true)
    setExpandedItems([])
    try {
      const res = await fetch(`/api/removal-shipments/${id}`)
      const json = await res.json()
      setExpandedItems(json.items ?? [])
    } catch { /* ignore */ }
    setExpandLoading(false)
  }

  // ── Sort toggle ─────────────────────────────────────────────────────────────

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return null
    return <span className="ml-1 text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order ID, SKU, FNSKU..."
            className="h-9 pl-8 pr-3 w-64 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        {pagination.total > 0 && (
          <span className="text-xs text-gray-400">
            {pagination.total} order{pagination.total !== 1 ? 's' : ''}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setShowSync(s => !s)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <RefreshCcw size={14} /> Sync
        </button>
      </div>

      {/* Sync panel */}
      {showSync && (
        <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-500 uppercase">Sync Removals</span>
          <select className="input w-56" value={syncAccountId}
            onChange={e => setSyncAccountId(e.target.value)}>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.marketplaceName} ({a.sellerId})</option>
            ))}
          </select>
          <button className="btn-primary text-sm" onClick={() => triggerSync(7)}
            disabled={!!isSyncing}>
            Last 7 Days
          </button>
          <button className="btn-ghost text-sm" onClick={() => triggerSync(30)}
            disabled={!!isSyncing}>
            Last 30 Days
          </button>
          <button className="btn-ghost text-sm" onClick={() => triggerSync(60)}
            disabled={!!isSyncing}>
            Last 60 Days
          </button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <input type="date" className="input w-36 text-sm" value={syncStart} onChange={e => setSyncStart(e.target.value)} />
          <span className="text-gray-400 text-xs">to</span>
          <input type="date" className="input w-36 text-sm" value={syncEnd} onChange={e => setSyncEnd(e.target.value)} />
          <button className="btn-primary text-sm" onClick={() => triggerSync()}
            disabled={!syncStart || !syncEnd || !!isSyncing}>
            Sync Range
          </button>
          <button className="btn-ghost text-sm" onClick={() => setShowSync(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Sync progress banner */}
      {activeJob && (
        <div className={clsx(
          'px-4 py-2 border-b text-xs flex items-center gap-2',
          activeJob.status === 'FAILED' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' :
          activeJob.status === 'COMPLETED' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' :
          'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
        )}>
          {isSyncing && <Loader2 size={12} className="animate-spin" />}
          {activeJob.status === 'PENDING' && 'Starting sync...'}
          {activeJob.status === 'RUNNING' && `Syncing... ${activeJob.totalUpserted} rows processed`}
          {activeJob.status === 'COMPLETED' && `Sync complete — ${activeJob.totalUpserted} of ${activeJob.totalFound} rows imported`}
          {activeJob.status === 'FAILED' && `Sync failed: ${activeJob.errorMessage ?? 'Unknown error'}`}
          {(activeJob.status === 'COMPLETED' || activeJob.status === 'FAILED') && (
            <button className="ml-2 underline" onClick={() => setActiveJob(null)}>Dismiss</button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
        ) : orders.length === 0 ? (
          <div className="py-20 text-center">
            <PackageMinus size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {search ? 'No removal orders match your search' : 'No removal orders synced yet'}
            </p>
            {!search && (
              <button onClick={() => setShowSync(true)} className="mt-3 text-sm text-amazon-blue hover:underline">
                Sync removal orders from Amazon
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className="w-8" />
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('removalOrderId')}>
                  Order ID<SortIcon col="removalOrderId" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('orderType')}>
                  Type<SortIcon col="orderType" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('orderStatus')}>
                  Status<SortIcon col="orderStatus" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('requestDate')}>
                  Request Date<SortIcon col="requestDate" />
                </th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">Requested</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">Shipped</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">In Process</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">SKUs</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <React.Fragment key={o.id}>
                  <tr
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 align-middle cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors',
                      i % 2 === 0
                        ? 'bg-white dark:bg-gray-900'
                        : 'bg-gray-50 dark:bg-gray-800/50',
                      expandedId === o.id && 'bg-blue-50 dark:bg-blue-900/10',
                    )}
                    onClick={() => toggleExpand(o.id)}
                  >
                    <td className="px-2 py-1.5 text-center">
                      {expandedId === o.id
                        ? <ChevronDown size={14} className="text-gray-400 inline" />
                        : <ChevronRight size={14} className="text-gray-400 inline" />}
                    </td>
                    <td className="px-3 py-1.5 font-mono font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      {o.removalOrderId}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                      {o.orderType ?? '—'}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold', statusBadge(o.orderStatus))}>
                        {o.orderStatus ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {fmtDate(o.requestDate)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {o.totals.requested}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">
                      {o.totals.shipped}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">
                      {o.totals.inProcess}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500">
                      {o._count.items}
                    </td>
                  </tr>

                  {/* Expanded items sub-table */}
                  {expandedId === o.id && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <div className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 px-6 py-3">
                          {expandLoading ? (
                            <p className="text-xs text-gray-400 py-2 flex items-center gap-2">
                              <Loader2 size={12} className="animate-spin" /> Loading items...
                            </p>
                          ) : expandedItems.length === 0 ? (
                            <p className="text-xs text-gray-400 py-2 italic">No items in this order</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-200 dark:border-gray-600">
                                  <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">SKU</th>
                                  <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">FNSKU</th>
                                  <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Disposition</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500 dark:text-gray-400">Requested</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500 dark:text-gray-400">Shipped</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500 dark:text-gray-400">In Process</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500 dark:text-gray-400">Cancelled</th>
                                  <th className="px-2 py-1.5 text-right font-semibold text-gray-500 dark:text-gray-400">Fee</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expandedItems.map((item) => (
                                  <tr key={item.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                                    <td className="px-2 py-1.5 font-mono text-gray-800 dark:text-gray-200">{item.sellerSku}</td>
                                    <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{item.fnsku}</td>
                                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{item.disposition ?? '—'}</td>
                                    <td className="px-2 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100">{item.requestedQty}</td>
                                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300">{item.shippedQty}</td>
                                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300">{item.inProcessQty}</td>
                                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300">{item.cancelledQty}</td>
                                    <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-400">
                                      {item.removalFee ? `$${Number(item.removalFee).toFixed(2)}` : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="px-4 py-2 border-t bg-white dark:bg-gray-900 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <div className="flex gap-1">
            <button
              disabled={pagination.page <= 1}
              onClick={() => fetchOrders(pagination.page - 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Prev
            </button>
            <button
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => fetchOrders(pagination.page + 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

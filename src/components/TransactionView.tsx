'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, RefreshCcw, X, Loader2, CreditCard } from 'lucide-react'
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

interface Transaction {
  id: string
  transactionType: string
  transactionStatus: string
  postedDate: string
  totalAmount: string
  currency: string
  description: string | null
  creditOrDebit: string
  orderId: string | null
  shipmentId: string | null
  fulfillmentChannel: string | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface Summary {
  totalCredits: number
  totalDebits: number
  netAmount: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(val: number) {
  const abs = Math.abs(val)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (val >= 0) return `+$${formatted}`
  return `-$${formatted}`
}

function typeColor(type: string) {
  switch (type) {
    case 'Shipment': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    case 'Refund': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    case 'ServiceFee': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
    case 'Adjustment': return 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
    case 'Transfer': return 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'RELEASED': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    case 'DEFERRED': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
  }
}

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
]

const TYPE_OPTIONS = ['All Types', 'Shipment', 'Refund', 'ServiceFee', 'Adjustment', 'Transfer', 'Other']

// ─── Component ──────────────────────────────────────────────────────────────

export default function TransactionView() {
  const [accounts, setAccounts] = useState<AmazonAccount[]>([])
  const [syncAccountId, setSyncAccountId] = useState('')
  const [syncStart, setSyncStart] = useState('')
  const [syncEnd, setSyncEnd] = useState('')
  const [showSync, setShowSync] = useState(false)
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null)
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 0 })
  const [summary, setSummary] = useState<Summary>({ totalCredits: 0, totalDebits: 0, netAmount: 0 })
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [datePreset, setDatePreset] = useState<number | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [creditDebitFilter, setCreditDebitFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fulfillmentFilter, setFulfillmentFilter] = useState('')

  // Sort
  const [sortBy, setSortBy] = useState('postedDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((data: AmazonAccount[]) => {
        setAccounts(data)
        if (data.length > 0) setSyncAccountId(data[0].id)
      })
      .catch(() => {})
  }, [])

  // Compute effective date range from preset or manual inputs
  const getDateParams = useCallback(() => {
    const params: Record<string, string> = {}
    if (datePreset !== null) {
      if (datePreset === 0) {
        const today = new Date().toISOString().slice(0, 10)
        params.startDate = today
        params.endDate = today
      } else {
        const end = new Date()
        const start = new Date(end.getTime() - datePreset * 86_400_000)
        params.startDate = start.toISOString().slice(0, 10)
        params.endDate = end.toISOString().slice(0, 10)
      }
    } else {
      if (startDate) params.startDate = startDate
      if (endDate) params.endDate = endDate
    }
    return params
  }, [datePreset, startDate, endDate])

  const fetchTransactions = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '50', sortBy, sortDir })
      if (search) params.set('search', search)
      if (typeFilter) params.set('type', typeFilter)
      if (creditDebitFilter) params.set('creditOrDebit', creditDebitFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (fulfillmentFilter) params.set('fulfillment', fulfillmentFilter)
      const dateParams = getDateParams()
      Object.entries(dateParams).forEach(([k, v]) => params.set(k, v))

      const res = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      setTransactions(json.data ?? [])
      setPagination(json.pagination ?? { page: 1, pageSize: 50, total: 0, totalPages: 0 })
      setSummary(json.summary ?? { totalCredits: 0, totalDebits: 0, netAmount: 0 })
    } catch { /* ignore */ }
    setLoading(false)
  }, [search, typeFilter, creditDebitFilter, statusFilter, fulfillmentFilter, sortBy, sortDir, getDateParams])

  useEffect(() => { fetchTransactions(1) }, [fetchTransactions])
  useEffect(() => { return () => { if (jobPollRef.current) clearInterval(jobPollRef.current) } }, [])

  // ── Date preset handler ──────────────────────────────────────────────────

  function selectPreset(days: number) {
    if (datePreset === days) {
      setDatePreset(null)
    } else {
      setDatePreset(days)
      setStartDate('')
      setEndDate('')
    }
  }

  function handleManualDate(field: 'start' | 'end', value: string) {
    setDatePreset(null)
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  function clearFilters() {
    setSearch('')
    setDatePreset(null)
    setStartDate('')
    setEndDate('')
    setTypeFilter('')
    setCreditDebitFilter('')
    setStatusFilter('')
    setFulfillmentFilter('')
  }

  const hasFilters = search || datePreset !== null || startDate || endDate || typeFilter || creditDebitFilter || statusFilter || fulfillmentFilter

  // ── Sync ────────────────────────────────────────────────────────────────

  function startJobPolling(jobId: string) {
    if (jobPollRef.current) clearInterval(jobPollRef.current)
    jobPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/transactions/sync?jobId=${jobId}`)
        if (!res.ok) return
        const job: ImportJob = await res.json()
        setActiveJob(job)
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(jobPollRef.current!)
          jobPollRef.current = null
          if (job.status === 'COMPLETED') fetchTransactions(1)
        }
      } catch { /* ignore */ }
    }, 3_000)
  }

  const isSyncing = activeJob && (activeJob.status === 'RUNNING' || activeJob.status === 'PENDING')

  async function triggerSync(daysBack?: number) {
    if (!syncAccountId) return
    let startDt: Date, endDt: Date
    if (daysBack != null) {
      const end = new Date(Date.now() - 5 * 60 * 1000)
      startDt = new Date(end.getTime() - daysBack * 86_400_000)
      endDt = end
    } else {
      if (!syncStart || !syncEnd) { alert('Select start and end dates'); return }
      startDt = new Date(syncStart)
      endDt = new Date(syncEnd + 'T23:59:59')
    }

    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: syncAccountId, startDate: startDt.toISOString(), endDate: endDt.toISOString() }),
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

  // ── Sort ──────────────────────────────────────────────────────────────────

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return null
    return <span className="ml-1 text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar row 1: Search + record count + Sync button */}
      <div className="px-4 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order ID, description, type..."
            className="h-9 pl-8 pr-3 w-64 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        {pagination.total > 0 && (
          <span className="text-xs text-gray-400">
            {pagination.total.toLocaleString()} transaction{pagination.total !== 1 ? 's' : ''}
          </span>
        )}

        <div className="flex-1" />

        <button onClick={() => setShowSync(s => !s)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">
          <RefreshCcw size={14} /> Sync
        </button>
      </div>

      {/* Toolbar row 2: Filters */}
      <div className="px-4 py-2 border-b bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 flex flex-wrap items-center gap-2">
        {/* Date presets */}
        {DATE_PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => selectPreset(p.days)}
            className={clsx(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              datePreset === p.days
                ? 'bg-amazon-orange text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600',
            )}
          >
            {p.label}
          </button>
        ))}

        <span className="text-gray-300 dark:text-gray-600">|</span>

        {/* Date range inputs */}
        <input
          type="date"
          className="h-7 px-2 w-32 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 text-xs"
          value={startDate}
          onChange={(e) => handleManualDate('start', e.target.value)}
        />
        <span className="text-gray-400 text-xs">to</span>
        <input
          type="date"
          className="h-7 px-2 w-32 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 text-xs"
          value={endDate}
          onChange={(e) => handleManualDate('end', e.target.value)}
        />

        <span className="text-gray-300 dark:text-gray-600">|</span>

        {/* Type filter */}
        <select
          className="h-7 px-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 text-xs"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {TYPE_OPTIONS.map(t => (
            <option key={t} value={t === 'All Types' ? '' : t}>{t}</option>
          ))}
        </select>

        {/* Credit/Debit filter */}
        <select
          className="h-7 px-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 text-xs"
          value={creditDebitFilter}
          onChange={(e) => setCreditDebitFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="CREDIT">Credits</option>
          <option value="DEBIT">Debits</option>
        </select>

        {/* Status filter */}
        <select
          className="h-7 px-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="DEFERRED">DEFERRED</option>
          <option value="RELEASED">RELEASED</option>
        </select>

        {/* Fulfillment filter */}
        <select
          className="h-7 px-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 text-xs"
          value={fulfillmentFilter}
          onChange={(e) => setFulfillmentFilter(e.target.value)}
        >
          <option value="">All Fulfillment</option>
          <option value="FBA">FBA</option>
          <option value="MFN">FBM</option>
        </select>

        {/* Clear filters */}
        {hasFilters && (
          <button onClick={clearFilters} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Clear filters">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Sync panel */}
      {showSync && (
        <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-500 uppercase">Sync Transactions</span>
          <select className="input w-56" value={syncAccountId} onChange={e => setSyncAccountId(e.target.value)}>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.marketplaceName} ({a.sellerId})</option>
            ))}
          </select>
          <button className="btn-primary text-sm" onClick={() => triggerSync(7)} disabled={!!isSyncing}>Last 7 Days</button>
          <button className="btn-ghost text-sm" onClick={() => triggerSync(30)} disabled={!!isSyncing}>Last 30 Days</button>
          <button className="btn-ghost text-sm" onClick={() => triggerSync(60)} disabled={!!isSyncing}>Last 60 Days</button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <input type="date" className="input w-36 text-sm" value={syncStart} onChange={e => setSyncStart(e.target.value)} />
          <span className="text-gray-400 text-xs">to</span>
          <input type="date" className="input w-36 text-sm" value={syncEnd} onChange={e => setSyncEnd(e.target.value)} />
          <button className="btn-primary text-sm" onClick={() => triggerSync()} disabled={!syncStart || !syncEnd || !!isSyncing}>Sync Range</button>
          <button className="btn-ghost text-sm" onClick={() => setShowSync(false)}><X size={14} /></button>
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
          {activeJob.status === 'RUNNING' && `Syncing... ${activeJob.totalUpserted} transactions processed`}
          {activeJob.status === 'COMPLETED' && `Sync complete — ${activeJob.totalUpserted} of ${activeJob.totalFound} transactions imported`}
          {activeJob.status === 'FAILED' && `Sync failed: ${activeJob.errorMessage ?? 'Unknown error'}`}
          {(activeJob.status === 'COMPLETED' || activeJob.status === 'FAILED') && (
            <button className="ml-2 underline" onClick={() => setActiveJob(null)}>Dismiss</button>
          )}
        </div>
      )}

      {/* Summary bar */}
      {pagination.total > 0 && (
        <div className="px-4 py-2 border-b bg-white dark:bg-gray-900 dark:border-gray-700 flex items-center gap-6 text-xs">
          <span className="text-green-600 dark:text-green-400 font-semibold">
            Credits: +${Math.abs(summary.totalCredits).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
          <span className="text-red-600 dark:text-red-400 font-semibold">
            Debits: -${Math.abs(summary.totalDebits).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
          <span className={clsx('font-semibold', summary.netAmount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
            Net: {fmtMoney(summary.netAmount)}
          </span>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="py-20 text-center">
            <CreditCard size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {hasFilters ? 'No transactions match your filters' : 'No transactions synced yet'}
            </p>
            {!hasFilters && (
              <button onClick={() => setShowSync(true)} className="mt-3 text-sm text-amazon-blue hover:underline">
                Sync transactions from Amazon
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th
                  className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none"
                  onClick={() => handleSort('postedDate')}
                >
                  Date<SortIcon col="postedDate" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Order ID</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Description</th>
                <th
                  className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none"
                  onClick={() => handleSort('totalAmount')}
                >
                  Amount<SortIcon col="totalAmount" />
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t, i) => {
                const amount = Number(t.totalAmount)
                return (
                  <tr
                    key={t.id}
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 align-middle',
                      i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50',
                    )}
                  >
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDate(t.postedDate)}</td>
                    <td className="px-3 py-1.5">
                      <span className={clsx('inline-block px-2 py-0.5 rounded text-[10px] font-semibold', typeColor(t.transactionType))}>
                        {t.transactionType}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={clsx('inline-block px-2 py-0.5 rounded text-[10px] font-semibold', statusColor(t.transactionStatus))}>
                        {t.transactionStatus}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {t.orderId ? (
                        <span className="inline-flex items-center gap-1.5">
                          {t.orderId}
                          {t.fulfillmentChannel && (
                            <span className={clsx(
                              'inline-block px-1.5 py-0.5 rounded text-[9px] font-bold leading-none',
                              t.fulfillmentChannel === 'FBA'
                                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
                            )}>
                              {t.fulfillmentChannel === 'MFN' ? 'FBM' : t.fulfillmentChannel}
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-xs truncate" title={t.description ?? ''}>
                      {t.description ?? '—'}
                    </td>
                    <td className={clsx(
                      'px-3 py-1.5 text-right font-semibold whitespace-nowrap',
                      amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
                    )}>
                      {fmtMoney(amount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="px-4 py-2 border-t bg-white dark:bg-gray-900 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total.toLocaleString()} total)</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1} onClick={() => fetchTransactions(pagination.page - 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Prev</button>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchTransactions(pagination.page + 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

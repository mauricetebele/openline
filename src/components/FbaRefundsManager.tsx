'use client'
import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import {
  Search, RefreshCcw, ChevronUp, ChevronDown,
  ChevronsUpDown, Copy, Check, X, AlertCircle, Download, CheckCircle,
} from 'lucide-react'
import { clsx } from 'clsx'

type SortBy = 'refundDate' | 'refundAmount' | 'orderId' | 'sku' | 'fnsku' | 'asin' | 'title' | 'originalOrderDate' | 'refundQty' | 'validatedAt'
type SortDir = 'asc' | 'desc'
type ActiveTab = 'unvalidated' | 'validated'

interface ReturnInfo {
  status: string
  date: string | null
  lpn: string | null
}

interface ReimbursementInfo {
  date: string
  amount: string
  currency: string
}

interface OrderItemInfo {
  lineItemCount: number
  maxQty: number
}

interface FbaRefund {
  id: string
  orderId: string
  adjustmentId: string
  sku: string | null
  fnsku: string | null
  asin: string | null
  title: string | null
  refundAmount: string
  currency: string
  refundQty: number
  refundDate: string
  originalOrderDate: string | null
  marketplaceId: string
  account: { marketplaceName: string }
  returnInfo: ReturnInfo | null
  lpn: string | null
  reimbursementInfo: ReimbursementInfo | null
  validationStatus: 'UNVALIDATED' | 'VALIDATED' | 'MANUAL_REVIEW'
  validatedAt: string | null
  validationReason: string | null
  validationSource: string | null
  orderItemInfo: OrderItemInfo | null
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number }
interface TabCounts { unvalidated: number; validated: number }

interface ImportJob {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
}

interface AmazonAccount {
  id: string
  sellerId: string
  marketplaceName: string
  isActive: boolean
}

function AgeBadge({ refundDate }: { refundDate: string }) {
  const days = Math.floor((Date.now() - new Date(refundDate).getTime()) / 86_400_000)
  const cls = days < 30
    ? 'badge-green'
    : days < 60
    ? 'badge-orange'
    : 'badge-red'
  return <span className={cls}>{days}d</span>
}

function SortIcon({ field, current, dir }: { field: string; current: string; dir: SortDir }) {
  if (field !== current) return <ChevronsUpDown size={12} className="text-gray-400" />
  return dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={handleCopy} className="ml-1 text-gray-400 hover:text-gray-700 transition-colors" title="Copy">
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </button>
  )
}

export default function FbaRefundsManager() {
  const [refunds, setRefunds] = useState<FbaRefund[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [tabCounts, setTabCounts] = useState<TabCounts>({ unvalidated: 0, validated: 0 })
  const [withinWindow, setWithinWindow] = useState<{ currency: string; total: number; count: number }[]>([])
  const [loading, setLoading] = useState(false)

  // Tabs
  const [activeTab, setActiveTab] = useState<ActiveTab>('unvalidated')

  // Filters
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('refundDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [reimbursedFilter, setReimbursedFilter] = useState<'' | 'yes' | 'no'>('')
  const [needsAttention, setNeedsAttention] = useState(false)

  // Accounts
  const [accounts, setAccounts] = useState<AmazonAccount[]>([])

  // Sync panel (unified)
  const [showSync, setShowSync] = useState(false)
  const [syncAccountId, setSyncAccountId] = useState('')
  const [syncStart, setSyncStart] = useState('')
  const [syncEnd, setSyncEnd] = useState('')

  // Background import jobs
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null)
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [activeReturnJob, setActiveReturnJob] = useState<ImportJob | null>(null)
  const returnJobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [activeReimbursementJob, setActiveReimbursementJob] = useState<ImportJob | null>(null)
  const reimbursementJobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-validate state
  const [autoValidating, setAutoValidating] = useState(false)

  // Load accounts
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((data: AmazonAccount[]) => {
        setAccounts(data)
        if (data.length > 0) {
          setSyncAccountId(data[0].id)
          setReturnSyncAccountId(data[0].id)
          setReimbursementSyncAccountId(data[0].id)
        }
      })
      .catch(() => {})
  }, [])

  function startJobPolling(jobId: string) {
    if (jobPollRef.current) clearInterval(jobPollRef.current)
    jobPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/fba-refunds/sync?jobId=${jobId}`)
        if (!res.ok) return
        const job: ImportJob = await res.json()
        setActiveJob(job)
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(jobPollRef.current!)
          jobPollRef.current = null
          if (job.status === 'COMPLETED') fetchRefunds(1)
        }
      } catch { /* transient poll error */ }
    }, 3_000)
  }

  function startReturnJobPolling(jobId: string) {
    if (returnJobPollRef.current) clearInterval(returnJobPollRef.current)
    returnJobPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/fba-returns/sync?jobId=${jobId}`)
        if (!res.ok) return
        const job: ImportJob = await res.json()
        setActiveReturnJob(job)
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(returnJobPollRef.current!)
          returnJobPollRef.current = null
          if (job.status === 'COMPLETED') fetchRefunds(1)
        }
      } catch { /* transient poll error */ }
    }, 3_000)
  }

  function startReimbursementJobPolling(jobId: string) {
    if (reimbursementJobPollRef.current) clearInterval(reimbursementJobPollRef.current)
    reimbursementJobPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/fba-reimbursements/sync?jobId=${jobId}`)
        if (!res.ok) return
        const job: ImportJob = await res.json()
        setActiveReimbursementJob(job)
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(reimbursementJobPollRef.current!)
          reimbursementJobPollRef.current = null
          if (job.status === 'COMPLETED') fetchRefunds(1)
        }
      } catch { /* transient poll error */ }
    }, 3_000)
  }

  useEffect(() => {
    return () => {
      if (jobPollRef.current) clearInterval(jobPollRef.current)
      if (returnJobPollRef.current) clearInterval(returnJobPollRef.current)
      if (reimbursementJobPollRef.current) clearInterval(reimbursementJobPollRef.current)
    }
  }, [])

  const [fetchPage, setFetchPage] = useState(1)
  const [fetchKey, setFetchKey] = useState(0)

  function fetchRefunds(page = 1) {
    setFetchPage(page)
    setFetchKey(k => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const params = new URLSearchParams()
    params.set('page', String(fetchPage))
    params.set('pageSize', '25')
    params.set('sortBy', sortBy)
    params.set('sortDir', sortDir)
    if (search) params.set('search', search)
    if (startDate) params.set('startDate', new Date(startDate).toISOString())
    if (endDate) params.set('endDate', new Date(endDate + 'T23:59:59').toISOString())
    if (accountFilter) params.set('accountId', accountFilter)
    if (reimbursedFilter) params.set('reimbursed', reimbursedFilter)

    // Tab → validationStatus filter
    if (activeTab === 'unvalidated') {
      if (needsAttention) {
        params.set('needsAttention', 'true')
      } else {
        params.set('validationStatus', 'UNVALIDATED,MANUAL_REVIEW')
      }
    } else {
      params.set('validationStatus', 'VALIDATED')
    }

    fetch(`/api/fba-refunds?${params}`)
      .then(async res => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then(data => {
        if (cancelled) return
        setRefunds(data.data)
        setPagination(data.pagination)
        if (data.tabCounts) setTabCounts(data.tabCounts)
        if (data.withinWindow) setWithinWindow(data.withinWindow)
      })
      .catch(err => {
        if (!cancelled) console.error('[FbaRefunds] fetch failed:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [fetchPage, fetchKey, search, startDate, endDate, accountFilter, sortBy, sortDir, activeTab, reimbursedFilter, needsAttention])

  function toggleSort(field: SortBy) {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  function daysBackRange(daysBack: number): { start: Date; end: Date } {
    const end = new Date(Date.now() - 5 * 60 * 1000)
    const start = new Date(end.getTime() - daysBack * 86_400_000)
    return { start, end }
  }

  const anySyncing = [activeJob, activeReturnJob, activeReimbursementJob].some(
    j => j && (j.status === 'RUNNING' || j.status === 'PENDING'),
  )

  async function triggerSyncAll(daysBack?: number) {
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
    const headers = { 'Content-Type': 'application/json' }

    // Fire all 3 syncs in parallel
    const [refundRes, returnRes, reimbursementRes] = await Promise.allSettled([
      fetch('/api/fba-refunds/sync', { method: 'POST', headers, body }),
      fetch('/api/fba-returns/sync', { method: 'POST', headers, body }),
      fetch('/api/fba-reimbursements/sync', { method: 'POST', headers, body }),
    ])

    if (refundRes.status === 'fulfilled' && refundRes.value.ok) {
      const { jobId } = await refundRes.value.json()
      setActiveJob({ id: jobId, status: 'PENDING', totalFound: 0, totalUpserted: 0, errorMessage: null })
      startJobPolling(jobId)
    } else {
      setActiveJob({ id: '', status: 'FAILED', totalFound: 0, totalUpserted: 0, errorMessage: 'Failed to start refund sync' })
    }

    if (returnRes.status === 'fulfilled' && returnRes.value.ok) {
      const { jobId } = await returnRes.value.json()
      setActiveReturnJob({ id: jobId, status: 'PENDING', totalFound: 0, totalUpserted: 0, errorMessage: null })
      startReturnJobPolling(jobId)
    } else {
      setActiveReturnJob({ id: '', status: 'FAILED', totalFound: 0, totalUpserted: 0, errorMessage: 'Failed to start return sync' })
    }

    if (reimbursementRes.status === 'fulfilled' && reimbursementRes.value.ok) {
      const { jobId } = await reimbursementRes.value.json()
      setActiveReimbursementJob({ id: jobId, status: 'PENDING', totalFound: 0, totalUpserted: 0, errorMessage: null })
      startReimbursementJobPolling(jobId)
    } else {
      setActiveReimbursementJob({ id: '', status: 'FAILED', totalFound: 0, totalUpserted: 0, errorMessage: 'Failed to start reimbursement sync' })
    }

    setShowSync(false)
  }

  async function runAutoValidate() {
    setAutoValidating(true)
    try {
      const res = await fetch('/api/fba-refunds/auto-validate', { method: 'POST' })
      if (!res.ok) {
        alert('Auto-validate failed')
        return
      }
      const result = await res.json()
      alert(`Auto-validate complete: ${result.validated} validated, ${result.manualReview} flagged for manual review, ${result.withinWindow ?? 0} within 60-day window, ${result.unchanged} unchanged`)
      fetchRefunds(1)
    } catch {
      alert('Auto-validate failed')
    } finally {
      setAutoValidating(false)
    }
  }

  async function manualValidate(id: string) {
    try {
      const res = await fetch('/api/fba-refunds/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })
      if (!res.ok) {
        alert('Validation failed')
        return
      }
      fetchRefunds(pagination.page)
    } catch {
      alert('Validation failed')
    }
  }

  const baseColumns = [
    { label: 'Order ID', field: 'orderId' },
    { label: 'Amount', field: 'refundAmount' },
    { label: 'QTY', field: 'refundQty' },
    { label: 'SKU', field: 'sku' },
    { label: 'FNSKU', field: 'fnsku' },
    { label: 'ASIN', field: 'asin' },
    { label: 'Title', field: 'title' },
    { label: 'LPN #', field: null },
    { label: 'Order Date', field: 'originalOrderDate' },
    { label: 'Refund Date', field: 'refundDate' },
    { label: 'Age', field: null },
    { label: 'Returned?', field: null },
    { label: 'Reimbursed?', field: null },
    { label: 'Marketplace', field: null },
  ] as const

  // Validated tab gets an extra sortable "Validated" info column
  const columns = activeTab === 'validated'
    ? [...baseColumns, { label: 'Validated', field: 'validatedAt' } as const]
    : [...baseColumns, { label: '', field: null } as const] // Action column for unvalidated
  const colSpan = columns.length

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b bg-white">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-8"
            placeholder="Search order ID, SKU, FNSKU, ASIN, title..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <input type="date" className="input w-36" value={startDate}
          onChange={e => setStartDate(e.target.value)} />
        <input type="date" className="input w-36" value={endDate}
          onChange={e => setEndDate(e.target.value)} />

        {accounts.length > 1 && (
          <select className="input w-44" value={accountFilter}
            onChange={e => setAccountFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.marketplaceName} ({a.sellerId})</option>
            ))}
          </select>
        )}

        <select className="input w-40" value={reimbursedFilter}
          onChange={e => { setReimbursedFilter(e.target.value as '' | 'yes' | 'no'); fetchRefunds(1) }}>
          <option value="">All refunds</option>
          <option value="yes">Reimbursed</option>
          <option value="no">Not Reimbursed</option>
        </select>

        {withinWindow.length > 0 && (
          <div className="ml-auto flex items-center gap-3 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
            <span className="text-[11px] text-blue-600 font-medium">60-Day Window</span>
            <div className="flex flex-col gap-0.5">
              {[...withinWindow].sort((a, b) => (a.currency === 'USD' ? -1 : b.currency === 'USD' ? 1 : a.currency.localeCompare(b.currency))).map(w => (
                <span key={w.currency} className="flex items-center gap-1">
                  <span className="text-sm font-bold text-blue-800">
                    {w.currency} {w.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-blue-500">({w.count})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={clsx('flex gap-2', !withinWindow.length && 'ml-auto')}>
          <button className="btn-ghost" onClick={() => fetchRefunds(pagination.page)}>
            <RefreshCcw size={14} />
          </button>
          <button className="btn-primary" onClick={() => setShowSync(v => !v)} disabled={anySyncing}>
            {anySyncing ? <RefreshCcw size={14} className="animate-spin" /> : <Download size={14} />} Sync All
          </button>
        </div>
      </div>

      {/* ── Sync panel (unified) ── */}
      {showSync && (
        <div className="px-4 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-500 uppercase">Sync All</span>
          <select className="input w-56" value={syncAccountId}
            onChange={e => setSyncAccountId(e.target.value)}>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.marketplaceName} ({a.sellerId})</option>
            ))}
          </select>
          <button className="btn-primary text-sm" onClick={() => triggerSyncAll(180)}
            disabled={anySyncing}>
            Last 6 Months
          </button>
          <button className="btn-ghost text-sm" onClick={() => triggerSyncAll(7)}
            disabled={anySyncing}>
            Last 7 Days
          </button>
          <span className="text-gray-300">|</span>
          <input type="date" className="input w-36 text-sm" value={syncStart} onChange={e => setSyncStart(e.target.value)} />
          <span className="text-gray-400 text-xs">to</span>
          <input type="date" className="input w-36 text-sm" value={syncEnd} onChange={e => setSyncEnd(e.target.value)} />
          <button className="btn-primary text-sm" onClick={() => triggerSyncAll()}
            disabled={!syncStart || !syncEnd || anySyncing}>
            Sync Range
          </button>
          <button className="btn-ghost text-sm" onClick={() => setShowSync(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Reimbursements import progress banner ── */}
      {activeReimbursementJob && (
        <div className={clsx(
          'px-4 py-3 border-b text-sm',
          activeReimbursementJob.status === 'RUNNING' || activeReimbursementJob.status === 'PENDING'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : activeReimbursementJob.status === 'COMPLETED'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-700',
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {(activeReimbursementJob.status === 'RUNNING' || activeReimbursementJob.status === 'PENDING') && (
                <RefreshCcw size={13} className="animate-spin shrink-0" />
              )}
              {activeReimbursementJob.status === 'FAILED' && (
                <AlertCircle size={14} className="shrink-0" />
              )}
              <span className="truncate">
                {activeReimbursementJob.status === 'PENDING' && 'Starting FBA reimbursements sync...'}
                {activeReimbursementJob.status === 'RUNNING' && activeReimbursementJob.totalFound === 0 && 'Fetching FBA reimbursements from Amazon...'}
                {activeReimbursementJob.status === 'RUNNING' && activeReimbursementJob.totalUpserted > 0 && (
                  <>Importing <strong>{activeReimbursementJob.totalUpserted}</strong> of <strong>{activeReimbursementJob.totalFound}</strong> reimbursements...</>
                )}
                {activeReimbursementJob.status === 'COMPLETED' && (
                  <><strong>{activeReimbursementJob.totalUpserted}</strong> reimbursement{activeReimbursementJob.totalUpserted !== 1 ? 's' : ''} imported successfully</>
                )}
                {activeReimbursementJob.status === 'FAILED' && (
                  <><strong>Reimbursement sync failed:</strong> {activeReimbursementJob.errorMessage ?? 'Unknown error'}</>
                )}
              </span>
            </div>
            {activeReimbursementJob.status !== 'RUNNING' && activeReimbursementJob.status !== 'PENDING' && (
              <button onClick={() => setActiveReimbursementJob(null)} className="text-gray-400 hover:text-gray-700 shrink-0">
                <X size={14} />
              </button>
            )}
          </div>
          {(activeReimbursementJob.status === 'RUNNING' || activeReimbursementJob.status === 'PENDING') && (
            <div className="mt-2 h-1.5 rounded-full bg-amber-200 overflow-hidden">
              {activeReimbursementJob.totalFound > 0 && activeReimbursementJob.totalUpserted > 0 ? (
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                  style={{ width: `${Math.round((activeReimbursementJob.totalUpserted / activeReimbursementJob.totalFound) * 100)}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-full bg-amber-400 animate-pulse" />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Returns import progress banner ── */}
      {activeReturnJob && (
        <div className={clsx(
          'px-4 py-3 border-b text-sm',
          activeReturnJob.status === 'RUNNING' || activeReturnJob.status === 'PENDING'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : activeReturnJob.status === 'COMPLETED'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-700',
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {(activeReturnJob.status === 'RUNNING' || activeReturnJob.status === 'PENDING') && (
                <RefreshCcw size={13} className="animate-spin shrink-0" />
              )}
              {activeReturnJob.status === 'FAILED' && (
                <AlertCircle size={14} className="shrink-0" />
              )}
              <span className="truncate">
                {activeReturnJob.status === 'PENDING' && 'Starting FBA returns sync...'}
                {activeReturnJob.status === 'RUNNING' && activeReturnJob.totalFound === 0 && 'Fetching FBA returns from Amazon...'}
                {activeReturnJob.status === 'RUNNING' && activeReturnJob.totalUpserted > 0 && (
                  <>Importing <strong>{activeReturnJob.totalUpserted}</strong> of <strong>{activeReturnJob.totalFound}</strong> FBA returns...</>
                )}
                {activeReturnJob.status === 'COMPLETED' && (
                  <><strong>{activeReturnJob.totalUpserted}</strong> FBA return{activeReturnJob.totalUpserted !== 1 ? 's' : ''} imported successfully</>
                )}
                {activeReturnJob.status === 'FAILED' && (
                  <><strong>Returns sync failed:</strong> {activeReturnJob.errorMessage ?? 'Unknown error'}</>
                )}
              </span>
            </div>
            {activeReturnJob.status !== 'RUNNING' && activeReturnJob.status !== 'PENDING' && (
              <button onClick={() => setActiveReturnJob(null)} className="text-gray-400 hover:text-gray-700 shrink-0">
                <X size={14} />
              </button>
            )}
          </div>
          {(activeReturnJob.status === 'RUNNING' || activeReturnJob.status === 'PENDING') && (
            <div className="mt-2 h-1.5 rounded-full bg-amber-200 overflow-hidden">
              {activeReturnJob.totalFound > 0 && activeReturnJob.totalUpserted > 0 ? (
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                  style={{ width: `${Math.round((activeReturnJob.totalUpserted / activeReturnJob.totalFound) * 100)}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-full bg-amber-400 animate-pulse" />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Import progress banner ── */}
      {activeJob && (
        <div className={clsx(
          'px-4 py-3 border-b text-sm',
          activeJob.status === 'RUNNING' || activeJob.status === 'PENDING'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : activeJob.status === 'COMPLETED'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-700',
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {(activeJob.status === 'RUNNING' || activeJob.status === 'PENDING') && (
                <RefreshCcw size={13} className="animate-spin shrink-0" />
              )}
              {activeJob.status === 'FAILED' && (
                <AlertCircle size={14} className="shrink-0" />
              )}
              <span className="truncate">
                {activeJob.status === 'PENDING' && 'Starting FBA refund sync...'}
                {activeJob.status === 'RUNNING' && activeJob.totalFound === 0 && 'Fetching FBA refunds from Amazon...'}
                {activeJob.status === 'RUNNING' && activeJob.totalFound > 0 && activeJob.totalUpserted === 0 && (
                  <>Found <strong>{activeJob.totalFound}</strong> FBA refunds — preparing to import...</>
                )}
                {activeJob.status === 'RUNNING' && activeJob.totalUpserted > 0 && (
                  <>Importing <strong>{activeJob.totalUpserted}</strong> of <strong>{activeJob.totalFound}</strong> FBA refunds...</>
                )}
                {activeJob.status === 'COMPLETED' && (
                  <><strong>{activeJob.totalUpserted}</strong> FBA refund{activeJob.totalUpserted !== 1 ? 's' : ''} imported successfully</>
                )}
                {activeJob.status === 'FAILED' && (
                  <><strong>Sync failed:</strong> {activeJob.errorMessage ?? 'Unknown error'}</>
                )}
              </span>
            </div>
            {activeJob.status !== 'RUNNING' && activeJob.status !== 'PENDING' && (
              <button onClick={() => setActiveJob(null)} className="text-gray-400 hover:text-gray-700 shrink-0">
                <X size={14} />
              </button>
            )}
          </div>
          {(activeJob.status === 'RUNNING' || activeJob.status === 'PENDING') && (
            <div className="mt-2 h-1.5 rounded-full bg-amber-200 overflow-hidden">
              {activeJob.totalFound > 0 && activeJob.totalUpserted > 0 ? (
                <div
                  className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                  style={{ width: `${Math.round((activeJob.totalUpserted / activeJob.totalFound) * 100)}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-full bg-amber-400 animate-pulse" />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 bg-white border-b">
        <button
          className={clsx(
            'px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors',
            activeTab === 'unvalidated'
              ? 'bg-white text-gray-900 border-gray-300'
              : 'bg-gray-50 text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100',
          )}
          onClick={() => { setActiveTab('unvalidated'); setNeedsAttention(false); fetchRefunds(1) }}
        >
          Unvalidated
          <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700">
            {tabCounts.unvalidated}
          </span>
        </button>
        <button
          className={clsx(
            'px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-colors',
            activeTab === 'validated'
              ? 'bg-white text-gray-900 border-gray-300'
              : 'bg-gray-50 text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100',
          )}
          onClick={() => { setActiveTab('validated'); setNeedsAttention(false); fetchRefunds(1) }}
        >
          Validated
          <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
            {tabCounts.validated}
          </span>
        </button>

        {activeTab === 'unvalidated' && (
          <div className="ml-auto flex items-center gap-2">
            <button
              className={clsx(
                'text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors border',
                needsAttention
                  ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50',
              )}
              onClick={() => { setNeedsAttention(v => !v); fetchRefunds(1) }}
            >
              <AlertCircle size={13} />
              Needs Your Attention
            </button>
            <button
              className="btn-primary text-sm flex items-center gap-1.5"
              onClick={runAutoValidate}
              disabled={autoValidating}
            >
              {autoValidating ? <RefreshCcw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
              Run Auto-Validate
            </button>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-gray-50 border-b">
            <tr>
              {columns.map(({ label, field }) => (
                <th
                  key={label || '_action'}
                  className={clsx(
                    'px-2 py-2 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap',
                    field && 'cursor-pointer hover:text-gray-900 select-none',
                  )}
                  onClick={() => field && toggleSort(field as SortBy)}
                >
                  <span className="flex items-center gap-1">
                    {label}
                    {field && <SortIcon field={field} current={sortBy} dir={sortDir} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y">
            {loading && (
              <tr><td colSpan={colSpan} className="text-center py-12 text-gray-400">Loading...</td></tr>
            )}
            {!loading && refunds.length === 0 && (
              <tr><td colSpan={colSpan} className="text-center py-12 text-gray-400">
                No FBA refunds found. Sync data or adjust filters.
              </td></tr>
            )}
            {!loading && refunds.map(r => {
              const isManualReview = r.validationStatus === 'MANUAL_REVIEW'
              return (
                <tr
                  key={r.id}
                  className={clsx(
                    'transition-colors',
                    isManualReview ? 'bg-yellow-50 hover:bg-yellow-100/70' : 'hover:bg-blue-50/50',
                  )}
                >
                  {/* Order ID */}
                  <td className="px-2 py-2 font-mono">
                    <span className="flex items-center gap-0.5">
                      <a
                        href={`https://sellercentral.amazon.com/orders-v3/order/${r.orderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate max-w-[130px]"
                        title={r.orderId}
                      >
                        {r.orderId}
                      </a>
                      <CopyButton text={r.orderId} />
                    </span>
                  </td>
                  {/* Amount */}
                  <td className="px-2 py-2 font-mono font-semibold whitespace-nowrap">
                    {r.currency} {Number(r.refundAmount).toFixed(2)}
                  </td>
                  {/* QTY */}
                  <td className="px-2 py-2 text-center">{r.refundQty}</td>
                  {/* SKU */}
                  <td className="px-2 py-2 font-mono text-gray-600 max-w-[90px] truncate" title={r.sku ?? ''}>{r.sku ?? '—'}</td>
                  {/* FNSKU */}
                  <td className="px-2 py-2 font-mono text-gray-600 max-w-[90px] truncate" title={r.fnsku ?? ''}>{r.fnsku ?? '—'}</td>
                  {/* ASIN */}
                  <td className="px-2 py-2 font-mono text-gray-600">{r.asin ?? '—'}</td>
                  {/* Title */}
                  <td className="px-2 py-2 max-w-[150px]">
                    {r.title
                      ? <span className="text-gray-800 line-clamp-1" title={r.title}>{r.title}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  {/* LPN # */}
                  <td className="px-2 py-2 font-mono text-gray-600">{r.lpn ?? '—'}</td>
                  {/* Original Order Date */}
                  <td className="px-2 py-2 whitespace-nowrap text-gray-600">
                    {r.originalOrderDate
                      ? format(new Date(r.originalOrderDate), 'M/d/yy')
                      : '—'}
                  </td>
                  {/* Refund Date */}
                  <td className="px-2 py-2 whitespace-nowrap text-gray-600">
                    {format(new Date(r.refundDate), 'M/d/yy')}
                  </td>
                  {/* Age */}
                  <td className="px-2 py-2"><AgeBadge refundDate={r.refundDate} /></td>
                  {/* Returned? */}
                  <td className="px-2 py-2 whitespace-nowrap">
                    {r.returnInfo ? (
                      r.returnInfo.status.startsWith('Return Received')
                        ? <span className="badge-green flex flex-col items-center leading-tight">
                            <span>Received</span>
                            {r.returnInfo.date && <span className="text-[10px] opacity-80">{format(new Date(r.returnInfo.date), 'M/d/yy')}</span>}
                          </span>
                        : <span className="badge-red">Not returned</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  {/* Reimbursed? */}
                  <td className="px-2 py-2 whitespace-nowrap">
                    {r.reimbursementInfo ? (
                      <span className="badge-green flex flex-col items-center leading-tight">
                        <span>{r.reimbursementInfo.currency} {r.reimbursementInfo.amount}</span>
                        {r.reimbursementInfo.date && (
                          <span className="text-[10px] opacity-80">
                            {format(new Date(r.reimbursementInfo.date), 'M/d/yy')}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="badge-red">No</span>
                    )}
                  </td>
                  {/* Marketplace */}
                  <td className="px-2 py-2 text-gray-600">{r.account.marketplaceName}</td>

                  {/* Last column: Validated info or action */}
                  {activeTab === 'validated' ? (
                    <td className="px-2 py-2 whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        <span className={clsx(
                          'inline-flex items-center gap-1 font-medium',
                          r.validationSource === 'auto' ? 'text-blue-600' : 'text-purple-600',
                        )}>
                          <CheckCircle size={11} />
                          {r.validationSource === 'auto' ? 'Auto' : 'Manual'}
                        </span>
                        {r.validatedAt && (
                          <span className="text-[10px] text-gray-500">
                            {format(new Date(r.validatedAt), 'M/d/yy')}
                          </span>
                        )}
                        {r.validationReason && (
                          <span className="text-[10px] text-gray-400 max-w-[100px] truncate" title={r.validationReason}>
                            {r.validationReason}
                          </span>
                        )}
                      </div>
                    </td>
                  ) : (
                    <td className="px-2 py-2 whitespace-nowrap">
                      {isManualReview && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 mb-0.5">
                          Manual
                        </span>
                      )}
                      {r.validationReason === 'Within the 60 day window' && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 mb-0.5">
                          60-day window
                        </span>
                      )}
                      <button
                        onClick={() => manualValidate(r.id)}
                        className="text-blue-600 hover:underline font-medium block"
                      >
                        Validate
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between px-4 py-3 border-t bg-white text-sm text-gray-600">
        <span>{pagination.total} total refund{pagination.total !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost py-1 px-3"
            disabled={pagination.page <= 1}
            onClick={() => fetchRefunds(pagination.page - 1)}
          >
            Previous
          </button>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <button
            className="btn-ghost py-1 px-3"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => fetchRefunds(pagination.page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

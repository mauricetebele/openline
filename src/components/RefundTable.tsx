'use client'
import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import {
  Search, Download, RefreshCcw, ChevronUp, ChevronDown,
  ChevronsUpDown, CheckCircle, XCircle, Clock, Copy, Check, X, AlertCircle,
} from 'lucide-react'
import { clsx } from 'clsx'
import { INVALID_REASON_LABELS, InvalidReason } from '@/types'
import ImportModal from './ImportModal'
import BulkReviewModal from './BulkReviewModal'
import RefundDetailModal from './RefundDetailModal'

type SortBy = 'postedDate' | 'amount' | 'status'
type SortDir = 'asc' | 'desc'

interface Refund {
  id: string
  orderId: string
  adjustmentId: string
  postedDate: string
  amount: string
  currency: string
  fulfillmentType: string
  sku: string | null
  asin: string | null
  productTitle: string | null
  reasonCode: string | null
  account: { marketplaceName: string }
  review: {
    status: string
    invalidReason: string | null
    notes: string | null
  } | null
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

interface ImportJob {
  id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'VALID') return (
    <span className="badge-green flex items-center gap-1"><CheckCircle size={10} />Valid</span>
  )
  if (status === 'INVALID') return (
    <span className="badge-red flex items-center gap-1"><XCircle size={10} />Invalid</span>
  )
  return <span className="badge-gray flex items-center gap-1"><Clock size={10} />Unreviewed</span>
}

function FulfillmentBadge({ type }: { type: string }) {
  return type === 'FBA'
    ? <span className="badge-blue">FBA</span>
    : type === 'MFN'
    ? <span className="badge-orange">MFN</span>
    : <span className="badge-gray">—</span>
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
    <button
      onClick={handleCopy}
      className="ml-1 text-gray-400 hover:text-gray-700 transition-colors"
      title="Copy order ID"
    >
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </button>
  )
}

export default function RefundTable() {
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [fulfillment, setFulfillment] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('postedDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Modals
  const [showImport, setShowImport] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  // Background import job
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null)
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startJobPolling(jobId: string) {
    if (jobPollRef.current) clearInterval(jobPollRef.current)
    jobPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/refunds/import?jobId=${jobId}`)
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

  useEffect(() => {
    return () => { if (jobPollRef.current) clearInterval(jobPollRef.current) }
  }, [])

  const [fetchPage, setFetchPage] = useState(1)
  const [fetchKey, setFetchKey] = useState(0)

  function fetchRefunds(page = 1) {
    setFetchPage(page)
    setFetchKey((k) => k + 1)
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
    if (fulfillment) params.set('fulfillment', fulfillment)
    if (statusFilter) params.set('status', statusFilter)

    fetch(`/api/refunds?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setRefunds(data.data)
        setPagination(data.pagination)
        setSelected(new Set())
      })
      .catch((err) => {
        if (!cancelled) console.error('[RefundTable] fetch failed:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [fetchPage, fetchKey, search, startDate, endDate, fulfillment, statusFilter, sortBy, sortDir])

  function toggleSort(field: SortBy) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === refunds.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(refunds.map((r) => r.id)))
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b bg-white">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-8"
            placeholder="Search order ID, SKU, ASIN, title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Quick date filters */}
        <div className="flex gap-1">
          {[
            { label: 'Today', days: 0 },
            { label: '3 Days', days: 3 },
            { label: '7 Days', days: 7 },
          ].map(({ label, days }) => {
            const from = new Date(); from.setDate(from.getDate() - days)
            const fromStr = from.toISOString().slice(0, 10)
            const todayStr = new Date().toISOString().slice(0, 10)
            const active = startDate === fromStr && endDate === todayStr
            return (
              <button
                key={label}
                onClick={() => { setStartDate(fromStr); setEndDate(todayStr) }}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                  active
                    ? 'bg-amazon-orange text-white border-amazon-orange'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-amazon-orange hover:text-amazon-orange'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Date range */}
        <input type="date" className="input w-36" value={startDate}
          onChange={(e) => setStartDate(e.target.value)} placeholder="From" />
        <input type="date" className="input w-36" value={endDate}
          onChange={(e) => setEndDate(e.target.value)} placeholder="To" />

        {/* Fulfillment filter */}
        <select className="input w-36" value={fulfillment}
          onChange={(e) => setFulfillment(e.target.value)}>
          <option value="">All fulfillment</option>
          <option value="FBA">FBA</option>
          <option value="MFN">MFN</option>
          <option value="UNKNOWN">Unknown</option>
        </select>

        {/* Status filter */}
        <select className="input w-36" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="UNREVIEWED">Unreviewed</option>
          <option value="VALID">Valid</option>
          <option value="INVALID">Invalid</option>
        </select>

        <div className="ml-auto flex gap-2">
          {selected.size > 0 && (
            <button className="btn-primary" onClick={() => setShowBulk(true)}>
              Bulk Review ({selected.size})
            </button>
          )}
          <button className="btn-ghost" onClick={() => fetchRefunds(pagination.page)}>
            <RefreshCcw size={14} />
          </button>
          <button className="btn-primary" onClick={() => setShowImport(true)}>
            <Download size={14} /> Import
          </button>
        </div>
      </div>

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
                {activeJob.status === 'PENDING' && 'Starting import…'}
                {activeJob.status === 'RUNNING' && activeJob.totalFound === 0 && 'Fetching refunds from Amazon…'}
                {activeJob.status === 'RUNNING' && activeJob.totalFound > 0 && activeJob.totalUpserted === 0 && (
                  <>Found <strong>{activeJob.totalFound}</strong> refunds — preparing to import…</>
                )}
                {activeJob.status === 'RUNNING' && activeJob.totalUpserted > 0 && (
                  <>Importing <strong>{activeJob.totalUpserted}</strong> of <strong>{activeJob.totalFound}</strong> refunds…</>
                )}
                {activeJob.status === 'COMPLETED' && (
                  <><strong>{activeJob.totalUpserted}</strong> refund{activeJob.totalUpserted !== 1 ? 's' : ''} imported successfully</>
                )}
                {activeJob.status === 'FAILED' && (
                  <><strong>Import failed:</strong> {activeJob.errorMessage ?? 'Unknown error'}</>
                )}
              </span>
            </div>
            {activeJob.status !== 'RUNNING' && activeJob.status !== 'PENDING' && (
              <button
                onClick={() => setActiveJob(null)}
                className="text-gray-400 hover:text-gray-700 shrink-0"
              >
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

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={selected.size === refunds.length && refunds.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              {[
                { label: 'Posted Date', field: 'postedDate' },
                { label: 'Order ID', field: null },
                { label: 'Amount', field: 'amount' },
                { label: 'Fulfillment', field: null },
                { label: 'Marketplace', field: null },
                { label: 'Title', field: null },
                { label: 'ASIN', field: null },
                { label: 'SKU', field: null },
                { label: 'Reason', field: null },
                { label: 'Status', field: 'status' },
                { label: 'Invalid Reason', field: null },
              ].map(({ label, field }) => (
                <th
                  key={label}
                  className={clsx(
                    'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap',
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
              <tr><td colSpan={11} className="text-center py-12 text-gray-400">Loading…</td></tr>
            )}
            {!loading && refunds.length === 0 && (
              <tr><td colSpan={11} className="text-center py-12 text-gray-400">
                No refunds found. Adjust filters or import data.
              </td></tr>
            )}
            {!loading && refunds.map((r) => (
              <tr
                key={r.id}
                className={clsx(
                  'hover:bg-blue-50/50 transition-colors cursor-pointer',
                  selected.has(r.id) && 'bg-blue-50',
                )}
                onClick={(e) => {
                  // Don't open detail if clicking checkbox
                  if ((e.target as HTMLElement).tagName !== 'INPUT') setDetailId(r.id)
                }}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                  {format(new Date(r.postedDate), 'MMM d, yyyy')}
                </td>
                <td className="px-4 py-3 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                  <span className="flex items-center gap-0.5">
                    <a
                      href={`https://sellercentral.amazon.com/orders-v3/order/${r.orderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {r.orderId}
                    </a>
                    <CopyButton text={r.orderId} />
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold whitespace-nowrap">
                  {r.currency} {Number(r.amount).toFixed(2)}
                </td>
                <td className="px-4 py-3"><FulfillmentBadge type={r.fulfillmentType} /></td>
                <td className="px-4 py-3 text-xs text-gray-600">{r.account.marketplaceName}</td>
                <td className="px-4 py-3 text-xs max-w-[220px]">
                  {r.productTitle
                    ? <span className="text-gray-800 line-clamp-2" title={r.productTitle}>{r.productTitle}</span>
                    : <span className="text-gray-400 font-mono">{r.sku ?? '—'}</span>}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-gray-600">
                  {r.asin ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-gray-600">
                  {r.sku ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{r.reasonCode ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={r.review?.status ?? 'UNREVIEWED'} /></td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px] truncate">
                  {r.review?.invalidReason
                    ? INVALID_REASON_LABELS[r.review.invalidReason as InvalidReason]
                    : '—'}
                </td>
              </tr>
            ))}
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
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            className="btn-ghost py-1 px-3"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => fetchRefunds(pagination.page + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* ── Modals ── */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onStarted={(jobId) => {
            setActiveJob({ id: jobId, status: 'PENDING', totalFound: 0, totalUpserted: 0, errorMessage: null })
            startJobPolling(jobId)
          }}
        />
      )}
      {showBulk && (
        <BulkReviewModal
          selectedIds={[...selected]}
          onClose={() => setShowBulk(false)}
          onDone={() => fetchRefunds(pagination.page)}
        />
      )}
      {detailId && (
        <RefundDetailModal
          refundId={detailId}
          onClose={() => setDetailId(null)}
          onUpdated={() => fetchRefunds(pagination.page)}
        />
      )}
    </div>
  )
}

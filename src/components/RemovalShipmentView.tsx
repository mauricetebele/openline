'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Search, RefreshCcw, ChevronDown, ChevronRight, PackageMinus, X, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import ProcessShipmentModal from './ProcessShipmentModal'

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

interface RemovalShipment {
  id: string
  removalOrderId: string
  trackingNumber: string
  carrier: string | null
  orderType: string | null
  shipDate: string | null
  requestDate: string | null
  _count: { items: number }
  unitCount: number
  receivedCount: number
}

interface RemovalShipmentItem {
  id: string
  sellerSku: string
  fnsku: string
  disposition: string | null
  quantity: number
  title: string | null
}

interface RemovalReceipt {
  id: string
  receiptNumber: string
  serialNumber: string
  sku: string
  description: string | null
  lpnNumber: string | null
  grade: string | null
  regraded: boolean
  location: string | null
  note: string | null
  receivedBy: string | null
  receivedAt: string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RemovalShipmentView() {
  const [accounts, setAccounts] = useState<AmazonAccount[]>([])
  const [syncAccountId, setSyncAccountId] = useState('')
  const [syncStart, setSyncStart] = useState('')
  const [syncEnd, setSyncEnd] = useState('')
  const [showSync, setShowSync] = useState(false)
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null)
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [shipments, setShipments] = useState<RemovalShipment[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('shipDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<RemovalShipmentItem[]>([])
  const [expandedReceipts, setExpandedReceipts] = useState<RemovalReceipt[]>([])
  const [expandLoading, setExpandLoading] = useState(false)

  const [processShipment, setProcessShipment] = useState<{ id: string; trackingNumber: string } | null>(null)

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((data: AmazonAccount[]) => {
        setAccounts(data)
        if (data.length > 0) setSyncAccountId(data[0].id)
      })
      .catch(() => {})
  }, [])

  const fetchShipments = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25', sortBy, sortDir })
      if (search) params.set('search', search)
      const res = await fetch(`/api/removal-shipments?${params}`)
      const json = await res.json()
      setShipments(json.data ?? [])
      setPagination(json.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 })
    } catch { /* ignore */ }
    setLoading(false)
  }, [search, sortBy, sortDir])

  useEffect(() => { fetchShipments(1) }, [fetchShipments])
  useEffect(() => { return () => { if (jobPollRef.current) clearInterval(jobPollRef.current) } }, [])

  // ── Sync ────────────────────────────────────────────────────────────────────

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
          if (job.status === 'COMPLETED') fetchShipments(1)
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
      const res = await fetch('/api/removal-shipments/sync', {
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

  // ── Expand ──────────────────────────────────────────────────────────────────

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setExpandLoading(true)
    setExpandedItems([])
    setExpandedReceipts([])
    try {
      const res = await fetch(`/api/removal-shipments/${id}`)
      const json = await res.json()
      setExpandedItems(json.items ?? [])
      setExpandedReceipts(json.receipts ?? [])
    } catch { /* ignore */ }
    setExpandLoading(false)
  }

  // ── Sort ────────────────────────────────────────────────────────────────────

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
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
            placeholder="Search tracking #, order ID, SKU..."
            className="h-9 pl-8 pr-3 w-64 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        {pagination.total > 0 && (
          <span className="text-xs text-gray-400">
            {pagination.total} shipment{pagination.total !== 1 ? 's' : ''}
          </span>
        )}

        <div className="flex-1" />

        <button onClick={() => setShowSync(s => !s)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">
          <RefreshCcw size={14} /> Sync
        </button>
      </div>

      {/* Sync panel */}
      {showSync && (
        <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-500 uppercase">Sync Removals</span>
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
        ) : shipments.length === 0 ? (
          <div className="py-20 text-center">
            <PackageMinus size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {search ? 'No shipments match your search' : 'No removal shipments synced yet'}
            </p>
            {!search && (
              <button onClick={() => setShowSync(true)} className="mt-3 text-sm text-amazon-blue hover:underline">
                Sync removal shipments from Amazon
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className="w-8" />
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort('shipDate')}>
                  Ship Date<SortIcon col="shipDate" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort('trackingNumber')}>
                  Tracking #<SortIcon col="trackingNumber" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort('removalOrderId')}>
                  Removal Order ID<SortIcon col="removalOrderId" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort('carrier')}>
                  Carrier<SortIcon col="carrier" />
                </th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Type</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">Units</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-100 whitespace-nowrap">Received</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s, i) => (
                <React.Fragment key={s.id}>
                  <tr
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 align-middle cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors',
                      i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50',
                      expandedId === s.id && 'bg-blue-50 dark:bg-blue-900/10',
                    )}
                    onClick={() => toggleExpand(s.id)}
                  >
                    <td className="px-2 py-1.5 text-center">
                      {expandedId === s.id
                        ? <ChevronDown size={14} className="text-gray-400 inline" />
                        : <ChevronRight size={14} className="text-gray-400 inline" />}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDate(s.shipDate)}</td>
                    <td className="px-3 py-1.5 font-mono font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      {s.trackingNumber}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {s.removalOrderId}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{s.carrier ?? '—'}</td>
                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{s.orderType ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100">{s.unitCount}</td>
                    <td className="px-3 py-1.5 text-center">
                      {s.receivedCount > 0 ? (
                        <span className={clsx(
                          'text-xs font-semibold',
                          s.receivedCount >= s.unitCount
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-amber-600 dark:text-amber-400'
                        )}>
                          {s.receivedCount} / {s.unitCount}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setProcessShipment({ id: s.id, trackingNumber: s.trackingNumber }) }}
                        className="px-2.5 py-1 text-[10px] font-semibold text-white bg-amazon-blue rounded hover:bg-amazon-blue/90"
                      >
                        Process
                      </button>
                    </td>
                  </tr>

                  {expandedId === s.id && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <div className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 px-6 py-3">
                          {expandLoading ? (
                            <p className="text-xs text-gray-400 py-2 flex items-center gap-2">
                              <Loader2 size={12} className="animate-spin" /> Loading items...
                            </p>
                          ) : expandedItems.length === 0 ? (
                            <p className="text-xs text-gray-400 py-2 italic">No items in this shipment</p>
                          ) : (
                            <>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-200 dark:border-gray-600">
                                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400 w-10">#</th>
                                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Merchant SKU</th>
                                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">FNSKU</th>
                                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Title</th>
                                    <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Disposition</th>
                                    <th className="px-2 py-1.5 text-right font-semibold text-gray-500 dark:text-gray-400">Qty</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedItems.map((item, idx) => (
                                    <tr key={item.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                                      <td className="px-2 py-1.5 text-gray-400">{idx + 1}</td>
                                      <td className="px-2 py-1.5 font-mono text-gray-800 dark:text-gray-200">{item.sellerSku}</td>
                                      <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400">{item.fnsku}</td>
                                      <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 max-w-xs truncate" title={item.title ?? ''}>{item.title ?? '—'}</td>
                                      <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{item.disposition ?? '—'}</td>
                                      <td className="px-2 py-1.5 text-right font-semibold text-gray-900 dark:text-gray-100">{item.quantity}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>

                              {expandedReceipts.length > 0 && (
                                <div className="mt-4">
                                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                                    Received Units ({expandedReceipts.length})
                                  </h4>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-gray-200 dark:border-gray-600">
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Receipt #</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Serial #</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">LPN</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">SKU</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Grade</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Location</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Note</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Received By</th>
                                        <th className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400">Received At</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandedReceipts.map(r => (
                                        <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                                          <td className="px-2 py-1.5 font-mono font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">{r.receiptNumber}</td>
                                          <td className="px-2 py-1.5 font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap">{r.serialNumber}</td>
                                          <td className="px-2 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.lpnNumber || '—'}</td>
                                          <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap" title={r.description ?? ''}>{r.sku}</td>
                                          <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                            {r.grade ?? '—'}
                                            {r.regraded && <span className="ml-1 text-amber-500" title="Regraded from previous grade">*</span>}
                                          </td>
                                          <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.location ?? '—'}</td>
                                          <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={r.note ?? ''}>{r.note || '—'}</td>
                                          <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.receivedBy ?? '—'}</td>
                                          <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(r.receivedAt)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
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
          <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1} onClick={() => fetchShipments(pagination.page - 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Prev</button>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchShipments(pagination.page + 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Next</button>
          </div>
        </div>
      )}

      {/* Process Shipment Modal */}
      {processShipment && (
        <ProcessShipmentModal
          shipmentId={processShipment.id}
          trackingNumber={processShipment.trackingNumber}
          onClose={() => setProcessShipment(null)}
          onUpdated={() => fetchShipments(pagination.page)}
        />
      )}
    </div>
  )
}

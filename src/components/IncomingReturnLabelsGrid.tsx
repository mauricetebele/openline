'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { format, differenceInCalendarDays } from 'date-fns'
import {
  Search, RefreshCcw, ExternalLink, Loader2, ChevronLeft, ChevronRight,
  AlertTriangle, PackageSearch, CheckCircle2, Truck, X, Archive, Undo2,
} from 'lucide-react'
import { clsx } from 'clsx'

interface Row {
  id: string
  orderId: string
  trackingNumber: string | null
  returnCarrier: string | null
  carrierStatus: string | null
  trackingUpdatedAt: string | null
  returnDate: string | null
  deliveredAt: string | null
  tenderedAt: string | null
  threatArchivedAt: string | null
  threatArchivedByLabel: string | null
  threatArchiveNote: string | null
  processedAt: string | null
  processedOutcome: string | null
  processed: boolean
  received: boolean
  statusGroup: 'delivered' | 'in_transit' | 'not_tendered' | 'needs_status' | 'unknown'
  disposition: 'resolved' | 'archived' | 'threat_unprocessed' | 'threat_lost' | 'not_tendered' | 'needs_status' | 'on_track'
}

interface Summary {
  total: number
  unprocessedDelivered: number
  lostInTransit: number
  needsStatus: number
  notTendered: number
  resolved: number
  archived: number
  onTrack: number
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

function statusBadge(r: Row): { label: string; className: string; dot: string } {
  const text = r.carrierStatus
  switch (r.statusGroup) {
    case 'delivered':
      return { label: text || 'Delivered', className: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' }
    case 'in_transit':
      return { label: text || 'In Transit', className: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' }
    case 'not_tendered':
      return { label: text || 'Not Tendered', className: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' }
    case 'needs_status':
      return { label: 'No Status — refresh', className: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400' }
    default:
      return { label: text || 'Unknown', className: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400' }
  }
}

function trackingUrl(tracking: string): string {
  const t = tracking.trim().toUpperCase()
  if (t.startsWith('1Z') || /^\d{9}$/.test(t) || /^\d{18}$/.test(t)) return `https://www.ups.com/track?tracknum=${tracking}`
  return `https://www.google.com/search?q=${encodeURIComponent(tracking + ' tracking')}`
}

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'threats', label: 'Threats' },
  { value: 'unprocessed_delivered', label: 'Delivered · Unprocessed' },
  { value: 'lost_in_transit', label: 'Lost in Transit' },
  { value: 'needs_status', label: 'No Status' },
  { value: 'not_tendered', label: 'Not Tendered' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'archived', label: 'Archived' },
] as const

function Tile({ label, value, tone, icon: Icon, active, onClick }: {
  label: string; value: number; tone: 'red' | 'orange' | 'gray' | 'emerald' | 'blue'
  icon: React.ElementType; active?: boolean; onClick?: () => void
}) {
  const tones: Record<string, string> = {
    red: 'text-red-600 dark:text-red-400',
    orange: 'text-orange-600 dark:text-orange-400',
    gray: 'text-gray-500 dark:text-gray-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    blue: 'text-blue-600 dark:text-blue-400',
  }
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
        active
          ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/50 dark:bg-blue-500/10'
          : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/40',
      )}
    >
      <Icon className={clsx('h-5 w-5', tones[tone])} />
      <div>
        <div className={clsx('text-xl font-semibold tabular-nums', tones[tone])}>{value.toLocaleString()}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      </div>
    </button>
  )
}

export default function IncomingReturnLabelsGrid() {
  const PAGE_SIZE_OPTIONS = [50, 100, 250, 500] as const
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [sla, setSla] = useState({ delivery: 4, transit: 7 })
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 1 })
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [view, setView] = useState('all')
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [bulk, setBulk] = useState({ running: false, done: 0, total: 0, refreshed: 0, failed: 0 })
  const cancelBulk = useRef(false)

  // Row selection + drag-to-select
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [archiving, setArchiving] = useState(false)
  const dragging = useRef(false)
  const dragAnchor = useRef<number | null>(null)
  const dragMode = useRef<'add' | 'remove'>('add')
  const dragBaseline = useRef<Set<string>>(new Set())

  // End any drag when the mouse is released anywhere
  useEffect(() => {
    const up = () => { dragging.current = false; dragAnchor.current = null }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  function applyDragRange(toIndex: number) {
    if (dragAnchor.current === null) return
    const lo = Math.min(dragAnchor.current, toIndex)
    const hi = Math.max(dragAnchor.current, toIndex)
    const next = new Set(dragBaseline.current)
    for (let i = lo; i <= hi; i++) {
      const rowId = rows[i]?.id
      if (!rowId) continue
      if (dragMode.current === 'add') next.add(rowId)
      else next.delete(rowId)
    }
    setSelected(next)
  }

  function startDrag(index: number, rowId: string) {
    dragging.current = true
    dragAnchor.current = index
    dragMode.current = selected.has(rowId) ? 'remove' : 'add'
    dragBaseline.current = new Set(selected)
    applyDragRange(index)
  }

  function toggleOne(rowId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId)
      return next
    })
  }

  const fetchRows = useCallback(async (page: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize), view })
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await fetch(`/api/incoming-return-labels?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed (${res.status})`)
      }
      const json = await res.json()
      setRows(json.data)
      setSummary(json.summary)
      setSla(json.slaDays)
      setPagination(json.pagination)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load returns')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [pageSize, debouncedSearch, view])

  useEffect(() => { fetchRows(1) }, [fetchRows])

  async function refreshTracking(id: string) {
    setRefreshingId(id)
    try {
      const res = await fetch('/api/incoming-return-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const body = await res.json()
      if (!res.ok) { alert(body.error ?? 'Tracking refresh failed'); return }
      // Re-fetch so threat reclassification (server-side) stays accurate
      fetchRows(pagination.page)
    } catch {
      alert('Tracking refresh failed')
    } finally {
      setRefreshingId(null)
    }
  }

  // Manually mark a threat as handled (or restore it). Clears it from the
  // threat counts via a server-side 'archived' disposition.
  async function archiveThreat(id: string, archive: boolean) {
    let note: string | undefined
    if (archive) {
      const input = window.prompt('Reason for marking as not a threat (optional):', '')
      if (input === null) return // cancelled
      note = input
    }
    try {
      const res = await fetch('/api/incoming-return-labels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: archive ? 'archive' : 'unarchive', note }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        alert(b.error ?? 'Archive failed')
        return
      }
      fetchRows(pagination.page)
    } catch {
      alert('Archive failed')
    }
  }

  // Archive or restore every selected row in one request.
  async function bulkArchive(archive: boolean) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    let note: string | undefined
    if (archive) {
      const input = window.prompt(`Reason for marking ${ids.length} return(s) as not a threat (optional):`, '')
      if (input === null) return
      note = input
    }
    setArchiving(true)
    try {
      const res = await fetch('/api/incoming-return-labels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: archive ? 'archive' : 'unarchive', note }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        alert(b.error ?? 'Bulk archive failed')
        return
      }
      fetchRows(pagination.page)
    } catch {
      alert('Bulk archive failed')
    } finally {
      setArchiving(false)
    }
  }

  // Pull UPS status for every in-transit (no tender date yet) and no-status
  // return, so tender dates — and lost-in-transit threats — populate now.
  async function bulkRefresh() {
    try {
      const res = await fetch('/api/incoming-return-labels?refreshable=1')
      const { ids } = (await res.json()) as { ids: string[] }
      if (!ids?.length) {
        alert('Nothing to refresh — every in-transit return already has a tender date.')
        return
      }
      cancelBulk.current = false
      setBulk({ running: true, done: 0, total: ids.length, refreshed: 0, failed: 0 })
      const CHUNK = 25
      let refreshed = 0, failed = 0, done = 0
      for (let i = 0; i < ids.length; i += CHUNK) {
        if (cancelBulk.current) break
        const chunk = ids.slice(i, i + CHUNK)
        try {
          const r = await fetch('/api/incoming-return-labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: chunk }),
          })
          const b = await r.json()
          refreshed += b.refreshed ?? 0
          failed += b.failed ?? 0
        } catch {
          failed += chunk.length
        }
        done += chunk.length
        setBulk({ running: true, done, total: ids.length, refreshed, failed })
      }
      setBulk(b => ({ ...b, running: false }))
      fetchRows(pagination.page)
    } catch {
      alert('Bulk refresh failed')
      setBulk(b => ({ ...b, running: false }))
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Incoming Return Labels</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Amazon returns with a return mailing label tracking number. Goal: process every delivered return within{' '}
          {sla.delivery} calendar days, before an auto-refund is issued.
        </p>
      </div>

      {/* Summary tiles double as quick filters */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Tile label={`Delivered · unprocessed >${sla.delivery}d`} value={summary.unprocessedDelivered} tone="red"
            icon={AlertTriangle} active={view === 'unprocessed_delivered'}
            onClick={() => setView(view === 'unprocessed_delivered' ? 'all' : 'unprocessed_delivered')} />
          <Tile label={`Lost in transit >${sla.transit}d from tender`} value={summary.lostInTransit} tone="orange"
            icon={AlertTriangle} active={view === 'lost_in_transit'}
            onClick={() => setView(view === 'lost_in_transit' ? 'all' : 'lost_in_transit')} />
          <Tile label="No status — needs refresh" value={summary.needsStatus} tone="gray"
            icon={PackageSearch} active={view === 'needs_status'}
            onClick={() => setView(view === 'needs_status' ? 'all' : 'needs_status')} />
          <Tile label="Not tendered (safe)" value={summary.notTendered} tone="blue"
            icon={CheckCircle2} active={view === 'not_tendered'}
            onClick={() => setView(view === 'not_tendered' ? 'all' : 'not_tendered')} />
          <Tile label="Resolved (received/processed)" value={summary.resolved} tone="emerald"
            icon={CheckCircle2} active={view === 'resolved'}
            onClick={() => setView(view === 'resolved' ? 'all' : 'resolved')} />
          <Tile label="Archived (manual)" value={summary.archived} tone="gray"
            icon={Archive} active={view === 'archived'}
            onClick={() => setView(view === 'archived' ? 'all' : 'archived')} />
          <Tile label="On track" value={summary.onTrack} tone="emerald"
            icon={CheckCircle2} active={false} onClick={() => setView('all')} />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order ID or tracking…"
            className="pl-9 pr-3 py-2 w-72 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {VIEWS.map(v => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={clsx(
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                view === v.value ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {bulk.running ? (
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Refreshing {bulk.done}/{bulk.total} · {bulk.refreshed} ok{bulk.failed ? ` · ${bulk.failed} failed` : ''}</span>
              <button
                onClick={() => { cancelBulk.current = true }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={bulkRefresh}
              title="Pull UPS status for in-transit & no-status returns to capture tender dates"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Truck className="h-4 w-4" /> Refresh in-transit &amp; no-status
            </button>
          )}
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-2"
          >
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Bulk selection toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-blue-800 dark:text-blue-300">{selected.size} selected</span>
          <button
            onClick={() => bulkArchive(true)}
            disabled={archiving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-white bg-gray-700 hover:bg-gray-800 disabled:opacity-50"
          >
            {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            Archive selected
          </button>
          <button
            onClick={() => bulkArchive(false)}
            disabled={archiving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <Undo2 className="h-4 w-4" /> Restore selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X className="h-4 w-4" /> Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-[300px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm select-none">
          <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="pl-4 pr-2 py-3 w-8">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-blue-600"
                  checked={rows.length > 0 && rows.every(r => selected.has(r.id))}
                  ref={el => { if (el) el.indeterminate = selected.size > 0 && !rows.every(r => selected.has(r.id)) }}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())}
                  title="Select all on this page"
                />
              </th>
              <th className="px-4 py-3">Order ID</th>
              <th className="px-4 py-3">Tracking Number</th>
              <th className="px-4 py-3">UPS Tracking Status</th>
              <th className="px-4 py-3">Return Started</th>
              <th className="px-4 py-3">Tendered to UPS</th>
              <th className="px-4 py-3">Delivered</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">No incoming return labels match this view.</td></tr>
            ) : rows.map((r, idx) => {
              const badge = statusBadge(r)
              const deliveredDays = r.deliveredAt ? differenceInCalendarDays(new Date(), new Date(r.deliveredAt)) : null
              const isSelected = selected.has(r.id)
              return (
                <tr
                  key={r.id}
                  onMouseDown={(e) => {
                    // Ignore drags that begin on links/buttons/inputs
                    if ((e.target as HTMLElement).closest('a,button,input,select')) return
                    e.preventDefault()
                    startDrag(idx, r.id)
                  }}
                  onMouseEnter={() => { if (dragging.current) applyDragRange(idx) }}
                  className={clsx(
                    'hover:bg-gray-50 dark:hover:bg-gray-900/40',
                    isSelected && 'bg-blue-50 dark:bg-blue-500/10',
                    !isSelected && r.disposition.startsWith('threat') && 'bg-red-50/40 dark:bg-red-500/[0.06]',
                  )}
                >
                  <td className="pl-4 pr-2 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-blue-600"
                      checked={isSelected}
                      onChange={() => toggleOne(r.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-gray-100 whitespace-nowrap">{r.orderId}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.trackingNumber ? (
                      <a href={trackingUrl(r.trackingNumber)} target="_blank" rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                        {r.trackingNumber}<ExternalLink className="h-3 w-3" />
                      </a>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={clsx('inline-flex items-center gap-1.5 font-medium', badge.className)}>
                      <span className={clsx('h-2 w-2 rounded-full', badge.dot)} />
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {r.returnDate ? format(new Date(r.returnDate), 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {r.tenderedAt
                      ? format(new Date(r.tenderedAt), 'MMM d, yyyy')
                      : <span className="text-gray-400 text-xs">{r.statusGroup === 'not_tendered' ? 'not tendered' : '—'}</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {r.deliveredAt ? (
                      <span>{format(new Date(r.deliveredAt), 'MMM d, yyyy')}
                        {deliveredDays != null && <span className="text-gray-400 ml-1">({deliveredDays}d ago)</span>}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.disposition === 'threat_unprocessed' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 px-2 py-0.5 text-xs font-semibold">
                        <AlertTriangle className="h-3 w-3" /> Auto-refund risk
                      </span>
                    ) : r.disposition === 'threat_lost' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 px-2 py-0.5 text-xs font-semibold">
                        <AlertTriangle className="h-3 w-3" /> Lost in transit
                      </span>
                    ) : r.disposition === 'resolved' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 px-2 py-0.5 text-xs font-medium">
                        <CheckCircle2 className="h-3 w-3" /> {r.received ? 'Received' : 'Processed'}
                      </span>
                    ) : r.disposition === 'archived' ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 text-xs font-medium"
                        title={[
                          r.threatArchivedByLabel && `by ${r.threatArchivedByLabel}`,
                          r.threatArchivedAt && `on ${format(new Date(r.threatArchivedAt), 'MMM d, yyyy')}`,
                          r.threatArchiveNote && `— ${r.threatArchiveNote}`,
                        ].filter(Boolean).join(' ')}
                      >
                        <Archive className="h-3 w-3" /> Archived
                      </span>
                    ) : r.disposition === 'not_tendered' ? (
                      <span className="text-xs text-gray-400">not tendered</span>
                    ) : r.disposition === 'needs_status' ? (
                      <span className="text-xs text-gray-400">unknown — refresh</span>
                    ) : (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">on track</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1 justify-end">
                      {r.disposition.startsWith('threat') && (
                        <button
                          onClick={() => archiveThreat(r.id, true)}
                          title="Mark as not a threat (handled manually)"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </button>
                      )}
                      {r.disposition === 'archived' && (
                        <button
                          onClick={() => archiveThreat(r.id, false)}
                          title="Restore this threat"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Restore
                        </button>
                      )}
                      <button
                        onClick={() => refreshTracking(r.id)}
                        disabled={refreshingId === r.id}
                        title="Refresh UPS tracking status"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        <RefreshCcw className={clsx('h-3.5 w-3.5', refreshingId === r.id && 'animate-spin')} />
                        Refresh
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer / pagination */}
      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span>{pagination.total.toLocaleString()} returns in this view</span>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchRows(pagination.page - 1)} disabled={pagination.page <= 1 || loading}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <span>Page {pagination.page} of {pagination.totalPages || 1}</span>
          <button onClick={() => fetchRows(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages || loading}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  )
}

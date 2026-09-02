'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { Ban, RefreshCw, Loader2, AlertCircle, CheckCircle2, DollarSign } from 'lucide-react'
import { clsx } from 'clsx'
import { detectCarrier } from '@/lib/tracking-utils'

type TrackingResult = { status: string; deliveredAt: string | null; estimatedDelivery: string | null } | { error: string }

// Pre-transit statuses = label bought but carrier never took possession → a
// genuinely unused (safe-to-void) label. Movement means the package shipped.
const NOT_SCANNED_RE = /label created|shipment ready|pre-?shipment|order processed|ready for ups|shipment information|information sent|billing information|awaiting|pending|not yet|no status|manifest/i

function TrackingBadge({ info, loading }: { info: TrackingResult | undefined; loading: boolean }) {
  if (loading) return <Loader2 size={12} className="animate-spin text-gray-400" />
  if (!info) return <span className="text-gray-400">—</span>
  if ('error' in info) {
    return <span title={info.error} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300 cursor-help"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> No Scan</span>
  }
  const s = info.status.toLowerCase()
  if (s.includes('delivered')) return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200">{info.status}</span>
  if (NOT_SCANNED_RE.test(s)) return <span title="No carrier scans yet — safe to void" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {info.status}</span>
  // Any movement → package actually shipped; voiding would strand it.
  return <span title="Package is moving — do NOT void" className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">{info.status}</span>
}

interface Orphan {
  shipmentId: number
  orderNumber: string | null
  olmNumber: number | null
  orderSource: string | null
  orderWorkflowStatus: string | null
  trackingNumber: string | null
  carrier: string | null
  service: string | null
  cost: number
  createDate: string
  refundRequested: boolean
}

interface VoidedRow {
  id: string
  shipmentId: number | null
  trackingNumber: string | null
  orderNumber: string | null
  cost: number | null
  voidedBy: string
  voidedAt: string
}

interface ReconResult {
  lastSyncedAt: string | null
  lookbackDays: number
  shipmentsScanned: number
  voidedSkipped: number
  orphanCount: number
  totalOrphanCost: number
  orphans: Orphan[]
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function OrphanLabelsManager() {
  const [days, setDays] = useState(90)
  const [data, setData] = useState<ReconResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; ok: number; failed: number; current: string | null } | null>(null)
  const [trackingMap, setTrackingMap] = useState<Record<string, TrackingResult>>({})
  const [trackingLoading, setTrackingLoading] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'orphans' | 'voided'>('orphans')
  const [voidedLog, setVoidedLog] = useState<VoidedRow[] | null>(null)
  const [voidedTotal, setVoidedTotal] = useState(0)
  const [voidedLoading, setVoidedLoading] = useState(false)

  // Fast: load the last cached scan (no ShipStation call).
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/shipstation/orphan-labels')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
      if (json.lastSyncedAt && json.lookbackDays) setDays(json.lookbackDays)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  // Slow: pull fresh from ShipStation and update the cache.
  const sync = useCallback(async (d: number) => {
    setSyncing(true); setError(null)
    try {
      const res = await fetch(`/api/shipstation/orphan-labels?days=${d}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sync failed')
      // A manual sync refreshes tracking too: reset the caches so the effect re-pulls.
      requestedRef.current = new Set()
      setTrackingMap({})
      setSelectedIds(new Set())
      setData(json)
      toast.success(`Synced — ${json.orphanCount} orphan${json.orphanCount !== 1 ? 's' : ''} found`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed'
      setError(msg); toast.error(msg)
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadVoidedLog = useCallback(async () => {
    setVoidedLoading(true)
    try {
      const res = await fetch('/api/shipstation/orphan-labels/voided-log')
      const json = await res.json()
      if (res.ok) { setVoidedLog(json.rows ?? []); setVoidedTotal(json.totalRefunded ?? 0) }
    } catch { /* ignore */ } finally { setVoidedLoading(false) }
  }, [])

  useEffect(() => { if (activeTab === 'voided') loadVoidedLog() }, [activeTab, loadVoidedLog])

  // Stable key of the trackable (UPS/FedEx) tracking numbers currently shown.
  // Keying the effect on this — not the whole `data` object — means row edits
  // like toggling "refund requested" don't re-trigger a tracking re-fetch.
  const trackingKey = useMemo(() => {
    return (data?.orphans ?? [])
      .map(o => o.trackingNumber)
      .filter((tn): tn is string => !!tn && (detectCarrier(tn) === 'UPS' || detectCarrier(tn) === 'FEDEX'))
      .sort()
      .join(',')
  }, [data?.orphans])

  // Tracking numbers we've already requested (persists across renders); cleared
  // only on a manual sync, so row edits never trigger a tracking re-fetch.
  const requestedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!trackingKey) return
    const missing = trackingKey.split(',').filter(tn => !requestedRef.current.has(tn))
    if (missing.length === 0) return
    missing.forEach(tn => requestedRef.current.add(tn))

    const batches: string[][] = []
    for (let i = 0; i < missing.length; i += 20) batches.push(missing.slice(i, i + 20))
    setTrackingLoading(prev => new Set([...prev, ...missing]))
    let cancelled = false
    ;(async () => {
      for (const batch of batches) {
        if (cancelled) return
        try {
          const res = await fetch('/api/ups/batch-track', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackingNumbers: batch }),
          })
          if (res.ok) {
            const d: { results: Record<string, TrackingResult> } = await res.json()
            if (!cancelled) setTrackingMap(prev => ({ ...prev, ...d.results }))
          }
        } catch { /* ignore */ }
        if (!cancelled) setTrackingLoading(prev => { const next = new Set(prev); batch.forEach(tn => next.delete(tn)); return next })
      }
    })()
    return () => { cancelled = true }
  }, [trackingKey])

  async function voidLabel(o: Orphan) {
    if (!confirm(`Void label ${o.trackingNumber} (${money(o.cost)}) on ShipStation? This requests the carrier refund.`)) return
    setBusyId(o.shipmentId)
    try {
      const res = await fetch('/api/shipstation/orphan-labels/void', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentId: o.shipmentId, trackingNumber: o.trackingNumber, orderNumber: o.orderNumber, cost: o.cost }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Void failed')
      toast.success(`Voided ${o.trackingNumber}`)
      // Drops off the list on refresh (ShipStation marks it voided).
      setData(prev => prev ? { ...prev, orphans: prev.orphans.filter(x => x.shipmentId !== o.shipmentId), orphanCount: prev.orphanCount - 1, totalOrphanCost: Math.round((prev.totalOrphanCost - o.cost) * 100) / 100 } : prev)
      setVoidedLog(null) // invalidate so the Voided Log tab reloads fresh
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Void failed')
    } finally { setBusyId(null) }
  }

  const toggleSelected = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function bulkVoid() {
    const orphans = data?.orphans ?? []
    const targets = orphans.filter(o => selectedIds.has(o.shipmentId))
    if (targets.length === 0) return
    const totalCost = targets.reduce((s, o) => s + (o.cost ?? 0), 0)
    if (!confirm(`Void ${targets.length} label${targets.length !== 1 ? 's' : ''} (${money(totalCost)}) on ShipStation? This requests carrier refunds.`)) return

    setBulkProgress({ done: 0, total: targets.length, ok: 0, failed: 0, current: null })
    let ok = 0, failed = 0
    // Sequential — respects ShipStation's rate limit and gives clean progress.
    for (let i = 0; i < targets.length; i++) {
      const o = targets[i]
      setBulkProgress({ done: i, total: targets.length, ok, failed, current: o.trackingNumber })
      try {
        const res = await fetch('/api/shipstation/orphan-labels/void', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipmentId: o.shipmentId, trackingNumber: o.trackingNumber, orderNumber: o.orderNumber, cost: o.cost }),
        })
        if (!res.ok) throw new Error()
        ok++
        setData(prev => prev ? { ...prev, orphans: prev.orphans.filter(x => x.shipmentId !== o.shipmentId), orphanCount: prev.orphanCount - 1, totalOrphanCost: Math.round((prev.totalOrphanCost - (o.cost ?? 0)) * 100) / 100 } : prev)
        setSelectedIds(prev => { const n = new Set(prev); n.delete(o.shipmentId); return n })
      } catch { failed++ }
      setBulkProgress({ done: i + 1, total: targets.length, ok, failed, current: null })
    }
    setVoidedLog(null) // invalidate the Voided Log tab
    toast[failed === 0 ? 'success' : 'error'](`Bulk void complete — ${ok} voided${failed ? `, ${failed} failed` : ''}`)
    // Leave the completed bar up briefly, then clear.
    setTimeout(() => setBulkProgress(null), 2500)
  }

  async function toggleRefund(o: Orphan) {
    setBusyId(o.shipmentId)
    try {
      const res = await fetch('/api/shipstation/orphan-labels/refund-requested', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentId: o.shipmentId, trackingNumber: o.trackingNumber, orderNumber: o.orderNumber, cost: o.cost, undo: o.refundRequested }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      setData(prev => prev ? { ...prev, orphans: prev.orphans.map(x => x.shipmentId === o.shipmentId ? { ...x, refundRequested: j.refundRequested } : x) } : prev)
      toast.success(j.refundRequested ? 'Marked refund requested' : 'Cleared refund flag')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setBusyId(null) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Ban size={18} className="text-red-500" /> Orphaned Labels
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          ShipStation labels we paid for that our system never recorded — candidates to void &amp; refund.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        {([['orphans', 'Orphaned Labels'], ['voided', 'Voided Log']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === key ? 'border-amazon-blue text-amazon-blue' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'orphans' ? (
      <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        <label className="text-xs text-gray-500">Lookback</label>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="h-8 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 px-2 text-sm">
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>365 days</option>
        </select>
        <button onClick={() => sync(days)} disabled={syncing || loading}
          title="Pull the latest labels from ShipStation (rate-limited — may take a minute)"
          className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {syncing ? <><Loader2 size={13} className="animate-spin" /> Syncing…</> : <><RefreshCw size={13} /> Sync with ShipStation</>}
        </button>
        {data?.lastSyncedAt && (
          <span className="text-[11px] text-gray-400">Last synced {new Date(data.lastSyncedAt).toLocaleString()}</span>
        )}
        {data && (
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span className="text-gray-400">Scanned {data.shipmentsScanned} labels</span>
            <span className="font-semibold text-red-600 dark:text-red-400">{data.orphanCount} orphan{data.orphanCount !== 1 ? 's' : ''}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-gray-700 dark:text-gray-200"><DollarSign size={12} /> {money(data.totalOrphanCost)} at risk</span>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {(selectedIds.size > 0 || bulkProgress) && (
        <div className="flex items-center gap-3 px-6 py-2.5 border-b bg-red-50 dark:bg-red-900/20 dark:border-gray-700 shrink-0">
          {!bulkProgress ? (
            <>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{selectedIds.size} selected</span>
              <button onClick={bulkVoid}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
                <Ban size={14} /> Bulk Void ({selectedIds.size})
              </button>
              <button onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Clear</button>
            </>
          ) : (
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {bulkProgress.done < bulkProgress.total
                    ? <>Voiding {bulkProgress.done + 1} of {bulkProgress.total}{bulkProgress.current ? ` — ${bulkProgress.current}` : ''}…</>
                    : <>Done — {bulkProgress.ok} voided{bulkProgress.failed ? `, ${bulkProgress.failed} failed` : ''}</>}
                </span>
                <span className="text-gray-500">{bulkProgress.done}/{bulkProgress.total}
                  {bulkProgress.failed > 0 && <span className="text-red-600 ml-2">✗ {bulkProgress.failed}</span>}
                  <span className="text-green-600 ml-2">✓ {bulkProgress.ok}</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full bg-red-500 transition-all duration-200"
                  style={{ width: `${Math.round((bulkProgress.done / bulkProgress.total) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading || syncing ? (
          <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> {syncing ? 'Reconciling with ShipStation…' : 'Loading…'}</div>
        ) : error ? (
          <div className="py-20 text-center">
            <AlertCircle size={32} className="mx-auto text-red-400 mb-2" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : !data?.lastSyncedAt ? (
          <div className="py-20 text-center">
            <RefreshCw size={36} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-500">No scan yet — click <span className="font-semibold">Sync with ShipStation</span> to reconcile labels.</p>
          </div>
        ) : !data || data.orphans.length === 0 ? (
          <div className="py-20 text-center">
            <CheckCircle2 size={36} className="mx-auto text-green-400 mb-3" />
            <p className="text-sm font-medium text-gray-500">No orphaned labels as of the last sync — every paid label is accounted for.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 z-10">
              <tr>
                <th className="px-3 py-2.5 w-8 text-center">
                  <input type="checkbox"
                    checked={data.orphans.length > 0 && data.orphans.every(o => selectedIds.has(o.shipmentId))}
                    onChange={e => setSelectedIds(e.target.checked ? new Set(data.orphans.map(o => o.shipmentId)) : new Set())}
                    className="rounded border-gray-500 text-red-500 focus:ring-red-500" />
                </th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Created</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Order #</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">OLM</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Carrier / Service</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking Status</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Order Status</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Cost</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.orphans.map((o, i) => (
                <tr key={o.shipmentId} className={clsx(selectedIds.has(o.shipmentId) ? 'bg-red-50 dark:bg-red-900/20' : i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50')}>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={selectedIds.has(o.shipmentId)} onChange={() => toggleSelected(o.shipmentId)}
                      className="rounded border-gray-300 text-red-500 focus:ring-red-500" />
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(o.createDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{o.orderNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{o.olmNumber ? `OLM-${o.olmNumber}` : '—'}</td>
                  <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap">{o.trackingNumber}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{o.carrier ?? '—'}{o.service ? ` · ${o.service}` : ''}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.trackingNumber
                      ? <TrackingBadge info={trackingMap[o.trackingNumber]} loading={trackingLoading.has(o.trackingNumber)} />
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.orderWorkflowStatus
                      ? <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{o.orderWorkflowStatus}</span>
                      : <span className="text-gray-400">no order</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{money(o.cost)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => toggleRefund(o)} disabled={busyId === o.shipmentId || !!bulkProgress}
                        className={clsx('inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium border transition-colors disabled:opacity-50',
                          o.refundRequested
                            ? 'bg-green-600 text-white border-green-600'
                            : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800')}>
                        <DollarSign size={10} /> {o.refundRequested ? 'Refund requested' : 'Mark refund requested'}
                      </button>
                      <button onClick={() => voidLabel(o)} disabled={busyId === o.shipmentId || !!bulkProgress}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                        {busyId === o.shipmentId ? <Loader2 size={10} className="animate-spin" /> : <Ban size={10} />} Void
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>
      ) : (
        /* ── Voided Log tab ── */
        <>
        <div className="flex items-center gap-4 px-6 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 text-xs">
          <span className="text-gray-500">Labels voided from this tool</span>
          {voidedLog && (
            <>
              <span className="font-semibold text-gray-700 dark:text-gray-200">{voidedLog.length} voided</span>
              <span className="inline-flex items-center gap-1 font-semibold text-green-700 dark:text-green-400"><DollarSign size={12} /> {money(voidedTotal)} refund requested</span>
            </>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {voidedLoading ? (
            <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : !voidedLog || voidedLog.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-400">No labels have been voided yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-800 z-10">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Voided</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Order #</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Shipment ID</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Cost</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Voided By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {voidedLog.map((r, i) => (
                  <tr key={r.id} className={clsx(i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50')}>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(r.voidedAt).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.orderNumber ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap">{r.trackingNumber ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-gray-500 whitespace-nowrap">{r.shipmentId ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.cost != null ? money(r.cost) : '—'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.voidedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>
      )}
    </div>
  )
}

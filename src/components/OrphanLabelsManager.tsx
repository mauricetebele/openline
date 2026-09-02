'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Ban, RefreshCw, Loader2, AlertCircle, CheckCircle2, DollarSign } from 'lucide-react'
import { clsx } from 'clsx'

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

interface ReconResult {
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
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async (d: number) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/shipstation/orphan-labels?days=${d}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(days) }, [load, days])

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Void failed')
    } finally { setBusyId(null) }
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
        <button onClick={() => load(days)} disabled={loading}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
        {data && (
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span className="text-gray-400">Scanned {data.shipmentsScanned} labels</span>
            <span className="font-semibold text-red-600 dark:text-red-400">{data.orphanCount} orphan{data.orphanCount !== 1 ? 's' : ''}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-gray-700 dark:text-gray-200"><DollarSign size={12} /> {money(data.totalOrphanCost)} at risk</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Reconciling with ShipStation…</div>
        ) : error ? (
          <div className="py-20 text-center">
            <AlertCircle size={32} className="mx-auto text-red-400 mb-2" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : !data || data.orphans.length === 0 ? (
          <div className="py-20 text-center">
            <CheckCircle2 size={36} className="mx-auto text-green-400 mb-3" />
            <p className="text-sm font-medium text-gray-500">No orphaned labels in the last {days} days — every paid label is accounted for.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Created</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Order #</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">OLM</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Carrier / Service</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Order Status</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Cost</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.orphans.map((o, i) => (
                <tr key={o.shipmentId} className={clsx(i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50')}>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(o.createDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{o.orderNumber ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{o.olmNumber ? `OLM-${o.olmNumber}` : '—'}</td>
                  <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap">{o.trackingNumber}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{o.carrier ?? '—'}{o.service ? ` · ${o.service}` : ''}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.orderWorkflowStatus
                      ? <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{o.orderWorkflowStatus}</span>
                      : <span className="text-gray-400">no order</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{money(o.cost)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => toggleRefund(o)} disabled={busyId === o.shipmentId}
                        className={clsx('inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium border transition-colors disabled:opacity-50',
                          o.refundRequested
                            ? 'bg-green-600 text-white border-green-600'
                            : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800')}>
                        <DollarSign size={10} /> {o.refundRequested ? 'Refund requested' : 'Mark refund requested'}
                      </button>
                      <button onClick={() => voidLabel(o)} disabled={busyId === o.shipmentId}
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
    </div>
  )
}

'use client'
import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCcw, AlertCircle, ExternalLink, CheckCircle2, Archive, ArchiveRestore, StickyNote } from 'lucide-react'

interface Row {
  orderId: string
  olmNumber: number | null
  shippedAt: string
  ageDays: number
  orderTotal: number | null
  currency: string
  shipToName: string | null
  note: string | null
  solvedAt: string | null
  archived: boolean
  archivedAt: string | null
  updatedBy: string | null
}

type Tab = 'active' | 'archived'

const money = (n: number | null, c: string) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: c || 'USD' }))
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export default function BmUnpaidOrders() {
  const [tab, setTab] = useState<Tab>('active')
  const [rows, setRows] = useState<Row[]>([])
  const [count, setCount] = useState(0)
  const [totalOutstanding, setTotalOutstanding] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((t: Tab) => {
    setLoading(true); setError(null)
    fetch(`/api/bm-unpaid-orders?tab=${t}`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then(d => { setRows(d.rows ?? []); setCount(d.count ?? 0); setTotalOutstanding(d.totalOutstanding ?? 0) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  const act = async (orderId: string, action: 'solve' | 'archive' | 'unarchive', note?: string) => {
    setBusy(orderId); setError(null)
    try {
      const res = await fetch('/api/bm-unpaid-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, action, note }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      load(tab)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const onSolve = (r: Row) => {
    const note = window.prompt(`Problem Solved — note for order ${r.orderId}:`, r.note ?? '')
    if (note === null) return // cancelled
    act(r.orderId, 'solve', note)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
          {(['active', 'archived'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-4 py-1.5 font-medium capitalize', tab === t ? 'bg-gray-800 text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800')}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={clsx('rounded-lg border px-3 py-1 font-semibold', tab === 'active' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200')}>
            {count} {tab === 'active' ? 'unpaid' : 'archived'}
          </span>
          <span className="rounded-lg bg-gray-50 text-gray-700 border border-gray-200 px-3 py-1 font-medium">{money(totalOutstanding, 'USD')} total</span>
        </div>
        <button onClick={() => load(tab)} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCcw size={13} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</div>
      )}

      <div className="flex-1 overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-800 text-gray-100 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">BM Order #</th>
              <th className="px-3 py-2 text-left font-semibold">OLM #</th>
              <th className="px-3 py-2 text-left font-semibold">Customer</th>
              <th className="px-3 py-2 text-left font-semibold">Shipped</th>
              <th className="px-3 py-2 text-right font-semibold">Age (days)</th>
              <th className="px-3 py-2 text-right font-semibold">Order Total</th>
              <th className="px-3 py-2 text-left font-semibold">Note</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400"><RefreshCcw size={16} className="animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-400">
                {tab === 'active' ? 'No unpaid Back Market orders — every shipped order has a payment. 🎉' : 'Nothing archived yet.'}
              </td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.orderId} className={clsx(i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/40', 'hover:bg-amber-50/50')}>
                <td className="px-3 py-1.5 font-mono">
                  <a href={`https://www.backmarket.com/bo_merchant/orders/${r.orderId}`} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 text-amazon-blue hover:underline">
                    {r.orderId} <ExternalLink size={10} />
                  </a>
                </td>
                <td className="px-3 py-1.5 font-medium">{r.olmNumber != null ? `OLM-${r.olmNumber}` : '—'}</td>
                <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{r.shipToName ?? '—'}</td>
                <td className="px-3 py-1.5 text-gray-500">{fmtDate(r.shippedAt)}</td>
                <td className={clsx('px-3 py-1.5 text-right font-semibold tabular-nums', r.ageDays >= 14 ? 'text-red-600' : r.ageDays >= 7 ? 'text-amber-600' : 'text-gray-500')}>
                  {r.ageDays}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.orderTotal, r.currency)}</td>
                <td className="px-3 py-1.5 max-w-[16rem]">
                  {r.note ? (
                    <span className="inline-flex items-start gap-1 text-gray-700 dark:text-gray-200" title={`${r.note}${r.updatedBy ? ` — ${r.updatedBy}` : ''}`}>
                      {r.solvedAt && <CheckCircle2 size={12} className="text-green-600 mt-0.5 shrink-0" />}
                      <span className="line-clamp-2">{r.note}</span>
                    </span>
                  ) : r.solvedAt ? (
                    <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 size={12} /> solved</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onSolve(r)} disabled={busy === r.orderId}
                      className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-green-200 bg-green-50 text-green-700 text-[11px] font-medium hover:bg-green-100 disabled:opacity-50"
                      title="Record a resolution note">
                      {r.note || r.solvedAt ? <StickyNote size={12} /> : <CheckCircle2 size={12} />}
                      {r.note || r.solvedAt ? 'Edit Note' : 'Problem Solved'}
                    </button>
                    {tab === 'active' ? (
                      <button onClick={() => act(r.orderId, 'archive')} disabled={busy === r.orderId}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-gray-200 bg-white text-gray-600 text-[11px] font-medium hover:bg-gray-50 disabled:opacity-50"
                        title="Move to Archived tab">
                        <Archive size={12} /> Archive
                      </button>
                    ) : (
                      <button onClick={() => act(r.orderId, 'unarchive')} disabled={busy === r.orderId}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-gray-200 bg-white text-gray-600 text-[11px] font-medium hover:bg-gray-50 disabled:opacity-50"
                        title="Restore to active list">
                        <ArchiveRestore size={12} /> Unarchive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

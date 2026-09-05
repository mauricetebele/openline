'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { Flag, CheckCircle2, RefreshCw, Loader2, DollarSign, Undo2, Copy } from 'lucide-react'

interface Refund {
  id: string
  transactionId: string
  postedDate: string
  amount: number
  currency: string
  orderId: string | null
  transactionType: string | null
  description: string | null
  status: string
  note: string | null
  flaggedByLabel: string | null
  validatedByLabel: string | null
  channel: 'FBA' | 'MFN' | null
}
interface Counts { notReviewed: number; flagged: number; validated: number }

type Tab = 'not_reviewed' | 'flagged' | 'validated'
const TABS: { key: Tab; label: string }[] = [
  { key: 'not_reviewed', label: 'Not Yet Reviewed' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'validated', label: 'Validated' },
]
const money = (n: number, c: string) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c && c !== 'USD' ? ` ${c}` : ''}`

export default function AmazonRefundsManager() {
  const [tab, setTab] = useState<Tab>('not_reviewed')
  const [rows, setRows] = useState<Refund[]>([])
  const [counts, setCounts] = useState<Counts>({ notReviewed: 0, flagged: 0, validated: 0 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [channelFilter, setChannelFilter] = useState<'all' | 'FBA' | 'MFN'>('all')
  // Row whose Order ID was opened in a new tab — stays highlighted until the
  // user clicks away, so it's clear which row they were working on.
  const [activeRowId, setActiveRowId] = useState<string | null>(null)

  const load = useCallback(async (t: Tab) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/amazon-refunds?tab=${t}`)
      const j = await res.json()
      setRows(j.rows ?? [])
      setCounts(j.counts ?? { notReviewed: 0, flagged: 0, validated: 0 })
      const nd: Record<string, string> = {}
      for (const r of (j.rows ?? []) as Refund[]) nd[r.id] = r.note ?? ''
      setNoteDraft(nd)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(tab) }, [load, tab])

  // Clear the highlight when the user clicks anywhere outside the active row.
  useEffect(() => {
    if (!activeRowId) return
    function onDown(e: MouseEvent) {
      const el = (e.target as HTMLElement).closest('[data-rowid]')
      if (!el || el.getAttribute('data-rowid') !== activeRowId) setActiveRowId(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [activeRowId])

  async function sync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/amazon-refunds/sync', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Sync failed')
      toast.success(`Synced — ${j.created} new refund${j.created !== 1 ? 's' : ''} compiled`)
      load(tab)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed')
    } finally { setSyncing(false) }
  }

  async function setStatus(r: Refund, status: string) {
    setBusyId(r.id)
    try {
      const res = await fetch(`/api/amazon-refunds/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      // Row leaves the current tab.
      setRows(prev => prev.filter(x => x.id !== r.id))
      setCounts(prev => {
        const c = { ...prev }
        if (r.status === 'NOT_REVIEWED') c.notReviewed--
        else if (r.status === 'FLAGGED') c.flagged--
        else if (r.status === 'VALIDATED') c.validated--
        if (status === 'NOT_REVIEWED') c.notReviewed++
        else if (status === 'FLAGGED') c.flagged++
        else if (status === 'VALIDATED') c.validated++
        return c
      })
      toast.success(status === 'FLAGGED' ? 'Flagged' : status === 'VALIDATED' ? 'Validated' : 'Reopened')
    } catch {
      toast.error('Update failed')
    } finally { setBusyId(null) }
  }

  async function saveNote(r: Refund) {
    const note = noteDraft[r.id] ?? ''
    if ((r.note ?? '') === note) return
    try {
      const res = await fetch(`/api/amazon-refunds/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) throw new Error()
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, note: note || null } : x))
      toast.success('Note saved')
    } catch {
      toast.error('Failed to save note')
    }
  }

  const visibleRows = channelFilter === 'all' ? rows : rows.filter(r => r.channel === channelFilter)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><DollarSign size={18} className="text-amazon-blue" /> Review Amazon Refunds</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Daily compilation of Amazon refund transactions to review, flag, and validate.</p>
        </div>
        <button onClick={sync} disabled={syncing}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing…</> : <><RefreshCw size={14} /> Sync</>}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        {TABS.map(t => {
          const n = t.key === 'not_reviewed' ? counts.notReviewed : t.key === 'flagged' ? counts.flagged : counts.validated
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={clsx('px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
                tab === t.key ? 'border-amazon-blue text-amazon-blue' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')}>
              {t.label}
              <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', tab === t.key ? 'bg-amazon-blue text-white' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300')}>{n}</span>
            </button>
          )
        })}
        {/* Channel filter */}
        <div className="ml-auto flex items-center gap-1.5 self-center pb-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-0.5">Channel</span>
          {(['all', 'FBA', 'MFN'] as const).map(c => (
            <button key={c} onClick={() => setChannelFilter(c)}
              className={clsx('px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
                channelFilter === c ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300')}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : visibleRows.length === 0 ? (
          <div className="py-20 text-center">
            <CheckCircle2 size={36} className="mx-auto text-green-400 mb-3" />
            <p className="text-sm font-medium text-gray-400">{channelFilter !== 'all' ? `No ${channelFilter} refunds in this tab.` : tab === 'not_reviewed' ? 'Nothing left to review.' : tab === 'flagged' ? 'No flagged refunds.' : 'No validated refunds yet.'}</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Posted</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Order ID</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Channel</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Amount</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Type</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Description</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap w-64">Note</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {visibleRows.map((r, i) => (
                <tr key={r.id} data-rowid={r.id}
                  className={clsx(activeRowId === r.id
                    ? 'bg-amber-100 dark:bg-amber-900/30 ring-2 ring-inset ring-amber-400'
                    : i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50')}>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(r.postedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {r.orderId ? (
                      <span className="inline-flex items-center gap-1.5">
                        <a href={`https://sellercentral.amazon.com/orders-v3/order/${r.orderId}`}
                          onClick={e => { e.preventDefault(); setActiveRowId(r.id); window.open(`https://sellercentral.amazon.com/orders-v3/order/${r.orderId}`, 'amazonSellerCentral') }}
                          className="text-amazon-blue hover:underline cursor-pointer">{r.orderId}</a>
                        <button
                          onClick={() => { navigator.clipboard.writeText(r.orderId!); toast.success('Order ID copied') }}
                          title="Copy Order ID"
                          className="text-gray-300 hover:text-gray-600 dark:hover:text-gray-200">
                          <Copy size={12} />
                        </button>
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.channel === 'FBA' ? (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">FBA</span>
                    ) : r.channel === 'MFN' ? (
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">MFN</span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                  <td className={clsx('px-3 py-2 text-right font-mono font-semibold whitespace-nowrap', r.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400')}>{money(r.amount, r.currency)}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.transactionType ?? 'Refund'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-[240px] truncate" title={r.description ?? ''}>{r.description ?? '—'}</td>
                  <td className="px-3 py-2">
                    <input
                      value={noteDraft[r.id] ?? ''}
                      onChange={e => setNoteDraft(prev => ({ ...prev, [r.id]: e.target.value }))}
                      onBlur={() => saveNote(r)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      placeholder="Add note…"
                      className="w-full text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {r.status !== 'NOT_REVIEWED' && (
                        <button onClick={() => setStatus(r, 'NOT_REVIEWED')} disabled={busyId === r.id}
                          title="Reopen — move back to Not Yet Reviewed"
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
                          <Undo2 size={11} /> Reopen
                        </button>
                      )}
                      {r.status !== 'FLAGGED' && (
                        <button onClick={() => setStatus(r, 'FLAGGED')} disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
                          <Flag size={11} /> Flag
                        </button>
                      )}
                      {r.status !== 'VALIDATED' && (
                        <button onClick={() => setStatus(r, 'VALIDATED')} disabled={busyId === r.id}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                          {busyId === r.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Validate
                        </button>
                      )}
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

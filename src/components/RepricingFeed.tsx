'use client'
/**
 * Amazon Repricing Suggestion Feed — one row per ASIN + condition group.
 * Every suggestion needs Approve (pushes to all SKUs in the group) or Reject
 * (snoozes that rule for 24 h). Margins shown are informational (no floor).
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { TrendingUp, RefreshCw, Loader2, Check, X, Pencil, ChevronRight, ChevronDown } from 'lucide-react'

type Strategy = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE'
type Status = 'SUGGESTION' | 'NO_CHANGE' | 'SNOOZED' | 'COOLDOWN' | 'NO_DATA'

interface FeedSku {
  sku: string; channel: string; price: number | null; qty: number
  units7d: number; units30d: number
  marginCurrent: number | null; marginSuggested: number | null; mapped: boolean
}
interface FeedGroup {
  key: string; accountId: string; asin: string; itemCondition: string; title: string | null
  strategy: Strategy; skus: FeedSku[]
  currentPrice: number | null; stock: number; units7d: number; units30d: number
  daysSinceLastSale: number | null; daysOfCover: number | null
  buyBoxPrice: number | null; buyBoxHolder: string | null; weHoldBuyBox: boolean
  lowestCompetitor: number | null; competitorCount: number; offersFetchedAt: string | null
  speed: string; competition: string; rule: string
  suggestedPrice: number | null; changePct: number | null
  marginCurrent: { min: number | null; max: number | null }
  marginSuggested: { min: number | null; max: number | null }
  reason: string; explanation: string[]; status: Status; primeEdgePct: number | null
  snoozedUntil: string | null; cooldownUntil: string | null
  lastRejectedAt: string | null; lastRejectedBy: string | null
}

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)
const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`)
const marginSpan = (m: { min: number | null; max: number | null }) =>
  m.min == null ? '—' : m.min === m.max ? pct(m.min) : `${pct(m.min)}–${pct(m.max)}`
const marginColor = (n: number | null) => (n == null ? 'text-gray-400' : n < 0 ? 'text-red-600 dark:text-red-400' : n < 10 ? 'text-amber-600 dark:text-amber-400' : 'text-green-700 dark:text-green-400')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

const SPEED_BADGE: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  HEALTHY: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  SLOW: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  STALE: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
}
const COMP_BADGE: Record<string, string> = {
  WINNING: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  LOWEST: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  CLOSE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  LOSING: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  ALONE: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
}
const FILTERS: { key: 'SUGGESTION' | 'WAITING' | 'ALL'; label: string }[] = [
  { key: 'SUGGESTION', label: 'Needs decision' },
  { key: 'WAITING', label: 'Snoozed / cooling down' },
  { key: 'ALL', label: 'All groups' },
]

export default function RepricingFeed() {
  const [groups, setGroups] = useState<FeedGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [filter, setFilter] = useState<'SUGGESTION' | 'WAITING' | 'ALL'>('SUGGESTION')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/repricing/feed')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to load feed')
      setGroups(j.groups)
      setGeneratedAt(j.generatedAt)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load feed')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function setStrategy(g: FeedGroup, strategy: Strategy) {
    setBusy(g.key)
    try {
      const res = await fetch('/api/repricing/strategy', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: g.accountId, asin: g.asin, itemCondition: g.itemCondition, strategy }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      toast.success(`${g.asin} ${g.itemCondition} → ${strategy.toLowerCase()}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to set strategy')
    } finally { setBusy(null) }
  }

  async function decide(g: FeedGroup, action: 'approve' | 'reject') {
    let price: number | undefined
    let note: string | undefined
    if (action === 'approve') {
      const edited = editing[g.key]
      if (edited != null && edited.trim() !== '') {
        price = parseFloat(edited)
        if (!(price > 0)) { toast.error('Enter a valid price'); return }
      }
      const p = price ?? g.suggestedPrice
      if (!window.confirm(`Push ${money(p ?? null)} to ${g.skus.length} SKU${g.skus.length === 1 ? '' : 's'} on Amazon for ${g.asin} (${g.itemCondition})?`)) return
    } else {
      const n = window.prompt('Reject this suggestion — optional note (the rule is snoozed for 24 hours):', '')
      if (n === null) return
      note = n
    }
    setBusy(g.key)
    try {
      const res = await fetch('/api/repricing/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: g.accountId, asin: g.asin, itemCondition: g.itemCondition, action, price, note }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      if (action === 'reject') toast.success(`Rejected — snoozed until ${when(j.snoozeUntil)}`)
      else {
        const failed = (j.pushResults ?? []).filter((r: { ok: boolean }) => !r.ok)
        if (failed.length) toast.error(`Pushed ${money(j.finalPrice)} — ${failed.length} SKU(s) failed: ${failed[0].error}`)
        else toast.success(`Pushed ${money(j.finalPrice)} to ${j.pushResults.length} SKU(s)`)
      }
      setEditing(prev => { const n = { ...prev }; delete n[g.key]; return n })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setBusy(null) }
  }

  const counts = {
    SUGGESTION: groups.filter(g => g.status === 'SUGGESTION').length,
    WAITING: groups.filter(g => g.status === 'SNOOZED' || g.status === 'COOLDOWN').length,
    ALL: groups.length,
  }
  const visible = groups.filter(g => filter === 'ALL' ? true : filter === 'SUGGESTION' ? g.status === 'SUGGESTION' : (g.status === 'SNOOZED' || g.status === 'COOLDOWN'))
  const noData = groups.filter(g => g.status === 'NO_DATA').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><TrendingUp size={18} className="text-amazon-blue" /> Repricing Feed — Amazon</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Suggestions per ASIN + condition (sales pooled across its SKUs). Nothing is pushed until you approve; rejecting snoozes that rule for 24 h.
            {generatedAt && <span className="ml-1">Updated {when(generatedAt)}.</span>}
            {noData > 0 && <span className="ml-1 text-amber-600">{noData} group{noData === 1 ? '' : 's'} waiting for competitor data.</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : <><RefreshCw size={14} /> Refresh</>}
        </button>
      </div>

      <div className="px-6 pt-3 flex gap-2 shrink-0">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={clsx('px-3 py-1.5 rounded-md text-sm font-medium border',
              filter === f.key ? 'bg-amazon-blue text-white border-amazon-blue' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800')}>
            {f.label} <span className="ml-1 opacity-75">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-6 py-3">
        <table className="w-full text-xs border border-gray-200 dark:border-gray-700">
          <thead className="sticky top-0 bg-gray-800 z-10">
            <tr className="text-gray-100">
              <th className="px-2 py-2.5 text-left font-semibold">ASIN / Condition</th>
              <th className="px-2 py-2.5 text-left font-semibold">Strategy</th>
              <th className="px-2 py-2.5 text-left font-semibold">Signals</th>
              <th className="px-2 py-2.5 text-right font-semibold" title="Units sold across all SKUs in the group">Sales 7d / 30d</th>
              <th className="px-2 py-2.5 text-right font-semibold">Stock / Cover</th>
              <th className="px-2 py-2.5 text-right font-semibold">Buy Box</th>
              <th className="px-2 py-2.5 text-right font-semibold" title="Lowest competing offer in the same condition">Lowest Comp.</th>
              <th className="px-2 py-2.5 text-right font-semibold">Current → Suggested</th>
              <th className="px-2 py-2.5 text-right font-semibold" title="Net margin at current → suggested price (range across the group's SKUs)">Margin</th>
              <th className="px-2 py-2.5 text-left font-semibold w-96">Why</th>
              <th className="px-2 py-2.5 text-right font-semibold">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {visible.length === 0 && !loading && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">Nothing here right now.</td></tr>
            )}
            {visible.map((g, i) => {
              const open = expanded.has(g.key)
              const up = (g.changePct ?? 0) > 0
              return (
                <FeedRows key={g.key} g={g} i={i} open={open} up={up} busy={busy === g.key}
                  editValue={editing[g.key]}
                  onToggle={() => setExpanded(prev => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}
                  onEdit={v => setEditing(prev => ({ ...prev, [g.key]: v }))}
                  onStrategy={s => setStrategy(g, s)}
                  onApprove={() => decide(g, 'approve')}
                  onReject={() => decide(g, 'reject')} />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FeedRows({ g, i, open, up, busy, editValue, onToggle, onEdit, onStrategy, onApprove, onReject }: {
  g: FeedGroup; i: number; open: boolean; up: boolean; busy: boolean; editValue: string | undefined
  onToggle: () => void; onEdit: (v: string) => void; onStrategy: (s: Strategy) => void
  onApprove: () => void; onReject: () => void
}) {
  const decidable = g.status === 'SUGGESTION' || g.status === 'SNOOZED' || g.status === 'COOLDOWN'
  return (
    <>
      <tr className={clsx('align-top', i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50')}>
        <td className="px-2 py-2">
          <button onClick={onToggle} className="flex items-start gap-1 text-left">
            {open ? <ChevronDown size={14} className="mt-0.5 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" />}
            <span>
              <a href={`https://www.amazon.com/dp/${g.asin}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="font-mono text-amazon-blue hover:underline">{g.asin}</a>
              <span className="ml-1.5 text-gray-500">{g.itemCondition}</span>
              <span className="block text-[10px] text-gray-400 max-w-[220px] truncate" title={g.title ?? ''}>{g.title ?? '—'}</span>
              <span className="block text-[10px] text-gray-400">{g.skus.length} SKU{g.skus.length === 1 ? '' : 's'}</span>
            </span>
          </button>
        </td>
        <td className="px-2 py-2">
          <select value={g.strategy} disabled={busy} onChange={e => onStrategy(e.target.value as Strategy)}
            className="h-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs px-1">
            <option value="CONSERVATIVE">Conservative</option>
            <option value="STANDARD">Standard</option>
            <option value="AGGRESSIVE">Aggressive</option>
          </select>
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          {g.status === 'NO_DATA' ? <span className="text-gray-400">waiting for data</span> : (
            <div className="flex flex-col gap-1">
              <span className={clsx('inline-flex w-fit px-1.5 py-0.5 rounded text-[10px] font-bold', SPEED_BADGE[g.speed])}>{g.speed}</span>
              <span className={clsx('inline-flex w-fit px-1.5 py-0.5 rounded text-[10px] font-bold', COMP_BADGE[g.competition])}>{g.competition}</span>
            </div>
          )}
        </td>
        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
          {g.units7d} / {g.units30d}
          <span className="block text-[10px] text-gray-400 font-sans">{g.daysSinceLastSale != null ? `last ${g.daysSinceLastSale}d ago` : 'no sales'}</span>
        </td>
        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
          {g.stock}
          <span className="block text-[10px] text-gray-400 font-sans">{g.daysOfCover != null ? `${g.daysOfCover}d cover` : '—'}</span>
        </td>
        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
          {money(g.buyBoxPrice)}
          <span className={clsx('block text-[10px] font-sans', g.weHoldBuyBox ? 'text-green-600' : 'text-gray-400')}>{g.weHoldBuyBox ? 'You' : g.buyBoxHolder ?? ''}</span>
          {g.primeEdgePct != null && (
            <span className="inline-block mt-0.5 px-1 rounded text-[10px] font-sans font-semibold bg-[#00A8E1] text-white"
              title={`Their offer isn't Prime and ours is — we're allowed up to ${g.primeEdgePct}% above it`}>Prime +{g.primeEdgePct}%</span>
          )}
        </td>
        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
          {money(g.lowestCompetitor)}
          <span className="block text-[10px] text-gray-400 font-sans">{g.competitorCount} offer{g.competitorCount === 1 ? '' : 's'}</span>
        </td>
        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
          <span className="text-gray-500">{money(g.currentPrice)}</span>
          {g.suggestedPrice != null && (
            <>
              <span className="mx-1 text-gray-400">→</span>
              <span className={clsx('font-semibold', up ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>{money(g.suggestedPrice)}</span>
              <span className="block text-[10px] text-gray-400 font-sans">{(g.changePct ?? 0) > 0 ? '+' : ''}{g.changePct?.toFixed(1)}%</span>
            </>
          )}
        </td>
        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
          <span className={marginColor(g.marginCurrent.min)}>{marginSpan(g.marginCurrent)}</span>
          {g.suggestedPrice != null && (
            <>
              <span className="mx-1 text-gray-400">→</span>
              <span className={clsx('font-semibold', marginColor(g.marginSuggested.min))}>{marginSpan(g.marginSuggested)}</span>
            </>
          )}
        </td>
        <td className="px-2 py-2 text-gray-700 dark:text-gray-300 w-96">
          <ol className="list-decimal pl-4 space-y-0.5 leading-snug">
            {g.explanation.map((line, idx) => (
              <li key={idx} className={clsx(line.startsWith('Suggested:') && 'font-semibold text-gray-900 dark:text-gray-100')}>{line}</li>
            ))}
          </ol>
          {g.status === 'SUGGESTION' && g.lastRejectedAt && <span className="block mt-1 text-[10px] text-gray-400">Previously rejected {when(g.lastRejectedAt)}{g.lastRejectedBy ? ` by ${g.lastRejectedBy}` : ''}</span>}
        </td>
        <td className="px-2 py-2 text-right whitespace-nowrap">
          {decidable && g.suggestedPrice != null ? (
            <div className="flex flex-col items-end gap-1">
              {editValue != null ? (
                <input type="number" step="0.01" autoFocus value={editValue} onChange={e => onEdit(e.target.value)}
                  className="w-24 h-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-right font-mono text-xs px-1" />
              ) : null}
              <div className="flex gap-1">
                <button onClick={onApprove} disabled={busy} title={editValue ? 'Approve & push your price' : 'Approve & push the suggested price'}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                </button>
                <button onClick={() => onEdit(editValue ?? (g.suggestedPrice ?? 0).toFixed(2))} disabled={busy} title="Edit the price before approving"
                  className="inline-flex items-center h-7 px-2 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                  <Pencil size={12} />
                </button>
                <button onClick={onReject} disabled={busy} title="Reject — snoozes this rule for 24 hours"
                  className="inline-flex items-center gap-1 h-7 px-2 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                  <X size={12} /> Reject
                </button>
              </div>
            </div>
          ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60 dark:bg-gray-800/30">
          <td colSpan={11} className="px-8 py-2">
            <table className="text-[11px]">
              <thead><tr className="text-gray-500">
                <th className="pr-6 text-left font-medium">SKU</th><th className="pr-6 text-left font-medium">Channel</th>
                <th className="pr-6 text-right font-medium">Price</th><th className="pr-6 text-right font-medium">Qty</th>
                <th className="pr-6 text-right font-medium">Sold 7d / 30d</th>
                <th className="pr-6 text-right font-medium">Margin now</th><th className="text-right font-medium">Margin at suggested</th>
              </tr></thead>
              <tbody>
                {g.skus.map(s => (
                  <tr key={s.sku}>
                    <td className="pr-6 font-mono">{s.sku}{!s.mapped && <span className="ml-1 text-amber-600" title="Not mapped to a product — margin unavailable">(unmapped)</span>}</td>
                    <td className="pr-6">{s.channel}</td>
                    <td className="pr-6 text-right font-mono">{money(s.price)}</td>
                    <td className="pr-6 text-right font-mono">{s.qty}</td>
                    <td className="pr-6 text-right font-mono">{s.units7d} / {s.units30d}</td>
                    <td className={clsx('pr-6 text-right font-mono', marginColor(s.marginCurrent))}>{pct(s.marginCurrent)}</td>
                    <td className={clsx('text-right font-mono', marginColor(s.marginSuggested))}>{pct(s.marginSuggested)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

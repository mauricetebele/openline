'use client'
/**
 * Amazon Repricing Suggestion Feed — one row per ASIN + condition group.
 * Every suggestion needs Approve (pushes to all SKUs in the group) or Reject
 * (snoozes that rule for 24 h). Margins shown are informational (no floor).
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { TrendingUp, RefreshCw, Loader2, Check, X, Pencil, ChevronRight, ChevronDown, Sparkles } from 'lucide-react'

type Strategy = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE'
type Status = 'SUGGESTION' | 'NO_CHANGE' | 'SNOOZED' | 'COOLDOWN' | 'NO_DATA'

interface FeedSku {
  sku: string; grade: string | null; channel: string; price: number | null; qty: number
  internalSku: string | null; internalDescription: string | null
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
  weArePrime: boolean | null; buyBoxPrime: boolean | null; lowestCompPrime: boolean | null
  liveSince: string | null; daysLive: number | null; liveReason: 'listed' | 'restocked' | 'amazon' | null; unitsSinceLive: number
  velocity: {
    score: number | null; raw: number | null; units: number; liveDays: number; estimatedPct: number
    confidence: 'low' | 'medium' | 'high'; baseline: number | null; target: number | null
    atPrice: { score: number | null; units: number; liveDays: number; since: string } | null
    buyBoxShare: number | null; buyBoxChecks: number
    uptime: { from: number; to: number; trackedSince: number | null; measured: [number, number][]; estimated: [number, number][] }
  }
  snoozedUntil: string | null; cooldownUntil: string | null
  lastRejectedAt: string | null; lastRejectedBy: string | null
}

const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)
const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`)
const marginSpan = (m: { min: number | null; max: number | null }) =>
  m.min == null ? '—' : m.min === m.max ? pct(m.min) : `${pct(m.min)}–${pct(m.max)}`
const marginColor = (n: number | null) => (n == null ? 'text-gray-400' : n < 0 ? 'text-red-600 dark:text-red-400' : n < 10 ? 'text-amber-600 dark:text-amber-400' : 'text-green-700 dark:text-green-400')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

// ── Visual building blocks ──────────────────────────────────────────────────
export type Tone = 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'sky' | 'teal' | 'violet' | 'prime'
const TONE: Record<Tone, { pill: string; box: string; text: string }> = {
  gray:   { pill: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-white/5 dark:text-gray-300 dark:border-gray-600', box: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900', text: 'text-gray-900 dark:text-gray-100' },
  blue:   { pill: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700', box: 'border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-900/10', text: 'text-blue-700 dark:text-blue-300' },
  green:  { pill: 'bg-green-50 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700', box: 'border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-900/10', text: 'text-green-700 dark:text-green-400' },
  red:    { pill: 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700', box: 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10', text: 'text-red-600 dark:text-red-400' },
  amber:  { pill: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700', box: 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10', text: 'text-amber-700 dark:text-amber-400' },
  sky:    { pill: 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-700', box: 'border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-900/10', text: 'text-sky-700 dark:text-sky-300' },
  teal:   { pill: 'bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700', box: 'border-teal-300 bg-teal-50/50 dark:border-teal-800 dark:bg-teal-900/10', text: 'text-teal-700 dark:text-teal-300' },
  violet: { pill: 'bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700', box: 'border-violet-300 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-900/10', text: 'text-violet-700 dark:text-violet-300' },
  prime:  { pill: 'bg-[#00A8E1] text-white border-[#0090c0]', box: 'border-[#00A8E1]', text: 'text-[#0077a3]' },
}

/** Small rounded pill with a coloured border. */
export function Pill({ tone = 'gray', children, title, mono }: { tone?: Tone; children: React.ReactNode; title?: string; mono?: boolean }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4', mono && 'font-mono', TONE[tone].pill)}>
      {children}
    </span>
  )
}

/** Labeled number box: tiny caption on top, the value big and bold below. */
export function Stat({ label, value, tone = 'gray', sub, title, valueClass }: {
  label: string; value: React.ReactNode; tone?: Tone; sub?: React.ReactNode; title?: string; valueClass?: string
}) {
  return (
    <div title={title} className={clsx('rounded-md border px-2 py-1 min-w-[64px]', TONE[tone].box)}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 leading-3">{label}</div>
      <div className={clsx('font-mono text-[13px] font-bold leading-5 tabular-nums', valueClass ?? TONE[tone].text)}>{value}</div>
      {sub && <div className="mt-0.5 flex flex-wrap gap-1">{sub}</div>}
    </div>
  )
}

const SPEED_TONE: Record<string, Tone> = { HOT: 'red', HEALTHY: 'green', SLOW: 'amber', STALE: 'sky', NEW: 'teal' }
const SPEED_LABEL: Record<string, string> = { HOT: '🔥 Hot', HEALTHY: '✅ Healthy', SLOW: '🐢 Slow', STALE: '🧊 Stale', NEW: '🌱 Just listed / restocked' }
const COMP_TONE: Record<string, Tone> = { WINNING: 'green', LOWEST: 'teal', CLOSE: 'amber', LOSING: 'red', ALONE: 'gray' }
const COMP_LABEL: Record<string, string> = { WINNING: 'Winning Buy Box', LOWEST: 'Lowest price', CLOSE: 'Close to Buy Box', LOSING: 'Losing Buy Box', ALONE: 'No competition' }
const marginTone = (n: number | null): Tone => (n == null ? 'gray' : n < 0 ? 'red' : n < 10 ? 'amber' : 'green')
// Left status stripe on each row
const STATUS_STRIPE = (g: FeedGroup) =>
  g.status === 'SNOOZED' ? 'border-l-amber-400'
  : g.status === 'COOLDOWN' ? 'border-l-sky-400'
  : g.status === 'NO_DATA' ? 'border-l-gray-300 dark:border-l-gray-600'
  : g.status === 'NO_CHANGE' ? 'border-l-gray-200 dark:border-l-gray-700'
  : (g.changePct ?? 0) > 0 ? 'border-l-green-500' : 'border-l-red-500'
const FILTERS: { key: 'SUGGESTION' | 'WAITING' | 'ALL'; label: string }[] = [
  { key: 'SUGGESTION', label: 'Needs decision' },
  { key: 'WAITING', label: 'Snoozed / cooling down' },
  { key: 'ALL', label: 'All groups' },
]

// Offer type pill: Prime (FBA / Seller-Fulfilled Prime) vs non-Prime; nothing when unknown.
function PrimeTag({ prime }: { prime: boolean | null }) {
  if (prime == null) return null
  return prime ? <Pill tone="prime">✓ Prime</Pill> : <Pill tone="gray">Non-Prime</Pill>
}

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

  // Refresh = pull fresh competitor offers (incl. Prime / non-Prime) from Amazon
  // for anything older than 1 h (up to ~4 min, rate-limited), then rebuild the feed.
  const [pulling, setPulling] = useState(false)
  async function refresh() {
    setPulling(true)
    try {
      const res = await fetch('/api/repricing/refresh-offers', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Competitor pull failed')
      if (j.remainingStale > 0) toast.success(`Pulled competitor offers for ${j.fetched} ASIN+condition pairs · ${j.remainingStale} still to go — click Refresh again`)
      else toast.success(j.fetched > 0 ? `Pulled competitor offers for ${j.fetched} ASIN+condition pairs — all up to date` : 'Competitor data already up to date (< 1 h old)')
      if (j.titlesFilled > 0) toast.success(`Pulled ${j.titlesFilled} missing Amazon product title${j.titlesFilled === 1 ? '' : 's'}`)
      if (j.errors > 0) toast.error(`${j.errors} offer request(s) failed — they'll retry on the next refresh`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Competitor pull failed')
    } finally { setPulling(false) }
    await load()
  }

  // Per-row ↻: live re-pull of this listing's offers (Prime, pricing, Buy Box),
  // our SKUs' prices and title — then swap in the recomputed row.
  const [rowRefreshing, setRowRefreshing] = useState<Set<string>>(new Set())
  async function refreshRow(g: FeedGroup) {
    setRowRefreshing(prev => new Set(prev).add(g.key))
    try {
      const res = await fetch('/api/repricing/refresh-group', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: g.accountId, asin: g.asin, itemCondition: g.itemCondition }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Refresh failed')
      if (j.group) {
        setGroups(prev => prev.map(x => (x.key === g.key ? j.group : x)))
        const ng: FeedGroup = j.group
        toast.success(`${g.asin} updated — ${j.offers ?? 0} offer${j.offers === 1 ? '' : 's'} · Buy Box ${money(ng.buyBoxPrice)}${ng.buyBoxPrime == null ? '' : ng.buyBoxPrime ? ' (Prime)' : ' (Non-Prime)'}`)
      } else {
        setGroups(prev => prev.filter(x => x.key !== g.key))
        toast.success(`${g.asin} no longer has active stock — removed from the feed`)
      }
      for (const n of j.notes ?? []) toast(n)
      for (const w of j.warnings ?? []) toast.error(w)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRowRefreshing(prev => { const n = new Set(prev); n.delete(g.key); return n })
    }
  }

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

  // Approve / Reject open a dialog with an optional "why" comment; Claude reads it
  // back (toast) and the comment feeds the AI Insights page.
  const [dialog, setDialog] = useState<{ g: FeedGroup; action: 'approve' | 'reject'; price: number | null } | null>(null)
  function decide(g: FeedGroup, action: 'approve' | 'reject') {
    let price: number | null = null
    if (action === 'approve') {
      const edited = editing[g.key]
      if (edited != null && edited.trim() !== '') {
        price = parseFloat(edited)
        if (!(price > 0)) { toast.error('Enter a valid price'); return }
      }
    }
    setDialog({ g, action, price })
  }

  async function submitDecision(note: string) {
    if (!dialog) return
    const { g, action, price } = dialog
    setDialog(null)
    setBusy(g.key)
    try {
      const res = await fetch('/api/repricing/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: g.accountId, asin: g.asin, itemCondition: g.itemCondition, action, price: price ?? undefined, note: note.trim() || undefined }),
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
      // Claude's read-back of the comment (non-blocking)
      if (j.hasNote && j.decisionId) {
        fetch('/api/repricing/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisionId: j.decisionId }) })
          .then(r => r.json())
          .then(a => { if (a.reply) toast(`🤖 ${a.reply}`, { duration: 15000 }); else if (a.error) toast.error(`AI reply: ${a.error}`) })
          .catch(() => {})
      }
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
        <div className="flex items-center gap-2">
        <a href="/repricing/insights"
          className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-violet-300 text-violet-700 dark:text-violet-300 dark:border-violet-700 text-sm font-medium hover:bg-violet-50 dark:hover:bg-violet-900/20">
          <Sparkles size={14} /> AI Insights
        </a>
        <button onClick={refresh} disabled={loading || pulling}
          title="Pull fresh competitor offers (price + Prime / non-Prime) from Amazon, then rebuild the feed. Can take up to ~4 minutes."
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {pulling ? <><Loader2 size={14} className="animate-spin" /> Pulling competitor offers… (up to ~4 min)</>
            : loading ? <><Loader2 size={14} className="animate-spin" /> Loading…</>
            : <><RefreshCw size={14} /> Refresh</>}
        </button>
        </div>
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
        <table className="w-full text-xs border-separate border-spacing-y-1.5">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-800 text-gray-100 text-[11px] uppercase tracking-wide">
              <th className="px-3 py-2.5 text-left font-semibold rounded-l-md">Listing</th>
              <th className="px-2 py-2.5 text-left font-semibold" title="Every marketplace SKU mapped to this ASIN + condition, with its OpenLine grade">SKUs &amp; Grades</th>
              <th className="px-2 py-2.5 text-left font-semibold">Strategy</th>
              <th className="px-2 py-2.5 text-left font-semibold" title="How fast it's selling · where we stand vs competitors">Signals</th>
              <th className="px-2 py-2.5 text-left font-semibold" title="Units sold across all SKUs in the group">Sales</th>
              <th className="px-2 py-2.5 text-left font-semibold">Stock</th>
              <th className="px-2 py-2.5 text-left font-semibold" title="Buy Box and the lowest competing offer in the same condition">Competition</th>
              <th className="px-2 py-2.5 text-left font-semibold">Price</th>
              <th className="px-2 py-2.5 text-left font-semibold" title="Net margin at the current → suggested price (range across the group's SKUs)">Margin</th>
              <th className="px-2 py-2.5 text-left font-semibold w-96">Why</th>
              <th className="px-3 py-2.5 text-right font-semibold rounded-r-md">Decision</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && !loading && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">Nothing here right now.</td></tr>
            )}
            {visible.map((g, i) => {
              const open = expanded.has(g.key)
              const up = (g.changePct ?? 0) > 0
              return (
                <FeedRows key={g.key} g={g} i={i} open={open} up={up} busy={busy === g.key}
                  refreshing={rowRefreshing.has(g.key)} onRefresh={() => refreshRow(g)}
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
      {dialog && <DecisionDialog {...dialog} onCancel={() => setDialog(null)} onConfirm={submitDecision} />}
    </div>
  )
}

// ── Uptime tiles ─────────────────────────────────────────────────────────────
// Each day is laid out in the viewer's local time; a tile is a vertical 24-hour
// timeline (top = midnight) coloured by live / down, measured vs estimated.
type UptimeData = FeedGroup['velocity']['uptime']
type SegKind = 'live' | 'down' | 'liveEst' | 'downEst' | 'future' | 'none'
const SEG_COLOR: Record<SegKind, string> = {
  live: '#86efac',     // soft green — live on Amazon (measured)
  down: '#fda4af',     // soft rose — down (measured)
  liveEst: '#d1fae5',  // pale green — live (estimated from stock history)
  downEst: '#ffe4e6',  // pale rose — down (estimated)
  future: '#f3f4f6',   // not happened yet
  none: '#f3f4f6',     // outside the 30-day window
}
const HOUR = 3_600_000
const inAny = (ivs: [number, number][], t: number) => ivs.some(([a, b]) => t >= a && t < b)

interface DayTile { start: number; end: number; segs: { kind: SegKind; frac: number }[]; liveH: number; knownH: number; measuredH: number }

function buildDays(u: UptimeData): DayTile[] {
  const days: DayTile[] = []
  const today = new Date(u.to); today.setHours(0, 0, 0, 0)
  for (let k = 29; k >= 0; k--) {
    const s = new Date(today); s.setDate(s.getDate() - k)
    const e = new Date(s); e.setDate(e.getDate() + 1)
    const start = s.getTime(), end = e.getTime()
    const cuts = new Set<number>([start, end])
    for (const t of [u.from, u.to, u.trackedSince ?? -1, ...u.measured.flat(), ...u.estimated.flat()]) if (t > start && t < end) cuts.add(t)
    const pts = Array.from(cuts).sort((a, b) => a - b)
    const segs: DayTile['segs'] = []
    let liveH = 0, knownH = 0, measuredH = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], mid = (a + b) / 2
      let kind: SegKind
      if (mid >= u.to) kind = 'future'
      else if (mid < u.from) kind = 'none'
      else {
        const measuredZone = u.trackedSince != null && mid >= u.trackedSince
        const live = inAny(measuredZone ? u.measured : u.estimated, mid)
        kind = measuredZone ? (live ? 'live' : 'down') : (live ? 'liveEst' : 'downEst')
        knownH += (b - a) / HOUR
        if (live) liveH += (b - a) / HOUR
        if (measuredZone) measuredH += (b - a) / HOUR
      }
      const frac = (b - a) / (end - start)
      const last = segs[segs.length - 1]
      if (last && last.kind === kind) last.frac += frac; else segs.push({ kind, frac })
    }
    days.push({ start, end, segs, liveH, knownH, measuredH })
  }
  return days
}

const tileBg = (d: DayTile) => {
  let acc = 0
  const stops = d.segs.map(s => { const a = acc * 100; acc += s.frac; return `${SEG_COLOR[s.kind]} ${a.toFixed(2)}% ${(acc * 100).toFixed(2)}%` })
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}
const dayLabel = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const shortDate = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function uptimeSummary(u: UptimeData) {
  const days = buildDays(u)
  const liveH = days.reduce((a, d) => a + d.liveH, 0)
  const knownH = days.reduce((a, d) => a + d.knownH, 0)
  const pct = knownH > 0 ? Math.round(liveH / knownH * 100) : null
  // Outages = runs of days with < 5% live; current live stretch from the end.
  const downRuns: [number, number][] = []
  let runStart: number | null = null
  days.forEach((d, i) => {
    const down = d.knownH > 0 && d.liveH / d.knownH < 0.05
    if (down && runStart == null) runStart = i
    if ((!down || i === days.length - 1) && runStart != null) { downRuns.push([runStart, down ? i : i - 1]); runStart = null }
  })
  const longest = downRuns.reduce((m, [a, b]) => Math.max(m, b - a + 1), 0)
  let liveStreak = 0
  for (let i = days.length - 1; i >= 0; i--) { if (days[i].knownH > 0 && days[i].liveH / days[i].knownH >= 0.95) liveStreak++; else if (i !== days.length - 1) break }
  const lead = pct == null ? 'No uptime data yet.'
    : pct >= 95 ? 'Live essentially the whole 30 days.'
    : pct >= 70 ? `Live most of the last 30 days (${pct}%).`
    : pct >= 30 ? `Live about ${pct}% of the last 30 days.`
    : `Mostly down — live only ${pct}% of the last 30 days.`
  const outages = downRuns.slice(-3).map(([a, b]) => (a === b ? shortDate(days[a].start) : `${shortDate(days[a].start)}–${shortDate(days[b].start)}`))
  const parts = [lead]
  if (outages.length) parts.push(`Down ${outages.join(', ')}${downRuns.length > 3 ? ' (and earlier)' : ''}.`)
  if (liveStreak >= 1 && liveStreak < 30 && pct != null && pct < 95) parts.push(`Live continuously for the last ${liveStreak} day${liveStreak === 1 ? '' : 's'}.`)
  if (u.trackedSince == null) parts.push('All of this is estimated from stock history — Amazon uptime tracking hasn\'t observed this listing yet.')
  else if (u.trackedSince > u.from) parts.push(`Before ${shortDate(u.trackedSince)} it's estimated from stock history; from then on it's measured by Amazon uptime checks.`)
  return { days, pct, liveDays: liveH / 24, longest, liveStreak, text: parts.join(' ') }
}

function UptimePill({ g }: { g: FeedGroup }) {
  const [open, setOpen] = useState(false)
  const s = uptimeSummary(g.velocity.uptime)
  const tone: Tone = s.pct == null ? 'gray' : s.pct >= 90 ? 'green' : s.pct >= 60 ? 'amber' : 'red'
  return (
    <>
      <button onClick={() => setOpen(true)} title={`${s.text}\n\nClick for the 30-day uptime view.`}
        className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4 hover:brightness-95', TONE[tone].pill)}>
        ⏱ Uptime {s.pct == null ? '—' : `${s.pct}%`}
      </button>
      {open && <UptimeModal g={g} s={s} onClose={() => setOpen(false)} />}
    </>
  )
}

function UptimeModal({ g, s, onClose }: { g: FeedGroup; s: ReturnType<typeof uptimeSummary>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">⏱ Amazon uptime — last 30 days</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-mono font-bold text-amazon-blue">{g.asin}</span>
              <Pill tone={g.itemCondition === 'New' ? 'violet' : 'amber'}>{g.itemCondition}</Pill>
              <span className="truncate text-gray-500 max-w-[420px]">{g.title}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Stat label="Uptime" value={s.pct == null ? '—' : `${s.pct}%`} tone={s.pct == null ? 'gray' : s.pct >= 90 ? 'green' : s.pct >= 60 ? 'amber' : 'red'} />
            <Stat label="Live days" value={`${s.liveDays.toFixed(1)} / 30`} />
            <Stat label="Longest outage" value={s.longest ? `${s.longest}d` : 'none'} tone={s.longest ? 'red' : 'green'} />
            <Stat label="Live streak" value={`${s.liveStreak}d`} tone="teal" />
            <Stat label="VelocityScore™" value={g.velocity.score == null ? '—' : g.velocity.score.toFixed(2)} tone="violet" />
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{s.text}</p>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {s.days.map(d => {
              const pctDay = d.knownH > 0 ? Math.round(d.liveH / d.knownH * 100) : null
              const src = d.measuredH > 0 && d.measuredH >= d.knownH - 0.01 ? 'measured by Amazon uptime' : d.measuredH > 0 ? 'partly measured, partly estimated' : 'estimated from stock history'
              const isToday = new Date(d.start).toDateString() === new Date().toDateString()
              return (
                <div key={d.start} className="flex flex-col items-center gap-0.5">
                  <div className={clsx('h-20 w-6 rounded border', isToday ? 'border-amazon-blue' : 'border-gray-200 dark:border-gray-700')}
                    style={{ background: tileBg(d) }}
                    title={`${dayLabel(d.start)} — ${pctDay == null ? 'no data' : `live ${d.liveH.toFixed(1)} h of ${d.knownH.toFixed(1)} h (${pctDay}%)`}${d.knownH > 0 ? ` · ${src}` : ''}${isToday ? ' · today so far' : ''}`} />
                  <span className="text-[9px] text-gray-500 tabular-nums">{new Date(d.start).getDate()}</span>
                  <span className="text-[8px] text-gray-400">{new Date(d.start).toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600 dark:text-gray-300">
            {([['live', 'Live (Amazon)'], ['down', 'Down (Amazon)'], ['liveEst', 'Live (estimated)'], ['downEst', 'Down (estimated)'], ['future', 'Not yet / no data']] as [SegKind, string][]).map(([k, label]) => (
              <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border border-gray-300" style={{ background: SEG_COLOR[k] }} />{label}</span>
            ))}
            <span className="text-gray-400">· Each tile runs midnight (top) to midnight (bottom), your local time. Hover a tile for its hours.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * VelocityScore™ — units sold per 24 h of Amazon uptime (30-day window), with
 * confidence, target, score at the current price, and Buy Box share.
 */
function VelocityPanel({ g }: { g: FeedGroup }) {
  const v = g.velocity
  const f2 = (n: number | null) => (n == null ? '—' : n.toFixed(2))
  const vsTone: Tone = v.score == null || v.target == null ? 'violet'
    : v.score >= v.target * 1.2 ? 'green' : v.score >= v.target * 0.8 ? 'teal' : 'amber'
  const confTone: Tone = v.confidence === 'high' ? 'green' : v.confidence === 'medium' ? 'amber' : 'gray'
  return (
    <div className={clsx('rounded-md border px-2 py-1 min-w-[150px]', TONE[vsTone].box)}
      title={`VelocityScore™ = units sold per 24 h live on Amazon (last 30 days)\n${v.units} units over ${v.liveDays} live days (raw ${f2(v.raw)}/day)${v.estimatedPct ? `\n${v.estimatedPct}% of live time estimated from stock history` : ''}${v.confidence === 'low' && v.baseline != null ? `\nLow data: blended with typical ${g.itemCondition} listing (${f2(v.baseline)}/day)` : ''}`}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 leading-3">VelocityScore™</div>
      <div className="flex items-baseline gap-1">
        <span className={clsx('font-mono text-[15px] font-bold leading-5 tabular-nums', TONE[vsTone].text)}>{f2(v.score)}</span>
        <span className="text-[10px] text-gray-500">/ day live</span>
      </div>
      <div className="text-[10px] text-gray-500 leading-4">{v.units} sold · {v.liveDays} live days</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        <Pill tone={confTone}>{v.confidence} confidence</Pill>
        {v.target != null && <Pill tone="gray" title="Target = units in stock ÷ the strategy's days-to-sell target">Target {f2(v.target)}</Pill>}
        {v.atPrice && <Pill tone="blue" title={`Since the last price change (${new Date(v.atPrice.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}): ${v.atPrice.units} sold over ${v.atPrice.liveDays} live days`}>@ price {f2(v.atPrice.score)} ({v.atPrice.liveDays}d)</Pill>}
        {v.buyBoxShare != null && <Pill tone={v.buyBoxShare >= 70 ? 'green' : v.buyBoxShare >= 30 ? 'amber' : 'red'} title={`Held the Buy Box in ${v.buyBoxShare}% of ${v.buyBoxChecks} live checks`}>Buy Box {v.buyBoxShare}%</Pill>}
        {v.estimatedPct > 0 && <Pill tone="gray" title="Share of live time estimated from stock history (Amazon uptime tracking started Oct 10, 2026)">est {v.estimatedPct}%</Pill>}
      </div>
    </div>
  )
}

/** Approve / Reject confirmation with an optional "why" — Claude reads it and learns from it. */
function DecisionDialog({ g, action, price, onCancel, onConfirm }: {
  g: FeedGroup; action: 'approve' | 'reject'; price: number | null
  onCancel: () => void; onConfirm: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const approve = action === 'approve'
  const pushPrice = price ?? g.suggestedPrice
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
        <div className={clsx('px-5 py-3 rounded-t-xl border-b', approve ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800')}>
          <h2 className={clsx('font-semibold', approve ? 'text-green-800 dark:text-green-300' : 'text-red-700 dark:text-red-300')}>
            {approve ? 'Approve & push price' : 'Reject suggestion'}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono font-bold text-amazon-blue">{g.asin}</span>
            <Pill tone={g.itemCondition === 'New' ? 'violet' : 'amber'}>{g.itemCondition}</Pill>
            <Pill tone="gray">{money(g.currentPrice)} → {money(approve ? pushPrice : g.suggestedPrice)}</Pill>
            <Pill tone="gray">{g.skus.length} SKU{g.skus.length === 1 ? '' : 's'}</Pill>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          <p className="text-gray-600 dark:text-gray-300">
            {approve
              ? <>This pushes <b>{money(pushPrice)}</b> to every SKU in this group on Amazon{price != null ? ' (your edited price)' : ''}.</>
              : <>Nothing is pushed. This rule ({g.rule}) is snoozed for this listing for 24 hours.</>}
          </p>
          <label className="block">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
              <Sparkles size={12} className="text-violet-500" /> Why? <span className="font-normal text-gray-400">(optional — the AI learns from this)</span>
            </span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus
              placeholder={approve ? 'e.g. Good call — this model sells fast at this price' : "e.g. Don't undercut below 10% margin on Used MacBooks"}
              className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onCancel} className="h-8 px-3 rounded-full border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={() => onConfirm(note)}
            className={clsx('h-8 px-4 rounded-full text-sm font-semibold text-white', approve ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700')}>
            {approve ? `Approve & push ${money(pushPrice)}` : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FeedRows({ g, open, up, busy, refreshing, onRefresh, editValue, onToggle, onEdit, onStrategy, onApprove, onReject }: {
  g: FeedGroup; i: number; open: boolean; up: boolean; busy: boolean; editValue: string | undefined
  refreshing: boolean; onRefresh: () => void
  onToggle: () => void; onEdit: (v: string) => void; onStrategy: (s: Strategy) => void
  onApprove: () => void; onReject: () => void
}) {
  const decidable = g.status === 'SUGGESTION' || g.status === 'SNOOZED' || g.status === 'COOLDOWN'
  const hasSuggestion = g.suggestedPrice != null
  const moveTone: Tone = up ? 'green' : 'red'
  // Shared cell chrome: white card band per row; first cell carries the status stripe.
  const cell = 'bg-white dark:bg-gray-900 border-y border-gray-200 dark:border-gray-700 px-2 py-2.5 align-top'
  return (
    <>
      <tr className="group">
        {/* ── Listing ─────────────────────────────────────────────── */}
        <td className={clsx(cell, 'pl-3 rounded-l-lg border-l-4', STATUS_STRIPE(g))}>
          <div className="flex items-start gap-1.5">
            <button onClick={onToggle} title={open ? 'Hide SKU detail' : 'Show SKU detail'} className="mt-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <a href={`https://www.amazon.com/dp/${g.asin}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center rounded-md border border-amazon-blue/40 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amazon-blue hover:underline">
                  {g.asin}
                </a>
                <Pill tone={g.itemCondition === 'New' ? 'violet' : 'amber'} title="Amazon condition">{g.itemCondition}</Pill>
                <button onClick={() => { if (!refreshing) onRefresh() }} disabled={refreshing}
                  title={`Refresh this listing now — all competitor offers (price, Prime / non-Prime, Buy Box) and our prices${g.offersFetchedAt ? ` · offers last pulled ${when(g.offersFetchedAt)}` : ' · offers never pulled'}`}
                  className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-amazon-blue hover:border-amazon-blue">
                  <RefreshCw size={11} className={clsx(refreshing && 'animate-spin text-amazon-blue')} />
                </button>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-gray-700 dark:text-gray-300 max-w-[250px] line-clamp-3" title={g.title ?? ''}>
                {g.title ?? <span className="italic text-gray-400">Title not pulled yet</span>}
              </div>
            </div>
          </div>
        </td>

        {/* ── SKUs & grades ───────────────────────────────────────── */}
        <td className={cell}>
          <div className="flex flex-col gap-1.5">
            {g.skus.map(s => (
              <div key={s.sku} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-800 dark:text-gray-200 whitespace-nowrap" title="Marketplace (Amazon seller) SKU">{s.sku}</span>
                  {s.grade
                    ? <Pill tone="blue" title="OpenLine grade">Grade {s.grade}</Pill>
                    : <Pill tone="amber" title={s.mapped ? 'Mapped with no grade' : 'Not mapped to a product'}>{s.mapped ? 'No grade' : 'Unmapped'}</Pill>}
                </div>
                {s.internalSku && (
                  <span className="flex items-center gap-1 pl-1 text-[10px] text-gray-500 whitespace-nowrap" title={`Internal OpenLine SKU${s.internalDescription ? ` — ${s.internalDescription}` : ''}`}>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Internal</span>
                    <span className="font-mono font-semibold text-violet-700 dark:text-violet-300">{s.internalSku}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </td>

        {/* ── Strategy ────────────────────────────────────────────── */}
        <td className={cell}>
          <select value={g.strategy} disabled={busy} onChange={e => onStrategy(e.target.value as Strategy)}
            className="h-7 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[11px] font-semibold px-2">
            <option value="CONSERVATIVE">Conservative</option>
            <option value="STANDARD">Standard</option>
            <option value="AGGRESSIVE">Aggressive</option>
          </select>
        </td>

        {/* ── Signals ─────────────────────────────────────────────── */}
        <td className={cell}>
          {g.status === 'NO_DATA' ? <Pill tone="gray">⏳ Waiting for data</Pill> : (
            <div className="flex flex-col gap-1">
              <Pill tone={SPEED_TONE[g.speed]} title="How fast it's selling">{SPEED_LABEL[g.speed] ?? g.speed}</Pill>
              <Pill tone={COMP_TONE[g.competition]} title="Where we stand vs competitors">{COMP_LABEL[g.competition] ?? g.competition}</Pill>
            </div>
          )}
        </td>

        {/* ── Sales ───────────────────────────────────────────────── */}
        <td className={cell}>
          <VelocityPanel g={g} />
          <div className="mt-1"><UptimePill g={g} /></div>
          <div className="mt-1 flex gap-1">
            <Stat label="7d sold" value={g.units7d} tone={g.units7d > 0 ? 'green' : 'gray'} title="Units sold in the last 7 days (all SKUs in the group)" />
            <Stat label="30d sold" value={g.units30d} tone={g.units30d > 0 ? 'green' : 'gray'} title="Units sold in the last 30 days (all SKUs in the group)" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {g.daysLive != null && g.daysLive < 30 && (
              <Pill tone="teal" title={`${g.liveReason === 'amazon' ? 'Live on Amazon (buyable with stock) since' : g.liveReason === 'listed' ? 'Listed' : 'In stock continuously since'} ${when(g.liveSince)} — sales pace is measured over the live period only (${g.unitsSinceLive} sold since)${g.liveReason === 'amazon' ? ' · from Amazon uptime tracking' : ' · estimated from stock history'}`}>
                🌱 {g.liveReason === 'amazon' ? 'Live' : g.liveReason === 'listed' ? 'Listed' : 'Restocked'} {g.daysLive === 0 ? 'today' : `${g.daysLive}d ago`}
              </Pill>
            )}
            {g.daysSinceLastSale != null
              ? <Pill tone={g.daysSinceLastSale <= 3 ? 'green' : g.daysSinceLastSale <= 14 ? 'amber' : 'red'}>Last sale {g.daysSinceLastSale === 0 ? 'today' : `${g.daysSinceLastSale}d ago`}</Pill>
              : <Pill tone="red">No sales yet</Pill>}
          </div>
        </td>

        {/* ── Stock ───────────────────────────────────────────────── */}
        <td className={cell}>
          <div className="flex gap-1">
            <Stat label="In stock" value={g.stock} title="Units in stock across the group's SKUs" />
            <Stat label="Cover" value={g.daysOfCover != null ? `${g.daysOfCover}d` : '—'}
              tone={g.daysOfCover == null ? 'gray' : g.daysOfCover < 15 ? 'red' : g.daysOfCover > 45 ? 'amber' : 'green'}
              title="How many days the stock lasts at the current sales pace" />
          </div>
        </td>

        {/* ── Competition ─────────────────────────────────────────── */}
        <td className={cell}>
          <div className="flex flex-col gap-1">
            <Stat label="Buy Box" title="Current Buy Box price and holder"
              tone={g.weHoldBuyBox ? 'green' : 'gray'}
              value={money(g.buyBoxPrice)}
              sub={<>
                {g.buyBoxPrice != null && <Pill tone={g.weHoldBuyBox ? 'green' : 'gray'}>{g.weHoldBuyBox ? '★ You' : (g.buyBoxHolder ?? 'Competitor')}</Pill>}
                {g.buyBoxPrice != null && <PrimeTag prime={g.buyBoxPrime} />}
                {g.primeEdgePct != null && <Pill tone="prime" title={`Their offer isn't Prime and ours is — we're allowed up to ${g.primeEdgePct}% above it`}>Prime +{g.primeEdgePct}%</Pill>}
              </>} />
            <Stat label="Lowest competitor" title="Cheapest competing offer in the same condition"
              value={money(g.lowestCompetitor)}
              sub={<>
                <Pill tone="gray">{g.competitorCount} offer{g.competitorCount === 1 ? '' : 's'}</Pill>
                {g.lowestCompetitor != null && <PrimeTag prime={g.lowestCompPrime} />}
              </>} />
          </div>
        </td>

        {/* ── Price ───────────────────────────────────────────────── */}
        <td className={cell}>
          <div className="flex flex-col gap-1">
            <Stat label="Our price now" value={money(g.currentPrice)}
              title={g.weArePrime == null ? 'Our offer type unknown until competitor data is pulled' : g.weArePrime ? 'Our offer is Prime' : 'Our offer is not Prime'}
              sub={g.weArePrime != null ? <PrimeTag prime={g.weArePrime} /> : undefined} />
            {hasSuggestion && (
              <Stat label="Suggested" tone={moveTone} value={money(g.suggestedPrice)}
                sub={<Pill tone={moveTone}>{up ? '▲' : '▼'} {up ? '+' : ''}{g.changePct?.toFixed(1)}% ({up ? '+' : '−'}{money(Math.abs((g.suggestedPrice ?? 0) - (g.currentPrice ?? 0)))})</Pill>} />
            )}
          </div>
        </td>

        {/* ── Margin ──────────────────────────────────────────────── */}
        <td className={cell}>
          <div className="flex flex-col gap-1">
            <Stat label="Margin now" value={marginSpan(g.marginCurrent)} tone={marginTone(g.marginCurrent.min)}
              title="Net margin at our current price (range across SKUs)" />
            {hasSuggestion && (
              <Stat label="Margin after" value={marginSpan(g.marginSuggested)} tone={marginTone(g.marginSuggested.min)}
                title="Net margin at the suggested price (range across SKUs)" />
            )}
          </div>
        </td>

        {/* ── Why ─────────────────────────────────────────────────── */}
        <td className={clsx(cell, 'w-96')}>
          <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 px-2 py-1.5">
            <ol className="space-y-1">
              {g.explanation.map((line, idx) => {
                const isResult = line.startsWith('Suggested:')
                return (
                  <li key={idx} className="flex gap-1.5 leading-snug text-gray-700 dark:text-gray-300">
                    <span className={clsx('mt-[1px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                      isResult ? 'bg-amazon-blue text-white' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300')}>{idx + 1}</span>
                    <span className={clsx(isResult && 'font-semibold text-gray-900 dark:text-gray-100')}>{line}</span>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {g.status === 'SNOOZED' && <Pill tone="amber">Snoozed until {when(g.snoozedUntil)}</Pill>}
            {g.status === 'COOLDOWN' && <Pill tone="sky">Cooling down until {when(g.cooldownUntil)}</Pill>}
            {g.status === 'SUGGESTION' && g.lastRejectedAt && <Pill tone="gray">Previously rejected {when(g.lastRejectedAt)}{g.lastRejectedBy ? ` · ${g.lastRejectedBy}` : ''}</Pill>}
          </div>
        </td>

        {/* ── Decision ────────────────────────────────────────────── */}
        <td className={clsx(cell, 'pr-3 rounded-r-lg border-r text-right')}>
          {decidable && hasSuggestion ? (
            <div className="flex flex-col items-end gap-1.5">
              {editValue != null && (
                <label className="flex items-center gap-1 text-[10px] font-semibold uppercase text-gray-500">
                  Your price
                  <input type="number" step="0.01" autoFocus value={editValue} onChange={e => onEdit(e.target.value)}
                    className="w-24 h-7 rounded-md border border-amazon-blue bg-white dark:bg-gray-800 text-right font-mono text-xs px-1" />
                </label>
              )}
              <button onClick={onApprove} disabled={busy} title={editValue ? 'Approve & push your price' : 'Approve & push the suggested price'}
                className="inline-flex w-28 items-center justify-center gap-1 h-7 rounded-full bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
              </button>
              <div className="flex gap-1">
                <button onClick={() => onEdit(editValue ?? (g.suggestedPrice ?? 0).toFixed(2))} disabled={busy} title="Edit the price before approving"
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                  <Pencil size={11} /> Edit
                </button>
                <button onClick={onReject} disabled={busy} title="Reject — snoozes this rule for 24 hours"
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                  <X size={11} /> Reject
                </button>
              </div>
            </div>
          ) : <Pill tone="gray">{g.status === 'NO_DATA' ? 'Waiting' : 'Hold'}</Pill>}
        </td>
      </tr>

      {/* ── Per-SKU detail ─────────────────────────────────────────── */}
      {open && (
        <tr>
          <td colSpan={11} className="px-6 pb-2">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-2">
              <table className="w-full text-[11px]">
                <thead><tr className="text-[9px] uppercase tracking-wider text-gray-500">
                  <th className="px-2 py-1 text-left font-bold">SKU</th><th className="px-2 py-1 text-left font-bold">Internal SKU</th><th className="px-2 py-1 text-left font-bold">Grade</th><th className="px-2 py-1 text-left font-bold">Channel</th>
                  <th className="px-2 py-1 text-right font-bold">Price</th><th className="px-2 py-1 text-right font-bold">In stock</th>
                  <th className="px-2 py-1 text-right font-bold">7d sold</th><th className="px-2 py-1 text-right font-bold">30d sold</th>
                  <th className="px-2 py-1 text-right font-bold">Margin now</th><th className="px-2 py-1 text-right font-bold">Margin after</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {g.skus.map(s => (
                    <tr key={s.sku}>
                      <td className="px-2 py-1 font-mono">{s.sku}</td>
                      <td className="px-2 py-1 font-mono text-violet-700 dark:text-violet-300" title={s.internalDescription ?? ''}>{s.internalSku ?? '—'}</td>
                      <td className="px-2 py-1">{s.grade ? <Pill tone="blue">Grade {s.grade}</Pill> : <Pill tone="amber">{s.mapped ? 'No grade' : 'Unmapped'}</Pill>}</td>
                      <td className="px-2 py-1"><Pill tone={s.channel === 'FBA' ? 'violet' : 'gray'}>{s.channel}</Pill></td>
                      <td className="px-2 py-1 text-right font-mono font-semibold">{money(s.price)}</td>
                      <td className="px-2 py-1 text-right font-mono">{s.qty}</td>
                      <td className="px-2 py-1 text-right font-mono">{s.units7d}</td>
                      <td className="px-2 py-1 text-right font-mono">{s.units30d}</td>
                      <td className="px-2 py-1 text-right"><Pill tone={marginTone(s.marginCurrent)} mono>{pct(s.marginCurrent)}</Pill></td>
                      <td className="px-2 py-1 text-right">{hasSuggestion ? <Pill tone={marginTone(s.marginSuggested)} mono>{pct(s.marginSuggested)}</Pill> : <span className="text-gray-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

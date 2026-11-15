'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Loader2, ExternalLink, Check, X, RefreshCcw, Crown, Zap, Tag, ArrowDown, ArrowUp } from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

interface Member {
  id: string
  sku: string
  internalSku: string
  grade: string | null
  fulfillmentChannel: string
  ourPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  avgCost: number | null
  marginPct: number | null
  fgQty: number
  pushQty: number
  syncQty: boolean
}
interface GridGroup {
  key: string
  asin: string
  title: string | null
  condition: string | null
  buyBoxPrice: number | null
  buyBoxSeller: string | null
  buyBoxIsPrime: boolean | null
  s1: number
  s3: number
  s7: number
  s30: number
  members: Member[]
}

type SortKey = 'asin' | 'internalSku' | 'ourPrice' | 'buyBoxPrice' | 'fulfillmentChannel'
  | 'buyBoxSeller' | 'fgQty' | 'pushQty' | 'avgCost' | 'marginPct' | 's1' | 's3' | 's7' | 's30'

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Group-level value used for sorting (members: use the first/primary member). */
function sortValue(g: GridGroup, key: SortKey): string | number | null {
  switch (key) {
    case 'asin': return g.asin
    case 'buyBoxPrice': return g.buyBoxPrice
    case 'buyBoxSeller': return g.buyBoxSeller
    case 's1': return g.s1
    case 's3': return g.s3
    case 's7': return g.s7
    case 's30': return g.s30
    case 'fgQty': return g.members.reduce((s, m) => s + m.fgQty, 0)
    case 'pushQty': return g.members.reduce((s, m) => s + m.pushQty, 0)
    case 'ourPrice': return g.members[0]?.ourPrice ?? null
    case 'avgCost': return g.members[0]?.avgCost ?? null
    case 'marginPct': return g.members[0]?.marginPct ?? null
    case 'internalSku': return g.members[0]?.internalSku ?? null
    case 'fulfillmentChannel': return g.members[0]?.fulfillmentChannel ?? null
    default: return null
  }
}

export default function ActiveListingPricingGrid() {
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [accountId, setAccountId] = useState('')
  const [groups, setGroups] = useState<GridGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 's30', dir: 'desc' })

  const [editing, setEditing] = useState<string | null>(null) // member id
  const [draftPrice, setDraftPrice] = useState('')
  const [pushing, setPushing] = useState<string | null>(null)
  const [refreshingBB, setRefreshingBB] = useState<string | null>(null)
  const [bulkBB, setBulkBB] = useState({ running: false, done: 0, total: 0 })
  const cancelBulkBB = useRef(false)
  // Prices pushed from THIS grid recently (per browser) → "just updated" indicator
  // while Amazon's displayed price still catches up (propagation lag).
  const [recentPushes, setRecentPushes] = useState<Record<string, { price: number; at: number }>>({})
  const RECENT_MS = 30 * 60 * 1000

  useEffect(() => {
    try {
      const raw = localStorage.getItem('alp_recent_pushes')
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, { price: number; at: number }>
      const now = Date.now()
      const pruned = Object.fromEntries(Object.entries(parsed).filter(([, v]) => now - v.at < RECENT_MS))
      setRecentPushes(pruned)
      localStorage.setItem('alp_recent_pushes', JSON.stringify(pruned))
    } catch { /* ignore */ }
  }, [RECENT_MS])

  function recordPush(sku: string, price: number) {
    setRecentPushes(prev => {
      const next = { ...prev, [sku]: { price, at: Date.now() } }
      try { localStorage.setItem('alp_recent_pushes', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((data: AmazonAccountDTO[]) => {
        setAccounts(data)
        if (data.length > 0) setAccountId(data.find(a => a.isActive)?.id ?? data[0].id)
      })
      .catch(() => setError('Failed to load Amazon accounts'))
  }, [])

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pricing/active-grid?accountId=${accountId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setGroups(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grid')
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { load() }, [load])

  function updateMember(id: string, patch: Partial<Member>) {
    setGroups(prev => prev.map(g => g.members.some(m => m.id === id)
      ? { ...g, members: g.members.map(m => m.id === id ? { ...m, ...patch } : m) }
      : g))
  }

  // A refresh pulls this member's live price AND the shared Buy Box for the group.
  function applyRefresh(id: string, json: { price?: number | null; buyBoxPrice?: number | null; buyBoxSeller?: string | null; buyBoxIsPrime?: boolean | null }) {
    setGroups(prev => prev.map(g => g.members.some(m => m.id === id)
      ? {
          ...g,
          buyBoxPrice: json.buyBoxPrice ?? null,
          buyBoxSeller: json.buyBoxSeller ?? null,
          buyBoxIsPrime: json.buyBoxIsPrime ?? null,
          members: g.members.map(m => m.id === id ? { ...m, ourPrice: json.price ?? m.ourPrice } : m),
        }
      : g))
  }

  function startEdit(m: Member) {
    setEditing(m.id)
    setDraftPrice(m.ourPrice != null ? String(m.ourPrice) : '')
  }

  async function pushPrice(m: Member) {
    const price = Number(draftPrice)
    if (!Number.isFinite(price) || price <= 0) { alert('Enter a valid price'); return }
    if (m.minPrice != null && price < m.minPrice) { alert(`Below min price ${money(m.minPrice)}`); return }
    if (m.maxPrice != null && price > m.maxPrice) { alert(`Above max price ${money(m.maxPrice)}`); return }
    setPushing(m.id)
    try {
      const res = await fetch('/api/listings/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, sku: m.sku, price }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Price push failed'); return }
      updateMember(m.id, { ourPrice: price })
      recordPush(m.sku, price)
      setEditing(null)
    } catch {
      alert('Price push failed')
    } finally {
      setPushing(null)
    }
  }

  async function refreshListing(m: Member) {
    setRefreshingBB(m.id)
    try {
      const res = await fetch('/api/listings/refresh-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, sku: m.sku, buyBox: true }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Refresh failed'); return }
      applyRefresh(m.id, json)
    } catch {
      alert('Refresh failed')
    } finally {
      setRefreshingBB(null)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = q
    ? groups.filter(g =>
        g.asin.toLowerCase().includes(q) ||
        (g.title ?? '').toLowerCase().includes(q) ||
        g.members.some(m => m.internalSku.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q)))
    : groups

  async function refreshAllVisible() {
    const targets = visible.flatMap(g => g.members)
    if (targets.length === 0 || bulkBB.running) return
    cancelBulkBB.current = false
    setBulkBB({ running: true, done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i++) {
      if (cancelBulkBB.current) break
      const m = targets[i]
      try {
        const res = await fetch('/api/listings/refresh-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, sku: m.sku, buyBox: true }),
        })
        const json = await res.json()
        if (res.ok) applyRefresh(m.id, json)
      } catch { /* skip failures, keep going */ }
      setBulkBB({ running: true, done: i + 1, total: targets.length })
    }
    setBulkBB(b => ({ ...b, running: false }))
  }

  const sorted = [...visible].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return sort.dir === 'asc' ? cmp : -cmp
  })
  const totalListings = visible.reduce((s, g) => s + g.members.length, 0)

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })
  }

  const Th = ({ col, label, align = 'left' }: { col: SortKey; label: string; align?: 'left' | 'right' | 'center' }) => (
    <th
      onClick={() => toggleSort(col)}
      className={clsx('px-3 py-3 cursor-pointer select-none text-slate-300 hover:text-white transition-colors',
        sort.key === col && 'text-white',
        align === 'right' && 'text-right', align === 'center' && 'text-center')}
    >
      <span className={clsx('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}{sort.key === col && <span className="text-indigo-300">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  )

  const SoldCell = ({ n, strong }: { n: number; strong?: boolean }) => (
    <td className="px-2 py-3 text-right tabular-nums align-top">
      {n > 0
        ? <span className={clsx('inline-block rounded-md px-1.5 py-0.5', strong ? 'bg-indigo-50 font-semibold text-indigo-700' : 'font-medium text-slate-700')}>{n}</span>
        : <span className="text-slate-300">0</span>}
    </td>
  )

  // Per-member stacked cell wrapper — members share the row; each gets a divider.
  const stackCls = 'divide-y divide-gray-100'
  const memberCls = 'py-1.5 first:pt-0 last:pb-0'

  return (
    <div className="h-full flex flex-col p-5 gap-5 overflow-auto bg-slate-50/50">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shadow-indigo-500/30">
          <Tag className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Active Listing Pricing</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Live Amazon listings grouped by ASIN + condition — price, Buy Box &amp; velocity at a glance. Click a price to push it live.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        >
          {accounts.map(a => <option key={a.id} value={a.id}>{a.marketplaceName} — {a.sellerId}</option>)}
        </select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ASIN, title, or SKU…"
            className="pl-9 pr-3 h-9 w-72 rounded-lg border border-slate-200 bg-white text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCcw className={clsx('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </button>
        {bulkBB.running ? (
          <div className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-indigo-50 text-xs font-medium text-indigo-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Buy Box {bulkBB.done}/{bulkBB.total}</span>
            <button onClick={() => { cancelBulkBB.current = true }}
              className="px-2 py-1 rounded-md font-semibold text-rose-600 hover:bg-rose-50">Cancel</button>
          </div>
        ) : (
          <button
            onClick={refreshAllVisible}
            disabled={loading || totalListings === 0}
            title="Pull live Buy Box from Amazon for every listing shown"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 text-sm font-semibold text-white shadow-sm shadow-indigo-500/25 hover:from-indigo-500 hover:to-indigo-700 disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" /> Refresh all Buy Box
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-sm text-slate-500">
          <span className="font-semibold text-slate-700">{sorted.length}</span> ASINs
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-slate-700">{totalListings}</span> listings
        </span>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-700">{error}</div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-[300px] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gradient-to-b from-slate-800 to-slate-700 shadow-sm">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider">
              <Th col="asin" label="ASIN & Title" />
              <Th col="internalSku" label="Internal SKU + Grade" />
              <Th col="fgQty" label="FG · Push Qty" align="right" />
              <Th col="avgCost" label="Avg Cost" align="right" />
              <Th col="ourPrice" label="Our Price · Margin" align="right" />
              <Th col="buyBoxPrice" label="Buy Box" align="right" />
              <Th col="fulfillmentChannel" label="Is Prime" align="center" />
              <Th col="buyBoxSeller" label="Buy Box Winner" />
              <Th col="s1" label="1d" align="right" />
              <Th col="s3" label="3d" align="right" />
              <Th col="s7" label="7d" align="right" />
              <Th col="s30" label="30d" align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={12} className="px-3 py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={12} className="px-3 py-12 text-center text-gray-400">No active mapped listings.</td></tr>
            ) : sorted.map(g => {
              const weWin = (g.buyBoxSeller ?? '').toLowerCase() === 'you'
              return (
                <tr key={g.key} className="even:bg-slate-50/40 hover:bg-indigo-50/40 transition-colors align-top">
                  {/* ASIN & Title (shared) */}
                  <td className="px-3 py-3 max-w-[340px] align-top">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <a href={`https://www.amazon.com/dp/${g.asin}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors">
                        {g.asin}<ExternalLink className="h-3 w-3" />
                      </a>
                      {g.condition && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold uppercase tracking-wide">{g.condition}</span>}
                      {g.members.length > 1 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">{g.members.length} SKUs</span>}
                    </div>
                    {g.title && (
                      <p className="mt-1.5 text-[12px] leading-snug text-slate-600 line-clamp-2">{g.title}</p>
                    )}
                  </td>
                  {/* Internal SKU + Grade (per member) */}
                  <td className="px-3 py-3 align-top">
                    <div className={stackCls}>
                      {g.members.map(m => (
                        <div key={m.id} className={clsx(memberCls, 'flex items-center gap-1.5 whitespace-nowrap')}>
                          <span className="font-mono text-xs text-gray-800">{m.internalSku}</span>
                          {m.grade && <span className="inline-block px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium">{m.grade}</span>}
                          <span className={clsx('text-[9px] px-1 py-0.5 rounded font-medium', m.fulfillmentChannel === 'FBA' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600')}>{m.fulfillmentChannel}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  {/* FG · Push qty (per member) */}
                  <td className="px-3 py-3 text-right align-top">
                    <div className={stackCls}>
                      {g.members.map(m => (
                        <div key={m.id} className={clsx(memberCls, 'whitespace-nowrap')}>
                          {m.fulfillmentChannel === 'FBA' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2 py-0.5 text-xs tabular-nums" title="Available qty at FBA (Amazon-managed)">
                              FBA <span className="font-semibold">{m.pushQty}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums"
                              title={m.syncQty
                                ? 'Finished-goods on-hand qty · qty pushed to Amazon'
                                : `Sync off — qty managed manually on Amazon (currently ${m.pushQty}). We do not push a qty.`}>
                              <span className="font-semibold text-slate-700">{m.fgQty}</span>
                              <span className="text-slate-300">·</span>
                              {m.syncQty
                                ? <span className="text-slate-500">{m.pushQty}</span>
                                : <span className="font-medium text-amber-600">N/A</span>}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  {/* Avg Cost (per member) */}
                  <td className="px-3 py-3 text-right tabular-nums align-top">
                    <div className={stackCls}>
                      {g.members.map(m => (
                        <div key={m.id} className={clsx(memberCls, 'whitespace-nowrap')}>
                          {m.avgCost != null ? <span className="text-gray-700">{money(m.avgCost)}</span> : <span className="text-gray-300">—</span>}
                        </div>
                      ))}
                    </div>
                  </td>
                  {/* Our Price · Margin (per member, editable) */}
                  <td className="px-3 py-3 text-right align-top">
                    <div className={stackCls}>
                      {g.members.map(m => {
                        const isEditing = editing === m.id
                        const rp = recentPushes[m.sku]
                        const justUpdated = rp && Date.now() - rp.at < RECENT_MS
                        return (
                          <div key={m.id} className={clsx(memberCls, 'whitespace-nowrap')}>
                            {isEditing ? (
                              <div className="inline-flex items-center gap-1">
                                <span className="text-gray-400 text-xs">$</span>
                                <input
                                  autoFocus
                                  type="number"
                                  value={draftPrice}
                                  onChange={(e) => setDraftPrice(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') pushPrice(m); if (e.key === 'Escape') setEditing(null) }}
                                  step="0.01"
                                  min="0.01"
                                  className="w-20 h-7 rounded border border-gray-300 px-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                                />
                                <button onClick={() => pushPrice(m)} disabled={pushing === m.id} title="Push to Amazon" className="text-green-600 hover:text-green-700 disabled:opacity-50">
                                  {pushing === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                </button>
                                <button onClick={() => setEditing(null)} title="Cancel" className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                <button onClick={() => startEdit(m)} title="Click to edit & push price" className="text-[15px] font-bold text-slate-900 hover:text-indigo-600 tabular-nums transition-colors">
                                  {money(m.ourPrice)}
                                </button>
                                <button onClick={() => refreshListing(m)} disabled={refreshingBB === m.id} title="Refresh our price & Buy Box live from Amazon" className="text-slate-300 hover:text-indigo-600 disabled:opacity-50">
                                  <RefreshCcw className={clsx('h-3 w-3', refreshingBB === m.id && 'animate-spin')} />
                                </button>
                              </div>
                            )}
                            {m.marginPct != null && (
                              <div className="flex justify-end mt-0.5">
                                <span className={clsx('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                  m.marginPct < 0 ? 'bg-rose-50 text-rose-700' : m.marginPct < 10 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}
                                  title="Net margin at our current price (base + cost code + repair + commission + shipping)">
                                  {m.marginPct.toFixed(1)}% margin
                                </span>
                              </div>
                            )}
                            {justUpdated && (
                              <div className="flex items-center gap-1 justify-end text-[10px] text-emerald-600 font-medium mt-0.5"
                                title="Pushed from this grid in the last 30 min — Amazon may still be propagating the new price">
                                <Zap className="h-2.5 w-2.5" /> Just updated to {money(rp!.price)}
                              </div>
                            )}
                            {(m.minPrice != null || m.maxPrice != null) && (
                              <div className="text-[10px] text-gray-400">{money(m.minPrice)}–{money(m.maxPrice)}</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </td>
                  {/* Buy Box price (shared) */}
                  <td className="px-3 py-3 text-right tabular-nums align-top whitespace-nowrap">
                    {(() => {
                      const minOur = Math.min(...g.members.map(m => m.ourPrice ?? Infinity))
                      const below = g.buyBoxPrice != null && Number.isFinite(minOur) && g.buyBoxPrice < minOur - 0.005
                      return (
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {g.buyBoxPrice != null ? (
                            <span className={clsx('inline-flex items-center gap-0.5 font-semibold',
                              weWin ? 'text-emerald-600' : below ? 'text-rose-600' : 'text-slate-700')}>
                              {!weWin && below && <ArrowDown className="h-3 w-3" />}
                              {weWin && <ArrowUp className="h-3 w-3" />}
                              {money(g.buyBoxPrice)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                          {g.members[0] && (
                            <button onClick={() => refreshListing(g.members[0])} disabled={refreshingBB === g.members[0].id}
                              title="Refresh Buy Box live from Amazon" className="text-slate-300 hover:text-indigo-600 disabled:opacity-50">
                              <RefreshCcw className={clsx('h-3 w-3', refreshingBB === g.members[0].id && 'animate-spin')} />
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  {/* Is Prime (per member) */}
                  <td className="px-3 py-3 text-center align-top">
                    <div className={stackCls}>
                      {g.members.map(m => (
                        <div key={m.id} className={memberCls}>
                          {m.fulfillmentChannel === 'FBA'
                            ? <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-semibold">Prime</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </div>
                      ))}
                    </div>
                  </td>
                  {/* Buy Box winner (shared) */}
                  <td className="px-3 py-3 whitespace-nowrap align-top">
                    {g.buyBoxSeller ? (
                      weWin ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          <Crown className="h-3 w-3" /> You win
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">{g.buyBoxSeller}</span>
                      )
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <SoldCell n={g.s1} />
                  <SoldCell n={g.s3} />
                  <SoldCell n={g.s7} />
                  <SoldCell n={g.s30} strong />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Loader2, ExternalLink, Check, X, RefreshCcw, Crown, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { AmazonAccountDTO } from '@/types'

interface GridRow {
  id: string
  sku: string
  asin: string
  title: string | null
  condition: string | null
  fulfillmentChannel: string
  internalSku: string
  grade: string | null
  ourPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  buyBoxPrice: number | null
  buyBoxSeller: string | null
  buyBoxIsPrime: boolean | null
  fgQty: number
  pushQty: number
  avgCost: number | null
  marginPct: number | null
  s1: number
  s3: number
  s7: number
  s30: number
}

type SortKey = 'asin' | 'internalSku' | 'ourPrice' | 'buyBoxPrice' | 'fulfillmentChannel'
  | 'buyBoxSeller' | 'fgQty' | 'pushQty' | 'avgCost' | 'marginPct' | 's1' | 's3' | 's7' | 's30'

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ActiveListingPricingGrid() {
  const [accounts, setAccounts] = useState<AmazonAccountDTO[]>([])
  const [accountId, setAccountId] = useState('')
  const [rows, setRows] = useState<GridRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 's30', dir: 'desc' })

  // Inline price edit state
  const [editing, setEditing] = useState<string | null>(null) // row id
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
      setRows(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grid')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { load() }, [load])

  function startEdit(r: GridRow) {
    setEditing(r.id)
    setDraftPrice(r.ourPrice != null ? String(r.ourPrice) : '')
  }

  async function pushPrice(r: GridRow) {
    const price = Number(draftPrice)
    if (!Number.isFinite(price) || price <= 0) { alert('Enter a valid price'); return }
    if (r.minPrice != null && price < r.minPrice) { alert(`Below min price ${money(r.minPrice)}`); return }
    if (r.maxPrice != null && price > r.maxPrice) { alert(`Above max price ${money(r.maxPrice)}`); return }
    setPushing(r.id)
    try {
      const res = await fetch('/api/listings/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, sku: r.sku, price }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Price push failed'); return }
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, ourPrice: price } : x))
      recordPush(r.sku, price)
      setEditing(null)
    } catch {
      alert('Price push failed')
    } finally {
      setPushing(null)
    }
  }

  async function refreshBuyBox(r: GridRow) {
    setRefreshingBB(r.id)
    try {
      const res = await fetch('/api/listings/refresh-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, sku: r.sku, buyBox: true }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Buy Box refresh failed'); return }
      setRows(prev => prev.map(x => x.id === r.id ? {
        ...x,
        ourPrice: json.price ?? x.ourPrice,
        buyBoxPrice: json.buyBoxPrice ?? null,
        buyBoxSeller: json.buyBoxSeller ?? null,
        buyBoxIsPrime: json.buyBoxIsPrime ?? null,
      } : x))
    } catch {
      alert('Buy Box refresh failed')
    } finally {
      setRefreshingBB(null)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = q
    ? rows.filter(r =>
        r.asin.toLowerCase().includes(q) ||
        (r.title ?? '').toLowerCase().includes(q) ||
        r.internalSku.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q))
    : rows

  async function refreshAllVisible() {
    const targets = visible
    if (targets.length === 0 || bulkBB.running) return
    cancelBulkBB.current = false
    setBulkBB({ running: true, done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i++) {
      if (cancelBulkBB.current) break
      const r = targets[i]
      try {
        const res = await fetch('/api/listings/refresh-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, sku: r.sku, buyBox: true }),
        })
        const json = await res.json()
        if (res.ok) {
          setRows(prev => prev.map(x => x.id === r.id ? {
            ...x,
            ourPrice: json.price ?? x.ourPrice,
            buyBoxPrice: json.buyBoxPrice ?? null,
            buyBoxSeller: json.buyBoxSeller ?? null,
            buyBoxIsPrime: json.buyBoxIsPrime ?? null,
          } : x))
        }
      } catch { /* skip failures, keep going */ }
      setBulkBB({ running: true, done: i + 1, total: targets.length })
    }
    setBulkBB(b => ({ ...b, running: false }))
  }

  const sorted = [...visible].sort((a, b) => {
    const va = a[sort.key]
    const vb = b[sort.key]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb))
    return sort.dir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })
  }

  const Th = ({ col, label, align = 'left' }: { col: SortKey; label: string; align?: 'left' | 'right' | 'center' }) => (
    <th
      onClick={() => toggleSort(col)}
      className={clsx('px-3 py-2.5 cursor-pointer select-none hover:text-gray-700',
        align === 'right' && 'text-right', align === 'center' && 'text-center')}
    >
      <span className={clsx('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}{sort.key === col && <span className="text-gray-400">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  )

  const SoldCell = ({ n }: { n: number }) => (
    <td className="px-2 py-2 text-right tabular-nums">
      {n > 0 ? <span className="font-medium text-gray-800">{n}</span> : <span className="text-gray-300">0</span>}
    </td>
  )

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-auto">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Active Listing Pricing Grid</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Active Amazon listings (by condition) mapped to internal SKUs — price, Buy Box, and recent sales. Edit a price to push it live to Amazon.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          {accounts.map(a => <option key={a.id} value={a.id}>{a.marketplaceName} — {a.sellerId}</option>)}
        </select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ASIN, title, or SKU…"
            className="pl-9 pr-3 h-9 w-72 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCcw className={clsx('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </button>
        {bulkBB.running ? (
          <div className="inline-flex items-center gap-2 text-xs text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Buy Box {bulkBB.done}/{bulkBB.total}</span>
            <button onClick={() => { cancelBulkBB.current = true }}
              className="px-2 py-1 rounded-md font-medium text-red-600 hover:bg-red-50">Cancel</button>
          </div>
        ) : (
          <button
            onClick={refreshAllVisible}
            disabled={loading || visible.length === 0}
            title="Pull live Buy Box from Amazon for every listing shown"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" /> Refresh all Buy Box
          </button>
        )}
        <span className="ml-auto text-sm text-gray-500">{visible.length} listings</span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-[300px] overflow-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
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
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={12} className="px-3 py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={12} className="px-3 py-12 text-center text-gray-400">No active mapped listings.</td></tr>
            ) : sorted.map(r => {
              const ourIsPrime = r.fulfillmentChannel === 'FBA'
              const weWin = (r.buyBoxSeller ?? '').toLowerCase() === 'you'
              const isEditing = editing === r.id
              return (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  {/* ASIN & Title */}
                  <td className="px-3 py-2 max-w-[340px]">
                    <div className="flex items-center gap-1 flex-wrap">
                      <a href={`https://www.amazon.com/dp/${r.asin}`} target="_blank" rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                        {r.asin}<ExternalLink className="h-3 w-3" />
                      </a>
                      <span className={clsx('text-[9px] px-1.5 py-0.5 rounded font-medium',
                        r.fulfillmentChannel === 'FBA' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600')}>
                        {r.fulfillmentChannel}
                      </span>
                      {r.condition && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">{r.condition}</span>}
                    </div>
                    {r.title && (
                      <span className="inline-block mt-1 rounded-md bg-gray-100 text-gray-700 text-[11px] leading-snug px-2 py-0.5 whitespace-normal break-words">
                        {r.title}
                      </span>
                    )}
                  </td>
                  {/* Internal SKU + Grade */}
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-gray-800">{r.internalSku}</span>
                    {r.grade && <span className="ml-1 inline-block px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium">{r.grade}</span>}
                  </td>
                  {/* FG qty · Push qty  (FBA: available-at-FBA only) */}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.fulfillmentChannel === 'FBA' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs tabular-nums"
                        title="Available qty at FBA (Amazon-managed)">
                        FBA <span className="font-semibold">{r.pushQty}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs tabular-nums"
                        title="Finished-goods on-hand qty · qty pushed/listed on Amazon">
                        <span className="font-semibold text-gray-700">{r.fgQty}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-500">{r.pushQty}</span>
                      </span>
                    )}
                  </td>
                  {/* Avg Cost (FG: base + cost code + repair) */}
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {r.avgCost != null ? <span className="text-gray-700">{money(r.avgCost)}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Our Price (editable) */}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {isEditing ? (
                      <div className="inline-flex items-center gap-1">
                        <span className="text-gray-400 text-xs">$</span>
                        <input
                          autoFocus
                          type="number"
                          value={draftPrice}
                          onChange={(e) => setDraftPrice(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') pushPrice(r); if (e.key === 'Escape') setEditing(null) }}
                          step="0.01"
                          min="0.01"
                          className="w-20 h-7 rounded border border-gray-300 px-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                        />
                        <button onClick={() => pushPrice(r)} disabled={pushing === r.id} title="Push to Amazon"
                          className="text-green-600 hover:text-green-700 disabled:opacity-50">
                          {pushing === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={() => setEditing(null)} title="Cancel" className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button onClick={() => startEdit(r)} title="Click to edit & push price"
                          className="font-semibold text-gray-900 hover:text-amazon-blue hover:underline tabular-nums">
                          {money(r.ourPrice)}
                        </button>
                        <button onClick={() => refreshBuyBox(r)} disabled={refreshingBB === r.id}
                          title="Refresh our price & Buy Box live from Amazon" className="text-gray-300 hover:text-amazon-blue disabled:opacity-50">
                          <RefreshCcw className={clsx('h-3 w-3', refreshingBB === r.id && 'animate-spin')} />
                        </button>
                      </div>
                    )}
                    {r.marginPct != null && (
                      <div className={clsx('text-[10px] font-medium', r.marginPct < 0 ? 'text-red-600' : r.marginPct < 10 ? 'text-amber-600' : 'text-emerald-600')}
                        title="Net margin at our current price (base + cost code + repair + commission + shipping)">
                        {r.marginPct.toFixed(1)}% margin
                      </div>
                    )}
                    {(() => {
                      const rp = recentPushes[r.sku]
                      if (!rp || Date.now() - rp.at >= RECENT_MS) return null
                      return (
                        <div className="flex items-center gap-1 justify-end text-[10px] text-emerald-600 font-medium mt-0.5"
                          title="Pushed from this grid in the last 30 min — Amazon may still be propagating the new price">
                          <Zap className="h-2.5 w-2.5" /> Just updated to {money(rp.price)}
                        </div>
                      )
                    })()}
                    {(r.minPrice != null || r.maxPrice != null) && (
                      <div className="text-[10px] text-gray-400">{money(r.minPrice)}–{money(r.maxPrice)}</div>
                    )}
                  </td>
                  {/* Buy Box price + live refresh */}
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      {r.buyBoxPrice != null ? (
                        <span className={clsx(r.ourPrice != null && r.buyBoxPrice < r.ourPrice ? 'text-red-600' : 'text-gray-700')}>
                          {money(r.buyBoxPrice)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                      <button onClick={() => refreshBuyBox(r)} disabled={refreshingBB === r.id}
                        title="Refresh Buy Box live from Amazon" className="text-gray-300 hover:text-amazon-blue disabled:opacity-50">
                        <RefreshCcw className={clsx('h-3 w-3', refreshingBB === r.id && 'animate-spin')} />
                      </button>
                    </div>
                  </td>
                  {/* Is Prime (our offer) */}
                  <td className="px-3 py-2 text-center">
                    {ourIsPrime
                      ? <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-semibold">Prime</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  {/* Buy Box winner */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.buyBoxSeller ? (
                      <span className={clsx('inline-flex items-center gap-1 text-xs', weWin ? 'text-green-700 font-semibold' : 'text-gray-600')}>
                        {weWin && <Crown className="h-3 w-3" />}{r.buyBoxSeller}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <SoldCell n={r.s1} />
                  <SoldCell n={r.s3} />
                  <SoldCell n={r.s7} />
                  <SoldCell n={r.s30} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

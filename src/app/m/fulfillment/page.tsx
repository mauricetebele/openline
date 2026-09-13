'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import {
  Search, Loader2, RefreshCw, ChevronLeft, ChevronRight, Package, Truck, Printer, Ban,
  RotateCcw, CheckCircle2, Boxes, ScanLine, FileText, Download, Crown, DownloadCloud,
} from 'lucide-react'
import { generateOrderInvoicePDF } from '@/lib/generate-order-invoice'
import {
  apiPost, fmtMoney, fmtDate, openLabelData, orderNumber, shipByDays, carrierLogo,
  TAB_LABEL, WORKFLOW_DISPLAY, type Tab, type Order, type Pagination,
} from './types'
import {
  Sheet, ProcessSheet, VerifySheet, ManualShipSheet,
  WholesaleProcessSheet, WholesaleSerializeSheet, WholesaleShipSheet,
} from './ActionSheets'

type Channel = 'all' | 'amazon' | 'backmarket' | 'wholesale'
interface Account { id: string; name?: string | null; sellerId?: string }

const WS_STATUS: Partial<Record<Tab, string>> = { pending: 'PENDING', unshipped: 'PROCESSING', shipped: 'SHIPPED', cancelled: 'CANCELLED' }

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  amazon: { label: 'AMZ', cls: 'bg-orange-100 text-orange-700' },
  backmarket: { label: 'BM', cls: 'bg-blue-100 text-blue-700' },
  wholesale: { label: 'WHL', cls: 'bg-purple-100 text-purple-700' },
}
const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700', PROCESSING: 'bg-indigo-100 text-indigo-700',
  AWAITING_VERIFICATION: 'bg-amber-100 text-amber-700', SHIPPED: 'bg-emerald-100 text-emerald-700', CANCELLED: 'bg-gray-100 text-gray-500',
}

// ─── Channel logos (reused from the desktop grid's inline icons) ─────────────
function AmazonLogo() {
  return (
    <span title="Amazon" className="inline-flex flex-col items-center leading-none select-none">
      <span style={{ fontFamily: 'Arial, sans-serif', fontWeight: 900, fontSize: 8, letterSpacing: '-0.3px', color: '#232F3E', lineHeight: 1 }}>amazon</span>
      <svg width="22" height="6" viewBox="0 0 22 6" fill="none" style={{ marginTop: -1 }}>
        <path d="M1 4C6 7.5 16 7.5 21 4" stroke="#FF9900" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M17.5 2.5L21 4L17.5 5.5" stroke="#FF9900" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
function BackMarketLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0.72 182 166.32" aria-label="Back Market" className="text-gray-900">
      <path d="M167.45.72H14.55C6.51.72 0 7.21 0 15.23v136.58c0 8.02 6.51 14.51 14.55 14.51h152.9c8.03 0 14.55-6.5 14.55-14.51V15.23C182 7.22 175.49.72 167.45.72ZM99.14 133.69H69.13c-.96 0-1.87-.38-2.55-1.06L18.54 84.59c-.59-.59-.59-1.55 0-2.15L66.58 34.4c.68-.68 1.59-1.06 2.55-1.06h30.01c.82 0 1.23.99.65 1.56L52.25 82.44c-.59.59-.59 1.55 0 2.15l47.54 47.54c.58.58.17 1.56-.65 1.56Zm16.04-49.1 47.54 47.54c.58.58.17 1.56-.65 1.56h-30.01c-.96 0-1.87-.38-2.55-1.06L81.47 84.58c-.59-.59-.59-1.55 0-2.15l48.04-48.04c.68-.68 1.59-1.06 2.55-1.06h30.01c.82 0 1.23.99.65 1.56l-47.54 47.54c-.59.59-.59 1.55 0 2.15Z" fill="currentColor" />
    </svg>
  )
}
function SourceLogo({ src }: { src: string }) {
  if (src === 'backmarket') return <BackMarketLogo />
  // eslint-disable-next-line @next/next/no-img-element
  if (src === 'wholesale') return <img src="/logos/olm-icon.svg" alt="Wholesale" title="Wholesale" className="w-5 h-5" />
  return <AmazonLogo />
}

function fullySerialized(o: Order): boolean {
  const need = o.items.filter(i => i.isSerializable !== false).reduce((s, i) => s + i.quantityOrdered, 0)
  return need > 0 && (o.serialAssignments?.length ?? 0) >= need
}

export default function MobileFulfillment() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('unshipped')
  const [channel, setChannel] = useState<Channel>('all')
  const [prime, setPrime] = useState(false)
  const [dueToday, setDueToday] = useState(false)
  const [rateSort, setRateSort] = useState<'none' | 'asc' | 'desc'>('none')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [page, setPage] = useState(1)
  const [counts, setCounts] = useState<{ pending: number; unshipped: number; awaiting: number }>({ pending: 0, unshipped: 0, awaiting: 0 })
  const [loading, setLoading] = useState(true)
  const [fetchKey, setFetchKey] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [menuOrder, setMenuOrder] = useState<Order | null>(null)
  const [sheet, setSheet] = useState<{ type: string; order: Order } | null>(null)

  // Multi-select + bulk rate-shop / apply-preset
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pkgPresets, setPkgPresets] = useState<{ id: string; name: string }[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState<string | null>(null)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  const refresh = useCallback(() => setFetchKey(k => k + 1), [])

  useEffect(() => { fetch('/api/package-presets').then(r => r.json()).then((d: unknown) => setPkgPresets(Array.isArray(d) ? d : ((d as { data?: { id: string; name: string }[] })?.data ?? []))).catch(() => {}) }, [])
  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const clearSelect = () => setSelected(new Set())
  // Drop selections no longer visible when the list changes.
  useEffect(() => { setSelected(s => { const ids = new Set(orders.map(o => o.id)); const n = new Set(Array.from(s).filter(id => ids.has(id))); return n.size === s.size ? s : n }) }, [orders])

  /** Patch an order's live rate in place from an SSE 'rate' event. */
  const patchRate = useCallback((e: { orderId: string; rateAmount?: number | null; rateCarrier?: string | null; rateService?: string | null; rateId?: string | null; error?: string | null }, presetName?: { id: string; name: string }) => {
    setOrders(prev => prev.map(o => o.id !== e.orderId ? o : {
      ...o,
      presetRateAmount: e.rateAmount != null ? String(e.rateAmount) : null,
      presetRateCarrier: e.rateCarrier ?? null, presetRateService: e.rateService ?? null,
      presetRateId: e.rateId ?? null, presetRateError: e.error ?? null,
      ...(presetName ? { appliedPackagePreset: presetName } : {}),
    }))
  }, [])

  /** Run a bulk SSE endpoint (rate-shop-applied-presets / apply-package-preset). */
  async function runBulkSSE(url: string, body: Record<string, unknown>, orderIds: string[], presetName?: { id: string; name: string }) {
    setBulkProgress({ done: 0, total: orderIds.length })
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok || !res.body) { const t = await res.text().catch(() => ''); throw new Error(t || 'Failed to start') }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let done = 0
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break
      buf += dec.decode(chunk.value, { stream: true })
      const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.split('\n').find(l => l.startsWith('data: ')); if (!line) continue
        const evt = JSON.parse(line.slice(6))
        if (evt.type === 'rate') { done++; patchRate(evt, presetName); setBulkProgress({ done, total: orderIds.length }) }
        else if (evt.type === 'applied') {
          done++
          if (evt.presetId) setOrders(prev => prev.map(o => o.id === evt.orderId ? { ...o, appliedPackagePreset: { id: evt.presetId, name: evt.presetName ?? '' } } : o))
          setBulkProgress({ done, total: orderIds.length })
        }
        else if (evt.type === 'error') throw new Error(evt.error ?? 'Bulk action failed')
      }
    }
  }

  const todayStr = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD (local)

  async function bulkRateShop() {
    if (!accountId) { toast.error('Pick an account'); return }
    const ids = Array.from(selected); setBulkBusy('rate')
    try { await runBulkSSE('/api/orders/rate-shop-applied-presets', { orderIds: ids, accountId, shipDate: todayStr() }, ids); toast.success('Rate shop complete'); setBulkOpen(false) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Rate shop failed') } finally { setBulkBusy(null); setBulkProgress(null) }
  }
  async function bulkApplyDefaults() {
    if (!accountId) { toast.error('Pick an account'); return }
    const ids = Array.from(selected); setBulkBusy('defaults')
    try { await runBulkSSE('/api/orders/apply-default-package-presets', { orderIds: ids, accountId }, ids); toast.success('Default presets applied'); setBulkOpen(false) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Apply defaults failed') } finally { setBulkBusy(null); setBulkProgress(null) }
  }
  async function bulkApplyPreset(preset: { id: string; name: string }) {
    if (!accountId) { toast.error('Pick an account'); return }
    const ids = Array.from(selected); setBulkBusy('apply')
    try { await runBulkSSE('/api/orders/apply-package-preset', { presetId: preset.id, orderIds: ids, accountId, shipDate: todayStr() }, ids, preset); toast.success(`Applied ${preset.name} + rated`); setBulkOpen(false) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Apply failed') } finally { setBulkBusy(null); setBulkProgress(null) }
  }

  useEffect(() => { fetch('/api/accounts').then(r => r.json()).then(d => { const list = Array.isArray(d) ? d : (d.data ?? []); setAccounts(list); if (list[0]) setAccountId(list[0].id) }).catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300); return () => clearTimeout(t) }, [searchInput])
  useEffect(() => { setPage(1) }, [tab, channel])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results: Order[] = []
      // Amazon/BM orders (paginated) — unless viewing wholesale-only.
      if (channel !== 'wholesale') {
        const p = new URLSearchParams({ tab, page: String(page), pageSize: '500', sortBy: 'purchaseDate', sortDir: 'desc' })
        if (accountId) p.set('accountId', accountId)
        if (search) p.set('search', search)
        if (channel === 'amazon' || channel === 'backmarket') p.set('orderSource', channel)
        if (prime) p.set('prime', '1')
        if (dueToday && tab !== 'shipped' && tab !== 'cancelled') p.set('dueToday', '1')
        const res = await fetch(`/api/orders?${p}`)
        const d = await res.json()
        if (res.ok) { results.push(...(d.data ?? [])); setPagination(d.pagination ?? { page, pageSize: 500, total: 0, totalPages: 1 }) }
      } else {
        setPagination({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
      }
      // Wholesale (all for the status) merged in — but not when Prime-only (WS isn't Prime).
      const wsStatus = WS_STATUS[tab]
      if ((channel === 'all' || channel === 'wholesale') && wsStatus && !prime) {
        const wp = new URLSearchParams({ fulfillmentStatus: wsStatus })
        if (search) wp.set('search', search)
        const wr = await fetch(`/api/wholesale/orders/for-grid?${wp}`)
        const wd = await wr.json()
        if (wr.ok) results.push(...(wd.data ?? []).map((o: Order) => ({ ...o, orderSource: 'wholesale' as const })))
      }
      setOrders(results)
    } catch { setOrders([]) } finally { setLoading(false) }
  }, [tab, channel, page, accountId, search, prime, dueToday, fetchKey])
  useEffect(() => { load() }, [load])

  const loadCounts = useCallback(async () => {
    try {
      const p = new URLSearchParams(); if (accountId) p.set('accountId', accountId)
      if (channel === 'amazon' || channel === 'backmarket') p.set('orderSource', channel)
      const d = await (await fetch(`/api/orders/counts?${p}`)).json()
      setCounts({ pending: d.pending ?? 0, unshipped: d.unshipped ?? 0, awaiting: d.awaiting ?? 0 })
    } catch { /* ignore */ }
  }, [accountId, channel, fetchKey])
  useEffect(() => { loadCounts() }, [loadCounts])

  // Channel is client-narrowed (prime + dueToday are applied server-side above).
  const filtered = orders.filter(o => channel === 'all' || (o.orderSource ?? 'amazon') === channel)
  const visible = rateSort === 'none' ? filtered : [...filtered].sort((a, b) => {
    const av = a.presetRateAmount != null ? parseFloat(a.presetRateAmount) : Infinity
    const bv = b.presetRateAmount != null ? parseFloat(b.presetRateAmount) : Infinity
    return rateSort === 'asc' ? av - bv : bv - av
  })
  const allVisibleSelected = visible.length > 0 && visible.every(o => selected.has(o.id))
  const toggleSelectAll = () => setSelected(prev => {
    const n = new Set(prev)
    if (allVisibleSelected) visible.forEach(o => n.delete(o.id))
    else visible.forEach(o => n.add(o.id))
    return n
  })

  // ── Sync (poll job) ──
  async function runSync() {
    if (!accountId) { toast.error('Pick an account first'); return }
    setSyncing(true)
    try {
      const d = await apiPost<{ jobId?: string }>('/api/orders/sync', { accountId, source: 'amazon' })
      const jobId = d.jobId
      if (jobId) {
        const deadline = Date.now() + 120000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 4000))
          const job = await (await fetch(`/api/orders/sync?jobId=${jobId}`)).json()
          if (job.status === 'COMPLETED' || job.status === 'FAILED') break
        }
      }
      toast.success('Orders synced'); refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Sync failed') } finally { setSyncing(false) }
  }

  // ── Direct (no-input) actions ──
  async function runDirect(o: Order, label: string, fn: () => Promise<unknown>) {
    setBusyId(o.id)
    try { await fn(); toast.success(label); setMenuOrder(null); refresh() }
    catch (e) { toast.error(e instanceof Error ? e.message : `${label} failed`) } finally { setBusyId(null) }
  }
  const printLabel = (o: Order) => runDirect(o, 'Label opened', async () => {
    const d = await (await fetch(`/api/orders/${o.id}/label`)).json()
    if (!d?.labelData) throw new Error(d?.error ?? 'No label')
    openLabelData(d.labelData, d.labelFormat ?? 'pdf', orderNumber(o))
  })
  const printWholesaleLabel = (o: Order) => runDirect(o, 'Label opened', async () => {
    const d = await (await fetch(`/api/wholesale/orders/${o.id}/shipping-label/print`)).json()
    if (!d?.labelData) throw new Error(d?.error ?? 'No label')
    openLabelData(d.labelData, 'pdf', orderNumber(o))
  })

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-amazon-blue text-white pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Package size={18} />
          <h1 className="text-sm font-bold flex-1">Order Fulfillment</h1>
          {accounts.length > 1 && (
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className="h-8 rounded-md bg-white/15 text-white text-xs px-2 max-w-[120px]">
              {accounts.map(a => <option key={a.id} value={a.id} className="text-gray-900">{a.name ?? a.sellerId ?? a.id.slice(0, 6)}</option>)}
            </select>
          )}
          <button onClick={runSync} disabled={syncing} title="Sync orders" className="p-1.5 rounded-lg active:bg-white/10 disabled:opacity-50">
            <DownloadCloud size={18} className={syncing ? 'animate-pulse' : ''} />
          </button>
          <button onClick={refresh} title="Refresh" className="p-1.5 rounded-lg active:bg-white/10"><RefreshCw size={16} /></button>
        </div>
        {/* Search */}
        <div className="px-3 pb-2 relative">
          <Search size={15} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} inputMode="search" placeholder="Search order #, SKU, tracking…"
            className="w-full h-10 rounded-xl border-0 pl-8 pr-3 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-white/60" />
        </div>
        {/* Tabs */}
        <div className="flex overflow-x-auto no-scrollbar px-2 gap-1 pb-1.5">
          {(Object.keys(TAB_LABEL) as Tab[]).map(t => {
            const c = t === 'pending' ? counts.pending : t === 'unshipped' ? counts.unshipped : t === 'awaiting' ? counts.awaiting : null
            return (
              <button key={t} onClick={() => setTab(t)} className={clsx('shrink-0 px-3 h-8 rounded-lg text-xs font-semibold whitespace-nowrap', tab === t ? 'bg-white text-amazon-blue' : 'bg-white/10 text-white/80')}>
                {TAB_LABEL[t]}{c != null && c > 0 ? ` ${c}` : ''}
              </button>
            )
          })}
        </div>
      </header>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-3 py-2 bg-white border-b border-gray-200">
        {(['all', 'amazon', 'backmarket', 'wholesale'] as Channel[]).map(ch => (
          <button key={ch} onClick={() => setChannel(ch)} className={clsx('shrink-0 px-2.5 h-7 rounded-full text-[11px] font-semibold capitalize', channel === ch ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600')}>{ch}</button>
        ))}
        <span className="w-px h-5 bg-gray-200 mx-0.5 shrink-0" />
        <button onClick={() => setPrime(v => !v)} className={clsx('shrink-0 inline-flex items-center gap-1 px-2.5 h-7 rounded-full text-[11px] font-semibold', prime ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-600')}><Crown size={11} /> Prime</button>
        {tab !== 'shipped' && tab !== 'cancelled' && (
          <button onClick={() => setDueToday(v => !v)} className={clsx('shrink-0 px-2.5 h-7 rounded-full text-[11px] font-semibold', dueToday ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600')}>Due Today</button>
        )}
        <button onClick={() => setRateSort(s => s === 'none' ? 'asc' : s === 'asc' ? 'desc' : 'none')}
          className={clsx('shrink-0 px-2.5 h-7 rounded-full text-[11px] font-semibold', rateSort !== 'none' ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600')}>
          Rate {rateSort === 'asc' ? '↑' : rateSort === 'desc' ? '↓' : '↕'}
        </button>
      </div>

      {/* List */}
      <main className={clsx('flex-1 bg-gray-50 p-2.5', selected.size > 0 && 'pb-24')}>
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No orders</div>
        ) : (
          <>
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[11px] text-gray-500">{visible.length} order{visible.length !== 1 ? 's' : ''}{pagination.totalPages > 1 ? ' (this page)' : ''}</span>
            <button onClick={toggleSelectAll} className="text-xs font-semibold text-amazon-blue">{allVisibleSelected ? 'Deselect all' : 'Select all'}</button>
          </div>
          <ul className="space-y-2">
            {visible.map(o => <li key={o.id}><OrderCard order={o} onOpen={() => setMenuOrder(o)} busy={busyId === o.id} selected={selected.has(o.id)} onToggle={() => toggleSelect(o.id)} /></li>)}
          </ul>
          </>
        )}

        {/* Pagination (amazon list) */}
        {channel !== 'wholesale' && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-gray-300 disabled:opacity-40 bg-white"><ChevronLeft size={14} /> Prev</button>
            <span>Page {pagination.page} / {pagination.totalPages}</span>
            <button disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-gray-300 disabled:opacity-40 bg-white">Next <ChevronRight size={14} /></button>
          </div>
        )}
      </main>

      {/* Bulk selection bar */}
      {selected.size > 0 && !bulkOpen && !menuOrder && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] flex items-center gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.08)]">
          <span className="text-sm font-semibold text-gray-800">{selected.size} selected</span>
          <button onClick={clearSelect} className="text-xs text-gray-500 underline">Clear</button>
          <button onClick={() => setBulkOpen(true)} className="ml-auto h-11 px-5 rounded-xl bg-amazon-blue text-white font-semibold text-sm inline-flex items-center gap-2"><Truck size={16} /> Rate / Preset</button>
        </div>
      )}

      {/* Bulk actions sheet */}
      {bulkOpen && (
        <Sheet title={`Bulk actions · ${selected.size} order${selected.size !== 1 ? 's' : ''}`} onClose={() => { if (!bulkBusy) setBulkOpen(false) }}>
          {bulkProgress ? (
            <div className="py-8 text-center text-sm text-gray-600 flex items-center justify-center gap-2"><Loader2 size={18} className="animate-spin" /> Rating {bulkProgress.done}/{bulkProgress.total}…</div>
          ) : (
            <div className="space-y-2">
              <button onClick={bulkApplyDefaults} disabled={!!bulkBusy} className="w-full h-12 rounded-xl bg-gray-800 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"><Boxes size={17} /> Apply default presets</button>
              <button onClick={bulkRateShop} disabled={!!bulkBusy} className="w-full h-12 rounded-xl bg-amazon-blue text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"><Truck size={17} /> Rate shop (use applied presets)</button>
              <div className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Apply a package preset + rate</div>
              {pkgPresets.length === 0 ? <div className="text-xs text-gray-400">No package presets defined.</div> : pkgPresets.map(p => (
                <button key={p.id} onClick={() => bulkApplyPreset(p)} disabled={!!bulkBusy} className="w-full h-11 rounded-xl bg-gray-100 text-gray-800 font-semibold text-sm px-4 text-left flex items-center gap-2 disabled:opacity-50"><Boxes size={16} className="text-gray-500" /> {p.name}</button>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {/* Action menu */}
      {menuOrder && (
        <ActionMenu order={menuOrder} tab={tab} busy={busyId === menuOrder.id}
          onClose={() => setMenuOrder(null)}
          onSheet={(type) => { setSheet({ type, order: menuOrder }); setMenuOrder(null) }}
          onPrint={() => (menuOrder.orderSource === 'wholesale' ? printWholesaleLabel(menuOrder) : printLabel(menuOrder))}
          onInvoice={() => { try { generateOrderInvoicePDF(menuOrder as unknown as Parameters<typeof generateOrderInvoicePDF>[0]) } catch { toast.error('Invoice failed') } }}
          onDirect={(action) => {
            const o = menuOrder
            const map: Record<string, () => Promise<unknown>> = {
              cancel: () => apiPost(`/api/orders/${o.id}/cancel`, {}),
              unprocess: () => apiPost(`/api/orders/${o.id}/unprocess`, {}),
              reinstate: () => apiPost(`/api/orders/${o.id}/reinstate`, {}),
              confirmBm: () => apiPost(`/api/orders/${o.id}/confirm-backmarket`, {}),
              void: () => apiPost(`/api/orders/${o.id}/void-label`, {}),
              ssPull: () => apiPost(`/api/orders/${o.id}/ss-pull`, {}),
            }
            const labels: Record<string, string> = { cancel: 'Order cancelled', unprocess: 'Unprocessed', reinstate: 'Reinstated', confirmBm: 'Confirmed', void: 'Label voided', ssPull: 'ShipStation pulled' }
            if (map[action]) runDirect(o, labels[action], map[action])
          }}
        />
      )}

      {/* Input sheets */}
      {sheet?.type === 'process' && <ProcessSheet order={sheet.order} onClose={() => setSheet(null)} onDone={() => { setSheet(null); toast.success('Processed'); refresh() }} />}
      {sheet?.type === 'verify' && <VerifySheet order={sheet.order} onClose={() => setSheet(null)} onDone={() => { setSheet(null); toast.success('Shipped'); refresh() }} />}
      {sheet?.type === 'manualShip' && <ManualShipSheet order={sheet.order} onClose={() => setSheet(null)} onDone={() => { setSheet(null); toast.success('Shipped'); refresh() }} />}
      {sheet?.type === 'wsProcess' && <WholesaleProcessSheet order={sheet.order} onClose={() => setSheet(null)} onDone={() => { setSheet(null); toast.success('Processed'); refresh() }} />}
      {sheet?.type === 'wsSerialize' && <WholesaleSerializeSheet order={sheet.order} onClose={() => setSheet(null)} onDone={() => { setSheet(null); toast.success('Serialized'); refresh() }} />}
      {sheet?.type === 'wsShip' && <WholesaleShipSheet order={sheet.order} onClose={() => setSheet(null)} onDone={() => { setSheet(null); toast.success('Shipped'); refresh() }} />}
    </div>
  )
}

// ─── Order card ──────────────────────────────────────────────────────────────
function OrderCard({ order: o, onOpen, busy, selected, onToggle }: { order: Order; onOpen: () => void; busy: boolean; selected: boolean; onToggle: () => void }) {
  const src = o.orderSource ?? 'amazon'
  const days = shipByDays(o)
  const item0 = o.items[0]
  const rateLogo = o.presetRateAmount ? carrierLogo(o.presetRateCarrier, o.presetRateService) : null
  return (
    <div className={clsx('flex items-stretch gap-1 bg-white rounded-xl shadow-sm', selected && 'ring-2 ring-amazon-blue')}>
      {/* select checkbox */}
      <button onClick={onToggle} className="pl-3 pr-1 flex items-center shrink-0" aria-label="Select order">
        <span className={clsx('w-5 h-5 rounded-md border-2 flex items-center justify-center', selected ? 'bg-amazon-blue border-amazon-blue text-white' : 'border-gray-300')}>
          {selected && <CheckCircle2 size={13} />}
        </span>
      </button>
      {/* main content */}
      <button onClick={onOpen} disabled={busy} className="flex-1 min-w-0 text-left py-3 pr-3 active:bg-gray-50 disabled:opacity-60 rounded-r-xl">
        <div className="flex items-start gap-2">
          <div className="shrink-0 w-6 flex items-center justify-center pt-0.5"><SourceLogo src={src} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-[13px] text-amazon-blue">{orderNumber(o)}</span>
              {o.isPrime && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">PRIME</span>}
              {o.isReplacement && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">REPL</span>}
              {o.isBuyerRequestedCancel && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">CANCEL REQ</span>}
            </div>
            <div className="text-[12px] text-gray-700 mt-0.5">{src === 'wholesale' ? (o.wholesaleCustomerName ?? '—') : (o.shipToName ?? '—')}{o.shipToCity ? ` · ${o.shipToCity}, ${o.shipToState}` : ''}</div>
            {item0 && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{item0.internalSku ?? item0.sellerSku ?? ''} · {item0.title}{o.items.length > 1 ? ` (+${o.items.length - 1})` : ''}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[13px] font-semibold text-gray-900">{fmtMoney(o.orderTotal)}</div>
            <div className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block', STATUS_BADGE[o.workflowStatus] ?? 'bg-gray-100 text-gray-500')}>{WORKFLOW_DISPLAY[o.workflowStatus] ?? o.workflowStatus}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
          {o.shipTracking || o.label?.trackingNumber ? <span className="font-mono truncate">{o.shipTracking ?? o.label?.trackingNumber}</span> : days != null ? <span className={clsx(days < 0 ? 'text-red-600 font-semibold' : days === 0 ? 'text-amber-600 font-semibold' : '')}>Ship by {fmtDate(o.latestShipDate)}{days < 0 ? ' (late)' : days === 0 ? ' (today)' : ''}</span> : <span>Ordered {fmtDate(o.purchaseDate)}</span>}
          {o.appliedPackagePreset && <span className="truncate">· {o.appliedPackagePreset.name}</span>}
          {o.presetRateAmount ? (
            <span className="ml-auto inline-flex items-center gap-1 text-gray-800 font-medium">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {rateLogo ? <img src={rateLogo} alt={o.presetRateCarrier ?? ''} className="h-3.5 w-auto object-contain" /> : <span className="text-[10px]">{o.presetRateCarrier}</span>}
              {fmtMoney(o.presetRateAmount)}
            </span>
          ) : o.presetRateError ? <span className="ml-auto text-red-500">rate err</span> : null}
        </div>
      </button>
    </div>
  )
}

// ─── Action menu (bottom sheet with tab/source-aware actions) ────────────────
function ActionMenu({ order: o, tab, busy, onClose, onSheet, onDirect, onPrint, onInvoice }: {
  order: Order; tab: Tab; busy: boolean; onClose: () => void
  onSheet: (type: string) => void; onDirect: (action: string) => void; onPrint: () => void; onInvoice: () => void
}) {
  const src = o.orderSource ?? 'amazon'
  const ws = src === 'wholesale'
  const serialized = fullySerialized(o)

  const A = ({ icon, label, onClick, tone = 'default' }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: 'default' | 'primary' | 'danger' }) => (
    <button onClick={onClick} disabled={busy}
      className={clsx('w-full h-12 rounded-xl font-semibold text-sm flex items-center gap-2.5 px-4 disabled:opacity-50',
        tone === 'primary' ? 'bg-amazon-blue text-white' : tone === 'danger' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-800')}>
      {busy ? <Loader2 size={17} className="animate-spin" /> : icon} {label}
    </button>
  )

  return (
    <Sheet title={orderNumber(o)} subtitle={`${SOURCE_BADGE[src]?.label} · ${o.shipToName ?? o.wholesaleCustomerName ?? ''}`} onClose={onClose}>
      <div className="space-y-2">
        {/* PENDING */}
        {tab === 'pending' && (ws
          ? <A icon={<Boxes size={17} />} label="Process" tone="primary" onClick={() => onSheet('wsProcess')} />
          : <>
              <A icon={<Boxes size={17} />} label="Process (reserve stock)" tone="primary" onClick={() => onSheet('process')} />
              <A icon={<Ban size={17} />} label="Cancel order" tone="danger" onClick={() => onDirect('cancel')} />
            </>)}

        {/* UNSHIPPED */}
        {tab === 'unshipped' && (ws
          ? <>
              <A icon={<ScanLine size={17} />} label="Serialize" tone="primary" onClick={() => onSheet('wsSerialize')} />
              <A icon={<Truck size={17} />} label="Ship" onClick={() => onSheet('wsShip')} />
              {o.hasShippingLabel && <A icon={<Printer size={17} />} label="Print label" onClick={onPrint} />}
            </>
          : <>
              {src === 'backmarket' && <A icon={<CheckCircle2 size={17} />} label="Confirm on Back Market" onClick={() => onDirect('confirmBm')} />}
              <A icon={<ScanLine size={17} />} label="Verify & serialize" tone="primary" onClick={() => onSheet('verify')} />
              {serialized && <A icon={<Truck size={17} />} label="Manual ship" onClick={() => onSheet('manualShip')} />}
              <A icon={<RotateCcw size={17} />} label="Unprocess" onClick={() => onDirect('unprocess')} />
              <A icon={<Ban size={17} />} label="Cancel order" tone="danger" onClick={() => onDirect('cancel')} />
            </>)}

        {/* AWAITING */}
        {tab === 'awaiting' && (
          <>
            <A icon={<Printer size={17} />} label="Print label" tone="primary" onClick={onPrint} />
            <A icon={<ScanLine size={17} />} label="Verify & serialize" onClick={() => onSheet('verify')} />
            {serialized && <A icon={<Truck size={17} />} label="Manual ship" onClick={() => onSheet('manualShip')} />}
            <A icon={<Ban size={17} />} label="Void label" tone="danger" onClick={() => onDirect('void')} />
            <A icon={<Ban size={17} />} label="Cancel order" tone="danger" onClick={() => onDirect('cancel')} />
          </>
        )}

        {/* SHIPPED */}
        {tab === 'shipped' && (
          <>
            {!ws && <A icon={<Printer size={17} />} label="Print label" onClick={onPrint} />}
            {ws && o.hasShippingLabel && <A icon={<Printer size={17} />} label="Print label" onClick={onPrint} />}
            <A icon={<FileText size={17} />} label="Invoice PDF" onClick={onInvoice} />
            {!ws && <A icon={<Ban size={17} />} label="Void label" tone="danger" onClick={() => onDirect('void')} />}
          </>
        )}

        {/* CANCELLED */}
        {tab === 'cancelled' && <A icon={<RotateCcw size={17} />} label="Reinstate order" tone="primary" onClick={() => onDirect('reinstate')} />}

        {/* Always available for marketplace orders */}
        {!ws && <A icon={<Download size={17} />} label="Pull from ShipStation" onClick={() => onDirect('ssPull')} />}
      </div>
    </Sheet>
  )
}

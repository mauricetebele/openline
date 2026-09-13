'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import {
  Search, Loader2, RefreshCw, ChevronLeft, ChevronRight, Package, Truck, Printer, Ban,
  RotateCcw, CheckCircle2, Boxes, ScanLine, FileText, Download, Crown, DownloadCloud,
} from 'lucide-react'
import { generateOrderInvoicePDF } from '@/lib/generate-order-invoice'
import {
  apiPost, fmtMoney, fmtDate, openLabelData, orderNumber, shipByDays,
  TAB_LABEL, type Tab, type Order, type Pagination,
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

  const refresh = useCallback(() => setFetchKey(k => k + 1), [])

  useEffect(() => { fetch('/api/accounts').then(r => r.json()).then(d => { const list = Array.isArray(d) ? d : (d.data ?? []); setAccounts(list); if (list[0]) setAccountId(list[0].id) }).catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300); return () => clearTimeout(t) }, [searchInput])
  useEffect(() => { setPage(1) }, [tab, channel])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results: Order[] = []
      // Amazon/BM orders (paginated) — unless viewing wholesale-only.
      if (channel !== 'wholesale') {
        const p = new URLSearchParams({ tab, page: String(page), pageSize: '25', sortBy: 'purchaseDate', sortDir: 'desc' })
        if (accountId) p.set('accountId', accountId)
        if (search) p.set('search', search)
        if (channel === 'amazon' || channel === 'backmarket') p.set('orderSource', channel)
        const res = await fetch(`/api/orders?${p}`)
        const d = await res.json()
        if (res.ok) { results.push(...(d.data ?? [])); setPagination(d.pagination ?? { page, pageSize: 25, total: 0, totalPages: 1 }) }
      } else {
        setPagination({ page: 1, pageSize: 25, total: 0, totalPages: 1 })
      }
      // Wholesale (all for the status) merged in for 'all' or 'wholesale'.
      const wsStatus = WS_STATUS[tab]
      if ((channel === 'all' || channel === 'wholesale') && wsStatus) {
        const wp = new URLSearchParams({ fulfillmentStatus: wsStatus })
        if (search) wp.set('search', search)
        const wr = await fetch(`/api/wholesale/orders/for-grid?${wp}`)
        const wd = await wr.json()
        if (wr.ok) results.push(...(wd.data ?? []).map((o: Order) => ({ ...o, orderSource: 'wholesale' as const })))
      }
      setOrders(results)
    } catch { setOrders([]) } finally { setLoading(false) }
  }, [tab, channel, page, accountId, search, fetchKey])
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

  // Client-side channel/prime/dueToday filters.
  const visible = orders.filter(o => {
    if (channel !== 'all' && (o.orderSource ?? 'amazon') !== channel) return false
    if (prime && !o.isPrime) return false
    if (dueToday) { const d = shipByDays(o); if (d == null || d > 0) return false }
    return true
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
      </div>

      {/* List */}
      <main className="flex-1 bg-gray-50 p-2.5">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No orders</div>
        ) : (
          <ul className="space-y-2">
            {visible.map(o => <li key={o.id}><OrderCard order={o} onOpen={() => setMenuOrder(o)} busy={busyId === o.id} /></li>)}
          </ul>
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
function OrderCard({ order: o, onOpen, busy }: { order: Order; onOpen: () => void; busy: boolean }) {
  const src = o.orderSource ?? 'amazon'
  const badge = SOURCE_BADGE[src]
  const days = shipByDays(o)
  const item0 = o.items[0]
  const rate = o.presetRateAmount ? `${o.presetRateCarrier ?? ''} ${fmtMoney(o.presetRateAmount)}` : o.presetRateError ? 'rate err' : null
  return (
    <button onClick={onOpen} disabled={busy} className="w-full text-left bg-white rounded-xl shadow-sm p-3 active:bg-gray-50 disabled:opacity-60">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-[13px] text-amazon-blue">{orderNumber(o)}</span>
            <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded', badge?.cls)}>{badge?.label}</span>
            {o.isPrime && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">PRIME</span>}
            {o.isReplacement && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">REPL</span>}
            {o.isBuyerRequestedCancel && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">CANCEL REQ</span>}
          </div>
          <div className="text-[12px] text-gray-700 mt-0.5">{src === 'wholesale' ? (o.wholesaleCustomerName ?? '—') : (o.shipToName ?? '—')}{o.shipToCity ? ` · ${o.shipToCity}, ${o.shipToState}` : ''}</div>
          {item0 && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{item0.internalSku ?? item0.sellerSku ?? ''} · {item0.title}{o.items.length > 1 ? ` (+${o.items.length - 1})` : ''}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-semibold text-gray-900">{src === 'wholesale' ? fmtMoney(o.orderTotal) : fmtMoney(o.orderTotal)}</div>
          <div className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block', STATUS_BADGE[o.workflowStatus] ?? 'bg-gray-100 text-gray-500')}>{o.workflowStatus.replace('AWAITING_VERIFICATION', 'AWAITING').replace('_', ' ')}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
        {o.shipTracking || o.label?.trackingNumber ? <span className="font-mono truncate">{o.shipTracking ?? o.label?.trackingNumber}</span> : days != null ? <span className={clsx(days < 0 ? 'text-red-600 font-semibold' : days === 0 ? 'text-amber-600 font-semibold' : '')}>Ship by {fmtDate(o.latestShipDate)}{days < 0 ? ' (late)' : days === 0 ? ' (today)' : ''}</span> : <span>Ordered {fmtDate(o.purchaseDate)}</span>}
        {o.appliedPackagePreset && <span className="truncate">· {o.appliedPackagePreset.name}</span>}
        {rate && <span className="ml-auto text-gray-600">{rate}</span>}
      </div>
    </button>
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

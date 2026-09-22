'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, X, Loader2, Trash2, Truck, Printer, RefreshCcw, Wrench, Building2, ArrowLeft, CheckCircle2, Ban, DollarSign, FileSpreadsheet, MapPin } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import { printAllLabels } from '@/lib/print-labels'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types ──────────────────────────────────────────────────────────────────
interface Vendor { id: string; companyName: string; email: string | null; phone: string | null; address1: string | null; address2: string | null; city: string | null; state: string | null; postal: string | null; country: string; isActive: boolean; repairLocationId: string | null }
interface LocOption { id: string; label: string }
interface RepairType { id: string; name: string; isActive: boolean }
interface OrderRow { id: string; orderNumber: number; status: string; vendorName: string; itemCount: number; totalCost: number; createdAt: string; outboundTracking: string | null; inboundTracking: string | null }
interface Item { id: string; serialNumber: string; sku: string | null; model: string | null; grade: string | null; location: string | null; repairTypeId: string | null; repairTypeName: string | null; repairCost: number | null; status: string; repairSummary: string | null }
interface OrderDetail { id: string; orderNumber: number; status: string; notes: string | null; vendor: Vendor; outboundCarrier: string | null; outboundTracking: string | null; inboundCarrier: string | null; inboundTracking: string | null; items: Item[]; totalCost: number }

const money = (n: number | null | undefined) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtD = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
function statusTone(st: string | null | undefined): string {
  const s = (st ?? '').toLowerCase()
  if (s.includes('deliver') && !s.includes('out for')) return 'bg-green-100 text-green-700'
  if (s.includes('exception') || s.includes('fail') || s.includes('return to sender')) return 'bg-red-100 text-red-700'
  // Any other tracked status (in transit, picked up, label created, …) is blue.
  return 'bg-blue-100 text-blue-700'
}
const inputCls = 'w-full h-8 px-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue'
const STATUS_COLOR: Record<string, string> = { DRAFT: 'bg-gray-100 text-gray-600', SHIPPED_OUT: 'bg-blue-100 text-blue-700', AT_VENDOR: 'bg-amber-100 text-amber-700', RETURNED: 'bg-indigo-100 text-indigo-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-red-100 text-red-600' }

const SERVICES: Record<string, { code: string; label: string }[]> = {
  ups: [{ code: '03', label: 'UPS Ground' }, { code: '02', label: 'UPS 2nd Day Air' }, { code: '01', label: 'UPS Next Day Air' }],
  fedex: [{ code: 'FEDEX_GROUND', label: 'FedEx Ground' }, { code: 'FEDEX_2_DAY', label: 'FedEx 2Day' }, { code: 'STANDARD_OVERNIGHT', label: 'FedEx Standard Overnight' }],
  ss: [{ code: 'ups_ground', label: 'UPS Ground' }, { code: 'ups_2nd_day_air', label: 'UPS 2nd Day Air' }, { code: 'ups_next_day_air', label: 'UPS Next Day Air' }],
}

function printLabel(base64: string, format: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const isPdf = (format || 'pdf').toLowerCase() === 'pdf'
  const url = URL.createObjectURL(new Blob([bytes], { type: isPdf ? 'application/pdf' : 'image/png' }))
  const iframe = document.createElement('iframe'); iframe.style.display = 'none'; document.body.appendChild(iframe); iframe.src = url
  iframe.onload = () => { iframe.contentWindow?.print(); setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url) }, 1500) }
}

async function api(url: string, method = 'GET', body?: any) {
  const res = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `${res.status}`)
  return data
}

export default function RepairOrders() {
  const [tab, setTab] = useState<'orders' | 'vendors' | 'types'>('orders')
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="max-w-6xl">
      <div className="flex gap-1 mb-4">
        {([['orders', 'Repair Orders', Wrench], ['vendors', 'Vendors', Building2], ['types', 'Repair Types', Wrench]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => { setTab(k); setOpenId(null) }}
            className={clsx('px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5', tab === k ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300')}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === 'orders' ? (openId ? <Detail id={openId} onBack={() => setOpenId(null)} /> : <OrdersList onOpen={setOpenId} />)
        : tab === 'vendors' ? <VendorsTab />
        : <TypesTab />}
    </div>
  )
}

// ─── Orders list ────────────────────────────────────────────────────────────
function OrdersList({ onOpen }: { onOpen: (id: string) => void }) {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [vendorId, setVendorId] = useState('')

  const load = useCallback(() => { setLoading(true); api('/api/repair-orders').then(setOrders).catch(() => {}).finally(() => setLoading(false)) }, [])
  useEffect(() => { load(); api('/api/repair-vendors').then((v: Vendor[]) => { setVendors(v); setVendorId(v.find(x => x.isActive)?.id ?? '') }).catch(() => {}) }, [load])

  async function create() {
    if (!vendorId) { toast.error('Add a vendor first (Vendors tab)'); return }
    setCreating(true)
    try { const o = await api('/api/repair-orders', 'POST', { vendorId }); onOpen(o.id) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setCreating(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select className={clsx(inputCls, 'max-w-xs')} value={vendorId} onChange={e => setVendorId(e.target.value)}>
          {vendors.length === 0 && <option value="">No vendors — add one</option>}
          {vendors.filter(v => v.isActive).map(v => <option key={v.id} value={v.id}>{v.companyName}</option>)}
        </select>
        <button onClick={create} disabled={creating || !vendorId} className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} New Repair Order
        </button>
      </div>
      {loading ? <div className="py-8 text-center text-gray-400"><Loader2 className="animate-spin inline" /></div>
        : orders.length === 0 ? <div className="py-8 text-center text-sm text-gray-400">No repair orders yet.</div>
        : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs">
                <tr><th className="text-left px-3 py-2">RO #</th><th className="text-left px-3 py-2">Vendor</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Units</th><th className="text-right px-3 py-2">Repair Cost</th><th className="text-left px-3 py-2">Created</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {orders.map(o => (
                  <tr key={o.id} onClick={() => onOpen(o.id)} className="cursor-pointer hover:bg-blue-50/50 dark:hover:bg-gray-800/60">
                    <td className="px-3 py-1.5 font-semibold text-amazon-blue">RO-{String(o.orderNumber).padStart(4, '0')}</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{o.vendorName}</td>
                    <td className="px-3 py-1.5"><span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium', STATUS_COLOR[o.status])}>{o.status.replace('_', ' ')}</span></td>
                    <td className="px-3 py-1.5 text-right text-gray-600">{o.itemCount}</td>
                    <td className="px-3 py-1.5 text-right text-gray-800 dark:text-gray-200">{money(o.totalCost)}</td>
                    <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{new Date(o.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

// ─── Order detail ───────────────────────────────────────────────────────────
function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [types, setTypes] = useState<RepairType[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [serials, setSerials] = useState('')
  const [busy, setBusy] = useState(false)
  const [assignType, setAssignType] = useState('')
  const [assignCost, setAssignCost] = useState('')
  const [tracking, setTracking] = useState<any>(null)
  const [labelDir, setLabelDir] = useState<null | 'outbound' | 'inbound'>(null)

  const load = useCallback(() => api(`/api/repair-orders/${id}`).then(setOrder).catch(() => {}), [id])
  useEffect(() => { load(); api('/api/repair-types').then(setTypes).catch(() => {}) }, [load])

  const toggle = (i: string) => setSelected(p => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n })
  const allSel = order && order.items.length > 0 && selected.size === order.items.length

  async function addSerials() {
    if (!serials.trim()) return
    setBusy(true)
    try {
      const r = await api(`/api/repair-orders/${id}/items`, 'POST', { serials: serials.split(/[\n\r,\t]+/) })
      setSerials(''); await load()
      toast.success(`Added ${r.added}${r.errors?.length ? ` — ${r.errors.length} skipped` : ''}`)
      if (r.errors?.length) toast(r.errors.slice(0, 6).join('\n'))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function assign() {
    if (selected.size === 0) { toast.error('Select rows first'); return }
    const body: any = { itemIds: Array.from(selected) }
    if (assignType) body.repairTypeId = assignType
    if (assignCost !== '') body.repairCost = Number(assignCost)
    setBusy(true)
    try { await api(`/api/repair-orders/${id}/items`, 'PATCH', body); await load(); toast.success('Assigned') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function removeSel() {
    if (selected.size === 0) return
    if (!confirm(`Remove ${selected.size} unit(s) from this order?`)) return
    setBusy(true)
    try { await api(`/api/repair-orders/${id}/items`, 'DELETE', { itemIds: Array.from(selected) }); setSelected(new Set()); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function outcome(status: 'REPAIRED' | 'REFUSED') {
    if (selected.size === 0) { toast.error('Select rows first'); return }
    const summary = status === 'REFUSED' ? (prompt('Refusal summary (optional):') ?? '') : ''
    setBusy(true)
    try { await api(`/api/repair-orders/${id}/items`, 'PATCH', { itemIds: Array.from(selected), status, repairSummary: summary }); setSelected(new Set()); await load(); toast.success(status === 'REPAIRED' ? 'Marked repaired' : 'Marked refused') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function setStatus(status: string) {
    try { await api(`/api/repair-orders/${id}`, 'PATCH', { status }); await load() } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const [relocating, setRelocating] = useState(false)
  async function relocate() {
    setRelocating(true)
    try {
      const r = await api(`/api/repair-orders/${id}/relocate`, 'POST')
      toast.success(r.moved > 0 ? `Moved ${r.moved} unit${r.moved !== 1 ? 's' : ''} into ${r.locationName}` : `Units already at ${r.locationName ?? 'the in-repair location'}`)
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setRelocating(false) }
  }
  async function loadTracking() {
    try { setTracking(await api(`/api/repair-orders/${id}/tracking`)) } catch { /* ignore */ }
  }
  async function printLabels(dir: 'outbound' | 'inbound') {
    try {
      const r = await api(`/api/repair-orders/${id}/label?direction=${dir}`)
      if (!r.labels?.length) { toast.error('No stored labels found'); return }
      // Merge every piece into one PDF so all print from a single tab (one dialog
      // per label fails — the modal print dialog drops the later ones).
      if (r.labels.length === 1) printLabel(r.labels[0].labelData, r.labels[0].labelFormat)
      else await printAllLabels(r.labels.map((l: any) => ({ labelData: l.labelData, labelFormat: l.labelFormat })))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load labels') }
  }

  if (!order) return <div className="py-8 text-center text-gray-400"><Loader2 className="animate-spin inline" /></div>

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={14} /> Back</button>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">RO-{String(order.orderNumber).padStart(4, '0')}</h2>
        <span className={clsx('inline-flex px-2 py-0.5 rounded text-xs font-medium', STATUS_COLOR[order.status])}>{order.status.replace('_', ' ')}</span>
        <span className="text-sm text-gray-500">{order.vendor.companyName}</span>
        <div className="ml-auto flex items-center gap-2">
          {order.vendor.repairLocationId && order.status !== 'DRAFT' && order.status !== 'CANCELLED' && (
            <button onClick={relocate} disabled={relocating}
              title="Move these units into the vendor's in-repair location (for orders shipped before the location was mapped)"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-purple-300 text-purple-700 text-xs font-medium hover:bg-purple-50 disabled:opacity-50">
              <MapPin size={13} /> {relocating ? 'Moving…' : 'Move to In-Repair Location'}
            </button>
          )}
          <a href={`/api/repair-orders/${id}/po-document`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-green-300 text-green-700 text-xs font-medium hover:bg-green-50">
            <FileSpreadsheet size={13} /> Repair PO (Excel)
          </a>
          <select className="h-8 px-2 rounded border border-gray-300 text-xs" value={order.status} onChange={e => setStatus(e.target.value)}>
            {['DRAFT', 'SHIPPED_OUT', 'AT_VENDOR', 'RETURNED', 'COMPLETED', 'CANCELLED'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      {/* Shipping */}
      <div className="grid grid-cols-2 gap-3">
        {(['outbound', 'inbound'] as const).map(dir => {
          const carrier = dir === 'outbound' ? order.outboundCarrier : order.inboundCarrier
          const trk = dir === 'outbound' ? order.outboundTracking : order.inboundTracking
          const sts: any[] | undefined = tracking?.[dir]
          const stByTn = new Map((sts ?? []).map((s: any) => [s.trackingNumber, s]))
          const parcels = (trk ?? '').split(',').map(t => t.trim()).filter(Boolean)
          return (
            <div key={dir} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold uppercase text-gray-500">{dir === 'outbound' ? 'Outbound → Vendor' : 'Inbound → Us'}</span>
                <div className="flex items-center gap-2">
                  {trk && <button onClick={() => printLabels(dir)} className="text-xs text-gray-500 hover:text-amazon-blue flex items-center gap-1"><Printer size={12} /> Print</button>}
                  <button onClick={() => setLabelDir(dir)} className="text-xs text-amazon-blue hover:underline flex items-center gap-1"><Truck size={12} /> {trk ? 'New label' : 'Create label'}</button>
                </div>
              </div>
              {parcels.length > 0 ? (
                <div className="space-y-1">
                  {parcels.map((tn, i) => {
                    const s = stByTn.get(tn)
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-gray-600 dark:text-gray-300"><span className="text-gray-400 mr-1">Box {i + 1}</span>{tn}<span className="text-gray-400 ml-1.5">{carrier}</span></span>
                        {s && (s.error
                          ? <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-100 text-red-600">lookup failed</span>
                          : s.status
                            ? <span className={clsx('shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium', statusTone(s.status))}>{s.status}{s.deliveredAt ? ` · ${fmtD(s.deliveredAt)}` : s.estimatedDelivery ? ` · ETA ${fmtD(s.estimatedDelivery)}` : ''}</span>
                            : <span className="shrink-0 text-[10px] text-gray-400">no status</span>)}
                      </div>
                    )
                  })}
                </div>
              ) : <div className="text-xs text-gray-400">No label yet.</div>}
            </div>
          )
        })}
      </div>
      <button onClick={loadTracking} className="text-xs text-gray-500 hover:text-amazon-blue flex items-center gap-1"><RefreshCcw size={12} /> Refresh tracking status</button>

      {/* Add serials */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <label className="text-xs font-semibold text-gray-500">Add in-stock serials (paste, one per line)</label>
        <textarea rows={2} value={serials} onChange={e => setSerials(e.target.value)} className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 text-sm font-mono" placeholder="Serial numbers…" />
        <button onClick={addSerials} disabled={busy || !serials.trim()} className="h-8 px-4 rounded-md bg-amazon-blue text-white text-xs font-medium disabled:opacity-50">Add serials</button>
      </div>

      {/* Assign / actions */}
      {order.items.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
          <div><label className="block text-[11px] text-gray-500 mb-0.5">Repair type</label>
            <select className={clsx(inputCls, 'w-44')} value={assignType} onChange={e => setAssignType(e.target.value)}>
              <option value="">— type —</option>{types.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
          <div><label className="block text-[11px] text-gray-500 mb-0.5">Cost ($)</label><input type="number" step="0.01" className={clsx(inputCls, 'w-24')} value={assignCost} onChange={e => setAssignCost(e.target.value)} /></div>
          <button onClick={assign} disabled={busy} className="h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium disabled:opacity-50">Assign to selected ({selected.size})</button>
          <div className="flex-1" />
          <button onClick={() => outcome('REPAIRED')} disabled={busy} className="h-8 px-3 rounded-md border border-green-300 text-green-700 text-xs font-medium hover:bg-green-50 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Repaired</button>
          <button onClick={() => outcome('REFUSED')} disabled={busy} className="h-8 px-3 rounded-md border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 inline-flex items-center gap-1"><Ban size={12} /> Refused</button>
          <button onClick={removeSel} disabled={busy} className="h-8 px-2 rounded-md border border-gray-300 text-gray-500 text-xs hover:bg-gray-100"><Trash2 size={13} /></button>
        </div>
      )}

      {/* Items grid */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs">
            <tr>
              <th className="w-8 px-2 py-2"><input type="checkbox" checked={!!allSel} onChange={e => setSelected(e.target.checked ? new Set(order.items.map(i => i.id)) : new Set())} /></th>
              <th className="text-left px-3 py-2">Serial / IMEI</th><th className="text-left px-3 py-2">SKU</th><th className="text-left px-3 py-2">Model Name</th>
              <th className="text-left px-3 py-2">Grade</th><th className="text-left px-3 py-2">Repair Type</th><th className="text-right px-3 py-2">Repair Cost</th><th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {order.items.length === 0 ? <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400 text-sm">No units yet — paste serials above.</td></tr>
              : order.items.map(it => (
                <tr key={it.id} className={clsx(selected.has(it.id) && 'bg-blue-50/50 dark:bg-gray-800/60')}>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} /></td>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">{it.serialNumber}</td>
                  <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{it.sku ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 truncate max-w-[240px]" title={it.model ?? ''}>{it.model ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500">{it.grade ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{it.repairTypeName ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-1.5 text-right text-gray-800 dark:text-gray-200">{money(it.repairCost)}</td>
                  <td className="px-3 py-1.5">
                    <span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium', it.status === 'REPAIRED' ? 'bg-green-100 text-green-700' : it.status === 'REFUSED' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500')} title={it.repairSummary ?? ''}>{it.status}</span>
                  </td>
                </tr>
              ))}
          </tbody>
          {order.items.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold"><tr><td colSpan={6} className="px-3 py-1.5 text-right text-gray-500">Total repair cost</td><td className="px-3 py-1.5 text-right">{money(order.totalCost)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>

      {labelDir && <LabelModal orderId={id} direction={labelDir} onClose={() => setLabelDir(null)} onDone={() => { setLabelDir(null); load() }} />}
    </div>
  )
}

// ─── Label modal ────────────────────────────────────────────────────────────
function LabelModal({ orderId, direction, onClose, onDone }: { orderId: string; direction: 'outbound' | 'inbound'; onClose: () => void; onDone: () => void }) {
  const [path, setPath] = useState<'ups' | 'fedex' | 'ss'>('ups')
  const [serviceCode, setServiceCode] = useState(SERVICES.ups[0].code)
  const emptyBox = () => ({ weight: '', l: '', w: '', h: '' })
  const [boxes, setBoxes] = useState<{ weight: string; l: string; w: string; h: string }[]>([emptyBox()])
  const [busy, setBusy] = useState(false)
  const [rating, setRating] = useState(false)
  const [rate, setRate] = useState<{ total: number; currency: string } | null>(null)
  useEffect(() => { setServiceCode(SERVICES[path][0].code) }, [path])
  useEffect(() => { setRate(null) }, [path, serviceCode, boxes])

  const setBox = (i: number, k: 'weight' | 'l' | 'w' | 'h', v: string) => setBoxes(p => p.map((b, j) => j === i ? { ...b, [k]: v } : b))

  function buildPackages() {
    return boxes.map(b => {
      const pkg: any = { weightValue: Number(b.weight), weightUnit: 'LBS' }
      if (b.l && b.w && b.h) Object.assign(pkg, { length: Number(b.l), width: Number(b.w), height: Number(b.h), dimUnit: 'IN' })
      return pkg
    })
  }
  async function getRate() {
    if (!boxes.every(b => Number(b.weight) > 0)) { toast.error('Enter a weight for every box'); return }
    setRating(true); setRate(null)
    try {
      const r = await api(`/api/repair-orders/${orderId}/label`, 'POST', { direction, path, serviceCode, packages: buildPackages(), rateOnly: true })
      setRate({ total: Number(r.total), currency: r.currency ?? 'USD' })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Rate failed') } finally { setRating(false) }
  }

  async function create() {
    if (!boxes.every(b => Number(b.weight) > 0)) { toast.error('Enter a weight for every box'); return }
    setBusy(true)
    try {
      const r = await api(`/api/repair-orders/${orderId}/label`, 'POST', { direction, path, serviceCode, packages: buildPackages() })
      toast.success(`Label created — ${r.pieces?.length ?? 0} piece(s)`)
      const pieces = (r.pieces ?? []) as any[]
      if (pieces.length === 1) printLabel(pieces[0].labelBase64, pieces[0].labelFormat)
      else if (pieces.length > 1) await printAllLabels(pieces.map(p => ({ labelData: p.labelBase64, labelFormat: p.labelFormat })))
      onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Label failed') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-gray-700">
          <h3 className="text-sm font-semibold">{direction === 'outbound' ? 'Outbound label → vendor' : 'Inbound label → us'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">{(['ups', 'fedex', 'ss'] as const).map(p => <button key={p} onClick={() => setPath(p)} className={clsx('flex-1 h-9 rounded-lg border text-xs font-semibold', path === p ? 'border-amazon-blue bg-blue-50 text-amazon-blue' : 'border-gray-200 text-gray-600')}>{p === 'ups' ? 'UPS' : p === 'fedex' ? 'FedEx' : 'ShipStation'}</button>)}</div>
          <div><label className="block text-[11px] text-gray-500 mb-0.5">Service</label><select className={inputCls} value={serviceCode} onChange={e => setServiceCode(e.target.value)}>{SERVICES[path].map(s => <option key={s.code} value={s.code}>{s.label}</option>)}</select></div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1.2rem_1fr_1fr_1fr_1fr_1.2rem] gap-2 text-[10px] text-gray-400 px-0.5">
              <span /><span>Weight (lb)</span><span>L (in)</span><span>W</span><span>H</span><span />
            </div>
            {boxes.map((b, i) => (
              <div key={i} className="grid grid-cols-[1.2rem_1fr_1fr_1fr_1fr_1.2rem] gap-2 items-center">
                <span className="text-[11px] text-gray-400">{i + 1}</span>
                <input type="number" step="0.1" className={inputCls} value={b.weight} onChange={e => setBox(i, 'weight', e.target.value)} />
                <input type="number" className={inputCls} value={b.l} onChange={e => setBox(i, 'l', e.target.value)} />
                <input type="number" className={inputCls} value={b.w} onChange={e => setBox(i, 'w', e.target.value)} />
                <input type="number" className={inputCls} value={b.h} onChange={e => setBox(i, 'h', e.target.value)} />
                {boxes.length > 1
                  ? <button onClick={() => setBoxes(p => p.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                  : <span />}
              </div>
            ))}
            <button onClick={() => setBoxes(p => [...p, emptyBox()])} className="text-xs text-amazon-blue hover:underline flex items-center gap-1"><Plus size={12} /> Add box</button>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 pb-4">
          <button onClick={getRate} disabled={rating || busy} className="h-9 px-3 rounded-md border border-gray-300 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-1.5">{rating ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />} Get Rate</button>
          {rate && <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{rate.currency} {rate.total.toFixed(2)}</span>}
          <button onClick={onClose} className="ml-auto h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-600">Cancel</button>
          <button onClick={create} disabled={busy} className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Create & print</button>
        </div>
      </div>
    </div>
  )
}

// ─── Vendors tab ────────────────────────────────────────────────────────────
function VendorsTab() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [locs, setLocs] = useState<LocOption[]>([])
  const emptyForm = { companyName: '', email: '', phone: '', address1: '', address2: '', city: '', state: '', postal: '', repairLocationId: '' }
  const [form, setForm] = useState<any>({ ...emptyForm })
  const [busy, setBusy] = useState(false)
  const load = () => api('/api/repair-vendors').then(setVendors).catch(() => {})
  useEffect(() => {
    load()
    // Flatten warehouses → locations for the "In Repair" location picker.
    api('/api/warehouses').then((d: { data: { name: string; locations: { id: string; name: string }[] }[] }) => {
      const flat: LocOption[] = []
      for (const w of d.data ?? []) for (const l of w.locations ?? []) flat.push({ id: l.id, label: `${w.name} — ${l.name}` })
      setLocs(flat)
    }).catch(() => {})
  }, [])
  async function add() {
    if (!form.companyName.trim()) { toast.error('Company name required'); return }
    setBusy(true)
    try { await api('/api/repair-vendors', 'POST', form); setForm({ ...emptyForm }); load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function del(id: string) { if (!confirm('Delete vendor?')) return; try { await api(`/api/repair-vendors/${id}`, 'DELETE'); load() } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } }
  async function setLocation(id: string, repairLocationId: string) {
    setVendors(vs => vs.map(v => v.id === id ? { ...v, repairLocationId: repairLocationId || null } : v))
    try { await api(`/api/repair-vendors/${id}`, 'PATCH', { repairLocationId }); toast.success('Repair location updated') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); load() }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 grid grid-cols-3 gap-2">
        <input className={inputCls} placeholder="Company name *" value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} />
        <input className={inputCls} placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <input className={inputCls} placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <input className={clsx(inputCls, 'col-span-3')} placeholder="Address line 1 (for labels)" value={form.address1} onChange={e => setForm({ ...form, address1: e.target.value })} />
        <input className={clsx(inputCls, 'col-span-3')} placeholder="Address line 2 (suite, unit, etc.)" value={form.address2} onChange={e => setForm({ ...form, address2: e.target.value })} />
        <input className={inputCls} placeholder="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        <input className={inputCls} placeholder="State" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} />
        <input className={inputCls} placeholder="ZIP" value={form.postal} onChange={e => setForm({ ...form, postal: e.target.value })} />
        <div className="col-span-2">
          <select className={clsx(inputCls, 'w-full')} value={form.repairLocationId} onChange={e => setForm({ ...form, repairLocationId: e.target.value })}>
            <option value="">In-repair location (optional)…</option>
            {locs.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <button onClick={add} disabled={busy} className="h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5 justify-center"><Plus size={14} /> Add vendor</button>
      </div>
      <p className="text-[11px] text-gray-400 -mt-2">The <strong>in-repair location</strong> is where a unit is moved when it&apos;s shipped to this vendor, so inventory reflects it&apos;s out for repair.</p>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
        {vendors.length === 0 ? <div className="px-3 py-4 text-center text-sm text-gray-400">No vendors yet.</div>
          : vendors.map(v => (
            <div key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-gray-800 dark:text-gray-200 min-w-[120px]">{v.companyName}</span>
              <span className="text-gray-400 text-xs">{v.email ?? ''} {v.phone ?? ''}</span>
              <span className="text-gray-400 text-xs">{[v.city, v.state].filter(Boolean).join(', ')}</span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
                <MapPin size={12} className="text-gray-400" />
                <select className="h-7 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 px-1.5 text-xs max-w-[180px]"
                  value={v.repairLocationId ?? ''} onChange={e => setLocation(v.id, e.target.value)}>
                  <option value="">— In-repair location —</option>
                  {locs.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
              <button onClick={() => del(v.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          ))}
      </div>
    </div>
  )
}

// ─── Repair Types tab ───────────────────────────────────────────────────────
function TypesTab() {
  const [types, setTypes] = useState<RepairType[]>([])
  const [name, setName] = useState('')
  const load = () => api('/api/repair-types').then(setTypes).catch(() => {})
  useEffect(() => { load() }, [])
  async function add() { if (!name.trim()) return; try { await api('/api/repair-types', 'POST', { name }); setName(''); load() } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } }
  async function del(id: string) { try { await api(`/api/repair-types/${id}`, 'DELETE'); load() } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } }
  return (
    <div className="max-w-md space-y-3">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="New repair type (e.g. Polishing)" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <button onClick={add} className="h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium inline-flex items-center gap-1.5 shrink-0"><Plus size={14} /> Add</button>
      </div>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
        {types.length === 0 ? <div className="px-3 py-4 text-center text-sm text-gray-400">No repair types yet.</div>
          : types.map(t => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="text-gray-800 dark:text-gray-200">{t.name}</span>
              <button onClick={() => del(t.id)} className="ml-auto text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          ))}
      </div>
    </div>
  )
}

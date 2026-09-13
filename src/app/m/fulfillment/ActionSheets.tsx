'use client'
import { useState, useEffect } from 'react'
import { X, Loader2, Check, Boxes, ScanLine, Truck } from 'lucide-react'
import {
  apiPost, orderNumber,
  type Order, type OrderInventoryData, type VerificationStatus,
} from './types'

// ─── Bottom-sheet shell ──────────────────────────────────────────────────────
export function Sheet({ title, subtitle, onClose, children, footer }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[92dvh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 truncate">{title}</h3>
            {subtitle && <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1 rounded-lg active:bg-gray-100 text-gray-500"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

function bigBtn(disabled: boolean, busy: boolean) {
  return `w-full h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 ${disabled ? 'bg-gray-200 text-gray-400' : 'bg-amazon-blue text-white active:bg-blue-700'}`
}

// ─── Process (reserve inventory) — Amazon/BM ─────────────────────────────────
interface Reservation { orderItemId: string; productId: string; locationId: string; qtyReserved: number; gradeId: string | null }

export function ProcessSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [inv, setInv] = useState<OrderInventoryData | null>(null)
  const [sel, setSel] = useState<Record<string, Reservation>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/orders/${order.id}/inventory`).then(r => r.json()).then((d: OrderInventoryData) => {
      setInv(d)
      const init: Record<string, Reservation> = {}
      for (const it of d.items) {
        if (!it.productId || it.locations.length === 0) continue
        const best = it.locations.find(l => l.qty >= it.quantityOrdered) ?? it.locations[0]
        init[it.orderItemId] = { orderItemId: it.orderItemId, productId: it.productId, locationId: best.locationId, qtyReserved: Math.min(it.quantityOrdered, best.qty), gradeId: it.gradeId ?? null }
      }
      setSel(init)
    }).catch(e => setErr(e instanceof Error ? e.message : 'Failed to load inventory')).finally(() => setLoading(false))
  }, [order.id])

  const valid = inv?.items.every(it => {
    if (!it.productId) return false
    const s = sel[it.orderItemId]; if (!s) return false
    const loc = it.locations.find(l => l.locationId === s.locationId)
    return loc && s.qtyReserved >= 1 && s.qtyReserved <= loc.qty
  }) ?? false

  async function confirm() {
    setBusy(true); setErr(null)
    try { await apiPost(`/api/orders/${order.id}/process`, { reservations: Object.values(sel) }); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to process') } finally { setBusy(false) }
  }

  return (
    <Sheet title="Process order" subtitle={orderNumber(order)} onClose={onClose}
      footer={<button disabled={!valid || busy} onClick={confirm} className={bigBtn(!valid, busy)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Boxes size={18} />} Reserve & Process</button>}>
      {loading ? <Center><Loader2 size={18} className="animate-spin" /></Center>
        : err ? <ErrBox msg={err} />
        : (
          <div className="space-y-3">
            {inv?.items.map(it => {
              const s = sel[it.orderItemId]
              const noStock = !it.productId || it.locations.length === 0
              return (
                <div key={it.orderItemId} className="rounded-xl border border-gray-200 p-3">
                  <div className="text-[13px] font-medium text-gray-800">{it.sellerSku ?? "—"}</div>
                  <div className="text-[11px] text-gray-500 truncate">{it.title}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Need {it.quantityOrdered} · Available {it.totalQtyAvailable}</div>
                  {noStock ? <div className="mt-2 text-[12px] text-red-600 font-medium">No stock / no product mapping</div> : (
                    <div className="mt-2 flex gap-2">
                      <select value={s?.locationId ?? ''} onChange={e => setSel(p => ({ ...p, [it.orderItemId]: { ...p[it.orderItemId], locationId: e.target.value } }))}
                        className="flex-1 h-10 rounded-lg border border-gray-300 px-2 text-sm">
                        {it.locations.map(l => <option key={l.locationId} value={l.locationId}>{l.warehouseName}/{l.locationName} · {l.qty}{l.gradeName ? ` · ${l.gradeName}` : ''}</option>)}
                      </select>
                      <input type="number" min={1} value={s?.qtyReserved ?? 1}
                        onChange={e => setSel(p => ({ ...p, [it.orderItemId]: { ...p[it.orderItemId], qtyReserved: parseInt(e.target.value) || 1 } }))}
                        className="w-16 h-10 rounded-lg border border-gray-300 px-2 text-sm text-center" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </Sheet>
  )
}

// ─── Verify + Serialize — Amazon/BM ──────────────────────────────────────────
export function VerifySheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<VerificationStatus | null>(null)
  const [serials, setSerials] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/orders/${order.id}/verification-status`).then(r => r.json()).then((d: VerificationStatus) => {
      setStatus(d)
      const init: Record<string, string[]> = {}
      for (const it of d.items) if (it.isSerializable) init[it.orderItemId] = it.assignedSerials.length ? [...it.assignedSerials] : Array(it.quantityOrdered).fill('')
      setSerials(init)
    }).catch(e => setErr(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false))
  }, [order.id])

  const serItems = status?.items.filter(i => i.isSerializable) ?? []
  const ready = serItems.length > 0 && serItems.every(it => (serials[it.orderItemId] ?? []).filter(s => s.trim()).length >= it.quantityOrdered)

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const assignments = serItems.map(it => ({ orderItemId: it.orderItemId, serialNumbers: (serials[it.orderItemId] ?? []).map(s => s.trim()).filter(Boolean) }))
      await apiPost(`/api/orders/${order.id}/serialize`, { assignments })
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Serialize failed') } finally { setBusy(false) }
  }

  return (
    <Sheet title="Verify & serialize" subtitle={`${orderNumber(order)}${status?.trackingNumber ? ` · ${status.trackingNumber}` : ''}`} onClose={onClose}
      footer={<button disabled={!ready || busy} onClick={submit} className={bigBtn(!ready, busy)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Confirm & Ship</button>}>
      {loading ? <Center><Loader2 size={18} className="animate-spin" /></Center>
        : err ? <ErrBox msg={err} />
        : serItems.length === 0 ? <div className="text-sm text-gray-500">No serialized items on this order.</div>
        : (
          <div className="space-y-3">
            {serItems.map(it => (
              <div key={it.orderItemId} className="rounded-xl border border-gray-200 p-3">
                <div className="text-[13px] font-medium text-gray-800">{it.internalSku ?? it.sellerSku}</div>
                <div className="text-[11px] text-gray-500 truncate mb-2">{it.title}{it.gradeName ? ` · ${it.gradeName}` : ''}</div>
                <div className="space-y-2">
                  {Array.from({ length: it.quantityOrdered }).map((_, i) => (
                    <input key={i} value={serials[it.orderItemId]?.[i] ?? ''} placeholder={`Serial ${i + 1}`}
                      autoCapitalize="characters" autoCorrect="off"
                      onChange={e => setSerials(p => { const arr = [...(p[it.orderItemId] ?? [])]; arr[i] = e.target.value; return { ...p, [it.orderItemId]: arr } })}
                      className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm font-mono" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
    </Sheet>
  )
}

// ─── Manual ship (Amazon/BM: mark shipped, no marketplace push) ──────────────
export function ManualShipSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [carrier, setCarrier] = useState(order.label?.carrier ?? '')
  const [tracking, setTracking] = useState(order.label?.trackingNumber ?? '')
  const [cost, setCost] = useState(order.label?.shipmentCost ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ready = carrier.trim() && tracking.trim()

  async function submit() {
    setBusy(true); setErr(null)
    try {
      await apiPost(`/api/orders/${order.id}/manual-ship`, { carrier: carrier.trim(), tracking: tracking.trim(), shippingCost: cost ? parseFloat(cost) : undefined })
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Ship failed') } finally { setBusy(false) }
  }

  return (
    <Sheet title="Manual ship" subtitle={orderNumber(order)} onClose={onClose}
      footer={<button disabled={!ready || busy} onClick={submit} className={bigBtn(!ready, busy)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Truck size={18} />} Mark Shipped</button>}>
      {err && <ErrBox msg={err} />}
      <div className="space-y-3">
        <Field label="Carrier"><input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="UPS / FedEx / USPS" className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue" /></Field>
        <Field label="Tracking #"><input value={tracking} onChange={e => setTracking(e.target.value)} autoCapitalize="characters" className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue font-mono" /></Field>
        <Field label="Shipping cost (optional)"><input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue" /></Field>
      </div>
    </Sheet>
  )
}

// ─── Wholesale: Process ──────────────────────────────────────────────────────
export function WholesaleProcessSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [inv, setInv] = useState<OrderInventoryData | null>(null)
  const [sel, setSel] = useState<Record<string, Reservation>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/wholesale/orders/${order.id}/inventory`).then(r => r.json()).then((d: OrderInventoryData) => {
      setInv(d)
      const init: Record<string, Reservation> = {}
      for (const it of d.items) {
        if (!it.productId || it.locations.length === 0) continue
        const best = it.locations.find(l => l.qty >= it.quantityOrdered) ?? it.locations[0]
        init[it.orderItemId] = { orderItemId: it.orderItemId, productId: it.productId, locationId: best.locationId, qtyReserved: Math.min(it.quantityOrdered, best.qty), gradeId: it.gradeId ?? null }
      }
      setSel(init)
    }).catch(e => setErr(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false))
  }, [order.id])

  const valid = inv?.items.every(it => { const s = sel[it.orderItemId]; const loc = it.locations.find(l => l.locationId === s?.locationId); return loc && s.qtyReserved >= 1 && s.qtyReserved <= loc.qty }) ?? false

  async function confirm() {
    setBusy(true); setErr(null)
    try { await apiPost(`/api/wholesale/orders/${order.id}/process`, { reservations: Object.values(sel) }); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to process') } finally { setBusy(false) }
  }

  return (
    <Sheet title="Process wholesale order" subtitle={orderNumber(order)} onClose={onClose}
      footer={<button disabled={!valid || busy} onClick={confirm} className={bigBtn(!valid, busy)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Boxes size={18} />} Reserve & Process</button>}>
      {loading ? <Center><Loader2 size={18} className="animate-spin" /></Center> : err ? <ErrBox msg={err} /> : (
        <div className="space-y-3">
          {inv?.items.map(it => {
            const s = sel[it.orderItemId]
            const noStock = !it.productId || it.locations.length === 0
            return (
              <div key={it.orderItemId} className="rounded-xl border border-gray-200 p-3">
                <div className="text-[13px] font-medium text-gray-800">{it.sellerSku ?? "—"}</div>
                <div className="text-[11px] text-gray-500 truncate">{it.title}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">Need {it.quantityOrdered} · Available {it.totalQtyAvailable}</div>
                {noStock ? <div className="mt-2 text-[12px] text-red-600 font-medium">No stock</div> : (
                  <div className="mt-2 flex gap-2">
                    <select value={s?.locationId ?? ''} onChange={e => setSel(p => ({ ...p, [it.orderItemId]: { ...p[it.orderItemId], locationId: e.target.value } }))} className="flex-1 h-10 rounded-lg border border-gray-300 px-2 text-sm">
                      {it.locations.map(l => <option key={l.locationId} value={l.locationId}>{l.warehouseName}/{l.locationName} · {l.qty}{l.gradeName ? ` · ${l.gradeName}` : ''}</option>)}
                    </select>
                    <input type="number" min={1} value={s?.qtyReserved ?? 1} onChange={e => setSel(p => ({ ...p, [it.orderItemId]: { ...p[it.orderItemId], qtyReserved: parseInt(e.target.value) || 1 } }))} className="w-16 h-10 rounded-lg border border-gray-300 px-2 text-sm text-center" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

// ─── Wholesale: Serialize (one serial box per unit) ──────────────────────────
export function WholesaleSerializeSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [serials, setSerials] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {}
    for (const it of order.items) if (it.isSerializable !== false) init[it.orderItemId] = Array(it.quantityOrdered).fill('')
    return init
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const serItems = order.items.filter(i => i.isSerializable !== false)
  const ready = serItems.every(it => (serials[it.orderItemId] ?? []).filter(s => s.trim()).length >= it.quantityOrdered)

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const payload = serItems.flatMap(it => (serials[it.orderItemId] ?? []).map(s => s.trim()).filter(Boolean).map(sn => ({ serialNumber: sn, salesOrderItemId: it.orderItemId })))
      await apiPost(`/api/wholesale/orders/${order.id}/serialize`, { serials: payload })
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Serialize failed') } finally { setBusy(false) }
  }

  return (
    <Sheet title="Serialize wholesale order" subtitle={orderNumber(order)} onClose={onClose}
      footer={<button disabled={!ready || busy} onClick={submit} className={bigBtn(!ready, busy)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <ScanLine size={18} />} Assign Serials</button>}>
      {err && <ErrBox msg={err} />}
      <div className="space-y-3">
        {serItems.map(it => (
          <div key={it.orderItemId} className="rounded-xl border border-gray-200 p-3">
            <div className="text-[13px] font-medium text-gray-800">{it.internalSku ?? it.sellerSku}</div>
            <div className="text-[11px] text-gray-500 truncate mb-2">{it.title}</div>
            <div className="space-y-2">
              {Array.from({ length: it.quantityOrdered }).map((_, i) => (
                <input key={i} value={serials[it.orderItemId]?.[i] ?? ''} placeholder={`Serial ${i + 1}`} autoCapitalize="characters" autoCorrect="off"
                  onChange={e => setSerials(p => { const arr = [...(p[it.orderItemId] ?? [])]; arr[i] = e.target.value; return { ...p, [it.orderItemId]: arr } })}
                  className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm font-mono" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

// ─── Wholesale: Ship ─────────────────────────────────────────────────────────
export function WholesaleShipSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [carrier, setCarrier] = useState(order.shipCarrier ?? '')
  const [tracking, setTracking] = useState(order.shipTracking ?? '')
  const [cost, setCost] = useState(order.actualShippingCost != null ? String(order.actualShippingCost) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ready = carrier.trim() && tracking.trim()

  async function submit() {
    setBusy(true); setErr(null)
    try { await apiPost(`/api/wholesale/orders/${order.id}/ship`, { carrier: carrier.trim(), tracking: tracking.trim(), shippingCost: cost ? parseFloat(cost) : undefined }); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Ship failed') } finally { setBusy(false) }
  }

  return (
    <Sheet title="Ship wholesale order" subtitle={orderNumber(order)} onClose={onClose}
      footer={<button disabled={!ready || busy} onClick={submit} className={bigBtn(!ready, busy)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Truck size={18} />} Mark Shipped</button>}>
      {err && <ErrBox msg={err} />}
      <div className="space-y-3">
        <Field label="Carrier"><input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="UPS / FedEx" className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue" /></Field>
        <Field label="Tracking #"><input value={tracking} onChange={e => setTracking(e.target.value)} autoCapitalize="characters" className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue font-mono" /></Field>
        <Field label="Shipping cost (optional)"><input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-full h-11 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue" /></Field>
      </div>
    </Sheet>
  )
}

// ─── small shared bits ───────────────────────────────────────────────────────
function Center({ children }: { children: React.ReactNode }) { return <div className="py-10 flex items-center justify-center text-gray-400">{children}</div> }
function ErrBox({ msg }: { msg: string }) { return <div className="mb-3 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[12px] text-red-700">{msg}</div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span><div className="mt-1">{children}</div></label>
}

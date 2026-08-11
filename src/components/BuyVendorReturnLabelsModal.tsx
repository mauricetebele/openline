'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, Loader2, Printer, AlertCircle, Package, Truck } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ──────────────────────────────────────────────────────────────────
type Carrier = 'ups' | 'fedex'

interface Warehouse {
  id: string; name: string; isDefault?: boolean
  addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null
}
interface UpsAccount { id: string; nickname: string | null; isDefault?: boolean }
interface ShipTo { name: string; company: string; address1: string; address2: string; city: string; state: string; postal: string; country: string; phone: string }
interface PkgForm { weightValue: string; weightUnit: 'LBS' | 'OZS'; length: string; width: string; height: string; dimUnit: 'IN' | 'CM' }

interface LabelRow {
  id: string; labelSetId: string; carrier: string; serviceLabel: string | null; serviceCode: string | null
  trackingNumber: string; pieceNumber: number; pieceCount: number; labelData: string; labelFormat: string
  shipmentCost: number | null; currency: string | null; createdAt: string; voided: boolean
}

const UPS_SERVICES = [
  { code: '03', label: 'UPS Ground' },
  { code: '02', label: 'UPS 2nd Day Air' },
  { code: '59', label: 'UPS 2nd Day Air A.M.' },
  { code: '12', label: 'UPS 3-Day Select' },
  { code: '13', label: 'UPS Next Day Air Saver' },
  { code: '01', label: 'UPS Next Day Air' },
  { code: '14', label: 'UPS Next Day Air Early' },
]
const FEDEX_SERVICES = [
  { code: 'FEDEX_GROUND', label: 'FedEx Ground' },
  { code: 'FEDEX_EXPRESS_SAVER', label: 'FedEx Express Saver' },
  { code: 'FEDEX_2_DAY', label: 'FedEx 2Day' },
  { code: 'FEDEX_2_DAY_AM', label: 'FedEx 2Day A.M.' },
  { code: 'STANDARD_OVERNIGHT', label: 'FedEx Standard Overnight' },
  { code: 'PRIORITY_OVERNIGHT', label: 'FedEx Priority Overnight' },
  { code: 'FIRST_OVERNIGHT', label: 'FedEx First Overnight' },
]

const emptyPkg = (): PkgForm => ({ weightValue: '', weightUnit: 'LBS', length: '', width: '', height: '', dimUnit: 'IN' })

function openLabel(base64: string, format: string) {
  const mime = format === 'pdf' ? 'application/pdf' : `image/${format}`
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([arr], { type: mime }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const money = (n: number | null, cur?: string | null) => (n != null ? `${cur === 'USD' || !cur ? '$' : cur + ' '}${n.toFixed(2)}` : '—')

export default function BuyVendorReturnLabelsModal({ rmaId, rmaNumber, defaultShipTo, onClose, onPurchased }: {
  rmaId: string; rmaNumber: string; defaultShipTo: ShipTo; onClose: () => void; onPurchased: () => void
}) {
  const [carrier, setCarrier] = useState<Carrier>('ups')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [upsAccounts, setUpsAccounts] = useState<UpsAccount[]>([])
  const [upsAccountId, setUpsAccountId] = useState('')
  const [serviceCode, setServiceCode] = useState(UPS_SERVICES[0].code)
  const [confirmation, setConfirmation] = useState<'none' | 'delivery' | 'signature' | 'adult_signature'>('none')
  const [shipTo, setShipTo] = useState<ShipTo>(defaultShipTo)
  const [packages, setPackages] = useState<PkgForm[]>([emptyPkg()])
  const [buying, setBuying] = useState(false)
  const [err, setErr] = useState('')
  const [history, setHistory] = useState<LabelRow[]>([])

  const services = carrier === 'ups' ? UPS_SERVICES : FEDEX_SERVICES

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`/api/vendor-rma/${rmaId}/labels`).then(x => x.json())
      setHistory(r.data ?? [])
    } catch { /* ignore */ }
  }, [rmaId])

  useEffect(() => {
    fetch('/api/warehouses').then(r => r.json()).then(d => {
      const whs: Warehouse[] = d.data ?? []
      setWarehouses(whs)
      setWarehouseId((whs.find(w => w.isDefault) ?? whs[0])?.id ?? '')
    }).catch(() => {})
    fetch('/api/ups/credentials').then(r => r.json()).then(d => {
      const accts: UpsAccount[] = d.accounts ?? []
      setUpsAccounts(accts)
      setUpsAccountId((accts.find(a => a.isDefault) ?? accts[0])?.id ?? '')
    }).catch(() => {})
    loadHistory()
  }, [loadHistory])

  // Keep the service valid when switching carriers.
  function switchCarrier(c: Carrier) {
    setCarrier(c)
    setServiceCode((c === 'ups' ? UPS_SERVICES : FEDEX_SERVICES)[0].code)
  }

  function setPkg(i: number, patch: Partial<PkgForm>) {
    setPackages(p => p.map((pk, idx) => idx === i ? { ...pk, ...patch } : pk))
  }

  const shipFromWh = warehouses.find(w => w.id === warehouseId)
  const shipToComplete = shipTo.address1.trim() && shipTo.city.trim() && shipTo.state.trim() && shipTo.postal.trim()
  const pkgsComplete = packages.every(p => Number(p.weightValue) > 0)
  const canBuy = !!warehouseId && !!serviceCode && shipToComplete && pkgsComplete && packages.length > 0 && !buying

  async function buy() {
    setErr('')
    if (!canBuy) { setErr('Fill in the ship-from warehouse, ship-to address, service, and a weight for each package.'); return }
    setBuying(true)
    try {
      const res = await fetch(`/api/vendor-rma/${rmaId}/labels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier,
          ...(carrier === 'ups' ? { upsCredentialId: upsAccountId || undefined } : {}),
          warehouseId, serviceCode, confirmation,
          shipTo,
          packages: packages.map(p => ({
            weightValue: Number(p.weightValue), weightUnit: p.weightUnit,
            length: p.length ? Number(p.length) : undefined, width: p.width ? Number(p.width) : undefined,
            height: p.height ? Number(p.height) : undefined, dimUnit: p.dimUnit,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Label purchase failed')
      // Open each new label for printing, refresh history + parent.
      for (const pc of (data.pieces ?? []) as LabelRow[]) openLabel(pc.labelData, pc.labelFormat)
      setPackages([emptyPkg()])
      await loadHistory()
      onPurchased()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Label purchase failed')
    } finally {
      setBuying(false)
    }
  }

  // Group history into label sets.
  const sets = useMemo(() => {
    const m = new Map<string, LabelRow[]>()
    for (const l of history) { const a = m.get(l.labelSetId) ?? []; a.push(l); m.set(l.labelSetId, a) }
    return Array.from(m.values()).map(rows => rows.sort((a, b) => a.pieceNumber - b.pieceNumber))
  }, [history])

  const field = 'w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-amazon-blue" />
            <h2 className="text-sm font-semibold text-gray-900">Buy Return Labels — {rmaNumber}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {err && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={14} className="shrink-0" /><span className="flex-1">{err}</span>
              <button onClick={() => setErr('')} className="hover:text-red-900"><X size={14} /></button>
            </div>
          )}

          {/* Carrier */}
          <div className="flex gap-2">
            {(['ups', 'fedex'] as const).map(c => (
              <button key={c} type="button" onClick={() => switchCarrier(c)}
                className={clsx('h-9 px-4 rounded-md text-sm font-medium border', carrier === c ? 'bg-amazon-blue text-white border-amazon-blue' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')}>
                {c === 'ups' ? 'UPS Direct' : 'FedEx Direct'}
              </button>
            ))}
          </div>

          {/* Ship-from + account + service */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ship from (warehouse)</label>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={field}>
                <option value="">Select…</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}{w.isDefault ? ' (default)' : ''}</option>)}
              </select>
              {shipFromWh && !shipFromWh.addressLine1 && <p className="text-[11px] text-red-500 mt-1">This warehouse has no address — add it on the Warehouses page.</p>}
            </div>
            {carrier === 'ups' && upsAccounts.length > 1 ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">UPS account</label>
                <select value={upsAccountId} onChange={e => setUpsAccountId(e.target.value)} className={field}>
                  {upsAccounts.map(a => <option key={a.id} value={a.id}>{a.nickname ?? 'UPS account'}{a.isDefault ? ' (default)' : ''}</option>)}
                </select>
              </div>
            ) : <div />}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Service</label>
              <select value={serviceCode} onChange={e => setServiceCode(e.target.value)} className={field}>
                {services.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Delivery confirmation</label>
              <select value={confirmation} onChange={e => setConfirmation(e.target.value as typeof confirmation)} className={field}>
                <option value="none">None</option>
                <option value="delivery">Delivery confirmation</option>
                <option value="signature">Signature required</option>
                <option value="adult_signature">Adult signature</option>
              </select>
            </div>
          </div>

          {/* Ship-to (auto-filled from vendor RMA address) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ship to — vendor RMA address <span className="text-gray-400 font-normal">(auto-filled; editable)</span></label>
            <div className="grid grid-cols-2 gap-2">
              <input className={field} placeholder="Attention / Name" value={shipTo.name} onChange={e => setShipTo(s => ({ ...s, name: e.target.value }))} />
              <input className={field} placeholder="Company" value={shipTo.company} onChange={e => setShipTo(s => ({ ...s, company: e.target.value }))} />
              <input className={clsx(field, 'col-span-2')} placeholder="Address 1" value={shipTo.address1} onChange={e => setShipTo(s => ({ ...s, address1: e.target.value }))} />
              <input className={clsx(field, 'col-span-2')} placeholder="Address 2" value={shipTo.address2} onChange={e => setShipTo(s => ({ ...s, address2: e.target.value }))} />
              <input className={field} placeholder="City" value={shipTo.city} onChange={e => setShipTo(s => ({ ...s, city: e.target.value }))} />
              <div className="grid grid-cols-3 gap-2">
                <input className={field} placeholder="State" value={shipTo.state} onChange={e => setShipTo(s => ({ ...s, state: e.target.value }))} />
                <input className={field} placeholder="ZIP" value={shipTo.postal} onChange={e => setShipTo(s => ({ ...s, postal: e.target.value }))} />
                <input className={field} placeholder="Country" value={shipTo.country} onChange={e => setShipTo(s => ({ ...s, country: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Packages */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600">Packages <span className="text-gray-400 font-normal">(one label per package)</span></label>
              <button type="button" onClick={() => setPackages(p => [...p, emptyPkg()])} className="inline-flex items-center gap-1 text-xs font-medium text-amazon-blue hover:underline"><Plus size={12} /> Add package</button>
            </div>
            <div className="space-y-2">
              {packages.map((p, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-2">
                  <Package size={14} className="text-gray-400 shrink-0" />
                  <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                  <input className="w-20 h-9 rounded-md border border-gray-300 px-2 text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue" placeholder="Wt" type="number" step="0.1" min={0} value={p.weightValue} onChange={e => setPkg(i, { weightValue: e.target.value })} />
                  <select className="h-9 rounded-md border border-gray-300 px-1 text-xs" value={p.weightUnit} onChange={e => setPkg(i, { weightUnit: e.target.value as 'LBS' | 'OZS' })}><option value="LBS">lbs</option><option value="OZS">oz</option></select>
                  <span className="text-gray-300 text-xs">·</span>
                  <input className="w-14 h-9 rounded-md border border-gray-300 px-1.5 text-sm text-center font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue" placeholder="L" type="number" min={0} value={p.length} onChange={e => setPkg(i, { length: e.target.value })} />
                  <span className="text-gray-300">×</span>
                  <input className="w-14 h-9 rounded-md border border-gray-300 px-1.5 text-sm text-center font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue" placeholder="W" type="number" min={0} value={p.width} onChange={e => setPkg(i, { width: e.target.value })} />
                  <span className="text-gray-300">×</span>
                  <input className="w-14 h-9 rounded-md border border-gray-300 px-1.5 text-sm text-center font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue" placeholder="H" type="number" min={0} value={p.height} onChange={e => setPkg(i, { height: e.target.value })} />
                  <select className="h-9 rounded-md border border-gray-300 px-1 text-xs" value={p.dimUnit} onChange={e => setPkg(i, { dimUnit: e.target.value as 'IN' | 'CM' })}><option value="IN">in</option><option value="CM">cm</option></select>
                  <div className="flex-1" />
                  {packages.length > 1 && <button type="button" onClick={() => setPackages(pp => pp.filter((_, idx) => idx !== i))} className="p-1.5 text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Dimensions optional. FedEx bills by weight in lbs (oz is converted).</p>
          </div>

          {/* Purchased sets */}
          {sets.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Purchased labels</p>
              <div className="space-y-2">
                {sets.map(rows => {
                  const head = rows[0]
                  return (
                    <div key={head.labelSetId} className={clsx('rounded-md border px-3 py-2', head.voided ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200')}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-gray-700">{head.carrier.toUpperCase()}</span>
                        <span className="text-xs text-gray-500">{head.serviceLabel ?? head.serviceCode}</span>
                        <span className="text-[11px] text-gray-400">{rows.length} piece{rows.length !== 1 ? 's' : ''}</span>
                        <span className="text-[11px] text-gray-400">{new Date(head.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        <div className="flex-1" />
                        <span className="text-xs font-medium text-gray-600">{money(head.shipmentCost, head.currency)}</span>
                      </div>
                      <div className="space-y-1">
                        {rows.map(pc => (
                          <div key={pc.id} className="flex items-center gap-2 text-xs">
                            <span className="text-gray-400 w-10">#{pc.pieceNumber}/{pc.pieceCount}</span>
                            <span className="font-mono text-gray-800">{pc.trackingNumber}</span>
                            <div className="flex-1" />
                            <button type="button" onClick={() => openLabel(pc.labelData, pc.labelFormat)} className="inline-flex items-center gap-1 text-amazon-blue hover:underline"><Printer size={12} /> Print</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Close</button>
          <button onClick={buy} disabled={!canBuy} className="inline-flex items-center gap-1.5 h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50">
            {buying ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
            {buying ? 'Generating…' : `Buy ${packages.length} label${packages.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

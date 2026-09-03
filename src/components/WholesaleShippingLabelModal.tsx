'use client'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Printer, Truck, CheckCircle2, MapPin, Plus, Trash2, Copy, RefreshCw } from 'lucide-react'

type Carrier = 'UPS' | 'FEDEX'

// Mirrors UPS_SERVICES in src/lib/ups-tracking.ts (static list).
const UPS_SERVICES = [
  { code: '03', label: 'UPS Ground' },
  { code: '02', label: 'UPS 2nd Day Air' },
  { code: '59', label: 'UPS 2nd Day Air A.M.' },
  { code: '13', label: 'UPS Next Day Air Saver' },
  { code: '01', label: 'UPS Next Day Air' },
  { code: '14', label: 'UPS Next Day Air Early' },
  { code: '12', label: 'UPS 3-Day Select' },
]

// Common FedEx services (subset of SERVICE_NAMES in src/lib/fedex/client.ts).
const FEDEX_SERVICES = [
  { code: 'FEDEX_GROUND', label: 'FedEx Ground' },
  { code: 'FEDEX_EXPRESS_SAVER', label: 'FedEx Express Saver' },
  { code: 'FEDEX_2_DAY', label: 'FedEx 2Day' },
  { code: 'FEDEX_2_DAY_AM', label: 'FedEx 2Day AM' },
  { code: 'STANDARD_OVERNIGHT', label: 'FedEx Standard Overnight' },
  { code: 'PRIORITY_OVERNIGHT', label: 'FedEx Priority Overnight' },
  { code: 'FIRST_OVERNIGHT', label: 'FedEx First Overnight' },
]

const SERVICES: Record<Carrier, { code: string; label: string }[]> = { UPS: UPS_SERVICES, FEDEX: FEDEX_SERVICES }
const DEFAULT_SERVICE: Record<Carrier, string> = { UPS: '03', FEDEX: 'FEDEX_GROUND' }

// Our warehouse origin (matches RETURN_ADDRESS in ups-tracking.ts).
const SHIP_FROM = 'PRIME MOBILITY FBM RETURNS · 20 MERIDIAN RD, UNIT 2, EATONTOWN, NJ 07724'

interface CustomerAddress {
  id: string; type: string; label: string
  addressLine1: string; addressLine2: string | null
  city: string; state: string; postalCode: string; country: string; isDefault: boolean
}
interface ShipTo { name: string; company: string; address1: string; address2: string; city: string; state: string; postal: string; country: string }
interface UpsAccount { id: string; nickname?: string; accountNumber?: string; isDefault?: boolean }
interface PkgForm { key: string; weightValue: string; weightUnit: 'LBS' | 'OZS'; length: string; width: string; height: string }
interface Piece { labelId: string; trackingNumber: string; labelBase64: string; labelFormat: string }

const blankShipTo: ShipTo = { name: '', company: '', address1: '', address2: '', city: '', state: '', postal: '', country: 'US' }
let pkgKey = 0
const emptyPkg = (): PkgForm => ({ key: `p${++pkgKey}`, weightValue: '', weightUnit: 'LBS', length: '', width: '', height: '' })

function toShipTo(a: { addressLine1?: string; addressLine2?: string | null; city?: string; state?: string; postalCode?: string; country?: string }, name: string, company: string): ShipTo {
  return { name, company, address1: a.addressLine1 ?? '', address2: a.addressLine2 ?? '', city: a.city ?? '', state: a.state ?? '', postal: a.postalCode ?? '', country: a.country ?? 'US' }
}

function openLabel(base64: string, format: string) {
  const isPdf = String(format ?? 'pdf').toLowerCase() === 'pdf'
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: isPdf ? 'application/pdf' : 'image/png' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) toast.error('Pop-up blocked — allow pop-ups and try again')
  else setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function WholesaleShippingLabelModal({ orderId, onClose, onCreated }: {
  orderId: string
  onClose: () => void
  onCreated?: (r: { carrier: string; trackingNumber: string; shipmentCost?: string; currency?: string }) => void
}) {
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [orderShipTo, setOrderShipTo] = useState<ShipTo | null>(null)

  const [choice, setChoice] = useState<string>('')
  const [shipTo, setShipTo] = useState<ShipTo>(blankShipTo)
  const [shipToPhone, setShipToPhone] = useState('')

  const [carrier, setCarrier] = useState<Carrier>('UPS')
  const [upsAccounts, setUpsAccounts] = useState<UpsAccount[]>([])
  const [accountId, setAccountId] = useState('')

  const [serviceCode, setServiceCode] = useState('03')
  const [confirmation, setConfirmation] = useState<'none' | 'delivery' | 'signature' | 'adult_signature'>('none')
  const [packages, setPackages] = useState<PkgForm[]>([emptyPkg()])

  const [generating, setGenerating] = useState(false); const [genErr, setGenErr] = useState('')
  const [result, setResult] = useState<{ carrier: string; masterTracking: string; shipmentCost?: string; currency?: string; pieces: Piece[] } | null>(null)

  const [rate, setRate] = useState<{ total: number; currency: string } | null>(null)
  const [fetchingRate, setFetchingRate] = useState(false); const [ratingErr, setRatingErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [oRes, uRes] = await Promise.all([
          fetch(`/api/wholesale/orders/${orderId}`),
          fetch('/api/ups/credentials'),
        ])
        const order = await oRes.json()
        if (!oRes.ok) throw new Error(order.error ?? 'Failed to load order')
        if (cancelled) return

        const company = order?.customer?.companyName ?? ''
        const contact = order?.customer?.contactName ?? ''
        setOrderNumber(order?.orderNumber ?? '')
        setCompanyName(company); setContactName(contact)
        if (order?.customer?.phone) setShipToPhone(order.customer.phone)
        const shipAddrs: CustomerAddress[] = (order?.customer?.addresses ?? []).filter((a: CustomerAddress) => a.type === 'SHIPPING')
        setAddresses(shipAddrs)

        const snap = order?.shippingAddress
        const snapShipTo = snap && snap.addressLine1 ? toShipTo(snap, contact, company) : null
        setOrderShipTo(snapShipTo)

        if (snapShipTo) { setChoice('order'); setShipTo(snapShipTo) }
        else if (shipAddrs.length) {
          const def = shipAddrs.find(a => a.isDefault) ?? shipAddrs[0]
          setChoice(def.id); setShipTo(toShipTo(def, contact, company))
        } else { setChoice('manual'); setShipTo({ ...blankShipTo, name: contact, company }) }

        try {
          const u = await uRes.json()
          const accts: UpsAccount[] = u.accounts ?? []
          setUpsAccounts(accts)
          const def = accts.find(a => a.isDefault) ?? accts[0]
          if (def) setAccountId(def.id)
        } catch { /* accounts optional */ }
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Failed to load order')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [orderId])

  function onChoice(value: string) {
    setChoice(value)
    if (value === 'order' && orderShipTo) setShipTo(orderShipTo)
    else if (value === 'manual') setShipTo({ ...blankShipTo, name: contactName, company: companyName })
    else { const a = addresses.find(x => x.id === value); if (a) setShipTo(toShipTo(a, contactName, companyName)) }
  }

  const patch = (over: Partial<ShipTo>) => setShipTo(prev => ({ ...prev, ...over }))
  const setPkg = (key: string, over: Partial<PkgForm>) => setPackages(prev => prev.map(p => p.key === key ? { ...p, ...over } : p))
  // Duplicate a box (same weight & dims) right after it.
  const copyPkg = (key: string) => setPackages(prev => {
    const i = prev.findIndex(p => p.key === key)
    if (i < 0) return prev
    return [...prev.slice(0, i + 1), { ...prev[i], key: `p${++pkgKey}` }, ...prev.slice(i + 1)]
  })

  function switchCarrier(c: Carrier) { setCarrier(c); setServiceCode(DEFAULT_SERVICE[c]) }

  const addressComplete = !!((shipTo.name.trim() || shipTo.company.trim()) && shipTo.address1.trim() && shipTo.city.trim() && shipTo.state.trim() && shipTo.postal.trim())
  const pkgsComplete = packages.length > 0 && packages.every(p => Number(p.weightValue) > 0)
  const canGenerate = addressComplete && pkgsComplete && !!serviceCode && !generating

  // Rate is only valid for the current inputs — clear it when anything changes.
  useEffect(() => { setRate(null); setRatingErr('') }, [carrier, serviceCode, packages, shipTo, accountId])

  function buildBody() {
    return {
      carrier,
      shipFromName: shipTo.name.trim(), shipFromCompany: shipTo.company.trim(),
      shipFromAddress1: shipTo.address1.trim(), shipFromAddress2: shipTo.address2.trim(),
      shipFromCity: shipTo.city.trim(), shipFromState: shipTo.state.trim(), shipFromPostal: shipTo.postal.trim(),
      shipFromCountry: shipTo.country.trim() || 'US',
      shipToPhone: shipToPhone.trim() || undefined,
      serviceCode,
      ...(confirmation !== 'none' ? { confirmation } : {}),
      referenceNumber: orderNumber || undefined,
      ...(carrier === 'UPS' && accountId ? { upsCredentialId: accountId } : {}),
      packages: packages.map(p => ({
        weightValue: Number(p.weightValue), weightUnit: p.weightUnit,
        ...(p.length && p.width && p.height ? { length: Number(p.length), width: Number(p.width), height: Number(p.height), dimUnit: 'IN' } : {}),
      })),
    }
  }

  async function fetchRate() {
    if (!addressComplete || !pkgsComplete) { setRatingErr('Enter a complete ship-to address and a weight for each box'); return }
    setFetchingRate(true); setRatingErr(''); setRate(null)
    try {
      const res = await fetch(`/api/wholesale/orders/${orderId}/shipping-label/rate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody()) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Rate quote failed')
      setRate({ total: Number(data.total), currency: data.currency ?? 'USD' })
    } catch (e) { setRatingErr(e instanceof Error ? e.message : 'Could not fetch rate') }
    finally { setFetchingRate(false) }
  }

  async function generate() {
    if (!canGenerate) return
    setGenerating(true); setGenErr('')
    try {
      const res = await fetch(`/api/wholesale/orders/${orderId}/shipping-label`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody()) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Label generation failed')
      setResult(data)
      toast.success(`${data.pieces?.length ?? 1} label${(data.pieces?.length ?? 1) > 1 ? 's' : ''} created`)
      onCreated?.({ carrier: data.carrier ?? (carrier === 'FEDEX' ? 'FedEx' : 'UPS'), trackingNumber: data.masterTracking, shipmentCost: data.shipmentCost, currency: data.currency })
    } catch (e) { setGenErr(e instanceof Error ? e.message : 'Label generation failed') }
    finally { setGenerating(false) }
  }

  const inputCls = 'w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500'
  const labelCls = 'block text-[10px] font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Truck size={15} className="text-emerald-600" /> Shipping Label</h3>
            {orderNumber && <p className="text-xs text-gray-500 font-mono mt-0.5">{orderNumber}{companyName ? ` · ${companyName}` : ''}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading order…</div>
        ) : loadErr ? (
          <div className="py-20 text-center text-sm text-red-500">{loadErr}</div>
        ) : result ? (
          // ── Done ──
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 size={18} /> <p className="text-sm font-semibold">{result.pieces.length} label{result.pieces.length > 1 ? 's' : ''} created</p></div>
            <div className="rounded-lg border border-gray-200 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Master tracking</span><span className="font-mono font-semibold">{result.masterTracking}</span></div>
              {result.shipmentCost && <div className="flex justify-between"><span className="text-gray-500">Cost</span><span className="font-semibold">${parseFloat(result.shipmentCost).toFixed(2)} {result.currency ?? 'USD'}</span></div>}
            </div>
            <div className="space-y-1.5">
              {result.pieces.map((p, i) => (
                <div key={p.labelId} className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2">
                  <span className="text-xs"><span className="text-gray-400">Box {i + 1}</span> <span className="font-mono text-gray-700">{p.trackingNumber}</span></span>
                  <button onClick={() => openLabel(p.labelBase64, p.labelFormat)} className="inline-flex items-center gap-1 text-xs font-semibold text-amazon-blue hover:underline"><Printer size={13} /> Open</button>
                </div>
              ))}
            </div>
            <button onClick={() => result.pieces.forEach(p => openLabel(p.labelBase64, p.labelFormat))}
              className="w-full flex items-center justify-center gap-1.5 h-10 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"><Printer size={15} /> Open / Print All Labels</button>
            <div className="flex gap-2">
              <button onClick={() => { setResult(null) }} className="flex-1 h-9 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Create Another</button>
              <button onClick={onClose} className="flex-1 h-9 rounded-md bg-gray-800 text-white text-sm font-medium hover:bg-gray-900">Done</button>
            </div>
          </div>
        ) : (
          // ── Form ──
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Carrier */}
            <div>
              <label className={labelCls}>Carrier</label>
              <div className="grid grid-cols-2 gap-2">
                {(['UPS', 'FEDEX'] as Carrier[]).map(c => (
                  <button key={c} type="button" onClick={() => switchCarrier(c)}
                    className={'h-9 rounded-md border-2 text-sm font-semibold transition ' + (carrier === c ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300')}>
                    {c === 'UPS' ? 'UPS' : 'FedEx'}
                  </button>
                ))}
              </div>
            </div>

            {/* Ship from */}
            <div className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-3 py-2 flex items-start gap-1.5">
              <MapPin size={12} className="mt-0.5 shrink-0 text-gray-400" /><span><span className="font-semibold text-gray-600">Ship from:</span> {SHIP_FROM}</span>
            </div>

            {/* Address selector */}
            <div>
              <label className={labelCls}>Ship to — select address</label>
              <select value={choice} onChange={e => onChoice(e.target.value)} className={inputCls}>
                {orderShipTo && <option value="order">Order ship-to{orderShipTo.city ? ` — ${orderShipTo.city}, ${orderShipTo.state}` : ''}</option>}
                {addresses.map(a => <option key={a.id} value={a.id}>{a.label}{a.isDefault ? ' (default)' : ''} — {a.city}, {a.state}</option>)}
                <option value="manual">Manual entry…</option>
              </select>
            </div>

            {/* Editable ship-to */}
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Name</label>
                <input className={inputCls} value={shipTo.name} onChange={e => patch({ name: e.target.value })} placeholder="Contact name" /></div>
              <div><label className={labelCls}>Company Name</label>
                <input className={inputCls} value={shipTo.company} onChange={e => patch({ company: e.target.value })} placeholder="Company" /></div>
              <div className="col-span-2"><label className={labelCls}>Address Line 1 <span className="text-red-500">*</span></label>
                <input className={inputCls} value={shipTo.address1} onChange={e => patch({ address1: e.target.value })} /></div>
              <div className="col-span-2"><label className={labelCls}>Address Line 2</label>
                <input className={inputCls} value={shipTo.address2} onChange={e => patch({ address2: e.target.value })} /></div>
              <div><label className={labelCls}>City <span className="text-red-500">*</span></label>
                <input className={inputCls} value={shipTo.city} onChange={e => patch({ city: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>State <span className="text-red-500">*</span></label>
                  <input className={inputCls} value={shipTo.state} onChange={e => patch({ state: e.target.value })} maxLength={2} /></div>
                <div><label className={labelCls}>ZIP <span className="text-red-500">*</span></label>
                  <input className={inputCls} value={shipTo.postal} onChange={e => patch({ postal: e.target.value })} /></div>
              </div>
              <div><label className={labelCls}>Country</label>
                <input className={inputCls} value={shipTo.country} onChange={e => patch({ country: e.target.value })} /></div>
              <div className="col-span-2"><label className={labelCls}>Phone <span className="text-gray-400 font-normal">(used for FedEx)</span></label>
                <input className={inputCls} value={shipToPhone} onChange={e => setShipToPhone(e.target.value)} placeholder="Recipient phone" /></div>
            </div>

            {/* Service + account + confirmation */}
            <div className="border-t pt-3 space-y-2">
              {carrier === 'UPS' && upsAccounts.length > 1 && (
                <div><label className={labelCls}>UPS Account</label>
                  <select className={inputCls} value={accountId} onChange={e => setAccountId(e.target.value)}>
                    {upsAccounts.map(a => <option key={a.id} value={a.id}>{a.nickname ?? a.accountNumber ?? a.id}{a.isDefault ? ' (default)' : ''}</option>)}
                  </select></div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>{carrier === 'FEDEX' ? 'FedEx' : 'UPS'} Service <span className="text-red-500">*</span></label>
                  <select className={inputCls} value={serviceCode} onChange={e => setServiceCode(e.target.value)}>
                    {SERVICES[carrier].map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select></div>
                <div><label className={labelCls}>Delivery Confirmation</label>
                  <select className={inputCls} value={confirmation} onChange={e => setConfirmation(e.target.value as typeof confirmation)}>
                    <option value="none">None</option>
                    <option value="delivery">Delivery confirmation</option>
                    <option value="signature">Signature required</option>
                    <option value="adult_signature">Adult signature</option>
                  </select></div>
              </div>
            </div>

            {/* Boxes */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Boxes ({packages.length})</label>
                <button type="button" onClick={() => setPackages(p => [...p, emptyPkg()])} className="inline-flex items-center gap-1 text-xs font-medium text-amazon-blue hover:underline"><Plus size={12} /> Add box</button>
              </div>
              <div className="space-y-2">
                {packages.map((p, i) => (
                  <div key={p.key} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1.5">
                    <span className="text-[11px] text-gray-400 w-9 shrink-0">Box {i + 1}</span>
                    <input className="w-16 h-8 rounded border border-gray-300 px-2 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="Wt" type="number" step="0.1" min={0} value={p.weightValue} onChange={e => setPkg(p.key, { weightValue: e.target.value })} />
                    <select className="h-8 rounded border border-gray-300 px-1 text-[11px]" value={p.weightUnit} onChange={e => setPkg(p.key, { weightUnit: e.target.value as 'LBS' | 'OZS' })}><option value="LBS">lbs</option><option value="OZS">oz</option></select>
                    <span className="text-gray-300 text-xs">·</span>
                    <input className="w-11 h-8 rounded border border-gray-300 px-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="L" type="number" min={0} value={p.length} onChange={e => setPkg(p.key, { length: e.target.value })} />
                    <input className="w-11 h-8 rounded border border-gray-300 px-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="W" type="number" min={0} value={p.width} onChange={e => setPkg(p.key, { width: e.target.value })} />
                    <input className="w-11 h-8 rounded border border-gray-300 px-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="H" type="number" min={0} value={p.height} onChange={e => setPkg(p.key, { height: e.target.value })} />
                    <button type="button" onClick={() => copyPkg(p.key)} title="Copy box (same weight & dims)" className="p-1 text-gray-300 hover:text-amazon-blue shrink-0"><Copy size={13} /></button>
                    {packages.length > 1 && <button type="button" onClick={() => setPackages(pp => pp.filter(x => x.key !== p.key))} title="Remove box" className="p-1 text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Weight required per box; dimensions (L×W×H in) optional. One label is created per box.</p>
            </div>

            {/* Rate */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <button type="button" onClick={fetchRate} disabled={fetchingRate}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amazon-blue hover:underline disabled:opacity-40">
                  {fetchingRate ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Get rate ({packages.length} box{packages.length > 1 ? 'es' : ''})
                </button>
                {rate && <span className="text-sm font-semibold text-gray-900">${rate.total.toFixed(2)} <span className="text-xs font-normal text-gray-400">{rate.currency}</span></span>}
              </div>
              {ratingErr && <p className="text-[11px] text-red-500 mt-1">{ratingErr}</p>}
            </div>

            {genErr && <p className="text-xs text-red-500">{genErr}</p>}
          </div>
        )}

        {!loading && !loadErr && !result && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={generate} disabled={!canGenerate}
              className="inline-flex items-center gap-1.5 h-9 px-5 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40">
              {generating ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />} Generate {packages.length > 1 ? `${packages.length} Labels` : 'Label'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

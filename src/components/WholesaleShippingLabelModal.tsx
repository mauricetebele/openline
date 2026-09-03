'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Printer, Truck, RefreshCw, CheckCircle2, MapPin } from 'lucide-react'

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
const SHIP_FROM_RATE = { postal: '07724', city: 'EATONTOWN', state: 'NJ', country: 'US' }

interface CustomerAddress {
  id: string; type: string; label: string
  addressLine1: string; addressLine2: string | null
  city: string; state: string; postalCode: string; country: string; isDefault: boolean
}
interface ShipTo { name: string; address1: string; address2: string; city: string; state: string; postal: string; country: string }
interface UpsAccount { id: string; nickname?: string; accountNumber?: string; isDefault?: boolean }
interface LabelResult { trackingNumber: string; labelBase64: string; labelFormat: string; shipmentCost?: string; currency?: string; labelId?: string }

const blankShipTo: ShipTo = { name: '', address1: '', address2: '', city: '', state: '', postal: '', country: 'US' }

function toShipTo(a: { addressLine1?: string; addressLine2?: string | null; city?: string; state?: string; postalCode?: string; country?: string }, name: string): ShipTo {
  return {
    name,
    address1: a.addressLine1 ?? '',
    address2: a.addressLine2 ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    postal: a.postalCode ?? '',
    country: a.country ?? 'US',
  }
}

function PrintPreview({ base64, format, onClose }: { base64: string; format: string; onClose: () => void }) {
  const isPdf = format.toLowerCase() === 'pdf'
  const dataUrl = isPdf ? `data:application/pdf;base64,${base64}` : `data:image/${format.toLowerCase()};base64,${base64}`
  const handlePrint = () => {
    const win = window.open(dataUrl, '_blank')
    if (!win) toast.error('Pop-up blocked — allow pop-ups and try again')
  }
  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-gray-50">
        <p className="text-sm font-semibold text-gray-700">Shipping Label</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-8 px-4 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-100">Close</button>
          <button onClick={handlePrint} className="flex items-center gap-1.5 h-8 px-4 rounded bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"><Printer size={14} /> Print</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <iframe src={dataUrl} title="Shipping Label" style={{ width: '100%', height: '100%', border: 'none', minHeight: '80vh' }} />
      </div>
    </div>
  )
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
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [orderShipTo, setOrderShipTo] = useState<ShipTo | null>(null)

  const [choice, setChoice] = useState<string>('') // 'order' | address.id | 'manual'
  const [shipTo, setShipTo] = useState<ShipTo>(blankShipTo)
  const [shipToPhone, setShipToPhone] = useState('')

  const [carrier, setCarrier] = useState<Carrier>('UPS')
  const [upsAccounts, setUpsAccounts] = useState<UpsAccount[]>([])
  const [accountId, setAccountId] = useState('')

  const [serviceCode, setServiceCode] = useState('03')
  const [weight, setWeight] = useState('')
  const [weightUnit, setWeightUnit] = useState<'LBS' | 'OZS'>('LBS')
  const [length, setLength] = useState(''); const [width, setWidth] = useState(''); const [height, setHeight] = useState('')
  const [confirmation, setConfirmation] = useState<'none' | 'delivery' | 'signature' | 'adult_signature'>('none')

  const [rate, setRate] = useState<{ publishedRate: string; negotiatedRate: string | null; currency: string } | null>(null)
  const [ratingErr, setRatingErr] = useState(''); const [fetchingRate, setFetchingRate] = useState(false)

  const [generating, setGenerating] = useState(false); const [genErr, setGenErr] = useState('')
  const [result, setResult] = useState<LabelResult | null>(null)
  const [preview, setPreview] = useState<{ base64: string; format: string } | null>(null)

  // Load the full order (customer addresses + snapshot) and UPS accounts.
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
        setOrderNumber(order?.orderNumber ?? '')
        setCompanyName(company)
        if (order?.customer?.phone) setShipToPhone(order.customer.phone)
        const shipAddrs: CustomerAddress[] = (order?.customer?.addresses ?? []).filter((a: CustomerAddress) => a.type === 'SHIPPING')
        setAddresses(shipAddrs)

        const snap = order?.shippingAddress
        const snapShipTo = snap && snap.addressLine1 ? toShipTo(snap, company) : null
        setOrderShipTo(snapShipTo)

        // Default selection: order snapshot → default shipping addr → first → manual
        if (snapShipTo) { setChoice('order'); setShipTo(snapShipTo) }
        else if (shipAddrs.length) {
          const def = shipAddrs.find(a => a.isDefault) ?? shipAddrs[0]
          setChoice(def.id); setShipTo(toShipTo(def, company))
        } else { setChoice('manual'); setShipTo({ ...blankShipTo, name: company }) }

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
    setChoice(value); setRate(null); setRatingErr('')
    if (value === 'order' && orderShipTo) setShipTo(orderShipTo)
    else if (value === 'manual') setShipTo({ ...blankShipTo, name: companyName })
    else {
      const a = addresses.find(x => x.id === value)
      if (a) setShipTo(toShipTo(a, companyName))
    }
  }

  const patch = (over: Partial<ShipTo>) => { setShipTo(prev => ({ ...prev, ...over })); setRate(null) }

  const addressComplete = !!(shipTo.name.trim() && shipTo.address1.trim() && shipTo.city.trim() && shipTo.state.trim() && shipTo.postal.trim())
  const weightNum = parseFloat(weight)
  const canGenerate = addressComplete && weightNum > 0 && !!serviceCode && !generating

  const buildBody = useCallback(() => ({
    carrier,
    shipFromName: shipTo.name.trim(), shipFromAddress1: shipTo.address1.trim(), shipFromAddress2: shipTo.address2.trim(),
    shipFromCity: shipTo.city.trim(), shipFromState: shipTo.state.trim(), shipFromPostal: shipTo.postal.trim(),
    shipFromCountry: shipTo.country.trim() || 'US',
    shipToPhone: shipToPhone.trim() || undefined,
    serviceCode, weightValue: weightNum, weightUnit,
    ...(length && width && height ? { length: parseFloat(length), width: parseFloat(width), height: parseFloat(height), dimUnit: 'IN' } : {}),
    ...(confirmation !== 'none' ? { confirmation } : {}),
    referenceNumber: orderNumber || undefined,
    ...(carrier === 'UPS' && accountId ? { upsCredentialId: accountId } : {}),
  }), [carrier, shipTo, shipToPhone, serviceCode, weightNum, weightUnit, length, width, height, confirmation, orderNumber, accountId])

  function switchCarrier(c: Carrier) {
    setCarrier(c); setServiceCode(DEFAULT_SERVICE[c]); setRate(null); setRatingErr('')
  }

  async function fetchRate() {
    if (!addressComplete || !(weightNum > 0)) { setRatingErr('Enter a complete ship-to address and weight first'); return }
    setFetchingRate(true); setRatingErr(''); setRate(null)
    try {
      if (carrier === 'FEDEX') {
        const res = await fetch('/api/fedex/rate-shop', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromPostalCode: SHIP_FROM_RATE.postal, fromCity: SHIP_FROM_RATE.city, fromState: SHIP_FROM_RATE.state, fromCountry: SHIP_FROM_RATE.country,
            toPostalCode: shipTo.postal.trim(), toCity: shipTo.city.trim(), toState: shipTo.state.trim(), toCountry: shipTo.country.trim() || 'US',
            residential: false,
            weight: { value: weightNum, units: weightUnit === 'LBS' ? 'LB' : 'OZ' },
            dimensions: { units: 'IN', length: parseFloat(length) || 12, width: parseFloat(width) || 9, height: parseFloat(height) || 3 },
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Rate quote failed')
        const match = (data.rates ?? []).find((r: { serviceCode: string }) => r.serviceCode === serviceCode)
        if (!match) { setRatingErr(`No FedEx rate returned for ${serviceCode}`); return }
        setRate({ publishedRate: String(match.shipmentCost), negotiatedRate: String(match.shipmentCost), currency: 'USD' })
      } else {
        const res = await fetch('/api/outbound-label/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody()) })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Rate quote failed')
        setRate(data)
      }
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
      toast.success(`Label created — ${data.trackingNumber}`)
      onCreated?.({ carrier: data.carrier ?? (carrier === 'FEDEX' ? 'FedEx' : 'UPS'), trackingNumber: data.trackingNumber, shipmentCost: data.shipmentCost, currency: data.currency })
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
            <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 size={18} /> <p className="text-sm font-semibold">Label created</p></div>
            <div className="rounded-lg border border-gray-200 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Tracking</span><span className="font-mono font-semibold">{result.trackingNumber}</span></div>
              {result.shipmentCost && <div className="flex justify-between"><span className="text-gray-500">Cost</span><span className="font-semibold">${parseFloat(result.shipmentCost).toFixed(2)} {result.currency ?? 'USD'}</span></div>}
            </div>
            <button onClick={() => setPreview({ base64: result.labelBase64, format: result.labelFormat })}
              className="w-full flex items-center justify-center gap-1.5 h-10 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"><Printer size={15} /> Open / Print Label</button>
            <div className="flex gap-2">
              <button onClick={() => { setResult(null); setRate(null) }} className="flex-1 h-9 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Create Another</button>
              <button onClick={onClose} className="flex-1 h-9 rounded-md bg-gray-800 text-white text-sm font-medium hover:bg-gray-900">Done</button>
            </div>
          </div>
        ) : (
          // ── Form ──
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Carrier selector */}
            <div>
              <label className={labelCls}>Carrier</label>
              <div className="grid grid-cols-2 gap-2">
                {(['UPS', 'FEDEX'] as Carrier[]).map(c => (
                  <button key={c} type="button" onClick={() => switchCarrier(c)}
                    className={'h-9 rounded-md border-2 text-sm font-semibold transition ' + (carrier === c
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300')}>
                    {c === 'UPS' ? 'UPS' : 'FedEx'}
                  </button>
                ))}
              </div>
            </div>

            {/* Ship from (read-only) */}
            <div className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-3 py-2 flex items-start gap-1.5">
              <MapPin size={12} className="mt-0.5 shrink-0 text-gray-400" /><span><span className="font-semibold text-gray-600">Ship from:</span> {SHIP_FROM}</span>
            </div>

            {/* Address selector */}
            <div>
              <label className={labelCls}>Ship to — select address</label>
              <select value={choice} onChange={e => onChoice(e.target.value)} className={inputCls}>
                {orderShipTo && <option value="order">Order ship-to{orderShipTo.city ? ` — ${orderShipTo.city}, ${orderShipTo.state}` : ''}</option>}
                {addresses.map(a => (
                  <option key={a.id} value={a.id}>{a.label}{a.isDefault ? ' (default)' : ''} — {a.city}, {a.state}</option>
                ))}
                <option value="manual">Manual entry…</option>
              </select>
            </div>

            {/* Editable ship-to */}
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className={labelCls}>Name <span className="text-red-500">*</span></label>
                <input className={inputCls} value={shipTo.name} onChange={e => patch({ name: e.target.value })} /></div>
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

            {/* Package */}
            <div className="border-t pt-3 space-y-2">
              {carrier === 'UPS' && upsAccounts.length > 1 && (
                <div><label className={labelCls}>UPS Account</label>
                  <select className={inputCls} value={accountId} onChange={e => setAccountId(e.target.value)}>
                    {upsAccounts.map(a => <option key={a.id} value={a.id}>{a.nickname ?? a.accountNumber ?? a.id}{a.isDefault ? ' (default)' : ''}</option>)}
                  </select></div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>{carrier === 'FEDEX' ? 'FedEx' : 'UPS'} Service <span className="text-red-500">*</span></label>
                  <select className={inputCls} value={serviceCode} onChange={e => { setServiceCode(e.target.value); setRate(null) }}>
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
              <div className="grid grid-cols-4 gap-2">
                <div><label className={labelCls}>Weight <span className="text-red-500">*</span></label>
                  <input type="number" step="0.1" min="0" className={inputCls} value={weight} onChange={e => { setWeight(e.target.value); setRate(null) }} /></div>
                <div><label className={labelCls}>Unit</label>
                  <select className={inputCls} value={weightUnit} onChange={e => setWeightUnit(e.target.value as 'LBS' | 'OZS')}><option value="LBS">lbs</option><option value="OZS">oz</option></select></div>
                <div className="col-span-2 grid grid-cols-3 gap-1">
                  <div><label className={labelCls}>L</label><input type="number" min="0" className={inputCls} value={length} onChange={e => setLength(e.target.value)} placeholder="in" /></div>
                  <div><label className={labelCls}>W</label><input type="number" min="0" className={inputCls} value={width} onChange={e => setWidth(e.target.value)} placeholder="in" /></div>
                  <div><label className={labelCls}>H</label><input type="number" min="0" className={inputCls} value={height} onChange={e => setHeight(e.target.value)} placeholder="in" /></div>
                </div>
              </div>
            </div>

            {/* Rate */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <button type="button" onClick={fetchRate} disabled={fetchingRate}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amazon-blue hover:underline disabled:opacity-40">
                  {fetchingRate ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Get rate quote
                </button>
                {rate && (
                  <span className="text-sm font-semibold text-gray-900">
                    ${parseFloat(rate.negotiatedRate ?? rate.publishedRate).toFixed(2)} <span className="text-xs font-normal text-gray-400">{rate.currency}{rate.negotiatedRate ? ' negotiated' : ''}</span>
                  </span>
                )}
              </div>
              {ratingErr && <p className="text-[11px] text-red-500 mt-1">{ratingErr}</p>}
            </div>

            {genErr && <p className="text-xs text-red-500">{genErr}</p>}
          </div>
        )}

        {/* Footer (form mode) */}
        {!loading && !loadErr && !result && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0">
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={generate} disabled={!canGenerate}
              className="inline-flex items-center gap-1.5 h-9 px-5 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40">
              {generating ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />} Generate Label
            </button>
          </div>
        )}
      </div>

      {preview && <PrintPreview base64={preview.base64} format={preview.format} onClose={() => setPreview(null)} />}
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { Truck, Plus, X, Printer, Loader2, DollarSign, Ban, MapPin, CheckCircle2, AlertCircle, History } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from 'sonner'

// ─── Constants ────────────────────────────────────────────────────────────────
type Path = 'ups' | 'fedex' | 'ss'

const SHIP_FROM_DEFAULT = {
  name: 'OPEN LINE MOBILITY LTD', company: 'OPEN LINE MOBILITY LTD',
  address1: '20 MERIDIAN ROAD', address2: 'UNIT 2',
  city: 'EATONTOWN', state: 'NJ', postal: '07724', country: 'US', phone: '917-841-9444',
}
const EMPTY_TO = { name: '', company: '', address1: '', address2: '', city: '', state: '', postal: '', country: 'US', phone: '' }

const SERVICES: Record<Path, { code: string; label: string }[]> = {
  ups: [
    { code: '03', label: 'UPS Ground' }, { code: '02', label: 'UPS 2nd Day Air' },
    { code: '59', label: 'UPS 2nd Day Air A.M.' }, { code: '12', label: 'UPS 3 Day Select' },
    { code: '13', label: 'UPS Next Day Air Saver' }, { code: '01', label: 'UPS Next Day Air' },
    { code: '14', label: 'UPS Next Day Air Early' },
  ],
  fedex: [
    { code: 'FEDEX_GROUND', label: 'FedEx Ground' }, { code: 'FEDEX_EXPRESS_SAVER', label: 'FedEx Express Saver' },
    { code: 'FEDEX_2_DAY', label: 'FedEx 2Day' }, { code: 'FEDEX_2_DAY_AM', label: 'FedEx 2Day A.M.' },
    { code: 'STANDARD_OVERNIGHT', label: 'FedEx Standard Overnight' }, { code: 'PRIORITY_OVERNIGHT', label: 'FedEx Priority Overnight' },
    { code: 'FIRST_OVERNIGHT', label: 'FedEx First Overnight' },
  ],
  ss: [
    { code: 'ups_ground', label: 'UPS Ground' }, { code: 'ups_3_day_select', label: 'UPS 3 Day Select' },
    { code: 'ups_2nd_day_air', label: 'UPS 2nd Day Air' }, { code: 'ups_2nd_day_air_am', label: 'UPS 2nd Day Air A.M.' },
    { code: 'ups_next_day_air_saver', label: 'UPS Next Day Air Saver' }, { code: 'ups_next_day_air', label: 'UPS Next Day Air' },
    { code: 'ups_next_day_air_early_am', label: 'UPS Next Day Air Early' },
  ],
}
const PATH_LABEL: Record<Path, string> = { ups: 'UPS Direct', fedex: 'FedEx Direct', ss: 'ShipStation (UPS)' }

interface Addr { name: string; company: string; address1: string; address2: string; city: string; state: string; postal: string; country: string; phone: string }
interface Pkg { weightValue: string; weightUnit: 'LBS' | 'OZS'; length: string; width: string; height: string }
interface UpsCred { id: string; nickname: string; isDefault: boolean }
interface Piece { trackingNumber: string; labelBase64: string; labelFormat: string }
interface HistoryRow {
  id: string; labelType: string; shipFromName: string; shipFromCity: string; shipFromState: string
  serviceLabel: string | null; serviceCode: string; trackingNumber: string; shipmentCost: string | null
  currency: string | null; voided: boolean; createdAt: string
}

const emptyPkg = (): Pkg => ({ weightValue: '', weightUnit: 'LBS', length: '', width: '', height: '' })
const inputCls = 'w-full h-8 px-2 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue'
const labelCls = 'block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5'

function printLabel(base64: string, format: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const isPdf = (format || 'pdf').toLowerCase() === 'pdf'
  const blob = new Blob([bytes], { type: isPdf ? 'application/pdf' : 'image/png' })
  const url = URL.createObjectURL(blob)
  if (isPdf) {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'; document.body.appendChild(iframe); iframe.src = url
    iframe.onload = () => { iframe.contentWindow?.print(); setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url) }, 1500) }
  } else {
    const w = window.open('', '_blank')
    if (w) { w.document.write(`<img src="${url}" style="max-width:100%" onload="window.print()" />`); w.document.close() }
  }
}

export default function CreateShippingLabels() {
  const [tab, setTab] = useState<'create' | 'history'>('create')
  const [path, setPath] = useState<Path>('ups')
  const [shipFrom, setShipFrom] = useState<Addr>({ ...SHIP_FROM_DEFAULT })
  const [shipTo, setShipTo] = useState<Addr>({ ...EMPTY_TO })
  const [packages, setPackages] = useState<Pkg[]>([emptyPkg()])
  const [serviceCode, setServiceCode] = useState(SERVICES.ups[0].code)
  const [confirmation, setConfirmation] = useState<'none' | 'delivery' | 'signature' | 'adult_signature'>('none')
  const [reference, setReference] = useState('')
  const [upsCreds, setUpsCreds] = useState<UpsCred[]>([])
  const [upsCredentialId, setUpsCredentialId] = useState('')

  const [rate, setRate] = useState<{ total: number; currency: string } | null>(null)
  const [rating, setRating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ masterTracking: string; pieces: Piece[]; shipmentCost: number | null; currency: string; accOlm: number | null } | null>(null)
  // Accessorial order option
  const [accessorial, setAccessorial] = useState(false)
  const [accessoryName, setAccessoryName] = useState('')
  // Copy ship-to from an existing order
  const [orderQuery, setOrderQuery] = useState('')
  const [orderResults, setOrderResults] = useState<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
  const [showOrderResults, setShowOrderResults] = useState(false)

  // Load UPS credentials for the UPS Direct account picker.
  // The endpoint returns { configured, accounts: [...] }.
  useEffect(() => {
    fetch('/api/ups/credentials').then(r => r.ok ? r.json() : null).then((d) => {
      const list: UpsCred[] = Array.isArray(d?.accounts) ? d.accounts : []
      setUpsCreds(list)
      const def = list.find(c => c.isDefault) ?? list[0]
      if (def) setUpsCredentialId(def.id)
    }).catch(() => {})
  }, [])

  // Reset the service + rate when the path changes.
  useEffect(() => { setServiceCode(SERVICES[path][0].code); setRate(null) }, [path])
  // Any input change invalidates a stale rate.
  useEffect(() => { setRate(null) }, [shipTo, shipFrom, packages, serviceCode, confirmation, upsCredentialId])

  // Debounced order search for copying a ship-to address.
  useEffect(() => {
    const q = orderQuery.trim()
    if (q.length < 2) { setOrderResults([]); return }
    const t = setTimeout(() => {
      fetch(`/api/orders/search?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : { data: [] })
        .then(d => { setOrderResults(d.data ?? []); setShowOrderResults(true) }).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [orderQuery])

  function copyFromOrder(o: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    setShipTo({
      name: o.shipToName ?? '', company: '',
      address1: o.shipToAddress1 ?? '', address2: o.shipToAddress2 ?? '',
      city: o.shipToCity ?? '', state: o.shipToState ?? '', postal: o.shipToPostal ?? '',
      country: o.shipToCountry ?? 'US', phone: o.shipToPhone ?? '',
    })
    setOrderQuery(''); setOrderResults([]); setShowOrderResults(false)
  }

  const setToField = (k: keyof Addr, v: string) => setShipTo(p => ({ ...p, [k]: v }))
  const setFromField = (k: keyof Addr, v: string) => setShipFrom(p => ({ ...p, [k]: v }))
  const setPkg = (i: number, k: keyof Pkg, v: string) => setPackages(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x))

  const addrComplete = (a: Addr) => (!!a.name.trim() || !!a.company.trim()) && !!a.address1.trim() && !!a.city.trim() && !!a.state.trim() && !!a.postal.trim()
  const pkgsComplete = packages.length > 0 && packages.every(p => Number(p.weightValue) > 0)
  const canSubmit = addrComplete(shipTo) && addrComplete(shipFrom) && pkgsComplete && !!serviceCode

  function buildBody() {
    return {
      path, serviceCode, confirmation, referenceNumber: reference.trim() || undefined,
      ...(path === 'ups' && upsCredentialId ? { upsCredentialId } : {}),
      shipFrom, shipTo,
      packages: packages.map(p => ({
        weightValue: Number(p.weightValue), weightUnit: p.weightUnit,
        ...(p.length && p.width && p.height ? { length: Number(p.length), width: Number(p.width), height: Number(p.height), dimUnit: 'IN' } : {}),
      })),
      ...(accessorial ? { accessorial: true, accessoryName: accessoryName.trim() } : {}),
    }
  }

  async function getRate() {
    if (!canSubmit) { setErr('Complete the ship-to address and a weight for each box'); return }
    setRating(true); setErr(''); setRate(null)
    try {
      const res = await fetch('/api/shipping-labels/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody()) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Rate failed')
      setRate({ total: Number(data.total), currency: data.currency ?? 'USD' })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Rate failed') }
    finally { setRating(false) }
  }

  async function createLabel() {
    if (!canSubmit) return
    if (accessorial && !accessoryName.trim()) { setErr('Enter which accessory is being shipped'); return }
    setCreating(true); setErr(''); setResult(null)
    try {
      const res = await fetch('/api/shipping-labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody()) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Label creation failed')
      setResult({ masterTracking: data.masterTracking, pieces: data.pieces, shipmentCost: data.shipmentCost, currency: data.currency, accOlm: data.accessorialOrder?.olmNumber ?? null })
      toast.success(`Label created — ${data.pieces.length} piece${data.pieces.length !== 1 ? 's' : ''}`)
      if (data.accessorialError) toast.error(`Label made, but accessorial order failed: ${data.accessorialError}`)
      else if (data.accessorialOrder) toast.success(`Accessorial order OLM-${data.accessorialOrder.olmNumber} sent to Awaiting Verification`)
      data.pieces.forEach((pc: Piece, i: number) => setTimeout(() => printLabel(pc.labelBase64, pc.labelFormat), i * 700))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Label creation failed') }
    finally { setCreating(false) }
  }

  function resetForm() {
    setShipTo({ ...EMPTY_TO }); setPackages([emptyPkg()]); setReference(''); setConfirmation('none'); setRate(null); setResult(null); setErr(''); setAccessorial(false); setAccessoryName(''); setOrderQuery('')
  }

  return (
    <div className="max-w-4xl">
      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <button onClick={() => setTab('create')} className={clsx('px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5', tab === 'create' ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300')}>
          <Truck size={14} /> Create
        </button>
        <button onClick={() => setTab('history')} className={clsx('px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1.5', tab === 'history' ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300')}>
          <History size={14} /> History
        </button>
      </div>

      {tab === 'history' ? <HistoryTab /> : (
        <div className="space-y-4">
          {/* Path */}
          <div className="flex gap-2">
            {(['ups', 'fedex', 'ss'] as Path[]).map(p => (
              <button key={p} onClick={() => setPath(p)}
                className={clsx('flex-1 h-11 rounded-lg border text-sm font-semibold', path === p ? 'border-amazon-blue bg-blue-50 text-amazon-blue dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300')}>
                {PATH_LABEL[p]}
              </button>
            ))}
          </div>

          {result ? (
            <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-800 dark:text-green-300 font-semibold text-sm"><CheckCircle2 size={16} /> Label created</div>
              {result.shipmentCost != null && <div className="text-xs text-gray-600 dark:text-gray-300">Cost: <span className="font-semibold">{result.currency} {result.shipmentCost.toFixed(2)}</span></div>}
              {result.accOlm != null && <div className="text-xs text-gray-700 dark:text-gray-200">Accessorial order <span className="font-semibold">OLM-{result.accOlm}</span> created → Awaiting Verification.</div>}
              <div className="divide-y divide-green-100 dark:divide-green-900/40">
                {result.pieces.map((pc, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="text-gray-400 text-xs w-12">Box {i + 1}</span>
                    <span className="font-mono text-gray-800 dark:text-gray-100">{pc.trackingNumber}</span>
                    <button onClick={() => printLabel(pc.labelBase64, pc.labelFormat)} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-white dark:hover:bg-gray-800">
                      <Printer size={12} /> Print
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={resetForm} className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium">Create another</button>
            </div>
          ) : (
            <>
              {/* Ship From */}
              <fieldset className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <legend className="px-1 text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1"><MapPin size={12} /> Ship From</legend>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>Company / Name</label><input className={inputCls} value={shipFrom.name} onChange={e => setFromField('name', e.target.value)} /></div>
                  <div><label className={labelCls}>Phone</label><input className={inputCls} value={shipFrom.phone} onChange={e => setFromField('phone', e.target.value)} /></div>
                  <div className="col-span-2"><label className={labelCls}>Address 1</label><input className={inputCls} value={shipFrom.address1} onChange={e => setFromField('address1', e.target.value)} /></div>
                  <div className="col-span-2"><label className={labelCls}>Address 2</label><input className={inputCls} value={shipFrom.address2} onChange={e => setFromField('address2', e.target.value)} /></div>
                  <div><label className={labelCls}>City</label><input className={inputCls} value={shipFrom.city} onChange={e => setFromField('city', e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={labelCls}>State</label><input className={inputCls} value={shipFrom.state} onChange={e => setFromField('state', e.target.value)} /></div>
                    <div><label className={labelCls}>ZIP</label><input className={inputCls} value={shipFrom.postal} onChange={e => setFromField('postal', e.target.value)} /></div>
                  </div>
                </div>
                <button onClick={() => setShipFrom({ ...SHIP_FROM_DEFAULT })} className="mt-2 text-[11px] text-amazon-blue hover:underline">Reset to Open Line Mobility</button>
              </fieldset>

              {/* Ship To */}
              <fieldset className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <legend className="px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">Ship To</legend>
                <div className="relative mb-2">
                  <input value={orderQuery} onChange={e => setOrderQuery(e.target.value)} onFocus={() => orderResults.length > 0 && setShowOrderResults(true)}
                    onBlur={() => setTimeout(() => setShowOrderResults(false), 150)}
                    placeholder="Copy address from an existing order — search OLM #, order ID, or name…" className={inputCls} />
                  {showOrderResults && orderResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                      {orderResults.map((o) => (
                        <button key={o.id} type="button" onMouseDown={() => copyFromOrder(o)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2">
                          <span className="font-medium text-amazon-blue">{o.olmNumber ? `OLM-${o.olmNumber}` : o.amazonOrderId}</span>
                          <span className="text-gray-600 dark:text-gray-300">{o.shipToName ?? '—'}</span>
                          <span className="text-gray-400 ml-auto">{[o.shipToCity, o.shipToState].filter(Boolean).join(', ')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>Name <span className="text-red-500">*</span></label><input className={inputCls} value={shipTo.name} onChange={e => setToField('name', e.target.value)} /></div>
                  <div><label className={labelCls}>Company</label><input className={inputCls} value={shipTo.company} onChange={e => setToField('company', e.target.value)} /></div>
                  <div className="col-span-2"><label className={labelCls}>Address 1 <span className="text-red-500">*</span></label><input className={inputCls} value={shipTo.address1} onChange={e => setToField('address1', e.target.value)} /></div>
                  <div className="col-span-2"><label className={labelCls}>Address 2</label><input className={inputCls} value={shipTo.address2} onChange={e => setToField('address2', e.target.value)} /></div>
                  <div><label className={labelCls}>City <span className="text-red-500">*</span></label><input className={inputCls} value={shipTo.city} onChange={e => setToField('city', e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={labelCls}>State <span className="text-red-500">*</span></label><input className={inputCls} value={shipTo.state} onChange={e => setToField('state', e.target.value)} /></div>
                    <div><label className={labelCls}>ZIP <span className="text-red-500">*</span></label><input className={inputCls} value={shipTo.postal} onChange={e => setToField('postal', e.target.value)} /></div>
                  </div>
                  <div><label className={labelCls}>Phone {path === 'fedex' && <span className="text-gray-400">(FedEx)</span>}</label><input className={inputCls} value={shipTo.phone} onChange={e => setToField('phone', e.target.value)} /></div>
                </div>
              </fieldset>

              {/* Service + options */}
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>Service</label>
                  <select className={inputCls} value={serviceCode} onChange={e => setServiceCode(e.target.value)}>
                    {SERVICES[path].map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Signature</label>
                  <select className={inputCls} value={confirmation} onChange={e => setConfirmation(e.target.value as typeof confirmation)}>
                    <option value="none">None</option><option value="delivery">Delivery confirmation</option>
                    <option value="signature">Signature</option><option value="adult_signature">Adult signature</option>
                  </select>
                </div>
                {path === 'ups' && (
                  <div><label className={labelCls}>UPS Account</label>
                    <select className={inputCls} value={upsCredentialId} onChange={e => setUpsCredentialId(e.target.value)}>
                      {upsCreds.length === 0 && <option value="">Default</option>}
                      {upsCreds.map(c => <option key={c.id} value={c.id}>{c.nickname}{c.isDefault ? ' (default)' : ''}</option>)}
                    </select>
                  </div>
                )}
                <div><label className={labelCls}>Reference # (optional)</label><input className={inputCls} value={reference} onChange={e => setReference(e.target.value)} /></div>
              </div>

              {/* Accessorial order */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                  <input type="checkbox" checked={accessorial} onChange={e => setAccessorial(e.target.checked)} />
                  Tie to an accessorial order (e.g. ship a replacement accessory to a customer)
                </label>
                {accessorial && (
                  <div className="mt-2">
                    <label className={labelCls}>Which accessory is being shipped? <span className="text-red-500">*</span></label>
                    <input className={inputCls} value={accessoryName} onChange={e => setAccessoryName(e.target.value)} placeholder="e.g. MacBook Pro Charger" />
                    <p className="text-[11px] text-gray-400 mt-1">Creates an order in <strong>Awaiting Verification</strong> tied to this label. No inventory is affected.</p>
                  </div>
                )}
              </div>

              {/* Packages */}
              <fieldset className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <legend className="px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">Boxes ({packages.length})</legend>
                <div className="space-y-2">
                  {packages.map((p, i) => (
                    <div key={i} className="flex items-end gap-2">
                      <div className="w-10 text-xs text-gray-400 pb-2">#{i + 1}</div>
                      <div className="w-24"><label className={labelCls}>Weight</label><input type="number" step="0.1" className={inputCls} value={p.weightValue} onChange={e => setPkg(i, 'weightValue', e.target.value)} /></div>
                      <div className="w-20"><label className={labelCls}>Unit</label><select className={inputCls} value={p.weightUnit} onChange={e => setPkg(i, 'weightUnit', e.target.value)}><option value="LBS">lb</option><option value="OZS">oz</option></select></div>
                      <div className="w-16"><label className={labelCls}>L (in)</label><input type="number" className={inputCls} value={p.length} onChange={e => setPkg(i, 'length', e.target.value)} /></div>
                      <div className="w-16"><label className={labelCls}>W</label><input type="number" className={inputCls} value={p.width} onChange={e => setPkg(i, 'width', e.target.value)} /></div>
                      <div className="w-16"><label className={labelCls}>H</label><input type="number" className={inputCls} value={p.height} onChange={e => setPkg(i, 'height', e.target.value)} /></div>
                      {packages.length > 1 && <button onClick={() => setPackages(pk => pk.filter((_, j) => j !== i))} className="mb-1.5 text-gray-300 hover:text-red-500"><X size={15} /></button>}
                    </div>
                  ))}
                </div>
                <button onClick={() => setPackages(p => [...p, emptyPkg()])} className="mt-2 text-xs text-amazon-blue hover:underline flex items-center gap-1"><Plus size={12} /> Add box</button>
                {path === 'ss' && packages.length > 1 && <p className="mt-1 text-[11px] text-gray-400">ShipStation creates one label per box (each its own tracking number).</p>}
              </fieldset>

              {err && <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"><AlertCircle size={14} /> {err}</div>}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button onClick={getRate} disabled={!canSubmit || rating} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                  {rating ? <Loader2 size={14} className="animate-spin" /> : <DollarSign size={14} />} Get Rate
                </button>
                {rate && <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{rate.currency} {rate.total.toFixed(2)}</span>}
                <button onClick={createLabel} disabled={!canSubmit || creating} className="ml-auto inline-flex items-center gap-1.5 h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-amazon-blue/90 disabled:opacity-50">
                  {creating ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : <><Printer size={14} /> Create Label</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── History tab ───────────────────────────────────────────────────────────────
function HistoryTab() {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [voidingId, setVoidingId] = useState<string | null>(null)

  const load = () => { setLoading(true); fetch('/api/shipping-labels').then(r => r.json()).then((d: HistoryRow[]) => setRows(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  async function reprint(id: string) {
    try {
      const res = await fetch(`/api/shipping-labels/${id}`)
      const data = await res.json()
      if (!res.ok || !data.labelData) throw new Error(data.error ?? 'Could not load label')
      printLabel(data.labelData, data.labelFormat ?? 'pdf')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load label') }
  }
  async function voidLabel(id: string) {
    if (!confirm('Void this label at the carrier? This cannot be undone.')) return
    setVoidingId(id)
    try {
      const res = await fetch(`/api/shipping-labels/${id}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Void failed')
      toast.success('Label voided'); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Void failed') }
    finally { setVoidingId(null) }
  }

  const pathBadge = (t: string) => t === 'MANUAL_FEDEX' ? 'FedEx' : t === 'MANUAL_SS' ? 'UPS (SS)' : 'UPS'

  if (loading) return <div className="py-10 text-center text-sm text-gray-400"><Loader2 size={18} className="animate-spin inline" /> Loading…</div>
  if (rows.length === 0) return <div className="py-10 text-center text-sm text-gray-400">No labels created yet.</div>

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Date</th>
            <th className="text-left px-3 py-2 font-medium">Path</th>
            <th className="text-left px-3 py-2 font-medium">Ship To</th>
            <th className="text-left px-3 py-2 font-medium">Service</th>
            <th className="text-left px-3 py-2 font-medium">Tracking</th>
            <th className="text-right px-3 py-2 font-medium">Cost</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(r => (
            <tr key={r.id} className={clsx(r.voided && 'opacity-50')}>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
              <td className="px-3 py-1.5"><span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{pathBadge(r.labelType)}</span></td>
              <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{r.shipFromName}<span className="text-gray-400"> · {r.shipFromCity}, {r.shipFromState}</span></td>
              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{r.serviceLabel ?? r.serviceCode}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">{r.trackingNumber}{r.voided && <span className="ml-1 text-red-500 text-[10px]">VOIDED</span>}</td>
              <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.shipmentCost != null ? `${r.currency ?? 'USD'} ${Number(r.shipmentCost).toFixed(2)}` : '—'}</td>
              <td className="px-3 py-1.5 whitespace-nowrap text-right">
                <button onClick={() => reprint(r.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"><Printer size={11} /> Print</button>
                {!r.voided && <button onClick={() => voidLabel(r.id)} disabled={voidingId === r.id} className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">{voidingId === r.id ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />} Void</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

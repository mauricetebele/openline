'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Search, Printer, AlertCircle, CheckCircle, ArrowLeft, Loader2,
  Package, RefreshCw, History, Plus, Download, XCircle, ExternalLink,
} from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AddressResult {
  amazonOrderId: string
  name:     string
  address1: string
  address2: string
  city:     string
  state:    string
  postal:   string
  country:  string
  services: { code: string; label: string }[]
}

interface PackageForm {
  serviceCode: string
  weightValue: string
  weightUnit:  'LBS' | 'OZS'
  length:      string
  width:       string
  height:      string
  dimUnit:     'IN' | 'CM'
  description: string
  referenceNumber: string
}

interface ChargeLineItem {
  description: string
  amount:      string
  currency:    string
}

interface LabelResult {
  trackingNumber:   string
  shipmentId:       string
  labelBase64:      string
  labelFormat:      string
  shipmentCost?:    string
  currency?:        string
  chargeBreakdown?: ChargeLineItem[]
}

interface UpsAccount {
  id:        string
  nickname:  string
  isDefault: boolean
}

interface HistoryEntry {
  id:               string
  amazonOrderId:    string | null
  shipFromName:     string
  shipFromAddress1: string
  shipFromCity:     string
  shipFromState:    string
  shipFromPostal:   string
  serviceCode:      string
  serviceLabel:     string | null
  weightValue:      string
  weightUnit:       string
  trackingNumber:   string
  shipmentCost:     string | null
  currency:         string | null
  voided:           boolean
  voidedAt:         string | null
  createdAt:        string
  upsCredential:    { nickname: string } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

type Step       = 'lookup' | 'details' | 'confirm' | 'done'
type ActiveTab  = 'create' | 'history'

const DESTINATION = {
  name:    'PRIME MOBILITY FBM RETURNS',
  address: '20 MERIDIAN RD, UNIT 2',
  city:    'EATONTOWN, NJ 07724',
}

const FALLBACK_SERVICES: { code: string; label: string }[] = [
  { code: '03', label: 'UPS Ground' },
  { code: '02', label: 'UPS 2nd Day Air' },
  { code: '59', label: 'UPS 2nd Day Air A.M.' },
  { code: '13', label: 'UPS Next Day Air Saver' },
  { code: '01', label: 'UPS Next Day Air' },
  { code: '14', label: 'UPS Next Day Air Early' },
  { code: '12', label: 'UPS 3-Day Select' },
]

// ─── History Tab ──────────────────────────────────────────────────────────────

function LabelHistoryTab() {
  const [labels, setLabels]     = useState<HistoryEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [voidingId, setVoidingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/return-label/history')
      const data = await res.json()
      if (res.ok) setLabels(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function openLabel(id: string, trackingNumber: string) {
    try {
      const res  = await fetch(`/api/return-label/${id}`)
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Download failed'); return }
      const w = window.open('', '_blank')
      if (!w) return
      w.document.write(`<!DOCTYPE html><html><head>
        <title>Return Label – ${trackingNumber}</title>
        <style>
          @page { size: letter landscape; margin: 0.25in; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 100%; height: 100%; }
          body { display: flex; }
          img { width: 50%; height: 100%; object-fit: contain; object-position: top left; }
        </style>
      </head><body>
        <img src="data:image/gif;base64,${data.labelData}" />
      </body></html>`)
      w.document.close()
      setTimeout(() => w.print(), 400)
    } catch {
      toast.error('Failed to open label')
    }
  }

  async function handleVoid(id: string, trackingNumber: string) {
    if (!confirm(`Void label ${trackingNumber}?\n\nUPS only allows voiding before the carrier scans the package.`)) return
    setVoidingId(id)
    try {
      const res  = await fetch(`/api/return-label/${id}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Void failed'); return }
      toast.success('Label voided successfully')
      load()
    } catch {
      toast.error('Void request failed')
    } finally {
      setVoidingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" />
        Loading history…
      </div>
    )
  }

  if (labels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <History size={36} className="text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-500">No return labels yet</p>
        <p className="text-xs text-gray-400 mt-1">Labels you generate will appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{labels.length} label{labels.length !== 1 ? 's' : ''}</p>
        <button onClick={load} className="flex items-center gap-1 text-xs text-amazon-blue hover:underline">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      <div className="space-y-2">
        {labels.map(lbl => (
          <div
            key={lbl.id}
            className={clsx(
              'card p-4 transition-opacity',
              lbl.voided && 'opacity-60',
            )}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 truncate">{lbl.shipFromName}</span>
                  {lbl.voided ? (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">
                      <XCircle size={10} /> VOIDED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">
                      Active
                    </span>
                  )}
                  {lbl.amazonOrderId && (
                    <span className="text-[10px] font-mono text-gray-400">{lbl.amazonOrderId}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {lbl.shipFromAddress1}, {lbl.shipFromCity}, {lbl.shipFromState} {lbl.shipFromPostal}
                </p>
              </div>
              <div className="text-right shrink-0">
                {lbl.shipmentCost && (
                  <p className="text-sm font-bold text-gray-900">
                    ${parseFloat(lbl.shipmentCost).toFixed(2)}
                    <span className="text-xs font-normal text-gray-400 ml-0.5">{lbl.currency ?? 'USD'}</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-400">
                  {new Date(lbl.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>

            {/* Details row */}
            <div className="flex items-center gap-4 text-xs text-gray-500 mb-3 flex-wrap">
              {lbl.upsCredential?.nickname && (
                <>
                  <span className="font-medium text-gray-600">{lbl.upsCredential.nickname}</span>
                  <span>·</span>
                </>
              )}
              <span>{lbl.serviceLabel ?? lbl.serviceCode}</span>
              <span>·</span>
              <span>{parseFloat(lbl.weightValue).toFixed(1)} {lbl.weightUnit}</span>
              <span>·</span>
              <a
                href={`https://www.ups.com/track?tracknum=${lbl.trackingNumber}`}
                target="_blank" rel="noopener noreferrer"
                className="font-mono text-amazon-blue hover:underline flex items-center gap-0.5"
              >
                {lbl.trackingNumber}
                <ExternalLink size={10} />
              </a>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => openLabel(lbl.id, lbl.trackingNumber)}
                className="flex items-center gap-1.5 h-7 px-3 rounded bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors"
              >
                <Printer size={12} />
                Print Label
              </button>
              {!lbl.voided && (
                <button
                  onClick={() => handleVoid(lbl.id, lbl.trackingNumber)}
                  disabled={voidingId === lbl.id}
                  className="flex items-center gap-1.5 h-7 px-3 rounded bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {voidingId === lbl.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <XCircle size={12} />}
                  Void
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReturnLabelManager() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('create')
  const [step, setStep] = useState<Step>('lookup')

  // UPS accounts
  const [upsAccounts, setUpsAccounts] = useState<UpsAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')

  useEffect(() => {
    fetch('/api/ups/credentials')
      .then(r => r.json())
      .then(data => {
        const accts: UpsAccount[] = data.accounts ?? []
        setUpsAccounts(accts)
        const def = accts.find(a => a.isDefault) ?? accts[0]
        if (def) setSelectedAccountId(def.id)
      })
      .catch(() => {})
  }, [])

  // Step 1
  const [orderId, setOrderId]         = useState('')
  const [looking, setLooking]         = useState(false)
  const [lookupErr, setLookupErr]     = useState('')
  const [address, setAddress]         = useState<AddressResult | null>(null)
  const [manualEntry, setManualEntry] = useState(false)

  // Step 2
  const [editAddress, setEditAddress] = useState<Omit<AddressResult, 'services' | 'amazonOrderId'>>({
    name: '', address1: '', address2: '', city: '', state: '', postal: '', country: 'US',
  })
  const [pkg, setPkg] = useState<PackageForm>({
    serviceCode: '03', weightValue: '', weightUnit: 'LBS',
    length: '', width: '', height: '', dimUnit: 'IN',
    description: 'Return Shipment', referenceNumber: '',
  })
  const [detailErr, setDetailErr] = useState('')

  // Rate quote
  const [rateQuote, setRateQuote]       = useState<{ publishedRate: string; negotiatedRate: string | null; currency: string } | null>(null)
  const [ratingErr, setRatingErr]       = useState('')
  const [fetchingRate, setFetchingRate] = useState(false)

  // Step 4
  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr]         = useState('')
  const [result, setResult]         = useState<LabelResult | null>(null)

  // ── Lookup ──────────────────────────────────────────────────────────────────

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!orderId.trim()) return
    setLooking(true); setLookupErr('')
    try {
      const res  = await fetch(`/api/return-label?amazonOrderId=${encodeURIComponent(orderId.trim())}`)
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 404) {
          setManualEntry(true)
          setAddress({ amazonOrderId: orderId.trim(), name: '', address1: '', address2: '', city: '', state: '', postal: '', country: 'US', services: FALLBACK_SERVICES })
          setEditAddress({ name: '', address1: '', address2: '', city: '', state: '', postal: '', country: 'US' })
          setPkg(p => ({ ...p, referenceNumber: orderId.trim() }))
          setStep('details')
        } else {
          setLookupErr(data.error ?? 'Lookup failed')
        }
        return
      }
      setManualEntry(false)
      setAddress(data)
      setEditAddress({ name: data.name, address1: data.address1, address2: data.address2, city: data.city, state: data.state, postal: data.postal, country: data.country || 'US' })
      setPkg(p => ({ ...p, referenceNumber: data.amazonOrderId }))
      setStep('details')
    } catch {
      setLookupErr('Network error — please try again')
    } finally {
      setLooking(false)
    }
  }

  // ── Details → Confirm ───────────────────────────────────────────────────────

  function handleDetails(e: React.FormEvent) {
    e.preventDefault()
    setDetailErr('')
    if (!editAddress.name.trim() || !editAddress.address1.trim() ||
        !editAddress.city.trim() || !editAddress.state.trim() || !editAddress.postal.trim()) {
      setDetailErr('All address fields except Address Line 2 are required'); return
    }
    if (!pkg.weightValue || parseFloat(pkg.weightValue) <= 0) {
      setDetailErr('Package weight is required'); return
    }
    setRateQuote(null); setRatingErr('')
    setStep('confirm')
    fetchRate()
  }

  async function fetchRate() {
    setFetchingRate(true); setRatingErr(''); setRateQuote(null)
    try {
      const body = {
        shipFromName: editAddress.name.trim(), shipFromAddress1: editAddress.address1.trim(),
        shipFromAddress2: editAddress.address2.trim(), shipFromCity: editAddress.city.trim(),
        shipFromState: editAddress.state.trim(), shipFromPostal: editAddress.postal.trim(),
        shipFromCountry: editAddress.country.trim() || 'US', serviceCode: pkg.serviceCode,
        weightValue: parseFloat(pkg.weightValue), weightUnit: pkg.weightUnit,
        ...(pkg.length && pkg.width && pkg.height ? {
          length: parseFloat(pkg.length), width: parseFloat(pkg.width),
          height: parseFloat(pkg.height), dimUnit: pkg.dimUnit,
        } : {}),
        ...(selectedAccountId ? { upsCredentialId: selectedAccountId } : {}),
      }
      const res  = await fetch('/api/return-label/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Rate quote failed')
      setRateQuote(data)
    } catch (err: unknown) {
      setRatingErr(err instanceof Error ? err.message : 'Could not fetch rate')
    } finally {
      setFetchingRate(false)
    }
  }

  // ── Generate ────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setGenerating(true); setGenErr('')
    try {
      const body = {
        amazonOrderId: address?.amazonOrderId,
        shipFromName: editAddress.name.trim(), shipFromAddress1: editAddress.address1.trim(),
        shipFromAddress2: editAddress.address2.trim(), shipFromCity: editAddress.city.trim(),
        shipFromState: editAddress.state.trim(), shipFromPostal: editAddress.postal.trim(),
        shipFromCountry: editAddress.country.trim() || 'US', serviceCode: pkg.serviceCode,
        weightValue: parseFloat(pkg.weightValue), weightUnit: pkg.weightUnit,
        ...(pkg.length && pkg.width && pkg.height ? {
          length: parseFloat(pkg.length), width: parseFloat(pkg.width),
          height: parseFloat(pkg.height), dimUnit: pkg.dimUnit,
        } : {}),
        description: pkg.description.trim() || 'Return Shipment',
        referenceNumber: pkg.referenceNumber.trim() || undefined,
        ...(selectedAccountId ? { upsCredentialId: selectedAccountId } : {}),
      }
      const res  = await fetch('/api/return-label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Label generation failed')
      setResult(data)
      setStep('done')
    } catch (err: unknown) {
      setGenErr(err instanceof Error ? err.message : 'Label generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function openLabel() {
    if (!result) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head>
      <title>Return Label – ${result.trackingNumber}</title>
      <style>
        @page { size: letter landscape; margin: 0.25in; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; }
        body { display: flex; }
        img { width: 50%; height: 100%; object-fit: contain; object-position: top left; }
      </style>
    </head><body>
      <img src="data:image/gif;base64,${result.labelBase64}" />
    </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 400)
  }

  function reset() {
    setStep('lookup'); setOrderId(''); setLookupErr(''); setAddress(null)
    setManualEntry(false); setResult(null); setGenErr('')
    setRateQuote(null); setRatingErr(''); setFetchingRate(false)
  }

  const serviceLabel = address?.services.find(s => s.code === pkg.serviceCode)?.label ?? pkg.serviceCode

  const inputCls = 'w-full h-9 rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue'
  const labelCls = 'block text-xs font-medium text-gray-700 mb-1'

  const steps: { key: Step; label: string }[] = [
    { key: 'lookup',  label: 'Order Lookup' },
    { key: 'details', label: 'Package Info' },
    { key: 'confirm', label: 'Confirm' },
    { key: 'done',    label: 'Label Ready' },
  ]
  const stepIdx = steps.findIndex(s => s.key === step)

  return (
    <div className="flex-1 overflow-auto">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-0 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('create')}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'create'
              ? 'border-amazon-blue text-amazon-blue'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          )}
        >
          <Plus size={14} /> Create Label
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'history'
              ? 'border-amazon-blue text-amazon-blue'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          )}
        >
          <History size={14} /> Label History
        </button>
      </div>

      {/* ── History tab ── */}
      {activeTab === 'history' && (
        <div className="px-6 py-6 max-w-3xl mx-auto w-full">
          <LabelHistoryTab />
        </div>
      )}

      {/* ── Create tab ── */}
      {activeTab === 'create' && (
        <div className="px-6 py-6 max-w-2xl mx-auto w-full">
          {/* Progress stepper */}
          <div className="flex items-center mb-8">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={clsx(
                    'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                    i < stepIdx  ? 'bg-green-500 text-white' :
                    i === stepIdx ? 'bg-amazon-blue text-white' :
                                    'bg-gray-100 text-gray-400',
                  )}>
                    {i < stepIdx ? <CheckCircle size={14} /> : i + 1}
                  </div>
                  <span className={clsx('text-[10px] mt-1 font-medium whitespace-nowrap',
                    i === stepIdx ? 'text-amazon-blue' : i < stepIdx ? 'text-green-600' : 'text-gray-400')}>
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className={clsx('flex-1 h-0.5 mx-2 mb-4 rounded', i < stepIdx ? 'bg-green-400' : 'bg-gray-200')} />
                )}
              </div>
            ))}
          </div>

          {/* ── STEP 1: Order ID lookup ── */}
          {step === 'lookup' && (
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">Enter Amazon Order ID</h2>
              <p className="text-xs text-gray-500 mb-5">
                We&apos;ll look up the customer&apos;s shipping address from your local database.
              </p>
              <form onSubmit={handleLookup} className="space-y-4">
                <div>
                  <label className={labelCls}>Amazon Order ID</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      className="w-full h-10 rounded-md border border-gray-300 pl-8 pr-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                      placeholder="114-1234567-1234567"
                      value={orderId}
                      onChange={e => { setOrderId(e.target.value); setLookupErr('') }}
                      autoFocus
                    />
                  </div>
                </div>
                {lookupErr && (
                  <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                    <AlertCircle size={14} className="shrink-0" /><span>{lookupErr}</span>
                  </div>
                )}
                <button type="submit" disabled={looking || !orderId.trim()}
                  className="flex items-center gap-2 h-10 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50">
                  {looking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  {looking ? 'Looking up…' : 'Look Up Address'}
                </button>
              </form>
            </div>
          )}

          {/* ── STEP 2: Address + Package ── */}
          {step === 'details' && address && (
            <form onSubmit={handleDetails} className="space-y-5">
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-900">Ship From (Buyer Address)</h2>
                  <span className="text-xs text-gray-400 font-mono">{address.amazonOrderId}</span>
                </div>
                {manualEntry && (
                  <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 mb-4">
                    <AlertCircle size={13} className="shrink-0 text-amber-500" />
                    <span>Address not found in database — please enter it manually.</span>
                  </div>
                )}
                {detailErr && (
                  <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 mb-4">
                    <AlertCircle size={13} className="shrink-0" /><span>{detailErr}</span>
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Full Name</label>
                    <input className={inputCls} value={editAddress.name} onChange={e => setEditAddress(a => ({ ...a, name: e.target.value }))} placeholder="Customer Name" required />
                  </div>
                  <div>
                    <label className={labelCls}>Address Line 1</label>
                    <input className={inputCls} value={editAddress.address1} onChange={e => setEditAddress(a => ({ ...a, address1: e.target.value }))} placeholder="123 Main St" required />
                  </div>
                  <div>
                    <label className={labelCls}>Address Line 2 <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input className={inputCls} value={editAddress.address2} onChange={e => setEditAddress(a => ({ ...a, address2: e.target.value }))} placeholder="Apt, Suite, etc." />
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <div className="col-span-2">
                      <label className={labelCls}>City</label>
                      <input className={inputCls} value={editAddress.city} onChange={e => setEditAddress(a => ({ ...a, city: e.target.value }))} placeholder="City" required />
                    </div>
                    <div>
                      <label className={labelCls}>State</label>
                      <input className={inputCls} value={editAddress.state} onChange={e => setEditAddress(a => ({ ...a, state: e.target.value }))} placeholder="NY" maxLength={2} required />
                    </div>
                    <div>
                      <label className={labelCls}>ZIP</label>
                      <input className={inputCls} value={editAddress.postal} onChange={e => setEditAddress(a => ({ ...a, postal: e.target.value }))} placeholder="10001" required />
                    </div>
                    <div>
                      <label className={labelCls}>Country</label>
                      <input className={inputCls} value={editAddress.country} onChange={e => setEditAddress(a => ({ ...a, country: e.target.value }))} placeholder="US" maxLength={2} required />
                    </div>
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Package size={15} className="text-gray-500" />
                  <h2 className="text-sm font-semibold text-gray-900">Package Details</h2>
                </div>
                <div className="space-y-3">
                  {upsAccounts.length > 1 && (
                    <div>
                      <label className={labelCls}>UPS Account</label>
                      <select className={inputCls} value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}>
                        {upsAccounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.nickname}{a.isDefault ? ' (Default)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={labelCls}>UPS Service</label>
                    <select className={inputCls} value={pkg.serviceCode} onChange={e => setPkg(p => ({ ...p, serviceCode: e.target.value }))}>
                      {address.services.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Weight</label>
                    <div className="flex gap-2">
                      <input className="flex-1 h-9 rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                        type="number" min="0.1" step="0.1" placeholder="e.g. 2.5"
                        value={pkg.weightValue} onChange={e => setPkg(p => ({ ...p, weightValue: e.target.value }))} required />
                      <select className="h-9 rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                        value={pkg.weightUnit} onChange={e => setPkg(p => ({ ...p, weightUnit: e.target.value as 'LBS' | 'OZS' }))}>
                        <option value="LBS">LBS</option>
                        <option value="OZS">OZS</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Dimensions <span className="text-gray-400 font-normal">(optional)</span></label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['length', 'width', 'height'] as const).map(dim => (
                        <div key={dim}>
                          <input className="w-full h-9 rounded-md border border-gray-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                            type="number" min="0" step="0.1" placeholder={dim.charAt(0).toUpperCase() + dim.slice(1)}
                            value={pkg[dim]} onChange={e => setPkg(p => ({ ...p, [dim]: e.target.value }))} />
                          <p className="text-[10px] text-gray-400 mt-0.5 text-center capitalize">{dim}</p>
                        </div>
                      ))}
                      <div>
                        <select className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                          value={pkg.dimUnit} onChange={e => setPkg(p => ({ ...p, dimUnit: e.target.value as 'IN' | 'CM' }))}>
                          <option value="IN">IN</option>
                          <option value="CM">CM</option>
                        </select>
                        <p className="text-[10px] text-gray-400 mt-0.5 text-center">Unit</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Package Description <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input className={inputCls} value={pkg.description} onChange={e => setPkg(p => ({ ...p, description: e.target.value }))} placeholder="Return Shipment" />
                  </div>
                  <div>
                    <label className={labelCls}>Reference # <span className="text-gray-400 font-normal">(printed on label)</span></label>
                    <input className={inputCls} value={pkg.referenceNumber} onChange={e => setPkg(p => ({ ...p, referenceNumber: e.target.value }))} placeholder="Order ID" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep('lookup')}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                  <ArrowLeft size={14} /> Back
                </button>
                <button type="submit"
                  className="flex-1 flex items-center justify-center gap-2 h-9 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">
                  Review &amp; Confirm →
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step === 'confirm' && (
            <div className="space-y-5">
              <div className="card p-6">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">Confirm Label Details</h2>
                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">From (Buyer)</p>
                    <p className="text-sm font-semibold text-gray-800">{editAddress.name}</p>
                    <p className="text-xs text-gray-600">{editAddress.address1}</p>
                    {editAddress.address2 && <p className="text-xs text-gray-600">{editAddress.address2}</p>}
                    <p className="text-xs text-gray-600">{editAddress.city}, {editAddress.state} {editAddress.postal}</p>
                    <p className="text-xs text-gray-500">{editAddress.country}</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                    <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-2">To (Warehouse)</p>
                    <p className="text-sm font-semibold text-gray-800">{DESTINATION.name}</p>
                    <p className="text-xs text-gray-600">{DESTINATION.address}</p>
                    <p className="text-xs text-gray-600">{DESTINATION.city}</p>
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Package</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {upsAccounts.length > 1 && (() => {
                      const acct = upsAccounts.find(a => a.id === selectedAccountId)
                      return acct ? (
                        <div className="flex justify-between col-span-2">
                          <span className="text-gray-500 text-xs">UPS Account</span>
                          <span className="font-medium text-xs">{acct.nickname}</span>
                        </div>
                      ) : null
                    })()}
                    <div className="flex justify-between">
                      <span className="text-gray-500 text-xs">Service</span>
                      <span className="font-medium text-xs">{serviceLabel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 text-xs">Weight</span>
                      <span className="font-medium text-xs">{pkg.weightValue} {pkg.weightUnit}</span>
                    </div>
                    {pkg.length && pkg.width && pkg.height && (
                      <div className="flex justify-between col-span-2">
                        <span className="text-gray-500 text-xs">Dimensions</span>
                        <span className="font-medium text-xs">{pkg.length} × {pkg.width} × {pkg.height} {pkg.dimUnit}</span>
                      </div>
                    )}
                    {pkg.referenceNumber && (
                      <div className="flex justify-between col-span-2">
                        <span className="text-gray-500 text-xs">Reference #</span>
                        <span className="font-mono text-xs">{pkg.referenceNumber}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Estimated Shipping Cost</p>
                  {!fetchingRate && (
                    <button type="button" onClick={fetchRate} className="flex items-center gap-1 text-xs text-amazon-blue hover:underline">
                      <RefreshCw size={11} /> Refresh
                    </button>
                  )}
                </div>
                {fetchingRate && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 size={15} className="animate-spin text-amazon-blue" />
                    <span>Fetching rate from UPS…</span>
                  </div>
                )}
                {!fetchingRate && ratingErr && (
                  <div className="flex items-start gap-2 text-xs text-red-600">
                    <AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{ratingErr}</span>
                  </div>
                )}
                {!fetchingRate && rateQuote && (
                  <div className="flex items-end gap-6">
                    {rateQuote.negotiatedRate ? (
                      <>
                        <div>
                          <p className="text-[10px] text-gray-400 mb-0.5">Your Rate (Negotiated)</p>
                          <p className="text-3xl font-bold text-green-600">
                            ${parseFloat(rateQuote.negotiatedRate).toFixed(2)}
                            <span className="text-sm font-medium text-gray-400 ml-1">{rateQuote.currency}</span>
                          </p>
                        </div>
                        <div className="pb-1">
                          <p className="text-[10px] text-gray-400 mb-0.5">Published Rate</p>
                          <p className="text-sm font-medium text-gray-400 line-through">
                            ${parseFloat(rateQuote.publishedRate).toFixed(2)}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5">Estimated Cost</p>
                        <p className="text-3xl font-bold text-gray-900">
                          ${parseFloat(rateQuote.publishedRate).toFixed(2)}
                          <span className="text-sm font-medium text-gray-400 ml-1">{rateQuote.currency}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {genErr && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={15} className="shrink-0" /><span>{genErr}</span>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => { setStep('details'); setGenErr('') }}
                  className="flex items-center gap-1.5 h-10 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                  <ArrowLeft size={14} /> Edit
                </button>
                <button type="button" onClick={handleGenerate} disabled={generating}
                  className="flex-1 flex items-center justify-center gap-2 h-10 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-60 shadow">
                  {generating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                  {generating ? 'Generating Label…' : 'Generate Label'}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Done ── */}
          {step === 'done' && result && (
            <div className="space-y-5">
              <div className="card p-6">
                <div className="flex items-start gap-3 mb-5">
                  <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <CheckCircle size={20} className="text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Return Label Generated</p>
                    <p className="text-xs text-gray-500 mt-0.5">The label has been created and is ready to print or download.</p>
                  </div>
                </div>

                <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 mb-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">UPS Tracking Number</p>
                  <p className="text-lg font-mono font-bold text-gray-900 tracking-wide">{result.trackingNumber}</p>
                </div>

                {result.shipmentCost && (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 mb-5">
                    <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide mb-3">Charge Breakdown</p>

                    {/* Line items */}
                    {result.chargeBreakdown && result.chargeBreakdown.length > 0 ? (
                      <div className="space-y-1.5 mb-3">
                        {result.chargeBreakdown.map((line, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-blue-600">{line.description}</span>
                            <span className="text-xs font-medium text-blue-700 tabular-nums">
                              ${parseFloat(line.amount).toFixed(2)}
                            </span>
                          </div>
                        ))}
                        <div className="border-t border-blue-200 pt-1.5 mt-1.5" />
                      </div>
                    ) : (
                      <p className="text-[10px] text-blue-400 mb-3 italic">
                        Detailed breakdown not available for this shipment.
                      </p>
                    )}

                    {/* Total */}
                    <div className="flex items-end justify-between">
                      <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Total Charged</span>
                      <p className="text-2xl font-bold text-blue-700 tabular-nums">
                        ${parseFloat(result.shipmentCost).toFixed(2)}
                        <span className="text-sm font-medium text-blue-500 ml-1">{result.currency ?? 'USD'}</span>
                      </p>
                    </div>
                  </div>
                )}

                <button type="button" onClick={openLabel}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-amazon-blue/90 shadow">
                  <Printer size={16} /> Open / Print Label
                </button>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={reset}
                  className="flex-1 h-9 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                  Generate Another Label
                </button>
                <button type="button" onClick={() => setActiveTab('history')}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200">
                  <History size={14} /> View History
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

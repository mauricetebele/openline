'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle, AlertTriangle, Clock, RefreshCw, FlaskConical,
  ExternalLink, Warehouse, Truck, Settings,
  ChevronRight,
} from 'lucide-react'
import AppShell from '@/components/AppShell'
import WarehouseManager from '@/components/WarehouseManager'

// ─── Brand logo components ────────────────────────────────────────────────────

function AmazonLogo({ height = 20 }: { height?: number }) {
  return (
    <img
      src="/logos/amazon.svg"
      alt="Amazon"
      height={height}
      style={{ height, width: 'auto', display: 'block' }}
    />
  )
}

function BackMarketLogo({ height = 20 }: { height?: number }) {
  return (
    <img
      src="/logos/backmarket.svg"
      alt="Back Market"
      height={height}
      style={{ height, width: 'auto', display: 'block' }}
    />
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface V2Carrier {
  carrier_id: string
  carrier_code: string
  nickname: string
  friendly_name: string
}

interface CarrierTestResult {
  v1: { ok: boolean; carriers?: { code: string; name: string; nickname: string | null }[]; error?: string }
  v2: { ok: boolean; carriers?: V2Carrier[]; error?: string }
}

interface SSAccount {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  partition: number | null
  internalJwtExp: string | null
  defaultShipFromId: string | null
  internalSellerId: string | null
  internalUserId: string | null
  amazonCarrierId: string | null
  hasV2Key: boolean
}

interface AmazonAccount {
  id: string
  sellerId: string
  marketplaceName: string
  region: string
  isActive: boolean
  createdAt: string
}

type Section = 'amazon' | 'shipstation' | 'warehouses' | 'ups' | 'backmarket'

// ─── Amazon Accounts Section ──────────────────────────────────────────────────

function AmazonAccountsSection() {
  const [accounts, setAccounts] = useState<AmazonAccount[]>([])
  const [saving, setSaving] = useState(false)
  const [sellerId, setSellerId] = useState('')
  const [refreshToken, setRefreshToken] = useState('')

  useEffect(() => { fetchAccounts() }, [])

  async function fetchAccounts() {
    const res = await fetch('/api/accounts')
    if (res.ok) setAccounts(await res.json())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId, refreshToken }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Amazon account connected successfully!')
      setSellerId('')
      setRefreshToken('')
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed to save account: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {accounts.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b">
            <p className="font-semibold text-sm">Connected Accounts</p>
          </div>
          <div className="divide-y">
            {accounts.map(a => (
              <div key={a.id} className="flex items-center gap-4 px-5 py-4">
                <CheckCircle size={16} className="text-green-500 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{a.marketplaceName}</p>
                  <p className="text-xs text-gray-400">Seller ID: {a.sellerId} · {a.region}</p>
                </div>
                <span className="ml-auto badge-green text-xs">Active</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="rounded-xl p-2 bg-amazon-orange/10 flex items-center justify-center shrink-0">
            <AmazonLogo height={22} />
          </div>
          <div>
            <p className="font-semibold">Add Amazon Seller Account</p>
            <p className="text-sm text-gray-500 mt-1">
              Get your refresh token from Seller Central → Apps &amp; Services → Manage Your Apps.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Seller ID</label>
            <input className="input" placeholder="A3CUWXS22IILW1" value={sellerId}
              onChange={e => setSellerId(e.target.value)} required />
          </div>
          <div>
            <label className="label">Refresh Token</label>
            <textarea className="input font-mono text-xs" rows={4} placeholder="Atzr|..."
              value={refreshToken} onChange={e => setRefreshToken(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary w-full justify-center" disabled={saving}>
            {saving ? 'Saving…' : 'Connect Account'}
          </button>
        </form>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-blue-800 mb-2">How to get your Refresh Token</p>
        <ol className="list-decimal list-inside space-y-1.5 text-blue-700 text-xs">
          <li>Go to <strong>Seller Central → Apps &amp; Services → Manage Your Apps</strong></li>
          <li>Find your developer app and click <strong>Authorize</strong></li>
          <li>Complete the authorization — you will be given a refresh token</li>
          <li>Paste it above along with your Seller ID</li>
        </ol>
        <a href="https://sellercentral.amazon.com/apps/manage" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-3 text-blue-600 hover:underline text-xs font-medium">
          Open Seller Central <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

// ─── ShipStation Section ───────────────────────────────────────────────────────

function ShipStationSection() {
  const [accounts, setAccounts] = useState<SSAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [jwt, setJwt] = useState('')
  const [v2ApiKey, setV2ApiKey] = useState('')
  const [shipFromId, setShipFromId] = useState('')
  const [amazonCarrierId, setAmazonCarrierId] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<CarrierTestResult | null>(null)

  useEffect(() => { fetchAccounts() }, [])

  async function fetchAccounts() {
    setLoading(true)
    const res = await fetch('/api/shipstation/accounts')
    if (res.ok) {
      const data: SSAccount[] = await res.json()
      setAccounts(data)
      const first = data[0]
      if (first) {
        setActiveId(first.id)
        setShipFromId(first.defaultShipFromId ?? '')
        setAmazonCarrierId(first.amazonCarrierId ?? '')
      }
    }
    setLoading(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeId) return
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (jwt.trim())             body.internalJwt       = jwt.trim()
      if (v2ApiKey.trim())        body.v2ApiKey          = v2ApiKey.trim()
      if (shipFromId.trim())      body.defaultShipFromId = shipFromId.trim()
      if (amazonCarrierId.trim()) body.amazonCarrierId   = amazonCarrierId.trim()
      const res = await fetch(`/api/shipstation/accounts/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('ShipStation settings saved!')
      setJwt('')
      setV2ApiKey('')
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/shipstation/carriers')
      if (!res.ok) throw new Error((await res.json()).error ?? `${res.status}`)
      const data: CarrierTestResult = await res.json()
      setTestResult(data)
      const amazonCarrier = data.v2.carriers?.find(c => c.carrier_code?.toLowerCase().includes('amazon'))
      if (amazonCarrier && !amazonCarrierId) {
        setAmazonCarrierId(String(amazonCarrier.carrier_id))
        toast.info(`Amazon carrier ID auto-filled: ${amazonCarrier.carrier_id}`)
      }
    } catch (err) {
      toast.error(`Test failed: ${(err as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  function jwtStatus(account: SSAccount) {
    if (!account.internalJwtExp) return null
    const exp = new Date(account.internalJwtExp)
    if (exp < new Date()) return 'expired'
    return Math.floor((exp.getTime() - Date.now()) / 3_600_000)
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="max-w-2xl space-y-6">
      {accounts.map(account => {
        const status = jwtStatus(account)
        return (
          <div key={account.id} className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle size={16} className="text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">{account.name}</p>
                <p className="text-xs text-gray-400">Connected · API key configured</p>
              </div>
            </div>

            <div className="mb-4 rounded-lg border px-4 py-3 text-sm space-y-2">
              {status === null && <p className="text-gray-500">No session token saved yet.</p>}
              {status === 'expired' && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle size={14} />
                  <span>Session token <strong>expired</strong> — paste a fresh one below.</span>
                </div>
              )}
              {typeof status === 'number' && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-green-700">
                    <Clock size={14} />
                    <span>Session token valid · expires in <strong>{status}h</strong></span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pt-1">
                    {([
                      ['Partition', account.partition],
                      ['Seller ID', account.internalSellerId],
                      ['User ID',   account.internalUserId],
                      ['Ship-from', account.defaultShipFromId ?? '(uses warehouse dropdown)'],
                    ] as [string, string | number | null][]).map(([label, val]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        {val ? <CheckCircle size={11} className="text-green-500 shrink-0" />
                             : <AlertTriangle size={11} className="text-red-400 shrink-0" />}
                        <span className="text-gray-500">{label}:</span>
                        <span className={val ? 'text-gray-800 font-mono truncate' : 'text-red-400 italic'}>
                          {val ?? 'missing'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {activeId === account.id && (
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="label">Session Token (Bearer JWT)</label>
                  <textarea className="input font-mono text-xs" rows={5}
                    placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXV..."
                    value={jwt} onChange={e => setJwt(e.target.value.replace(/\s+/g, ''))} />
                  <p className="text-xs text-gray-400 mt-1">
                    Expires every ~16 hours. Get it from ShipStation → DevTools → Network → any request → copy Authorization header (remove &quot;Bearer &quot;).
                  </p>
                </div>
                <div>
                  <label className="label">
                    ShipEngine / V2 API Key
                    {account.hasV2Key && <span className="ml-2 text-green-600 text-xs font-normal">✓ saved</span>}
                  </label>
                  <input className="input font-mono" placeholder="TEST_abc123... or LIVE_abc123..."
                    value={v2ApiKey} onChange={e => setV2ApiKey(e.target.value.trim())} />
                  <p className="text-xs text-gray-400 mt-1">
                    Found in ShipStation → Account Settings → API Settings → ShipEngine API Key.
                  </p>
                </div>
                <div>
                  <label className="label">Ship-From Warehouse ID</label>
                  <input className="input font-mono" placeholder="1663524"
                    value={shipFromId} onChange={e => setShipFromId(e.target.value)} />
                </div>
                <div>
                  <label className="label">
                    Amazon Buy Shipping Carrier ID
                    {account.amazonCarrierId && (
                      <span className="ml-2 text-green-600 font-mono text-xs font-normal">✓ {account.amazonCarrierId}</span>
                    )}
                  </label>
                  <input className="input font-mono" placeholder="se-5013604"
                    value={amazonCarrierId} onChange={e => setAmazonCarrierId(e.target.value)} />
                </div>
                <button type="submit" className="btn-primary" disabled={saving || (!jwt.trim() && !v2ApiKey.trim() && !shipFromId.trim() && !amazonCarrierId.trim())}>
                  <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
              </form>
            )}
          </div>
        )
      })}

      {accounts.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-500">
          No ShipStation account found. Add one from the Unshipped Orders page.
        </div>
      )}

      {accounts.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-sm">Carrier API Test</p>
              <p className="text-xs text-gray-400 mt-0.5">Verifies V1 and V2 carrier connectivity.</p>
            </div>
            <button onClick={handleTest} disabled={testing} className="btn-primary shrink-0">
              <FlaskConical size={14} className={testing ? 'animate-pulse' : ''} />
              {testing ? 'Testing…' : 'Test Carriers'}
            </button>
          </div>
          {testResult && (
            <div className="space-y-3 mt-3">
              {[
                { label: 'V1 API (Basic auth)', result: testResult.v1, isV2: false },
                { label: 'V2 API (API-Key)',    result: testResult.v2, isV2: true  },
              ].map(({ label, result, isV2 }) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                    {result.ok ? <CheckCircle size={12} className="text-green-500" />
                               : <AlertTriangle size={12} className="text-red-400" />}
                    {label} — {result.ok ? `${result.carriers?.length} carriers` : 'failed'}
                  </p>
                  {result.ok ? (
                    isV2 ? (
                      <div className="space-y-1">
                        {(result as CarrierTestResult['v2']).carriers?.map(c => {
                          const isAmazon = c.carrier_code?.toLowerCase().includes('amazon')
                          return (
                            <div key={c.carrier_id} className={`flex items-center gap-2 text-[10px] font-mono px-1.5 py-1 rounded ${isAmazon ? 'bg-orange-50 border border-orange-200' : 'bg-gray-100'}`}>
                              {isAmazon && <span className="text-orange-600 font-bold text-[9px] uppercase">Amazon</span>}
                              <span className="text-gray-600">{c.friendly_name || c.nickname}</span>
                              <span className="ml-auto text-blue-600 font-bold">id: {c.carrier_id}</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(result as CarrierTestResult['v1']).carriers?.map(c => (
                          <span key={c.code} className="font-mono text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                            {c.nickname || c.name} ({c.code})
                          </span>
                        ))}
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-red-500">{result.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-blue-800 mb-2">How to get your Session Token</p>
        <ol className="list-decimal list-inside space-y-1.5 text-blue-700 text-xs">
          <li>Open <strong>ShipStation</strong> in Chrome and go to an unshipped order</li>
          <li>Press <strong>F12</strong> → click the <strong>Network</strong> tab → clear it</li>
          <li>Click the button that shows Amazon Buy Shipping rates</li>
          <li>Find the <code className="bg-blue-100 px-1 rounded">api/rate/browse</code> request</li>
          <li>Click it → <strong>Headers</strong> → copy the <code className="bg-blue-100 px-1 rounded">Authorization</code> value (everything after &quot;Bearer &quot;)</li>
          <li>Paste it above and click Save</li>
        </ol>
      </div>
    </div>
  )
}

// ─── UPS Credentials Section ───────────────────────────────────────────────────

function UpsCredentialsSection() {
  const [configured, setConfigured] = useState(false)
  const [maskedClientId, setMaskedClientId] = useState<string | null>(null)
  const [maskedAccountNumber, setMaskedAccountNumber] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchStatus() }, [])

  async function fetchStatus() {
    const res = await fetch('/api/ups/credentials')
    if (res.ok) {
      const data = await res.json()
      setConfigured(data.configured ?? false)
      setMaskedClientId(data.maskedClientId ?? null)
      setMaskedAccountNumber(data.maskedAccountNumber ?? null)
      setUpdatedAt(data.updatedAt ?? null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/ups/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), accountNumber: accountNumber.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('UPS credentials saved!')
      setClientId('')
      setClientSecret('')
      setAccountNumber('')
      fetchStatus()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {configured && (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <CheckCircle size={16} className="text-green-500 shrink-0" />
            <div>
              <p className="font-semibold text-sm">UPS API Connected</p>
              <p className="text-xs text-gray-400">
                Client ID: <span className="font-mono">{maskedClientId}</span>
                {maskedAccountNumber && <> · Account #: <span className="font-mono">{maskedAccountNumber}</span></>}
                {updatedAt && ` · Updated ${new Date(updatedAt).toLocaleDateString()}`}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="rounded-xl p-3 bg-amber-50">
            <Truck size={20} className="text-amber-600" />
          </div>
          <div>
            <p className="font-semibold">{configured ? 'Update UPS Credentials' : 'Connect UPS API'}</p>
            <p className="text-sm text-gray-500 mt-1">
              UPS credentials are used to fetch live tracking status and generate return labels.
              Register at <a href="https://developer.ups.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developer.ups.com</a>.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Client ID</label>
            <input className="input font-mono" placeholder="m7St8F1ZKIw5oq…"
              value={clientId} onChange={e => setClientId(e.target.value)} required />
          </div>
          <div>
            <label className="label">Client Secret</label>
            <input className="input font-mono" type="password" placeholder="SfCvVYFaI8Aeap…"
              value={clientSecret} onChange={e => setClientSecret(e.target.value)} required />
          </div>
          <div>
            <label className="label">Account Number <span className="text-gray-400 font-normal">(required for generating return labels)</span></label>
            <input className="input font-mono" placeholder="12AB34"
              value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : configured ? 'Update Credentials' : 'Save Credentials'}
          </button>
        </form>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-amber-800 mb-2">How to get UPS API Credentials</p>
        <ol className="list-decimal list-inside space-y-1.5 text-amber-700 text-xs">
          <li>Go to <a href="https://developer.ups.com" target="_blank" rel="noopener noreferrer" className="underline">developer.ups.com</a> and sign in with your UPS account</li>
          <li>Create a new app under <strong>My Apps</strong></li>
          <li>Select the <strong>Track API</strong>, <strong>Shipping API</strong>, and <strong>Rating API</strong> products</li>
          <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from your app</li>
          <li>Find your <strong>Account Number</strong> (6-character shipper number) in UPS.com → My UPS → Account Summary</li>
        </ol>
      </div>
    </div>
  )
}

// ─── Back Market Credentials Section ─────────────────────────────────────────

function BackMarketSection() {
  const [configured, setConfigured] = useState(false)
  const [maskedKey, setMaskedKey]   = useState<string | null>(null)
  const [updatedAt, setUpdatedAt]   = useState<string | null>(null)
  const [apiKey, setApiKey]         = useState('')
  const [saving, setSaving]         = useState(false)

  useEffect(() => { fetchStatus() }, [])

  async function fetchStatus() {
    const res = await fetch('/api/backmarket/credentials')
    if (res.ok) {
      const data = await res.json()
      setConfigured(data.configured ?? false)
      setMaskedKey(data.maskedKey ?? null)
      setUpdatedAt(data.updatedAt ?? null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/backmarket/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Back Market API key saved!')
      setApiKey('')
      fetchStatus()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {configured && (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <CheckCircle size={16} className="text-green-500 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Back Market API Connected</p>
              <p className="text-xs text-gray-400">
                API Key: <span className="font-mono">{maskedKey}</span>
                {updatedAt && ` · Updated ${new Date(updatedAt).toLocaleDateString()}`}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="rounded-xl p-2 bg-green-50 flex items-center justify-center shrink-0">
            <BackMarketLogo height={22} />
          </div>
          <div>
            <p className="font-semibold">{configured ? 'Update Back Market API Key' : 'Connect Back Market'}</p>
            <p className="text-sm text-gray-500 mt-1">
              Your Back Market API key is used to sync orders and manage listings on the Back Market marketplace.
              Find it in your Back Market seller dashboard under API settings.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">API Key</label>
            <input
              className="input font-mono"
              type="password"
              placeholder="bm_live_…"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : configured ? 'Update Key' : 'Save Key'}
          </button>
        </form>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-green-800 mb-2">How to get your Back Market API Key</p>
        <ol className="list-decimal list-inside space-y-1.5 text-green-700 text-xs">
          <li>Log in to your Back Market seller account</li>
          <li>Go to <strong>Settings → API</strong></li>
          <li>Generate or copy your existing API key</li>
          <li>Paste it above and click Save</li>
        </ol>
      </div>
    </div>
  )
}

// ─── Hub Cards Data ────────────────────────────────────────────────────────────

interface HubCard {
  id: Section
  icon: React.ElementType
  iconBg: string
  iconColor: string
  title: string
  description: string
  logo?: React.ReactNode  // if set, shown instead of icon
}

interface HubGroup {
  label: string
  cards: HubCard[]
}

const HUB_GROUPS: HubGroup[] = [
  {
    label: 'Integrations',
    cards: [
      {
        id: 'amazon',
        icon: RefreshCw,
        iconBg: 'bg-amazon-orange/10',
        iconColor: 'text-amazon-orange',
        title: 'Amazon',
        description: 'Connect your Amazon Seller account via SP-API refresh token to enable refund auditing, rate shopping, and label purchasing.',
        logo: <AmazonLogo height={18} />,
      },
      {
        id: 'backmarket',
        icon: RefreshCw,
        iconBg: 'bg-green-50',
        iconColor: 'text-green-600',
        title: 'Back Market',
        description: 'Connect your Back Market seller account to sync orders and manage listings on the Back Market marketplace.',
        logo: <BackMarketLogo height={18} />,
      },
      {
        id: 'shipstation',
        icon: RefreshCw,
        iconBg: 'bg-blue-50',
        iconColor: 'text-blue-600',
        title: 'ShipStation',
        description: 'Configure your ShipStation session token, ShipEngine V2 API key, and default ship-from warehouse for rate shopping and label creation.',
      },
      {
        id: 'ups',
        icon: Truck,
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-600',
        title: 'UPS API',
        description: 'Store your UPS developer credentials to enable live tracking status lookups on MFN Returns without leaving the app.',
      },
    ],
  },
  {
    label: 'Operations',
    cards: [
      {
        id: 'warehouses',
        icon: Warehouse,
        iconBg: 'bg-purple-50',
        iconColor: 'text-purple-600',
        title: 'Warehouses',
        description: 'Add and manage ship-from warehouse locations used when purchasing shipping labels through ShipStation.',
      },
    ],
  },
]

// ─── Settings Page ─────────────────────────────────────────────────────────────

function SettingsContent() {
  const [activeSection, setActiveSection] = useState<Section | null>(null)

  function handleCardClick(id: Section) {
    setActiveSection(prev => prev === id ? null : id)
  }

  const activeCard = HUB_GROUPS.flatMap(g => g.cards).find(c => c.id === activeSection)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white shrink-0 flex items-center gap-3">
        <Settings size={20} className="text-gray-500" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage integrations and configuration</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-8">

        {/* Hub grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {HUB_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.cards.map(card => {
                  const Icon = card.icon
                  const isActive = activeSection === card.id
                  return (
                    <button
                      key={card.id}
                      onClick={() => handleCardClick(card.id)}
                      className={`w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-all ${
                        isActive
                          ? 'border-amazon-blue bg-blue-50 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                      }`}
                    >
                      <div className={`rounded-lg p-2 shrink-0 flex items-center justify-center ${card.iconBg}`}>
                        {card.logo ?? <Icon size={16} className={card.iconColor} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold leading-tight ${isActive ? 'text-amazon-blue' : 'text-gray-800'}`}>
                          {card.title}
                        </p>
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                          {card.description}
                        </p>
                      </div>
                      <ChevronRight
                        size={14}
                        className={`shrink-0 mt-0.5 transition-transform ${
                          isActive ? 'rotate-90 text-amazon-blue' : 'text-gray-300'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {activeSection && (
          <div className="border-t pt-6">
            {activeCard && (
              <div className="mb-5 flex items-center gap-3">
                <div className={`rounded-lg p-2 flex items-center justify-center ${activeCard.iconBg}`}>
                  {activeCard.logo ?? <activeCard.icon size={16} className={activeCard.iconColor} />}
                </div>
                <h2 className="text-base font-semibold text-gray-900">{activeCard.title}</h2>
              </div>
            )}
            {activeSection === 'amazon'      && <AmazonAccountsSection />}
            {activeSection === 'shipstation' && <ShipStationSection />}
            {activeSection === 'warehouses'  && <WarehouseManager />}
            {activeSection === 'ups'         && <UpsCredentialsSection />}
            {activeSection === 'backmarket'  && <BackMarketSection />}
          </div>
        )}

      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsContent />
    </AppShell>
  )
}

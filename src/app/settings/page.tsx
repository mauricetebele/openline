'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle, AlertTriangle, Clock, RefreshCw, FlaskConical,
  ExternalLink, Warehouse, Truck, Settings,
  ChevronRight, Trash2, RotateCcw, Plus, X,
  Store, Upload, ImageIcon, Users, Shield, Printer, Package,
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

type Section = 'amazon' | 'shipstation' | 'warehouses' | 'ups' | 'fedex' | 'backmarket' | 'rma-settings' | 'store-settings' | 'users' | 'printer'

// ─── Amazon Accounts Section ──────────────────────────────────────────────────

function AmazonAccountsSection() {
  const [accounts, setAccounts] = useState<AmazonAccount[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [sellerId, setSellerId] = useState('')
  const [refreshToken, setRefreshToken] = useState('')

  useEffect(() => { fetchAccounts() }, [])

  async function fetchAccounts() {
    const res = await fetch('/api/accounts')
    if (res.ok) setAccounts(await res.json())
  }

  async function handleDelete(id: string, sellerName: string) {
    if (!confirm(`Remove ${sellerName}? This will disconnect the account.`)) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Account removed')
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed to remove: ${(err as Error).message}`)
    } finally {
      setDeleting(null)
    }
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
                <button
                  onClick={() => handleDelete(a.id, a.marketplaceName)}
                  disabled={deleting === a.id}
                  className="ml-2 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Remove account"
                >
                  <Trash2 size={14} className={deleting === a.id ? 'animate-pulse' : ''} />
                </button>
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
  const [showAddForm, setShowAddForm] = useState(false)
  const [addApiKey, setAddApiKey] = useState('')
  const [addApiSecret, setAddApiSecret] = useState('')
  const [addName, setAddName] = useState('')
  const [connecting, setConnecting] = useState(false)

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

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!addApiKey.trim()) return
    setConnecting(true)
    try {
      const res = await fetch('/api/shipstation/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim() || 'ShipStation',
          apiKey: addApiKey.trim(),
          apiSecret: addApiSecret.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('ShipStation account connected!')
      setAddApiKey('')
      setAddApiSecret('')
      setAddName('')
      setShowAddForm(false)
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setConnecting(false)
    }
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

      {/* Add Account */}
      <div className="card">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <p className="font-semibold text-sm">{accounts.length === 0 ? 'Connect ShipStation' : 'Add Another Account'}</p>
          {accounts.length > 0 && (
            <button
              onClick={() => setShowAddForm(f => !f)}
              className="flex items-center gap-1.5 text-xs font-medium text-amazon-blue hover:underline"
            >
              <Plus size={14} /> Add Account
            </button>
          )}
        </div>
        {(showAddForm || accounts.length === 0) && (
          <form onSubmit={handleConnect} className="px-5 py-4 space-y-4">
            <div>
              <label className="label">Account Name</label>
              <input className="input" placeholder="ShipStation" value={addName} onChange={e => setAddName(e.target.value)} />
            </div>
            <div>
              <label className="label">API Key</label>
              <input className="input font-mono" placeholder="V1 API Key or V2 ShipEngine Key" value={addApiKey} onChange={e => setAddApiKey(e.target.value)} required />
              <p className="text-[10px] text-gray-400 mt-1">Found in ShipStation → Account Settings → API Settings.</p>
            </div>
            <div>
              <label className="label">API Secret <span className="text-gray-400 font-normal">(leave blank for V2-only)</span></label>
              <input className="input font-mono" type="password" placeholder="V1 API Secret" value={addApiSecret} onChange={e => setAddApiSecret(e.target.value)} />
              <p className="text-[10px] text-gray-400 mt-1">Required for V1 Basic auth. If you only have a V2/ShipEngine key, leave this empty.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={connecting || !addApiKey.trim()} className="btn-primary">
                <RefreshCw size={14} className={connecting ? 'animate-spin' : ''} />
                {connecting ? 'Testing & Saving…' : 'Connect Account'}
              </button>
              {accounts.length > 0 && (
                <button type="button" onClick={() => setShowAddForm(false)} className="btn btn-secondary text-xs">Cancel</button>
              )}
            </div>
          </form>
        )}
      </div>

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

// ─── FedEx Credentials Section ────────────────────────────────────────────────

function FedexCredentialsSection() {
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
    const res = await fetch('/api/fedex/credentials')
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
      const res = await fetch('/api/fedex/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), accountNumber: accountNumber.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('FedEx credentials saved!')
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
              <p className="font-semibold text-sm">FedEx API Connected</p>
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
          <div className="rounded-xl p-3 bg-purple-50">
            <Package size={20} className="text-purple-600" />
          </div>
          <div>
            <p className="font-semibold">{configured ? 'Update FedEx Credentials' : 'Connect FedEx API'}</p>
            <p className="text-sm text-gray-500 mt-1">
              FedEx credentials are used to fetch live tracking status for FedEx shipments.
              Register at <a href="https://developer.fedex.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developer.fedex.com</a>.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">API Key (Client ID)</label>
            <input className="input font-mono" placeholder="l7a1b2c3d4e5f6…"
              value={clientId} onChange={e => setClientId(e.target.value)} required />
          </div>
          <div>
            <label className="label">Secret Key (Client Secret)</label>
            <input className="input font-mono" type="password" placeholder="a1b2c3d4e5f6g7…"
              value={clientSecret} onChange={e => setClientSecret(e.target.value)} required />
          </div>
          <div>
            <label className="label">Account Number <span className="text-gray-400 font-normal">(optional — required for shipping labels)</span></label>
            <input className="input font-mono" placeholder="123456789"
              value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : configured ? 'Update Credentials' : 'Save Credentials'}
          </button>
        </form>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-purple-800 mb-2">How to get FedEx API Credentials</p>
        <ol className="list-decimal list-inside space-y-1.5 text-purple-700 text-xs">
          <li>Go to <a href="https://developer.fedex.com" target="_blank" rel="noopener noreferrer" className="underline">developer.fedex.com</a> and create an account</li>
          <li>Create a new project under <strong>My Projects</strong></li>
          <li>Select the <strong>Track API</strong> (and Ship API / Rate API if needed)</li>
          <li>Copy the <strong>API Key</strong> (Client ID) and <strong>Secret Key</strong> (Client Secret)</li>
          <li>Your <strong>Account Number</strong> is found in your FedEx account profile (9-digit number)</li>
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

// ─── Store Settings Section ────────────────────────────────────────────────────

function StoreSettingsSection() {
  const [storeName, setStoreName] = useState('Open Line Mobility')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [thankYouMsg, setThankYouMsg] = useState('Thank you for shopping with us!')
  const [primaryColor, setPrimaryColor] = useState('#14284B')
  const [accentColor, setAccentColor] = useState('#007ACC')
  const safeHex = (v: string, fb: string) => /^#[0-9A-Fa-f]{6}$/.test(v) ? v : fb
  const primaryRef = useRef<HTMLInputElement>(null!)
  const accentRef = useRef<HTMLInputElement>(null!)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoBase64, setLogoBase64] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null!)

  useEffect(() => {
    fetch('/api/store-settings')
      .then(r => r.json())
      .then(data => {
        setStoreName(data.storeName ?? '')
        setPhone(data.phone ?? '')
        setEmail(data.email ?? '')
        setAddressLine(data.addressLine ?? '')
        setCity(data.city ?? '')
        setState(data.state ?? '')
        setZip(data.zip ?? '')
        setThankYouMsg(data.thankYouMsg ?? '')
        setPrimaryColor(data.primaryColor ?? '#14284B')
        setAccentColor(data.accentColor ?? '#007ACC')
        if (data.logoBase64) { setLogoPreview(data.logoBase64); setLogoBase64(data.logoBase64) }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 400_000) { toast.error('Logo must be under 400 KB'); return }
    if (!file.type.startsWith('image/')) { toast.error('File must be an image'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setLogoPreview(result)
      setLogoBase64(result)
    }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/store-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeName, logoBase64, phone, email, addressLine, city, state, zip, thankYouMsg, primaryColor: safeHex(primaryColor, '#14284B'), accentColor: safeHex(accentColor, '#007ACC') }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Store settings saved!')
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading...</p>

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card p-6 space-y-5">
        {/* Logo upload */}
        <div>
          <label className="label mb-2">Store Logo</label>
          <div className="flex items-center gap-4">
            <div
              onClick={() => fileRef.current?.click()}
              className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 hover:border-amazon-blue flex items-center justify-center cursor-pointer transition-colors overflow-hidden bg-gray-50"
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <div className="text-center">
                  <ImageIcon size={20} className="mx-auto text-gray-400" />
                  <span className="text-[10px] text-gray-400 mt-1 block">Upload</span>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs font-medium text-amazon-blue hover:underline"
              >
                <Upload size={12} /> Choose image
              </button>
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => { setLogoPreview(null); setLogoBase64(null) }}
                  className="flex items-center gap-1 text-xs text-red-500 hover:underline"
                >
                  <Trash2 size={12} /> Remove
                </button>
              )}
              <p className="text-[10px] text-gray-400">PNG or JPG, max 400 KB. Shows on invoices.</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
          </div>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Store Name</label>
            <input className="input" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="Open Line Mobility" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="info@example.com" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Street Address</label>
            <input className="input" value={addressLine} onChange={e => setAddressLine(e.target.value)} placeholder="123 Main St" />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={city} onChange={e => setCity(e.target.value)} placeholder="Miami" />
          </div>
          <div>
            <label className="label">State / Zip</label>
            <div className="flex gap-2">
              <input className="input w-20" value={state} onChange={e => setState(e.target.value)} placeholder="FL" maxLength={2} />
              <input className="input flex-1" value={zip} onChange={e => setZip(e.target.value)} placeholder="33101" />
            </div>
          </div>
        </div>
        <div>
          <label className="label">Thank You Message</label>
          <input className="input" value={thankYouMsg} onChange={e => setThankYouMsg(e.target.value)} placeholder="Thank you for shopping with us!" />
          <p className="text-[10px] text-gray-400 mt-1">Appears at the bottom of invoices.</p>
        </div>

        {/* Invoice Color Theme */}
        <div className="border-t pt-5 space-y-3">
          <label className="label">Invoice Color Theme</label>
          <input ref={primaryRef} type="color" className="hidden" onChange={e => setPrimaryColor(e.target.value)} />
          <input ref={accentRef} type="color" className="hidden" onChange={e => setAccentColor(e.target.value)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Primary Color (header, totals)</label>
              <div className="flex items-center gap-2">
                <div
                  onClick={() => { primaryRef.current.value = safeHex(primaryColor, '#14284B'); primaryRef.current.click() }}
                  className="w-10 h-10 rounded border border-gray-200 cursor-pointer shrink-0"
                  style={{ backgroundColor: safeHex(primaryColor, '#14284B') }}
                />
                <input className="input flex-1 font-mono text-sm" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} placeholder="#14284B" maxLength={7} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Accent Color (thank-you text)</label>
              <div className="flex items-center gap-2">
                <div
                  onClick={() => { accentRef.current.value = safeHex(accentColor, '#007ACC'); accentRef.current.click() }}
                  className="w-10 h-10 rounded border border-gray-200 cursor-pointer shrink-0"
                  style={{ backgroundColor: safeHex(accentColor, '#007ACC') }}
                />
                <input className="input flex-1 font-mono text-sm" value={accentColor} onChange={e => setAccentColor(e.target.value)} placeholder="#007ACC" maxLength={7} />
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400">Controls the colors used in generated PDF invoices.</p>
        </div>

        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
          {saving ? 'Saving...' : 'Save Store Settings'}
        </button>
      </div>
    </div>
  )
}

// ─── Hub Cards Data ────────────────────────────────────────────────────────────

// ─── RMA Settings Section ─────────────────────────────────────────────────────

interface ReturnReason {
  id: string
  label: string
  sortOrder: number
  isActive: boolean
}

function RMASettingsSection() {
  const [reasons, setReasons] = useState<ReturnReason[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/rma-return-reasons')
      .then(r => r.json())
      .then(j => setReasons(j.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd() {
    if (!newLabel.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/rma-return-reasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to add'); return }
      setReasons(prev => [...prev, data])
      setNewLabel('')
      toast.success('Return reason added')
    } catch { toast.error('Failed to add reason') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/rma-return-reasons?id=${id}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Failed to delete'); return }
      setReasons(prev => prev.filter(r => r.id !== id))
      toast.success('Reason removed')
    } catch { toast.error('Failed to delete') }
    finally { setDeletingId(null) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Return Reasons</h3>
        <p className="text-xs text-gray-500 mb-4">
          These options appear in the reason dropdown when creating a marketplace return (MP-RMA).
        </p>

        {/* Add new */}
        <div className="flex items-center gap-2 mb-4">
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="e.g. Defective, Wrong Item, Buyer Remorse..."
            className="flex-1 h-9 px-3 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          <button
            onClick={handleAdd}
            disabled={!newLabel.trim() || saving}
            className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading...</p>
        ) : reasons.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No return reasons configured yet</p>
        ) : (
          <div className="space-y-1.5">
            {reasons.map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-200 bg-white"
              >
                <span className="text-sm text-gray-800">{r.label}</span>
                <button
                  onClick={() => handleDelete(r.id)}
                  disabled={deletingId === r.id}
                  className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Users Management Section ─────────────────────────────────────────────────

interface ManagedUser {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
}

function UsersSection() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Form state
  const [formEmail, setFormEmail] = useState('')
  const [formName, setFormName] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formRole, setFormRole] = useState<'REVIEWER' | 'ADMIN'>('REVIEWER')

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users')
      if (res.ok) {
        const json = await res.json()
        setUsers(json.data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formEmail, name: formName, password: formPassword, role: formRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`User ${formName} created`)
      setFormEmail('')
      setFormName('')
      setFormPassword('')
      setFormRole('REVIEWER')
      setShowForm(false)
      fetchUsers()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleRole(u: ManagedUser) {
    const newRole = u.role === 'ADMIN' ? 'REVIEWER' : 'ADMIN'
    setTogglingId(u.id)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, role: newRole }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success(`${u.name} is now ${newRole}`)
      fetchUsers()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(u: ManagedUser) {
    if (!confirm(`Delete user "${u.name}" (${u.email})? This cannot be undone.`)) return
    setDeletingId(u.id)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`User ${u.name} deleted`)
      fetchUsers()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading users…</p>

  return (
    <div className="max-w-3xl space-y-6">
      {/* Users table */}
      <div className="card">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <p className="font-semibold text-sm">Team Members</p>
          <button
            onClick={() => setShowForm(f => !f)}
            className="flex items-center gap-1.5 text-xs font-medium text-amazon-blue hover:underline"
          >
            <Plus size={14} /> Add User
          </button>
        </div>

        {/* Inline create form */}
        {showForm && (
          <form onSubmit={handleCreate} className="px-5 py-4 border-b bg-gray-50 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Full name"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                required
                className="input"
              />
              <input
                type="email"
                placeholder="Email"
                value={formEmail}
                onChange={e => setFormEmail(e.target.value)}
                required
                className="input"
              />
              <input
                type="password"
                placeholder="Temporary password (min 6)"
                value={formPassword}
                onChange={e => setFormPassword(e.target.value)}
                required
                minLength={6}
                className="input"
              />
              <select
                value={formRole}
                onChange={e => setFormRole(e.target.value as 'REVIEWER' | 'ADMIN')}
                className="input"
              >
                <option value="REVIEWER">Reviewer</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary text-xs">
                {saving ? 'Creating…' : 'Create User'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary text-xs">
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="divide-y">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                <p className="text-xs text-gray-500 truncate">{u.email}</p>
              </div>
              <p className="text-xs text-gray-400 whitespace-nowrap hidden sm:block">
                {new Date(u.createdAt).toLocaleDateString()}
              </p>
              <button
                onClick={() => handleToggleRole(u)}
                disabled={togglingId === u.id}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  u.role === 'ADMIN'
                    ? 'bg-amazon-blue/10 text-amazon-blue hover:bg-amazon-blue/20'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title={`Click to switch to ${u.role === 'ADMIN' ? 'Reviewer' : 'Admin'}`}
              >
                {togglingId === u.id ? '…' : u.role === 'ADMIN' ? 'Admin' : 'Reviewer'}
              </button>
              <button
                onClick={() => handleDelete(u)}
                disabled={deletingId === u.id}
                className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                title="Delete user"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {users.length === 0 && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No users yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Printer Settings Section ─────────────────────────────────────────────────

function PrinterSettingsSection() {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [printers, setPrinters] = useState<string[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState<string | null>(null)
  const [savedPrinter, setSavedPrinter] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qzRef = useRef<any>(null)

  // Load saved default printer
  useEffect(() => {
    fetch('/api/store-settings').then(r => r.json()).then(d => {
      if (d.defaultPrinter) { setSelectedPrinter(d.defaultPrinter); setSavedPrinter(d.defaultPrinter) }
    }).catch(() => {})
  }, [])

  const getQz = useCallback(async () => {
    if (qzRef.current) return qzRef.current
    const mod = await import('qz-tray')
    qzRef.current = mod.default ?? mod
    return qzRef.current
  }, [])

  const doConnect = useCallback(async () => {
    setConnecting(true)
    try {
      const qz = await getQz()
      if (!qz.websocket.isActive()) {
        qz.security.setCertificatePromise(() => Promise.resolve(''))
        qz.security.setSignaturePromise(() => () => Promise.resolve(''))
        await qz.websocket.connect()
      }
      setConnected(true)
    } catch { setConnected(false) }
    finally { setConnecting(false) }
  }, [getQz])

  const doDisconnect = useCallback(async () => {
    try {
      const qz = await getQz()
      if (qz.websocket.isActive()) await qz.websocket.disconnect()
    } catch { /* ignore */ }
    setConnected(false); setPrinters([])
  }, [getQz])

  const [printerError, setPrinterError] = useState<string | null>(null)

  const doRefresh = useCallback(async () => {
    setPrinterError(null)
    try {
      const qz = await getQz()
      console.log('[QZ] websocket active:', qz.websocket.isActive())

      // Use a timeout — qz.printers.find() can hang indefinitely on some setups
      const findWithTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
        Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms))])

      // Try finding all printers first
      let list: string[] = []
      try {
        console.log('[QZ] Calling printers.find()...')
        list = await findWithTimeout(qz.printers.find(), 10_000)
        console.log('[QZ] printers.find() returned:', list)
      } catch (e) {
        console.warn('[QZ] printers.find() failed/timed out, trying getDefault()...', e)
        // Fallback: try getting just the default printer
        try {
          const defaultP = await findWithTimeout(qz.printers.getDefault(), 10_000)
          console.log('[QZ] printers.getDefault() returned:', defaultP)
          if (defaultP) list = [defaultP]
        } catch (e2) {
          console.error('[QZ] printers.getDefault() also failed:', e2)
        }
      }

      setPrinters(Array.isArray(list) ? list : [])
      if (!list || (Array.isArray(list) && list.length === 0)) {
        setPrinterError('QZ Tray could not detect printers. Try restarting QZ Tray (right-click tray icon > Exit, then relaunch).')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[QZ] printer detection error:', e)
      setPrinterError(`Printer detection failed: ${msg}`)
    }
  }, [getQz])

  const doSave = useCallback(async () => {
    setSaving(true)
    try {
      await fetch('/api/store-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultPrinter: selectedPrinter }),
      })
      setSavedPrinter(selectedPrinter)
      toast.success('Default printer saved')
    } catch { toast.error('Failed to save printer') }
    finally { setSaving(false) }
  }, [selectedPrinter])

  const doTestPrint = useCallback(async () => {
    if (!selectedPrinter) { toast.error('Select a printer first'); return }
    setTesting(true)
    try {
      // Generate a simple 4×6 test label PDF using jsPDF
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'in', format: [4, 6] })
      doc.setFontSize(16)
      doc.text('QZ Tray Test Print', 0.5, 1)
      doc.setFontSize(11)
      doc.text(`Printer: ${selectedPrinter}`, 0.5, 1.6)
      doc.text(`Time: ${new Date().toLocaleString()}`, 0.5, 2.1)
      doc.setFontSize(10)
      doc.text('4 × 6 thermal label test', 0.5, 2.8)
      doc.text('If you see this, QZ Tray is working!', 0.5, 3.3)
      const pdfBytes = doc.output('arraybuffer') as ArrayBuffer
      const b64 = btoa(Array.from(new Uint8Array(pdfBytes), b => String.fromCharCode(b)).join(''))

      const qz = await getQz()
      const config = qz.configs.create(selectedPrinter)
      console.log('[QZ] Sending test print to:', selectedPrinter)
      await qz.print(config, [{ type: 'pdf', data: b64, flavor: 'base64' }])
      toast.success('Test page sent to printer')
    } catch (e) {
      console.error('[QZ] Test print error:', e)
      toast.error(e instanceof Error ? e.message : 'Print failed')
    }
    finally { setTesting(false) }
  }, [selectedPrinter, getQz])

  // Try auto-connect on mount
  useEffect(() => { doConnect() }, [doConnect])

  return (
    <div className="space-y-5">
      {/* Connection status */}
      <div className="flex items-center gap-3">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-400'}`} />
        <span className="text-sm font-medium text-gray-700">
          {connecting ? 'Connecting…' : connected ? 'Connected to QZ Tray' : 'Not connected'}
        </span>
        {connected ? (
          <button onClick={doDisconnect} className="ml-auto text-xs text-gray-500 hover:text-red-600 underline">Disconnect</button>
        ) : (
          <button onClick={doConnect} disabled={connecting}
            className="ml-auto text-xs font-medium text-teal-600 hover:text-teal-700 underline disabled:opacity-50">
            {connecting ? 'Connecting…' : 'Retry'}
          </button>
        )}
      </div>

      {!connected && !connecting && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 space-y-2">
          <p className="font-semibold">QZ Tray is not running</p>
          <p>Install QZ Tray from <a href="https://qz.io" target="_blank" rel="noreferrer" className="underline font-medium text-amber-900">qz.io</a> and make sure it is running before connecting.</p>
          <p>QZ Tray bridges your browser to local printers over a secure WebSocket for silent 1-click printing.</p>
        </div>
      )}

      {connected && (
        <>
          {/* Printer list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Detected Printers</h4>
              <button onClick={doRefresh} className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1">
                <RefreshCw size={10} /> Refresh
              </button>
            </div>
            {printerError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 mb-2">
                {printerError}
              </div>
            )}
            {printers.length === 0 ? (
              <div className="space-y-2 py-2">
                <p className="text-xs text-gray-400">No printers auto-detected. Click Refresh to retry, or enter your printer name manually.</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="e.g. BIXOLON SRP-770III"
                    value={selectedPrinter ?? ''}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    className="flex-1 h-8 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <p className="text-[10px] text-gray-400">Enter the exact printer name as shown in Windows Settings &gt; Printers &amp; Scanners.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {printers.map(p => (
                  <label key={p} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                    selectedPrinter === p ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <input type="radio" name="printer" checked={selectedPrinter === p}
                      onChange={() => setSelectedPrinter(p)}
                      className="accent-teal-600" />
                    <span className="truncate">{p}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button onClick={doTestPrint} disabled={testing || !selectedPrinter}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-40 transition-colors">
              {testing ? <RefreshCw size={11} className="animate-spin" /> : <Printer size={11} />}
              Test Print
            </button>
            <button onClick={doSave} disabled={saving || selectedPrinter === savedPrinter}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors">
              {saving ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle size={11} />}
              Save Default
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Hub Cards ────────────────────────────────────────────────────────────────

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
      {
        id: 'fedex',
        icon: Package,
        iconBg: 'bg-purple-50',
        iconColor: 'text-purple-600',
        title: 'FedEx API',
        description: 'Store your FedEx developer credentials to enable live tracking status for FedEx shipments on the Shipping Manifest.',
      },
    ],
  },
  {
    label: 'Operations',
    cards: [
      {
        id: 'store-settings',
        icon: Store,
        iconBg: 'bg-indigo-50',
        iconColor: 'text-indigo-600',
        title: 'Store Settings',
        description: 'Set your store name, logo, contact info, and invoice thank-you message.',
      },
      {
        id: 'warehouses',
        icon: Warehouse,
        iconBg: 'bg-purple-50',
        iconColor: 'text-purple-600',
        title: 'Warehouses',
        description: 'Add and manage ship-from warehouse locations used when purchasing shipping labels through ShipStation.',
      },
      {
        id: 'rma-settings',
        icon: RotateCcw,
        iconBg: 'bg-rose-50',
        iconColor: 'text-rose-600',
        title: 'RMA Settings',
        description: 'Configure return reasons that appear when creating marketplace or customer RMAs.',
      },
      {
        id: 'printer',
        icon: Printer,
        iconBg: 'bg-teal-50',
        iconColor: 'text-teal-600',
        title: 'Printer',
        description: 'Connect to QZ Tray for 1-click silent printing of shipping labels to your thermal printer.',
      },
    ],
  },
  {
    label: 'Administration',
    cards: [
      {
        id: 'users',
        icon: Shield,
        iconBg: 'bg-sky-50',
        iconColor: 'text-sky-600',
        title: 'Users',
        description: 'Create team accounts, assign Admin or Reviewer roles, and manage access to the platform.',
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
            {activeSection === 'amazon'         && <AmazonAccountsSection />}
            {activeSection === 'shipstation'    && <ShipStationSection />}
            {activeSection === 'warehouses'     && <WarehouseManager />}
            {activeSection === 'ups'            && <UpsCredentialsSection />}
            {activeSection === 'fedex'          && <FedexCredentialsSection />}
            {activeSection === 'backmarket'     && <BackMarketSection />}
            {activeSection === 'rma-settings'   && <RMASettingsSection />}
            {activeSection === 'store-settings' && <StoreSettingsSection />}
            {activeSection === 'users'          && <UsersSection />}
            {activeSection === 'printer'        && <PrinterSettingsSection />}
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

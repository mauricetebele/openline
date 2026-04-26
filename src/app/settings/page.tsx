'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle, AlertTriangle, Clock, RefreshCw, FlaskConical,
  ExternalLink, Warehouse, Truck, Settings,
  ChevronRight, Trash2, RotateCcw, Plus, X,
  Store, Upload, ImageIcon, Users, Shield, Printer, Package, Smartphone, Tag, Wrench,
  Lock, Pencil,
} from 'lucide-react'
import AppShell from '@/components/AppShell'
import WarehouseManager from '@/components/WarehouseManager'
import CostCodeManager from '@/components/CostCodeManager'
import ClientNoteEditor from '@/components/ClientNoteEditor'
import { auth } from '@/lib/firebase-client'
import {
  signInWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  multiFactor,
  TotpMultiFactorGenerator,
  TotpSecret,
  type MultiFactorInfo,
} from 'firebase/auth'
import QRCode from 'qrcode'

// ─── Brand logo components (inline SVGs so fonts render reliably) ─────────────

function AmazonLogo({ height = 20 }: { height?: number }) {
  const w = (height / 38) * 120
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 38" width={w} height={height} role="img" aria-label="Amazon">
      <text x="0" y="26" fontFamily="Arial Black, Arial, sans-serif" fontSize="28" fontWeight="900" fill="#232F3E">amazon</text>
      <path d="M4 33 Q60 44 116 33" stroke="#FF9900" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
      <path d="M112 29.5 L117 33.5 L111.5 36" stroke="#FF9900" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function BackMarketLogo({ height = 20 }: { height?: number }) {
  const w = (height / 40) * 160
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40" width={w} height={height} role="img" aria-label="Back Market">
      <circle cx="20" cy="20" r="18" fill="#05C35E"/>
      <rect x="11" y="10" width="5" height="20" rx="1.5" fill="white"/>
      <path d="M16 10h5a7 7 0 0 1 0 10h-5z" fill="white"/>
      <path d="M16 20h6a7.5 7.5 0 0 1 0 10h-6z" fill="white"/>
      <text x="46" y="27" fontFamily="Arial, sans-serif" fontSize="18" fontWeight="700" fill="#05C35E">Back Market</text>
    </svg>
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

type Section = 'amazon' | 'shipstation' | 'warehouses' | 'ups' | 'ups-buy-shipping' | 'fedex' | 'backmarket' | 'rma-settings' | 'store-settings' | 'users' | 'printer' | 'sickw' | 'grades' | 'cost-codes' | 'security'

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

interface UpsAccountInfo {
  id: string
  nickname: string
  isDefault: boolean
  maskedClientId: string | null
  maskedAccountNumber: string | null
  updatedAt: string
}

function UpsCredentialsSection() {
  const [accounts, setAccounts] = useState<UpsAccountInfo[]>([])
  const [showForm, setShowForm] = useState(false)
  const [nickname, setNickname] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNickname, setEditNickname] = useState('')

  const fetchAccounts = useCallback(async () => {
    const res = await fetch('/api/ups/credentials')
    if (res.ok) {
      const data = await res.json()
      setAccounts(data.accounts ?? [])
    }
  }, [])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/ups/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname.trim() || 'Primary',
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          accountNumber: accountNumber.trim(),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('UPS account added!')
      setNickname(''); setClientId(''); setClientSecret(''); setAccountNumber('')
      setShowForm(false)
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleSetDefault(id: string) {
    setSettingDefaultId(id)
    try {
      const res = await fetch(`/api/ups/credentials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Default account updated')
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setSettingDefaultId(null)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove UPS account "${name}"? This will deactivate it.`)) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/ups/credentials/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Account removed')
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRename(id: string) {
    if (!editNickname.trim()) return
    try {
      const res = await fetch(`/api/ups/credentials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: editNickname.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Nickname updated')
      setEditingId(null)
      fetchAccounts()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {accounts.length > 0 && (
        <div className="space-y-3">
          {accounts.map(acct => (
            <div key={acct.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {editingId === acct.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="input h-7 text-sm w-40"
                          value={editNickname}
                          onChange={e => setEditNickname(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(acct.id); if (e.key === 'Escape') setEditingId(null) }}
                          autoFocus
                        />
                        <button onClick={() => handleRename(acct.id)} className="text-xs text-amazon-blue hover:underline">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <span className="font-semibold text-sm text-gray-900">{acct.nickname}</span>
                        <button onClick={() => { setEditingId(acct.id); setEditNickname(acct.nickname) }}
                          className="p-0.5 text-gray-400 hover:text-gray-600" title="Rename">
                          <Pencil size={12} />
                        </button>
                      </>
                    )}
                    {acct.isDefault && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    Client ID: <span className="font-mono">{acct.maskedClientId ?? '—'}</span>
                    {acct.maskedAccountNumber && <> · Account #: <span className="font-mono">{acct.maskedAccountNumber}</span></>}
                    {acct.updatedAt && ` · Updated ${new Date(acct.updatedAt).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!acct.isDefault && (
                    <button
                      onClick={() => handleSetDefault(acct.id)}
                      disabled={settingDefaultId === acct.id}
                      className="text-xs text-amazon-blue hover:underline disabled:opacity-50"
                    >
                      {settingDefaultId === acct.id ? 'Setting…' : 'Set Default'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(acct.id, acct.nickname)}
                    disabled={deletingId === acct.id}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Remove account"
                  >
                    <Trash2 size={14} className={deletingId === acct.id ? 'animate-pulse' : ''} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button onClick={() => setShowForm(true)}
          className="btn-primary">
          <Plus size={14} />
          Add UPS Account
        </button>
      ) : (
        <div className="card p-6">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-start gap-4">
              <div className="rounded-xl p-3 bg-amber-50">
                <Truck size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="font-semibold">Add UPS Account</p>
                <p className="text-sm text-gray-500 mt-1">
                  Register at <a href="https://developer.ups.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developer.ups.com</a>.
                </p>
              </div>
            </div>
            <button onClick={() => setShowForm(false)} className="p-1 text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Nickname</label>
              <input className="input" placeholder="e.g. Primary, Wholesale Returns"
                value={nickname} onChange={e => setNickname(e.target.value)} />
            </div>
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
              <label className="label">Account Number <span className="text-gray-400 font-normal">(required for return labels)</span></label>
              <input className="input font-mono" placeholder="12AB34"
                value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>
                <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
                {saving ? 'Saving…' : 'Save Account'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 h-9 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

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

// ─── UPS Buy Shipping Section ─────────────────────────────────────────────────

function UpsBuyShippingSection() {
  const [configured, setConfigured] = useState(false)
  const [maskedAccountNumber, setMaskedAccountNumber] = useState<string | null>(null)
  const [maskedUsername, setMaskedUsername] = useState<string | null>(null)
  const [lastLinkedAt, setLastLinkedAt] = useState<string | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [accountZip, setAccountZip] = useState('')
  const [shipFromCity, setShipFromCity] = useState('')
  const [shipFromZip, setShipFromZip] = useState('')
  const [country, setCountry] = useState('US')
  const [upsUsername, setUpsUsername] = useState('')
  const [upsPassword, setUpsPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(false)

  useEffect(() => { fetchStatus() }, [])

  async function fetchStatus() {
    const res = await fetch('/api/ups/buy-shipping-credentials')
    if (res.ok) {
      const data = await res.json()
      setConfigured(data.configured ?? false)
      setMaskedAccountNumber(data.maskedAccountNumber ?? null)
      setMaskedUsername(data.maskedUsername ?? null)
      setLastLinkedAt(data.lastLinkedAt ?? null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/ups/buy-shipping-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber: accountNumber.trim(),
          accountZip: accountZip.trim(),
          shipFromCity: shipFromCity.trim(),
          shipFromZip: shipFromZip.trim(),
          country: country.trim(),
          upsUsername: upsUsername.trim(),
          upsPassword: upsPassword.trim(),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('UPS Buy Shipping credentials saved!')
      setAccountNumber('')
      setAccountZip('')
      setShipFromCity('')
      setShipFromZip('')
      setCountry('US')
      setUpsUsername('')
      setUpsPassword('')
      fetchStatus()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleLink() {
    setLinking(true)
    try {
      const res = await fetch('/api/ups/buy-shipping-credentials/link', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message)
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {configured && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle size={16} className="text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">UPS Buy Shipping Credentials Saved</p>
                <p className="text-xs text-gray-400">
                  Account #: <span className="font-mono">{maskedAccountNumber}</span>
                  {maskedUsername && <> · Username: <span className="font-mono">{maskedUsername}</span></>}
                  {lastLinkedAt && ` · Last linked ${new Date(lastLinkedAt).toLocaleDateString()}`}
                </p>
              </div>
            </div>
            <button
              onClick={handleLink}
              disabled={linking}
              className="btn-primary text-xs px-3 py-1.5 shrink-0"
            >
              <ExternalLink size={12} className={linking ? 'animate-spin' : ''} />
              {linking ? 'Opening…' : 'Link Account'}
            </button>
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="rounded-xl p-3 bg-amber-50">
            <Truck size={20} className="text-amber-600" />
          </div>
          <div>
            <p className="font-semibold">{configured ? 'Update Buy Shipping Credentials' : 'Connect UPS Buy Shipping'}</p>
            <p className="text-sm text-gray-500 mt-1">
              These credentials are used by the Playwright script to link your UPS carrier account
              to Amazon Buy Shipping via Seller Central. Run <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">npm run link-ups</code> after saving.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">UPS Account Number</label>
              <input className="input font-mono" placeholder="12AB34"
                value={accountNumber} onChange={e => setAccountNumber(e.target.value)} required />
            </div>
            <div>
              <label className="label">Account Zip Code</label>
              <input className="input font-mono" placeholder="10001"
                value={accountZip} onChange={e => setAccountZip(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Ship-From City</label>
              <input className="input" placeholder="New York"
                value={shipFromCity} onChange={e => setShipFromCity(e.target.value)} required />
            </div>
            <div>
              <label className="label">Ship-From Zip Code</label>
              <input className="input font-mono" placeholder="10001"
                value={shipFromZip} onChange={e => setShipFromZip(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Country</label>
              <input className="input" placeholder="US"
                value={country} onChange={e => setCountry(e.target.value)} required />
            </div>
          </div>
          <hr className="border-gray-200" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">UPS.com Login</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">UPS Username / Email</label>
              <input className="input font-mono" placeholder="user@example.com"
                value={upsUsername} onChange={e => setUpsUsername(e.target.value)} required />
            </div>
            <div>
              <label className="label">UPS Password</label>
              <input className="input font-mono" type="password" placeholder="••••••••"
                value={upsPassword} onChange={e => setUpsPassword(e.target.value)} required />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : configured ? 'Update Credentials' : 'Save Credentials'}
          </button>
        </form>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-amber-800 mb-2">How to Link UPS to Amazon Buy Shipping</p>
        <ol className="list-decimal list-inside space-y-1.5 text-amber-700 text-xs">
          <li>Fill in your UPS account details and UPS.com login credentials above, then click Save</li>
          <li>Run <code className="bg-amber-100 px-1 py-0.5 rounded">npm run link-ups</code> from the project root</li>
          <li>A browser window will open — log in to Amazon Seller Central if prompted</li>
          <li>The script will automatically navigate to Carrier Preferences and link your UPS account</li>
          <li>Once complete, UPS rates will appear in Amazon Buy Shipping</li>
        </ol>
      </div>
    </div>
  )
}

// ─── FedEx Credentials Section ────────────────────────────────────────────────

function FedexCredentialsSection() {
  // ── Tracking credentials ──────────────────────────────────────────
  const [trackConfigured, setTrackConfigured] = useState(false)
  const [trackMaskedId, setTrackMaskedId] = useState<string | null>(null)
  const [trackUpdatedAt, setTrackUpdatedAt] = useState<string | null>(null)
  const [trackClientId, setTrackClientId] = useState('')
  const [trackClientSecret, setTrackClientSecret] = useState('')
  const [trackSaving, setTrackSaving] = useState(false)

  // ── Shipping credentials ──────────────────────────────────────────
  const [shipConfigured, setShipConfigured] = useState(false)
  const [shipMaskedId, setShipMaskedId] = useState<string | null>(null)
  const [shipMaskedAcct, setShipMaskedAcct] = useState<string | null>(null)
  const [shipUpdatedAt, setShipUpdatedAt] = useState<string | null>(null)
  const [shipClientId, setShipClientId] = useState('')
  const [shipClientSecret, setShipClientSecret] = useState('')
  const [shipAccountNumber, setShipAccountNumber] = useState('')
  const [shipSaving, setShipSaving] = useState(false)

  // ── Test / Sandbox credentials ──────────────────────────────────
  const [testConfigured, setTestConfigured] = useState(false)
  const [testMaskedId, setTestMaskedId] = useState<string | null>(null)
  const [testClientId, setTestClientId] = useState('')
  const [testClientSecret, setTestClientSecret] = useState('')
  const [testAccountNumber, setTestAccountNumber] = useState('')
  const [testSaving, setTestSaving] = useState(false)

  useEffect(() => { fetchTrackingStatus(); fetchShippingStatus() }, [])

  async function fetchTrackingStatus() {
    const res = await fetch('/api/fedex/credentials')
    if (res.ok) {
      const data = await res.json()
      setTrackConfigured(data.configured ?? false)
      setTrackMaskedId(data.maskedClientId ?? null)
      setTrackUpdatedAt(data.updatedAt ?? null)
    }
  }

  async function fetchShippingStatus() {
    const res = await fetch('/api/fedex/shipping-credentials')
    if (res.ok) {
      const data = await res.json()
      setShipConfigured(data.configured ?? false)
      setShipMaskedId(data.maskedClientId ?? null)
      setShipMaskedAcct(data.maskedAccountNumber ?? null)
      setShipUpdatedAt(data.updatedAt ?? null)
      setTestConfigured(data.testConfigured ?? false)
      setTestMaskedId(data.testMaskedClientId ?? null)
    }
  }

  async function handleTrackingSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTrackSaving(true)
    try {
      const res = await fetch('/api/fedex/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: trackClientId.trim(), clientSecret: trackClientSecret.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('FedEx tracking credentials saved!')
      setTrackClientId(''); setTrackClientSecret('')
      fetchTrackingStatus()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally { setTrackSaving(false) }
  }

  async function handleShippingSubmit(e: React.FormEvent) {
    e.preventDefault()
    setShipSaving(true)
    try {
      const res = await fetch('/api/fedex/shipping-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: shipClientId.trim(), clientSecret: shipClientSecret.trim(), accountNumber: shipAccountNumber.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('FedEx shipping credentials saved!')
      setShipClientId(''); setShipClientSecret(''); setShipAccountNumber('')
      fetchShippingStatus()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally { setShipSaving(false) }
  }

  async function handleTestSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTestSaving(true)
    try {
      const res = await fetch('/api/fedex/shipping-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testClientId: testClientId.trim(), testClientSecret: testClientSecret.trim(), testAccountNumber: testAccountNumber.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('FedEx sandbox credentials saved!')
      setTestClientId(''); setTestClientSecret(''); setTestAccountNumber('')
      fetchShippingStatus()
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`)
    } finally { setTestSaving(false) }
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* ── FedEx — Tracking ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">FedEx — Tracking</h3>

        {trackConfigured && (
          <div className="card p-5">
            <div className="flex items-center gap-3">
              <CheckCircle size={16} className="text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Tracking API Connected</p>
                <p className="text-xs text-gray-400">
                  Client ID: <span className="font-mono">{trackMaskedId}</span>
                  {trackUpdatedAt && ` · Updated ${new Date(trackUpdatedAt).toLocaleDateString()}`}
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
              <p className="font-semibold">{trackConfigured ? 'Update Tracking Credentials' : 'Connect FedEx Tracking'}</p>
              <p className="text-sm text-gray-500 mt-1">
                Used for live tracking status on FedEx shipments. Create a project with the <strong>Track API</strong> at{' '}
                <a href="https://developer.fedex.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developer.fedex.com</a>.
              </p>
            </div>
          </div>
          <form onSubmit={handleTrackingSubmit} className="space-y-4">
            <div>
              <label className="label">API Key (Client ID)</label>
              <input className="input font-mono" placeholder="l7a1b2c3d4e5f6…"
                value={trackClientId} onChange={e => setTrackClientId(e.target.value)} required />
            </div>
            <div>
              <label className="label">Secret Key (Client Secret)</label>
              <input className="input font-mono" type="password" placeholder="a1b2c3d4e5f6g7…"
                value={trackClientSecret} onChange={e => setTrackClientSecret(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary" disabled={trackSaving}>
              <RefreshCw size={14} className={trackSaving ? 'animate-spin' : ''} />
              {trackSaving ? 'Saving…' : trackConfigured ? 'Update Credentials' : 'Save Credentials'}
            </button>
          </form>
        </div>
      </section>

      {/* ── FedEx — Shipping ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">FedEx — Shipping</h3>

        {shipConfigured && (
          <div className="card p-5">
            <div className="flex items-center gap-3">
              <CheckCircle size={16} className="text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Shipping API Connected</p>
                <p className="text-xs text-gray-400">
                  Client ID: <span className="font-mono">{shipMaskedId}</span>
                  {shipMaskedAcct && <> · Account #: <span className="font-mono">{shipMaskedAcct}</span></>}
                  {shipUpdatedAt && ` · Updated ${new Date(shipUpdatedAt).toLocaleDateString()}`}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="card p-6">
          <div className="flex items-start gap-4 mb-5">
            <div className="rounded-xl p-3 bg-indigo-50">
              <Package size={20} className="text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold">{shipConfigured ? 'Update Shipping Credentials' : 'Connect FedEx Shipping'}</p>
              <p className="text-sm text-gray-500 mt-1">
                Used for direct FedEx rate shopping and label purchase on Back Market orders. Create a project with the <strong>Ship API</strong> and <strong>Rate API</strong> at{' '}
                <a href="https://developer.fedex.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developer.fedex.com</a>.
              </p>
            </div>
          </div>
          <form onSubmit={handleShippingSubmit} className="space-y-4">
            <div>
              <label className="label">API Key (Client ID)</label>
              <input className="input font-mono" placeholder="l7a1b2c3d4e5f6…"
                value={shipClientId} onChange={e => setShipClientId(e.target.value)} required />
            </div>
            <div>
              <label className="label">Secret Key (Client Secret)</label>
              <input className="input font-mono" type="password" placeholder="a1b2c3d4e5f6g7…"
                value={shipClientSecret} onChange={e => setShipClientSecret(e.target.value)} required />
            </div>
            <div>
              <label className="label">Account Number</label>
              <input className="input font-mono" placeholder="123456789"
                value={shipAccountNumber} onChange={e => setShipAccountNumber(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary" disabled={shipSaving}>
              <RefreshCw size={14} className={shipSaving ? 'animate-spin' : ''} />
              {shipSaving ? 'Saving…' : shipConfigured ? 'Update Credentials' : 'Save Credentials'}
            </button>
          </form>
        </div>
      </section>

      {/* ── FedEx — Sandbox / Test ─────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">FedEx — Sandbox / Test</h3>

        {testConfigured && (
          <div className="card p-5">
            <div className="flex items-center gap-3">
              <CheckCircle size={16} className="text-amber-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Sandbox API Connected</p>
                <p className="text-xs text-gray-400">
                  Test Client ID: <span className="font-mono">{testMaskedId}</span>
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="card p-6">
          <div className="flex items-start gap-4 mb-5">
            <div className="rounded-xl p-3 bg-amber-50">
              <Package size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="font-semibold">{testConfigured ? 'Update Sandbox Credentials' : 'Connect FedEx Sandbox'}</p>
              <p className="text-sm text-gray-500 mt-1">
                Used for test labels submitted to FedEx Label Analysis Group. Create a <strong>test project</strong> at{' '}
                <a href="https://developer.fedex.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developer.fedex.com</a>{' '}
                using the sandbox environment.
              </p>
            </div>
          </div>
          <form onSubmit={handleTestSubmit} className="space-y-4">
            <div>
              <label className="label">Test API Key (Client ID)</label>
              <input className="input font-mono" placeholder="l7a1b2c3d4e5f6…"
                value={testClientId} onChange={e => setTestClientId(e.target.value)} required />
            </div>
            <div>
              <label className="label">Test Secret Key (Client Secret)</label>
              <input className="input font-mono" type="password" placeholder="a1b2c3d4e5f6g7…"
                value={testClientSecret} onChange={e => setTestClientSecret(e.target.value)} required />
            </div>
            <div>
              <label className="label">Test Account Number</label>
              <input className="input font-mono" placeholder="123456789"
                value={testAccountNumber} onChange={e => setTestAccountNumber(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary" disabled={testSaving}>
              <RefreshCw size={14} className={testSaving ? 'animate-spin' : ''} />
              {testSaving ? 'Saving…' : testConfigured ? 'Update Credentials' : 'Save Credentials'}
            </button>
          </form>
        </div>
      </section>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-purple-800 mb-2">How to get FedEx API Credentials</p>
        <ol className="list-decimal list-inside space-y-1.5 text-purple-700 text-xs">
          <li>Go to <a href="https://developer.fedex.com" target="_blank" rel="noopener noreferrer" className="underline">developer.fedex.com</a> and create an account</li>
          <li>Create a project for <strong>Tracking</strong> (Track API) and/or <strong>Shipping</strong> (Ship API + Rate API)</li>
          <li>Copy the <strong>API Key</strong> (Client ID) and <strong>Secret Key</strong> (Client Secret) from each project</li>
          <li>Your <strong>Account Number</strong> is found in your FedEx account profile (9-digit number)</li>
        </ol>
      </div>
    </div>
  )
}

// ─── SICKW Credentials Section ──────────────────────────────────────────────

function SickwCredentialsSection() {
  const [configured, setConfigured] = useState(false)
  const [maskedKey, setMaskedKey] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchStatus() }, [])

  async function fetchStatus() {
    const res = await fetch('/api/sickw/credentials')
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
      const res = await fetch('/api/sickw/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('SICKW API key saved!')
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
              <p className="font-semibold text-sm">SICKW API Connected</p>
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
          <div className="rounded-xl p-3 bg-cyan-50">
            <Smartphone size={20} className="text-cyan-600" />
          </div>
          <div>
            <p className="font-semibold">{configured ? 'Update SICKW API Key' : 'Connect SICKW API'}</p>
            <p className="text-sm text-gray-500 mt-1">
              SICKW provides IMEI checking services (iCloud, carrier, blacklist, Knox, etc.).
              Get your API key from <a href="https://sickw.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">sickw.com</a>.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">API Key</label>
            <input className="input font-mono" type="password" placeholder="Your SICKW API key"
              value={apiKey} onChange={e => setApiKey(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            <RefreshCw size={14} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : configured ? 'Update API Key' : 'Save API Key'}
          </button>
        </form>
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

// ─── Grades Settings Section ──────────────────────────────────────────────────

interface GradeItem { id: string; grade: string; description: string | null; sortOrder: number }

function GradesSettingsSection() {
  const [grades, setGrades] = useState<GradeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newGrade, setNewGrade] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/grades')
      .then(r => r.json())
      .then(j => setGrades(j.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd() {
    if (!newGrade.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/grades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade: newGrade.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to add'); return }
      setGrades(prev => [...prev, data])
      setNewGrade('')
      toast.success('Grade added')
    } catch { toast.error('Failed to add grade') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/grades?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete')
        return
      }
      setGrades(prev => prev.filter(g => g.id !== id))
      toast.success('Grade removed')
    } catch { toast.error('Failed to delete') }
    finally { setDeletingId(null) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Inventory Grades</h3>
        <p className="text-xs text-gray-500 mb-4">
          These grades appear in receive, regrade, and return workflows across all products.
        </p>

        {/* Add new */}
        <div className="flex items-center gap-2 mb-4">
          <input
            value={newGrade}
            onChange={e => setNewGrade(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="e.g. A, B, REFURB..."
            className="flex-1 h-9 px-3 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          <button
            onClick={handleAdd}
            disabled={!newGrade.trim() || saving}
            className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading...</p>
        ) : grades.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No grades configured yet</p>
        ) : (
          <div className="space-y-1.5">
            {grades.map(g => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-200 bg-white"
              >
                <span className="text-sm font-mono font-semibold text-gray-800">{g.grade}</span>
                <button
                  onClick={() => handleDelete(g.id)}
                  disabled={deletingId === g.id}
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
  companyName: string | null
  _count?: { clientLocationAccess: number; visibleUsers: number }
}

function UsersSection() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // Form state
  const [formEmail, setFormEmail] = useState('')
  const [formName, setFormName] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formRole, setFormRole] = useState<'REVIEWER' | 'ADMIN' | 'CLIENT' | 'RESOLUTION_PROVIDER'>('REVIEWER')
  const [formCompanyName, setFormCompanyName] = useState('')

  // Location access modal state
  const [locationModalUserId, setLocationModalUserId] = useState<string | null>(null)
  const [allLocations, setAllLocations] = useState<{ id: string; name: string; warehouseId: string; warehouseName: string }[]>([])
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set())
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)

  // Visibility modal state (Resolution Provider → visible users)
  const [visibilityModalUserId, setVisibilityModalUserId] = useState<string | null>(null)
  const [allUsersForVisibility, setAllUsersForVisibility] = useState<{ id: string; name: string; email: string; role: string }[]>([])
  const [selectedVisibleIds, setSelectedVisibleIds] = useState<Set<string>>(new Set())
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [visibilityLoading, setVisibilityLoading] = useState(false)

  // Notes modal state
  const [notesModalUserId, setNotesModalUserId] = useState<string | null>(null)

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
        body: JSON.stringify({
          email: formEmail, name: formName, password: formPassword, role: formRole,
          ...(formRole === 'CLIENT' && formCompanyName ? { companyName: formCompanyName } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`User ${formName} created`)
      setFormEmail('')
      setFormName('')
      setFormPassword('')
      setFormRole('REVIEWER')
      setFormCompanyName('')
      setShowForm(false)
      fetchUsers()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangeRole(u: ManagedUser, newRole: string) {
    if (newRole === u.role) return
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

  async function openLocationModal(userId: string) {
    setLocationModalUserId(userId)
    setLocationLoading(true)
    try {
      const [locRes, accessRes] = await Promise.all([
        fetch('/api/warehouses'),
        fetch(`/api/admin/users/location-access?userId=${userId}`),
      ])
      if (locRes.ok) {
        const locJson = await locRes.json()
        const locs: { id: string; name: string; warehouseId: string; warehouseName: string }[] = []
        for (const wh of (locJson.data ?? locJson)) {
          for (const loc of wh.locations ?? []) {
            locs.push({ id: loc.id, name: loc.name, warehouseId: wh.id, warehouseName: wh.name })
          }
        }
        setAllLocations(locs)
      }
      if (accessRes.ok) {
        const accessJson = await accessRes.json()
        setSelectedLocationIds(new Set((accessJson.data ?? []).map((a: { locationId: string }) => a.locationId)))
      }
    } finally {
      setLocationLoading(false)
    }
  }

  async function saveLocationAccess() {
    if (!locationModalUserId) return
    setLocationSaving(true)
    try {
      const res = await fetch('/api/admin/users/location-access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: locationModalUserId, locationIds: Array.from(selectedLocationIds) }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Location access updated')
      setLocationModalUserId(null)
      fetchUsers()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLocationSaving(false)
    }
  }

  async function openVisibilityModal(userId: string) {
    setVisibilityModalUserId(userId)
    setVisibilityLoading(true)
    try {
      const [usersRes, visRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch(`/api/admin/users/tag-visibility?userId=${userId}`),
      ])
      if (usersRes.ok) {
        const json = await usersRes.json()
        // Show all users except the provider themselves
        setAllUsersForVisibility(
          (json.data ?? []).filter((u: { id: string }) => u.id !== userId)
        )
      }
      if (visRes.ok) {
        const json = await visRes.json()
        setSelectedVisibleIds(new Set(json.data ?? []))
      }
    } finally {
      setVisibilityLoading(false)
    }
  }

  async function saveVisibility() {
    if (!visibilityModalUserId) return
    setVisibilitySaving(true)
    try {
      const res = await fetch('/api/admin/users/tag-visibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: visibilityModalUserId, visibleUserIds: Array.from(selectedVisibleIds) }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Visible users updated')
      setVisibilityModalUserId(null)
      fetchUsers()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setVisibilitySaving(false)
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

  async function handleRename(u: ManagedUser) {
    const trimmed = editName.trim()
    if (!trimmed || trimmed === u.name) { setEditingId(null); return }
    setTogglingId(u.id) // reuse toggling indicator
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, name: trimmed }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success(`Renamed to ${trimmed}`)
      setEditingId(null)
      fetchUsers()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTogglingId(null)
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
                onChange={e => setFormRole(e.target.value as 'REVIEWER' | 'ADMIN' | 'CLIENT' | 'RESOLUTION_PROVIDER')}
                className="input"
              >
                <option value="REVIEWER">Reviewer</option>
                <option value="ADMIN">Admin</option>
                <option value="CLIENT">Client</option>
                <option value="RESOLUTION_PROVIDER">Resolution Provider</option>
              </select>
              {formRole === 'CLIENT' && (
                <input
                  type="text"
                  placeholder="Company name"
                  value={formCompanyName}
                  onChange={e => setFormCompanyName(e.target.value)}
                  className="input col-span-2"
                />
              )}
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
                {editingId === u.id ? (
                  <form
                    onSubmit={e => { e.preventDefault(); handleRename(u) }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      className="input text-sm py-1 px-2"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                      onBlur={() => handleRename(u)}
                      onKeyDown={e => { if (e.key === 'Escape') setEditingId(null) }}
                    />
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5 group">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                    <button
                      onClick={() => { setEditingId(u.id); setEditName(u.name) }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                      title="Edit name"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-500 truncate">{u.email}</p>
                {u.role === 'CLIENT' && u.companyName && (
                  <p className="text-xs text-purple-500 truncate">{u.companyName}</p>
                )}
              </div>
              <p className="text-xs text-gray-400 whitespace-nowrap hidden sm:block">
                {new Date(u.createdAt).toLocaleDateString()}
              </p>
              {u.role === 'CLIENT' && (
                <>
                  <button
                    onClick={() => openLocationModal(u.id)}
                    className="px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
                  >
                    Locations ({u._count?.clientLocationAccess ?? 0})
                  </button>
                  <button
                    onClick={() => setNotesModalUserId(u.id)}
                    className="px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    Notes
                  </button>
                </>
              )}
              {u.role === 'RESOLUTION_PROVIDER' && (
                <button
                  onClick={() => openVisibilityModal(u.id)}
                  className="px-2 py-1 rounded text-xs font-medium bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors"
                >
                  Visible Users ({u._count?.visibleUsers ?? 0})
                </button>
              )}
              <select
                value={u.role}
                onChange={e => handleChangeRole(u, e.target.value)}
                disabled={togglingId === u.id}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border-0 ${
                  u.role === 'ADMIN'
                    ? 'bg-amazon-blue/10 text-amazon-blue'
                    : u.role === 'CLIENT'
                      ? 'bg-purple-100 text-purple-700'
                      : u.role === 'RESOLUTION_PROVIDER'
                        ? 'bg-teal-100 text-teal-700'
                        : 'bg-gray-100 text-gray-600'
                }`}
              >
                <option value="REVIEWER">Reviewer</option>
                <option value="ADMIN">Admin</option>
                <option value="CLIENT">Client</option>
                <option value="RESOLUTION_PROVIDER">Resolution Provider</option>
              </select>
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

      {/* Location Access Modal */}
      {locationModalUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setLocationModalUserId(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <p className="font-semibold text-sm">Manage Location Access</p>
              <button onClick={() => setLocationModalUserId(null)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {locationLoading ? (
                <p className="text-sm text-gray-500">Loading locations...</p>
              ) : allLocations.length === 0 ? (
                <p className="text-sm text-gray-400">No locations found. Create warehouses and locations first.</p>
              ) : (
                (() => {
                  const grouped = new Map<string, typeof allLocations>()
                  for (const loc of allLocations) {
                    const arr = grouped.get(loc.warehouseName) ?? []
                    arr.push(loc)
                    grouped.set(loc.warehouseName, arr)
                  }
                  return Array.from(grouped.entries()).map(([whName, locs]) => (
                    <div key={whName} className="mb-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{whName}</p>
                      <div className="space-y-1">
                        {locs.map(loc => (
                          <label key={loc.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedLocationIds.has(loc.id)}
                              onChange={() => {
                                setSelectedLocationIds(prev => {
                                  const next = new Set(prev)
                                  if (next.has(loc.id)) next.delete(loc.id)
                                  else next.add(loc.id)
                                  return next
                                })
                              }}
                              className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue"
                            />
                            <span className="text-sm text-gray-700">{loc.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                })()
              )}
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-between">
              <p className="text-xs text-gray-400">{selectedLocationIds.size} selected</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setLocationModalUserId(null)} className="btn btn-secondary text-xs">Cancel</button>
                <button onClick={saveLocationAccess} disabled={locationSaving} className="btn btn-primary text-xs">
                  {locationSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Visible Users Modal (Resolution Provider) */}
      {visibilityModalUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setVisibilityModalUserId(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <p className="font-semibold text-sm">Manage Visible Users</p>
              <button onClick={() => setVisibilityModalUserId(null)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {visibilityLoading ? (
                <p className="text-sm text-gray-500">Loading users...</p>
              ) : allUsersForVisibility.length === 0 ? (
                <p className="text-sm text-gray-400">No users available.</p>
              ) : (
                <div className="space-y-1">
                  {allUsersForVisibility.map(u => (
                    <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedVisibleIds.has(u.id)}
                        onChange={() => {
                          setSelectedVisibleIds(prev => {
                            const next = new Set(prev)
                            if (next.has(u.id)) next.delete(u.id)
                            else next.add(u.id)
                            return next
                          })
                        }}
                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-sm text-gray-700">{u.name}</span>
                      <span className="text-xs text-gray-400">{u.email}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-between">
              <p className="text-xs text-gray-400">{selectedVisibleIds.size} selected</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setVisibilityModalUserId(null)} className="btn btn-secondary text-xs">Cancel</button>
                <button onClick={saveVisibility} disabled={visibilitySaving} className="btn btn-primary text-xs">
                  {visibilitySaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {notesModalUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setNotesModalUserId(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <p className="font-semibold text-sm">Client Notes</p>
              <button onClick={() => setNotesModalUserId(null)} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ClientNoteEditor readOnly userId={notesModalUserId} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Two-Factor Authentication Section ────────────────────────────────────────

function TwoFactorSection() {
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [enrolledFactors, setEnrolledFactors] = useState<MultiFactorInfo[]>([])
  const [loading, setLoading] = useState(true)

  // Enrollment flow state
  const [step, setStep] = useState<'idle' | 'password' | 'qr' | 'verify'>('idle')
  const [reAuthPassword, setReAuthPassword] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [busy, setBusy] = useState(false)

  // Disable flow
  const [disableStep, setDisableStep] = useState<'idle' | 'password'>('idle')
  const [disablePassword, setDisablePassword] = useState('')

  useEffect(() => {
    checkMfaStatus()
  }, [])

  function checkMfaStatus() {
    const user = auth.currentUser
    if (!user) {
      setLoading(false)
      return
    }
    const factors = multiFactor(user).enrolledFactors
    setEnrolledFactors(factors)
    setMfaEnabled(factors.length > 0)
    setLoading(false)
  }

  async function handleStartEnrollment(e: React.FormEvent) {
    e.preventDefault()
    const user = auth.currentUser
    if (!user || !user.email) return
    setBusy(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, reAuthPassword)
      await reauthenticateWithCredential(user, credential)

      const mfaSession = await multiFactor(user).getSession()
      const secret = await TotpMultiFactorGenerator.generateSecret(mfaSession)
      setTotpSecret(secret)

      const qrUrl = secret.generateQrCodeUrl(user.email, 'OpenLine')
      const dataUrl = await QRCode.toDataURL(qrUrl, { width: 200, margin: 2 })
      setQrDataUrl(dataUrl)
      setStep('qr')
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('Incorrect password')
      } else {
        toast.error((err as Error).message ?? 'Failed to start enrollment')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleVerifyEnrollment(e: React.FormEvent) {
    e.preventDefault()
    if (!totpSecret) return
    setBusy(true)
    try {
      const user = auth.currentUser
      if (!user) throw new Error('Not signed in')

      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, verifyCode)
      await multiFactor(user).enroll(assertion, 'Authenticator')

      toast.success('Two-factor authentication enabled')
      setStep('idle')
      setReAuthPassword('')
      setVerifyCode('')
      setQrDataUrl('')
      setTotpSecret(null)
      checkMfaStatus()
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/invalid-verification-code') {
        toast.error('Invalid code. Please try again.')
      } else {
        toast.error((err as Error).message ?? 'Enrollment failed')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault()
    const user = auth.currentUser
    if (!user || !user.email) return
    setBusy(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, disablePassword)
      await reauthenticateWithCredential(user, credential)

      const factors = multiFactor(user).enrolledFactors
      for (const factor of factors) {
        await multiFactor(user).unenroll(factor)
      }

      toast.success('Two-factor authentication disabled')
      setDisableStep('idle')
      setDisablePassword('')
      checkMfaStatus()
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('Incorrect password')
      } else {
        toast.error((err as Error).message ?? 'Failed to disable 2FA')
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Checking 2FA status…</p>

  if (!auth.currentUser) {
    return (
      <div className="max-w-xl">
        <div className="card p-6">
          <p className="text-sm text-gray-500">
            Sign in with the Firebase client SDK to manage two-factor authentication.
            Your current session uses server-side cookies — please sign out and sign back in to enable 2FA management.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-6">
      {/* Current status */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Status</p>
            <p className="text-xs text-gray-500 mt-1">
              {mfaEnabled
                ? `Enabled — ${enrolledFactors.map(f => f.displayName ?? 'Authenticator').join(', ')}`
                : 'Not enabled'}
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            mfaEnabled
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {mfaEnabled ? 'Active' : 'Off'}
          </span>
        </div>
      </div>

      {/* Enable flow */}
      {!mfaEnabled && step === 'idle' && (
        <button
          onClick={() => setStep('password')}
          className="btn-primary w-full justify-center"
        >
          Enable Two-Factor Authentication
        </button>
      )}

      {!mfaEnabled && step === 'password' && (
        <div className="card p-6">
          <p className="text-sm font-medium text-gray-900 mb-1">Confirm your password</p>
          <p className="text-xs text-gray-500 mb-4">Re-authentication is required before enabling 2FA.</p>
          <form onSubmit={handleStartEnrollment} className="space-y-3">
            <input
              type="password"
              className="input"
              placeholder="Current password"
              value={reAuthPassword}
              onChange={e => setReAuthPassword(e.target.value)}
              required
              autoFocus
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                {busy ? 'Verifying…' : 'Continue'}
              </button>
              <button type="button" className="btn btn-secondary text-xs" onClick={() => { setStep('idle'); setReAuthPassword('') }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {!mfaEnabled && step === 'qr' && (
        <div className="card p-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-900 mb-1">Scan QR Code</p>
            <p className="text-xs text-gray-500">
              Open your authenticator app (Google Authenticator, Authy, etc.) and scan this QR code.
            </p>
          </div>
          {qrDataUrl && (
            <div className="flex justify-center">
              <img src={qrDataUrl} alt="TOTP QR Code" width={200} height={200} className="rounded-lg border" />
            </div>
          )}
          <button onClick={() => setStep('verify')} className="btn-primary w-full justify-center text-sm">
            I&apos;ve scanned the code
          </button>
        </div>
      )}

      {!mfaEnabled && step === 'verify' && (
        <div className="card p-6">
          <p className="text-sm font-medium text-gray-900 mb-1">Enter verification code</p>
          <p className="text-xs text-gray-500 mb-4">Enter the 6-digit code from your authenticator app.</p>
          <form onSubmit={handleVerifyEnrollment} className="space-y-3">
            <input
              type="text"
              className="input text-center text-lg tracking-[0.3em] font-mono"
              placeholder="000000"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy || verifyCode.length !== 6} className="btn-primary text-xs">
                {busy ? 'Verifying…' : 'Enable 2FA'}
              </button>
              <button type="button" className="btn btn-secondary text-xs" onClick={() => setStep('qr')}>
                Back
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Disable flow */}
      {mfaEnabled && disableStep === 'idle' && (
        <button
          onClick={() => setDisableStep('password')}
          className="btn btn-secondary w-full justify-center text-red-600 hover:text-red-700"
        >
          Disable Two-Factor Authentication
        </button>
      )}

      {mfaEnabled && disableStep === 'password' && (
        <div className="card p-6">
          <p className="text-sm font-medium text-gray-900 mb-1">Confirm your password</p>
          <p className="text-xs text-gray-500 mb-4">Re-authentication is required to disable 2FA.</p>
          <form onSubmit={handleDisable} className="space-y-3">
            <input
              type="password"
              className="input"
              placeholder="Current password"
              value={disablePassword}
              onChange={e => setDisablePassword(e.target.value)}
              required
              autoFocus
            />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="btn-primary text-xs bg-red-600 hover:bg-red-700">
                {busy ? 'Disabling…' : 'Disable 2FA'}
              </button>
              <button type="button" className="btn btn-secondary text-xs" onClick={() => { setDisableStep('idle'); setDisablePassword('') }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// ─── Printer Settings Section ─────────────────────────────────────────────────

function PrinterSettingsSection() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        FedEx Direct labels are generated in <span className="font-semibold">ZPL format</span> for thermal printers.
        When you purchase a FedEx label, download the <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">.zpl</code> file
        and send it to your thermal printer.
      </p>
      <p className="text-xs text-gray-500">
        ShipStation labels (USPS, UPS via Amazon Buy Shipping) continue to use PDF format.
      </p>
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
        id: 'ups-buy-shipping',
        icon: Truck,
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-600',
        title: 'UPS Buy Shipping',
        description: 'Link your UPS carrier account to Amazon Buy Shipping for discounted label rates via Seller Central.',
      },
      {
        id: 'fedex',
        icon: Package,
        iconBg: 'bg-purple-50',
        iconColor: 'text-purple-600',
        title: 'FedEx API',
        description: 'Store your FedEx developer credentials to enable live tracking status for FedEx shipments on the Shipping Manifest.',
      },
      {
        id: 'sickw',
        icon: Smartphone,
        iconBg: 'bg-cyan-50',
        iconColor: 'text-cyan-600',
        title: 'SICKW',
        description: 'Store your SICKW API key to run IMEI checks (iCloud, carrier, blacklist, Knox, etc.) from the SICKW tool page.',
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
        id: 'grades',
        icon: Tag,
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-600',
        title: 'Grades',
        description: 'Manage inventory condition grades (A, B, Refurb, etc.) used across all products.',
      },
      {
        id: 'cost-codes',
        icon: Wrench,
        iconBg: 'bg-orange-50',
        iconColor: 'text-orange-600',
        title: 'Cost Codes',
        description: 'Manage per-unit cost codes applied to PO lines (e.g. kitting, refurbishment) that factor into profitability.',
      },
      {
        id: 'printer',
        icon: Printer,
        iconBg: 'bg-teal-50',
        iconColor: 'text-teal-600',
        title: 'Printer',
        description: 'Label format settings for thermal printer output.',
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
      {
        id: 'security',
        icon: Lock,
        iconBg: 'bg-emerald-50',
        iconColor: 'text-emerald-600',
        title: 'Two-Factor Auth',
        description: 'Enable TOTP two-factor authentication using Google Authenticator or Authy for added account security.',
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
            {activeSection === 'ups-buy-shipping' && <UpsBuyShippingSection />}
            {activeSection === 'fedex'          && <FedexCredentialsSection />}
            {activeSection === 'sickw'          && <SickwCredentialsSection />}
            {activeSection === 'backmarket'     && <BackMarketSection />}
            {activeSection === 'rma-settings'   && <RMASettingsSection />}
            {activeSection === 'grades'         && <GradesSettingsSection />}
            {activeSection === 'cost-codes'    && <CostCodeManager />}
            {activeSection === 'store-settings' && <StoreSettingsSection />}
            {activeSection === 'users'          && <UsersSection />}
            {activeSection === 'security'       && <TwoFactorSection />}
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

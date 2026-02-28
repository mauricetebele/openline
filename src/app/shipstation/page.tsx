'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle, AlertTriangle, Clock, RefreshCw, FlaskConical } from 'lucide-react'
import AppShell from '@/components/AppShell'

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

function ShipStationContent() {
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
      // Auto-fill Amazon carrier ID if found in V2 results
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

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">ShipStation Settings</h1>
      <p className="text-gray-500 text-sm mb-6">
        Configure your ShipStation session token to enable live Amazon Buy Shipping rates.
      </p>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {accounts.map(account => {
        const status = jwtStatus(account)
        return (
          <div key={account.id} className="card mb-4 p-5">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle size={16} className="text-green-500 shrink-0" />
              <div>
                <p className="font-semibold text-sm">{account.name}</p>
                <p className="text-xs text-gray-400">Connected · API key configured</p>
              </div>
            </div>

            <div className="mb-4 rounded-lg border px-4 py-3 text-sm space-y-2">
              {status === null && (
                <p className="text-gray-500">No session token saved yet — Amazon rates will show "Price at purchase".</p>
              )}
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
                        {val
                          ? <CheckCircle size={11} className="text-green-500 shrink-0" />
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
                  <textarea
                    className="input font-mono text-xs"
                    rows={5}
                    placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXV..."
                    value={jwt}
                    onChange={e => setJwt(e.target.value.replace(/\s+/g, ''))}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Expires every ~16 hours. Get it from ShipStation → DevTools → Network → any request → Copy Authorization header value (remove &quot;Bearer &quot;).
                  </p>
                </div>

                <div>
                  <label className="label">
                    ShipEngine / V2 API Key
                    {account.hasV2Key && (
                      <span className="ml-2 text-green-600 text-xs font-normal">✓ saved</span>
                    )}
                  </label>
                  <input
                    className="input font-mono"
                    placeholder="TEST_abc123... or LIVE_abc123..."
                    value={v2ApiKey}
                    onChange={e => setV2ApiKey(e.target.value.trim())}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Found in ShipStation → Account Settings → API Settings → ShipEngine API Key. Required for Amazon Buy Shipping rates.
                  </p>
                </div>

                <div>
                  <label className="label">Ship-From Warehouse ID <span className="text-gray-400 font-normal">(internal ID)</span></label>
                  <input
                    className="input font-mono"
                    placeholder="1663524"
                    value={shipFromId}
                    onChange={e => setShipFromId(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Found in the ShipStation network request body as <code className="bg-gray-100 px-1 rounded">shipFromId</code>.
                  </p>
                </div>

                <div>
                  <label className="label">
                    Amazon Buy Shipping Carrier ID
                    {account.amazonCarrierId && (
                      <span className="ml-2 text-green-600 font-mono text-xs font-normal">
                        ✓ {account.amazonCarrierId}
                      </span>
                    )}
                  </label>
                  <input
                    className="input font-mono"
                    placeholder="se-5013604"
                    value={amazonCarrierId}
                    onChange={e => setAmazonCarrierId(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Find this in ShipStation → Settings → Carriers, or use the Test Carriers button below.
                  </p>
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

      {!loading && accounts.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-500">
          No ShipStation account found. Add one from the Unshipped Orders page.
        </div>
      )}

      {/* ── Carrier Test ───────────────────────────────────────────────── */}
      {!loading && accounts.length > 0 && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-sm">Carrier API Test</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Verifies V1 (Basic auth) and V2 (API-Key) carrier lookups, including Amazon Buy Shipping carrier ID.
              </p>
            </div>
            <button
              onClick={handleTest}
              disabled={testing}
              className="btn-primary shrink-0"
            >
              <FlaskConical size={14} className={testing ? 'animate-pulse' : ''} />
              {testing ? 'Testing…' : 'Test Carriers'}
            </button>
          </div>

          {testResult && (
            <div className="space-y-3 mt-3">
              {/* V1 */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                  {testResult.v1.ok
                    ? <CheckCircle size={12} className="text-green-500" />
                    : <AlertTriangle size={12} className="text-red-400" />}
                  V1 API (Basic auth) — {testResult.v1.ok ? `${testResult.v1.carriers?.length} carriers` : 'failed'}
                </p>
                {testResult.v1.ok ? (
                  <div className="flex flex-wrap gap-1.5">
                    {testResult.v1.carriers?.map(c => (
                      <span key={c.code} className="font-mono text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                        {c.nickname || c.name} ({c.code})
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-red-500">{testResult.v1.error}</p>
                )}
              </div>

              {/* V2 */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1.5">
                  {testResult.v2.ok
                    ? <CheckCircle size={12} className="text-green-500" />
                    : <AlertTriangle size={12} className="text-red-400" />}
                  V2 API (API-Key) — {testResult.v2.ok ? `${testResult.v2.carriers?.length} carriers` : 'failed'}
                </p>
                {testResult.v2.ok ? (
                  <div className="space-y-1">
                    {testResult.v2.carriers?.map(c => {
                      const isAmazon = c.carrier_code?.toLowerCase().includes('amazon')
                      return (
                        <div key={c.carrier_id} className={`flex items-center gap-2 text-[10px] font-mono px-1.5 py-1 rounded ${isAmazon ? 'bg-orange-50 border border-orange-200' : 'bg-gray-100'}`}>
                          {isAmazon && <span className="text-orange-600 font-bold text-[9px] uppercase">Amazon</span>}
                          <span className="text-gray-600">{c.friendly_name || c.nickname}</span>
                          <span className="text-gray-400">code: {c.carrier_code}</span>
                          <span className="ml-auto text-blue-600 font-bold">id: {c.carrier_id}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-red-500">{testResult.v2.error}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-blue-800 mb-2">How to get your Session Token</p>
        <ol className="list-decimal list-inside space-y-1.5 text-blue-700 text-xs">
          <li>Open <strong>ShipStation</strong> in Chrome and go to an unshipped order</li>
          <li>Press <strong>F12</strong> → click the <strong>Network</strong> tab → clear it</li>
          <li>Click the button that shows Amazon Buy Shipping rates</li>
          <li>Find the <code className="bg-blue-100 px-1 rounded">api/rate/browse</code> request</li>
          <li>Click it → <strong>Headers</strong> → copy the <code className="bg-blue-100 px-1 rounded">Authorization</code> value (everything after &quot;Bearer &quot;)</li>
          <li>Paste it above and click Save</li>
        </ol>
        <p className="text-xs text-blue-600 mt-3">Token expires every ~16 hours and must be refreshed manually.</p>
      </div>
    </div>
  )
}

export default function ShipStationPage() {
  return (
    <AppShell>
      <ShipStationContent />
    </AppShell>
  )
}

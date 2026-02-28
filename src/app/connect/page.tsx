'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link2, CheckCircle, ExternalLink } from 'lucide-react'
import AppShell from '@/components/AppShell'

interface Account {
  id: string
  sellerId: string
  marketplaceName: string
  region: string
  isActive: boolean
  createdAt: string
}

function ConnectContent() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [saving, setSaving] = useState(false)
  const [sellerId, setSellerId] = useState('')
  const [refreshToken, setRefreshToken] = useState('')

  useEffect(() => {
    fetchAccounts()
  }, [])

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
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">Connect Amazon Account</h1>
      <p className="text-gray-500 text-sm mb-6">
        Paste your Seller ID and refresh token from Seller Central to connect your account.
      </p>

      {/* Connected accounts */}
      {accounts.length > 0 && (
        <div className="card mb-6">
          <div className="px-5 py-3 border-b">
            <p className="font-semibold text-sm">Connected Accounts</p>
          </div>
          <div className="divide-y">
            {accounts.map((a) => (
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

      {/* Manual token form */}
      <div className="card p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="rounded-xl p-3 bg-amazon-orange/10">
            <Link2 size={20} className="text-amazon-orange" />
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
            <input
              className="input"
              placeholder="A3CUWXS22IILW1"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Refresh Token</label>
            <textarea
              className="input font-mono text-xs"
              rows={4}
              placeholder="Atzr|..."
              value={refreshToken}
              onChange={(e) => setRefreshToken(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary w-full justify-center" disabled={saving}>
            {saving ? 'Saving…' : 'Connect Account'}
          </button>
        </form>
      </div>

      {/* How to get refresh token */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm">
        <p className="font-semibold text-blue-800 mb-2">How to get your Refresh Token</p>
        <ol className="list-decimal list-inside space-y-1.5 text-blue-700 text-xs">
          <li>Go to <strong>Seller Central → Apps &amp; Services → Manage Your Apps</strong></li>
          <li>Find your developer app and click <strong>Authorize</strong></li>
          <li>Complete the authorization — you will be given a refresh token</li>
          <li>Paste it above along with your Seller ID</li>
        </ol>
        <a
          href="https://sellercentral.amazon.com/apps/manage"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-3 text-blue-600 hover:underline text-xs font-medium"
        >
          Open Seller Central <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

export default function ConnectPage() {
  return (
    <AppShell>
      <ConnectContent />
    </AppShell>
  )
}

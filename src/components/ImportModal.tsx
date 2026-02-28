'use client'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { X, Download, Loader2 } from 'lucide-react'

interface Account { id: string; sellerId: string; marketplaceName: string }

interface Props {
  onClose: () => void
  /** Called immediately when the job is created — parent takes over progress tracking */
  onStarted: (jobId: string) => void
}

export default function ImportModal({ onClose, onStarted }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((data: Account[]) => {
        setAccounts(data)
        if (data.length > 0) setAccountId(data[0].id)
      })
  }, [])

  async function handleImport() {
    if (!accountId) { toast.error('Select an Amazon account'); return }
    setLoading(true)

    try {
      const res = await fetch('/api/refunds/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate + 'T23:59:59').toISOString(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Failed to start import')

      // Hand off the job ID to the parent and close immediately
      onStarted(data.jobId)
      onClose()
    } catch (err) {
      setLoading(false)
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg">Import Refunds from Amazon</h2>
          <button onClick={onClose} disabled={loading} className="text-gray-400 hover:text-gray-700 disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Amazon Account</label>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={loading}>
              {accounts.length === 0 && <option value="">— No account connected —</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.marketplaceName} ({a.sellerId})
                </option>
              ))}
            </select>
            {accounts.length === 0 && (
              <p className="text-xs text-red-500 mt-1">
                No account found. Go to <a href="/connect" className="underline">Connect</a> to add one.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start Date</label>
              <input type="date" className="input" value={startDate} disabled={loading}
                onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label">End Date</label>
              <input type="date" className="input" value={endDate} disabled={loading}
                onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border">
            The import runs in the background — you can keep using the app. A progress bar will appear at the top of the refunds table.
          </p>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-primary" onClick={handleImport} disabled={loading || !accountId}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {loading ? 'Starting…' : 'Start Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

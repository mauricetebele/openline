'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import AppShell from '@/components/AppShell'
import { DollarSign, Loader2, Search } from 'lucide-react'

interface PostageEntry {
  type: string
  postedDate: string | null
  amount: number
  currency: string
  items: { sku: string | null; qty: number; perUnit: number | null; total: number | null }[]
}

interface LookupResult {
  amazonOrderId: string
  parsed: {
    entries: PostageEntry[]
    totalPostage: number
  }
  eventSummary?: Record<string, number>
  raw: Record<string, unknown>
}

export default function ShippingCostPage() {
  const [orderId, setOrderId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleLookup() {
    const trimmed = orderId.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/shipping-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazonOrderId: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Lookup failed')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-auto">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign size={20} />
            Shipping Cost Lookup
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Look up Amazon Buy Shipping label costs via the Finances API.
          </p>
        </div>

        <div className="p-6 space-y-6 max-w-4xl">
          {/* Input */}
          <div className="flex gap-3">
            <input
              type="text"
              value={orderId}
              onChange={e => setOrderId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              placeholder="Enter Amazon Order ID (e.g. 114-1234567-1234567)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleLookup}
              disabled={loading || !orderId.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Look Up
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Summary */}
              <div className={`px-4 py-3 rounded-lg border ${result.parsed.totalPostage > 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                <p className={`text-sm font-medium ${result.parsed.totalPostage > 0 ? 'text-green-800' : 'text-yellow-800'}`}>
                  Order: {result.amazonOrderId}
                </p>
                <p className={`text-2xl font-bold mt-1 ${result.parsed.totalPostage > 0 ? 'text-green-900' : 'text-yellow-900'}`}>
                  Postage: ${result.parsed.totalPostage.toFixed(2)}
                </p>
                {result.parsed.totalPostage === 0 && (
                  <p className="text-xs text-yellow-600 mt-0.5">
                    No PostageBilling_Postage adjustment found for this order.
                  </p>
                )}
              </div>

              {/* Postage entries */}
              {result.parsed.entries.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Type</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Posted</th>
                        <th className="text-right px-4 py-2 font-medium text-gray-700">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.parsed.entries.map((entry, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs">{entry.type}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">
                            {entry.postedDate ? new Date(entry.postedDate).toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-bold">
                            ${entry.amount.toFixed(2)} {entry.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Event types found */}
              {result.eventSummary && Object.keys(result.eventSummary).length > 0 && (
                <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-lg">
                  <p className="text-sm font-medium text-blue-800 mb-1">Event Types Found:</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(result.eventSummary).map(([key, count]) => (
                      <span key={key} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        {key}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw JSON */}
              <details className="border rounded-lg">
                <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                  Raw Financial Events JSON
                </summary>
                <pre className="px-4 py-3 text-xs bg-gray-50 overflow-auto max-h-96 border-t">
                  {JSON.stringify(result.raw, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

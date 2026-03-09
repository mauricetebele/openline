'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import AppShell from '@/components/AppShell'
import { DollarSign, Loader2, Search } from 'lucide-react'

interface ChargeOrFee {
  type: string
  amount: number
  currency: string
}

interface ParsedItem {
  sku: string | null
  orderItemId: string | null
  qty: number
  charges: ChargeOrFee[]
  fees: ChargeOrFee[]
  shippingTotal: number
}

interface LookupResult {
  amazonOrderId: string
  parsed: {
    items: ParsedItem[]
    totalShippingCost: number
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
              <div className="bg-green-50 border border-green-200 px-4 py-3 rounded-lg">
                <p className="text-sm font-medium text-green-800">
                  Order: {result.amazonOrderId}
                </p>
                <p className="text-lg font-bold text-green-900 mt-1">
                  Total Shipping Cost: ${result.parsed.totalShippingCost.toFixed(2)}
                </p>
                <p className="text-xs text-green-600 mt-0.5">
                  {result.parsed.items.length} line item{result.parsed.items.length !== 1 ? 's' : ''} found
                </p>
              </div>

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

              {/* Item breakdown */}
              {result.parsed.items.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">SKU</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Qty</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Charges</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Fees</th>
                        <th className="text-right px-4 py-2 font-medium text-gray-700">Shipping Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.parsed.items.map((item, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs">{item.sku ?? '—'}</td>
                          <td className="px-4 py-2">{item.qty}</td>
                          <td className="px-4 py-2">
                            {item.charges.map((c, j) => (
                              <div key={j} className="text-xs">
                                <span className="text-gray-500">{c.type}:</span>{' '}
                                ${c.amount.toFixed(2)}
                              </div>
                            ))}
                            {item.charges.length === 0 && <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-2">
                            {item.fees.map((f, j) => (
                              <div key={j} className="text-xs">
                                <span className="text-gray-500">{f.type}:</span>{' '}
                                ${f.amount.toFixed(2)}
                              </div>
                            ))}
                            {item.fees.length === 0 && <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            ${item.shippingTotal.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

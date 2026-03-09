'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import AppShell from '@/components/AppShell'
import { DollarSign, Loader2, Search } from 'lucide-react'

interface CostEntry {
  source: 'adjustment' | 'shipment' | 'mfn'
  label: string
  postedDate: string | null
  amount: number
  currency: string
  details: { type: string; amount: number }[]
}

interface LookupResult {
  amazonOrderId: string | null
  shipmentId: string | null
  parsed: {
    entries: CostEntry[]
    totalShippingCost: number
  }
  eventSummary?: Record<string, number>
  raw: Record<string, unknown>
}

const SOURCE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  adjustment: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Postage Billing' },
  shipment:   { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Order Settlement' },
  mfn:        { bg: 'bg-green-100',  text: 'text-green-700',  label: 'MFN Label' },
}

export default function ShippingCostPage() {
  const [orderId, setOrderId] = useState('')
  const [shipmentId, setShipmentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleLookup() {
    const trimmedOrder = orderId.trim()
    const trimmedShipment = shipmentId.trim()
    if (!trimmedOrder && !trimmedShipment) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/shipping-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amazonOrderId: trimmedOrder || undefined,
          shipmentId: trimmedShipment || undefined,
        }),
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

  const total = result?.parsed.totalShippingCost ?? 0

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-auto">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign size={20} />
            Shipping Cost Lookup
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Look up Amazon Buy Shipping label costs. Uses Finances API + MFN getShipment.
          </p>
        </div>

        <div className="p-6 space-y-6 max-w-4xl">
          {/* Inputs */}
          <div className="space-y-3">
            <div className="flex gap-3">
              <input
                type="text"
                value={orderId}
                onChange={e => setOrderId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder="Amazon Order ID (e.g. 114-1234567-1234567)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleLookup}
                disabled={loading || (!orderId.trim() && !shipmentId.trim())}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                Look Up
              </button>
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                value={shipmentId}
                onChange={e => setShipmentId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder="MFN Shipment ID (optional — for own-carrier labels)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-gray-400">
              Amazon-vendor labels: Order ID is enough (Finances API). Own-carrier labels: also provide the MFN Shipment ID.
            </p>
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
              <div className={`px-4 py-3 rounded-lg border ${total > 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                <p className={`text-sm font-medium ${total > 0 ? 'text-green-800' : 'text-yellow-800'}`}>
                  {result.amazonOrderId && <>Order: {result.amazonOrderId}</>}
                  {result.amazonOrderId && result.shipmentId && ' · '}
                  {result.shipmentId && <>Shipment: {result.shipmentId}</>}
                </p>
                <p className={`text-2xl font-bold mt-1 ${total > 0 ? 'text-green-900' : 'text-yellow-900'}`}>
                  Label Cost: ${total.toFixed(2)}
                </p>
                {total === 0 && (
                  <p className="text-xs text-yellow-600 mt-0.5">
                    No label cost found. For own-carrier labels, try providing the MFN Shipment ID.
                  </p>
                )}
              </div>

              {/* Cost entries breakdown */}
              {result.parsed.entries.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Source</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Posted</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-700">Breakdown</th>
                        <th className="text-right px-4 py-2 font-medium text-gray-700">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.parsed.entries.map((entry, i) => {
                        const badge = SOURCE_BADGE[entry.source] ?? SOURCE_BADGE.shipment
                        return (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <div className="text-xs font-medium">{entry.label}</div>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-600">
                              {entry.postedDate ? new Date(entry.postedDate).toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2">
                              {entry.details.map((d, j) => (
                                <div key={j} className="text-xs">
                                  <span className="text-gray-500">{d.type}:</span>{' '}
                                  ${d.amount.toFixed(2)}
                                </div>
                              ))}
                            </td>
                            <td className="px-4 py-2 text-right font-bold">
                              {entry.amount > 0 ? `$${entry.amount.toFixed(2)}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Event types found */}
              {result.eventSummary && Object.keys(result.eventSummary).length > 0 && (
                <details className="border rounded-lg">
                  <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                    Event Types Found
                  </summary>
                  <div className="px-4 py-3 border-t bg-blue-50 flex flex-wrap gap-2">
                    {Object.entries(result.eventSummary).map(([key, count]) => (
                      <span key={key} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        {key}: {count}
                      </span>
                    ))}
                  </div>
                </details>
              )}

              {/* Raw JSON */}
              <details className="border rounded-lg">
                <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                  Raw JSON
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

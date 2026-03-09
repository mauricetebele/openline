'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import AppShell from '@/components/AppShell'
import {
  DollarSign,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Truck,
  Package,
  ChevronDown,
} from 'lucide-react'

// ─── Types matching API response ─────────────────────────────────────────────

type LabelType = 'amazon_rate' | 'linked_carrier' | 'unknown'
type Confidence = 'high' | 'medium' | 'low'

interface TransactionCandidate {
  transactionId: string | null
  type: string | null
  description: string | null
  amount: number
  currency: string
  postedDate: string | null
}

interface ShippingCostResult {
  orderId: string | null
  shipmentId: string | null
  labelType: LabelType
  carrier: string | null
  service: string | null
  tracking: string | null
  purchaseQuotedCost: number | null
  amazonTransactionAmount: number | null
  carrierBilledAmount: number | null
  bestEstimate: number | null
  confidence: Confidence
  reason: string
  candidates: TransactionCandidate[]
  warnings: string[]
  raw: {
    mfnShipment: Record<string, unknown> | null
    transactions: unknown[] | null
    v0Events: Record<string, unknown> | null
    dbLabel: Record<string, unknown> | null
  }
}

// ─── Badge helpers ───────────────────────────────────────────────────────────

const LABEL_TYPE_BADGE: Record<LabelType, { bg: string; text: string; label: string }> = {
  amazon_rate:    { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Amazon Rate' },
  linked_carrier: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Linked Carrier' },
  unknown:        { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Unknown' },
}

const CONFIDENCE_BADGE: Record<Confidence, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  high:   { bg: 'bg-green-100',  text: 'text-green-700',  icon: CheckCircle2 },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: AlertTriangle },
  low:    { bg: 'bg-red-100',    text: 'text-red-700',    icon: HelpCircle },
}

function Badge({ bg, text, label }: { bg: string; text: string; label: string }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${bg} ${text}`}>
      {label}
    </span>
  )
}

// ─── Detail row component ────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ShippingCostPage() {
  const [orderId, setOrderId] = useState('')
  const [shipmentId, setShipmentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ShippingCostResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawOpen, setRawOpen] = useState(false)

  async function handleLookup() {
    const trimmedOrder = orderId.trim()
    const trimmedShipment = shipmentId.trim()
    if (!trimmedOrder && !trimmedShipment) return

    setLoading(true)
    setError(null)
    setResult(null)
    setRawOpen(false)

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

  const confBadge = result ? CONFIDENCE_BADGE[result.confidence] : null
  const typeBadge = result ? LABEL_TYPE_BADGE[result.labelType] : null

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-auto">
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign size={20} />
            Shipping Cost Lookup
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Multi-source lookup: Local DB, MFN getShipment, Finances v2024-06-19, Finances v0.
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
            <input
              type="text"
              value={shipmentId}
              onChange={e => setShipmentId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              placeholder="MFN Shipment ID (optional — for own-carrier labels)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">
              Amazon-vendor labels: Order ID is enough. Own-carrier labels: also provide the MFN Shipment ID.
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
              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 space-y-1">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-yellow-800">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Header Card */}
              <div className="bg-white border rounded-lg p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {result.orderId && (
                        <span className="text-sm text-gray-500">
                          Order: <span className="font-mono font-medium text-gray-700">{result.orderId}</span>
                        </span>
                      )}
                      {result.shipmentId && (
                        <span className="text-sm text-gray-500">
                          Shipment: <span className="font-mono font-medium text-gray-700">{result.shipmentId}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {typeBadge && <Badge bg={typeBadge.bg} text={typeBadge.text} label={typeBadge.label} />}
                      {confBadge && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${confBadge.bg} ${confBadge.text}`}>
                          <confBadge.icon size={12} />
                          {result.confidence} confidence
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Best Estimate</p>
                    <p className={`text-3xl font-bold ${result.bestEstimate !== null ? 'text-gray-900' : 'text-gray-400'}`}>
                      {result.bestEstimate !== null ? `$${result.bestEstimate.toFixed(2)}` : '—'}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-3 border-t pt-3">
                  {result.reason}
                </p>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Shipping Details */}
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
                    <Truck size={14} />
                    Shipping Details
                  </h3>
                  <DetailRow label="Carrier" value={result.carrier} />
                  <DetailRow label="Service" value={result.service} />
                  <DetailRow label="Tracking" value={result.tracking} />
                  <DetailRow label="Label Type" value={typeBadge?.label} />
                  {!result.carrier && !result.service && !result.tracking && (
                    <p className="text-sm text-gray-400 italic">No shipping details available</p>
                  )}
                </div>

                {/* Cost Breakdown */}
                <div className="bg-white border rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
                    <Package size={14} />
                    Cost Sources
                  </h3>
                  <DetailRow
                    label="MFN Quoted Rate"
                    value={result.purchaseQuotedCost !== null ? `$${result.purchaseQuotedCost.toFixed(2)}` : null}
                  />
                  <DetailRow
                    label="Amazon Transaction"
                    value={result.amazonTransactionAmount !== null ? `$${result.amazonTransactionAmount.toFixed(2)}` : null}
                  />
                  <DetailRow
                    label="Carrier Billed"
                    value={result.carrierBilledAmount !== null ? `$${result.carrierBilledAmount.toFixed(2)}` : 'N/A (not available via API)'}
                  />
                  {result.purchaseQuotedCost === null && result.amazonTransactionAmount === null && (
                    <p className="text-sm text-gray-400 italic">No cost data found from any source</p>
                  )}
                </div>
              </div>

              {/* Transaction Candidates */}
              {result.candidates.length > 0 && (
                <div className="bg-white border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Transaction Candidates ({result.candidates.length})
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Shipping-related transactions from Finances v2024-06-19
                    </p>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">Transaction ID</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">Type</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">Description</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">Posted</th>
                        <th className="text-right px-4 py-2 font-medium text-gray-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.candidates.map((c, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs text-gray-600">
                            {c.transactionId ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-xs">{c.type ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-600 max-w-[200px] truncate">
                            {c.description ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {c.postedDate ? new Date(c.postedDate).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-medium">
                            ${c.amount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Raw JSON */}
              <div className="bg-white border rounded-lg overflow-hidden">
                <button
                  onClick={() => setRawOpen(!rawOpen)}
                  className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <span>Raw API Responses</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform ${rawOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {rawOpen && (
                  <div className="border-t">
                    {(['dbLabel', 'mfnShipment', 'transactions', 'v0Events'] as const).map(key => {
                      const data = result.raw[key]
                      if (!data) return null
                      return (
                        <div key={key} className="border-b last:border-0">
                          <div className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                            {key}
                          </div>
                          <pre className="px-4 py-3 text-xs bg-white overflow-auto max-h-64">
                            {JSON.stringify(data, null, 2)}
                          </pre>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

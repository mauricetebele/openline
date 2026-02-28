'use client'
import { useEffect, useState } from 'react'
import { X, ExternalLink, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { format } from 'date-fns'
import ReviewForm from './ReviewForm'
import { INVALID_REASON_LABELS, InvalidReason, ReviewStatus } from '@/types'

interface Props {
  refundId: string
  onClose: () => void
  onUpdated: () => void
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'VALID' ? 'badge-green'
    : status === 'INVALID' ? 'badge-red'
    : 'badge-gray'
  return <span className={cls}>{status}</span>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-1 text-gray-400 hover:text-gray-700 transition-colors"
      title="Copy order ID"
    >
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </button>
  )
}

export default function RefundDetailModal({ refundId, onClose, onUpdated }: Props) {
  const [refund, setRefund] = useState<Record<string, unknown> | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [loading, setLoading] = useState(true)

  async function fetchRefund() {
    setLoading(true)
    const res = await fetch(`/api/refunds/${refundId}`)
    if (res.ok) setRefund(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchRefund() }, [refundId])

  function handleSaved() {
    fetchRefund()
    onUpdated()
  }

  const review = refund?.review as Record<string, unknown> | null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-semibold text-lg">Refund Detail</h2>
            {refund && (
              <p className="text-xs text-gray-500 mt-0.5">
                Order:{' '}
                <span className="inline-flex items-center gap-1">
                  <a
                    href={`https://sellercentral.amazon.com/orders-v3/order/${refund.orderId as string}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    {refund.orderId as string}
                    <ExternalLink size={11} />
                  </a>
                  <CopyButton text={refund.orderId as string} />
                </span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center text-gray-400 py-12">Loading…</div>
        )}

        {!loading && refund && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Fields grid */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Posted Date', format(new Date(refund.postedDate as string), 'MMM d, yyyy')],
                ['Amount', `${refund.currency} ${Number(refund.amount).toFixed(2)}`],
                ['Fulfillment', refund.fulfillmentType as string],
                ['Marketplace', (refund.account as { marketplaceName: string })?.marketplaceName],
                ['SKU', refund.sku ?? '—'],
                ['ASIN', refund.asin ?? '—'],
                ['Reason Code', refund.reasonCode ?? '—'],
                ['Adjustment ID', refund.adjustmentId as string],
                ['Review Status', ''],
              ].map(([label, value]) =>
                label === 'Review Status' ? (
                  <div key={label}>
                    <p className="text-gray-500 text-xs uppercase tracking-wide">{label}</p>
                    <StatusBadge status={(review?.status as string) ?? 'UNREVIEWED'} />
                  </div>
                ) : (
                  <div key={label as string}>
                    <p className="text-gray-500 text-xs uppercase tracking-wide">{label}</p>
                    <p className="font-medium truncate">{value || '—'}</p>
                  </div>
                ),
              )}
            </div>

            {/* Current invalid reason */}
            {review?.status === 'INVALID' && (
              <div className="bg-red-50 rounded-lg p-4 border border-red-200 text-sm">
                <p className="font-semibold text-red-800 mb-1">
                  {INVALID_REASON_LABELS[(review.invalidReason as InvalidReason) ?? 'OTHER']}
                </p>
                {review.customReason && <p className="text-red-700">{review.customReason as string}</p>}
                {review.notes && <p className="text-gray-600 mt-1 italic">{review.notes as string}</p>}
              </div>
            )}

            {/* Review form */}
            <div className="border-t pt-5">
              <h3 className="font-semibold mb-4">Update Review</h3>
              <ReviewForm
                refundId={refundId}
                currentStatus={(review?.status as ReviewStatus) ?? 'UNREVIEWED'}
                currentReason={(review?.invalidReason as InvalidReason) ?? null}
                currentNotes={(review?.notes as string) ?? null}
                onSaved={handleSaved}
              />
            </div>

            {/* Raw payload toggle */}
            <div className="border-t pt-4">
              <button
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setShowRaw(!showRaw)}
              >
                {showRaw ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Raw SP-API Payload
              </button>
              {showRaw && (
                <pre className="mt-2 bg-gray-950 text-green-400 text-xs rounded-lg p-4 overflow-x-auto max-h-64">
                  {JSON.stringify(refund.rawPayload, null, 2)}
                </pre>
              )}
            </div>

            {/* Audit trail for this refund */}
            {(refund.auditEvents as unknown[])?.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="font-semibold text-sm mb-3">History</h3>
                <div className="space-y-2">
                  {(refund.auditEvents as Record<string, unknown>[]).map((evt) => (
                    <div key={evt.id as string} className="flex items-start gap-3 text-xs">
                      <span className="text-gray-400 w-32 shrink-0">
                        {format(new Date(evt.timestamp as string), 'MMM d HH:mm')}
                      </span>
                      <span className="font-mono text-gray-600">{evt.action as string}</span>
                      <span className="text-gray-400 ml-auto">{evt.actorLabel as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

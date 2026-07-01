'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { X, Loader2, CheckCircle2, Package } from 'lucide-react'
import { clsx } from 'clsx'
import ReceiveRemovalItemModal from './ReceiveRemovalItemModal'
import CreateRemovalCaseModal from './CreateRemovalCaseModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShipmentItem {
  id: string
  sellerSku: string
  fnsku: string
  disposition: string | null
  quantity: number
  title: string | null
  receivedCount: number
  remainingQty: number
}

interface ShipmentDetail {
  id: string
  trackingNumber: string
  removalOrderId: string
  carrier: string | null
  orderType: string | null
  shipDate: string | null
  items: ShipmentItem[]
  totalUnits: number
  totalReceived: number
}

interface Props {
  shipmentId: string
  trackingNumber: string
  onClose: () => void
  onUpdated: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProcessShipmentModal({ shipmentId, trackingNumber, onClose, onUpdated }: Props) {
  const [detail, setDetail] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [receiveItem, setReceiveItem] = useState<ShipmentItem | null>(null)
  const [caseItem, setCaseItem] = useState<ShipmentItem | null>(null)

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/removal-shipments/${shipmentId}`)
      const json = await res.json()
      setDetail(json)
    } catch { /* ignore */ }
    setLoading(false)
  }, [shipmentId])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  function handleReceived() {
    setReceiveItem(null)
    fetchDetail()
    onUpdated()
  }

  function handleCaseCreated() {
    setCaseItem(null)
    fetchDetail()
    onUpdated()
  }

  const allDone = detail ? detail.totalReceived >= detail.totalUnits : false

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-3xl mx-4 flex flex-col max-h-[88vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700 shrink-0">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Process Shipment
              </h2>
              <p className="text-xs text-gray-400 mt-0.5 font-mono">{trackingNumber}</p>
            </div>
            <div className="flex items-center gap-3">
              {detail && (
                <span className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold',
                  allDone
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                )}>
                  {allDone && <CheckCircle2 size={12} />}
                  {detail.totalReceived} / {detail.totalUnits} received
                </span>
              )}
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto px-6 py-4">
            {loading ? (
              <div className="py-12 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading shipment...
              </div>
            ) : !detail ? (
              <div className="py-12 text-center text-sm text-gray-400">Failed to load shipment</div>
            ) : detail.items.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No items in this shipment</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 w-8">#</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">SKU</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">FNSKU</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Title</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Disposition</th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-500 dark:text-gray-400">Qty</th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-500 dark:text-gray-400">Received</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-500 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, idx) => {
                    const done = item.receivedCount >= item.quantity
                    return (
                      <tr key={item.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                        <td className="px-2 py-2 text-gray-400">{idx + 1}</td>
                        <td className="px-2 py-2 font-mono text-gray-800 dark:text-gray-200">{item.sellerSku}</td>
                        <td className="px-2 py-2 font-mono text-gray-600 dark:text-gray-400">{item.fnsku}</td>
                        <td className="px-2 py-2 text-gray-600 dark:text-gray-400 max-w-[180px] truncate" title={item.title ?? ''}>
                          {item.title ?? '—'}
                        </td>
                        <td className="px-2 py-2 text-gray-600 dark:text-gray-400">{item.disposition ?? '—'}</td>
                        <td className="px-2 py-2 text-center font-semibold text-gray-900 dark:text-gray-100">{item.quantity}</td>
                        <td className="px-2 py-2 text-center">
                          <span className={clsx(
                            'font-semibold',
                            done ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'
                          )}>
                            {item.receivedCount} / {item.quantity}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            {done ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-[10px] font-semibold">
                                <CheckCircle2 size={10} /> Done
                              </span>
                            ) : (
                              <button
                                onClick={() => setReceiveItem(item)}
                                className="px-3 py-1 text-[11px] font-semibold text-white bg-amazon-blue rounded hover:bg-amazon-blue/90"
                              >
                                Receive
                              </button>
                            )}
                            <button
                              onClick={() => setCaseItem(item)}
                              className="px-3 py-1 text-[11px] font-semibold text-white bg-amber-600 rounded hover:bg-amber-700"
                            >
                              Create Case
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-3 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900">
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Receive Item Modal */}
      {receiveItem && detail && (
        <ReceiveRemovalItemModal
          shipmentId={shipmentId}
          shipmentItemId={receiveItem.id}
          trackingNumber={detail.trackingNumber}
          sellerSku={receiveItem.sellerSku}
          fnsku={receiveItem.fnsku}
          onClose={() => setReceiveItem(null)}
          onReceived={handleReceived}
        />
      )}

      {/* Create Case Modal */}
      {caseItem && detail && (
        <CreateRemovalCaseModal
          shipmentId={shipmentId}
          shipmentItemId={caseItem.id}
          trackingNumber={detail.trackingNumber}
          removalOrderId={detail.removalOrderId}
          sellerSku={caseItem.sellerSku}
          fnsku={caseItem.fnsku}
          productTitle={caseItem.title}
          onClose={() => setCaseItem(null)}
          onCreated={handleCaseCreated}
        />
      )}
    </>
  )
}

'use client'
import { useState } from 'react'
import {
  X, RefreshCcw, CheckCircle2, AlertCircle, Printer, Package, Truck,
} from 'lucide-react'

interface OrderItem {
  id: string; orderItemId: string; asin: string | null; sellerSku: string | null
  title: string | null; quantityOrdered: number; quantityShipped: number
  itemPrice: string | null; shippingPrice: string | null
}

interface OrderLabelSummary {
  trackingNumber: string; labelFormat: string; carrier: string | null
  serviceCode: string | null; shipmentCost: string | null
}

interface Order {
  id: string; amazonOrderId: string; shipToName: string | null
  items: OrderItem[]
  label?: OrderLabelSummary | null
  orderSource?: string
  olmNumber?: number | null
}

type Phase = 'review' | 'verified' | 'done'

function downloadLabelData(labelData: string, labelFormat: string, filename: string) {
  const bytes = Uint8Array.from(atob(labelData), c => c.charCodeAt(0))
  const mime  = labelFormat === 'pdf' ? 'application/pdf' : 'image/png'
  const ext   = labelFormat === 'pdf' ? 'pdf' : 'png'
  const blob  = new Blob([bytes], { type: mime })
  const url   = URL.createObjectURL(blob)
  const a     = document.createElement('a')
  a.href = url; a.download = `${filename}.${ext}`; a.click()
  URL.revokeObjectURL(url)
}

export default function ShipByItemModal({ order, serialNumber, serialSku, onClose, onComplete }: {
  order: Order
  serialNumber: string
  serialSku: string
  onClose: () => void
  onComplete: () => void
}) {
  const [phase, setPhase]           = useState<Phase>('review')
  const [verifying, setVerifying]   = useState(false)
  const [verifyErr, setVerifyErr]   = useState<string | null>(null)
  const [printing, setPrinting]     = useState(false)
  const [printErr, setPrintErr]     = useState<string | null>(null)

  const matchedItem = order.items.find(i => i.sellerSku === serialSku) ?? order.items[0]

  async function handleVerify() {
    setVerifying(true); setVerifyErr(null)
    try {
      const assignments = [{
        orderItemId:   matchedItem.id,
        serialNumbers: [serialNumber],
      }]
      const res = await fetch(`/api/orders/${order.id}/serialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status}`)
      setPhase('verified')
    } catch (e) {
      setVerifyErr(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  async function handlePrintLabel() {
    setPrinting(true); setPrintErr(null)
    try {
      const res = await fetch(`/api/orders/${order.id}/label`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Failed to fetch label')
      }
      const data: { labelData: string; labelFormat: string; trackingNumber: string } = await res.json()
      downloadLabelData(data.labelData, data.labelFormat, `label-${order.amazonOrderId}`)
      setPhase('done')
    } catch (e) {
      setPrintErr(e instanceof Error ? e.message : 'Failed to print label')
    } finally {
      setPrinting(false)
    }
  }

  function handleDone() {
    onComplete()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <Package size={15} className="text-purple-600" /> Ship by Item
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Scan &rarr; Verify &rarr; Print</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Serial info */}
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
            <p className="text-[10px] font-medium text-purple-500 uppercase tracking-wider mb-1">Scanned Serial</p>
            <p className="font-mono text-sm font-bold text-purple-900">{serialNumber}</p>
            <p className="text-xs text-purple-600 mt-0.5">SKU: {serialSku}</p>
          </div>

          {/* Matched order info */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">Matched Order <CheckCircle2 size={12} className="text-green-500" /></p>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-sm font-bold text-gray-900">
                  {order.olmNumber ? `OLM-${order.olmNumber}` : order.amazonOrderId}
                </p>
                <p className="text-xs text-gray-500">{order.amazonOrderId}</p>
              </div>
            </div>
            {order.shipToName && (
              <p className="text-xs text-gray-600">Buyer: <span className="font-medium">{order.shipToName}</span></p>
            )}
            <p className="text-xs text-gray-600">
              SKU: <span className="font-mono font-medium">{matchedItem?.sellerSku ?? '—'}</span>
              {matchedItem?.title && <span className="text-gray-400 ml-1">— {matchedItem.title}</span>}
            </p>
            {order.label?.trackingNumber && (
              <p className="text-xs text-gray-600">
                Tracking: <span className="font-mono font-medium">{order.label.trackingNumber}</span>
                {order.label.carrier && <span className="text-gray-400 ml-1">({order.label.carrier})</span>}
              </p>
            )}
          </div>

          {/* Phase: Review */}
          {phase === 'review' && (
            <>
              {verifyErr && (
                <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />{verifyErr}
                </div>
              )}
              <button onClick={handleVerify} disabled={verifying}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors">
                {verifying
                  ? <><RefreshCcw size={14} className="animate-spin" /> Verifying…</>
                  : <><Truck size={14} /> Verify &amp; Ship</>}
              </button>
            </>
          )}

          {/* Phase: Verified */}
          {phase === 'verified' && (
            <>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
                <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                <span className="font-medium">Order verified &amp; marked shipped!</span>
              </div>
              {printErr && (
                <div className="flex items-start gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />{printErr}
                </div>
              )}
              <button onClick={handlePrintLabel} disabled={printing}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 transition-colors">
                {printing
                  ? <><RefreshCcw size={14} className="animate-spin" /> Downloading…</>
                  : <><Printer size={14} /> Print Label</>}
              </button>
            </>
          )}

          {/* Phase: Done */}
          {phase === 'done' && (
            <>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
                <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                <span className="font-medium">Label downloaded!</span>
              </div>
              <button onClick={handleDone}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-colors">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'
import React, { useState } from 'react'
import { X, Loader2 } from 'lucide-react'

interface Props {
  shipmentId: string
  shipmentItemId: string
  trackingNumber: string
  removalOrderId: string
  sellerSku: string
  fnsku: string
  productTitle: string | null
  defaultLpn?: string | null
  onClose: () => void
  onCreated: () => void
}

export default function CreateRemovalCaseModal({
  shipmentId,
  shipmentItemId,
  trackingNumber,
  removalOrderId,
  sellerSku,
  fnsku,
  productTitle,
  defaultLpn,
  onClose,
  onCreated,
}: Props) {
  const [lpnNumber, setLpnNumber] = useState(defaultLpn ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/removal-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          removalOrderId,
          trackingNumber,
          lpnNumber: lpnNumber.trim() || null,
          fnsku,
          sellerSku,
          productTitle,
          note: note.trim() || null,
          removalShipmentId: shipmentId,
          removalShipmentItemId: shipmentItemId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create case')
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Create a Case</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Read-only fields */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-gray-500 dark:text-gray-400 mb-0.5">Removal Order ID</label>
              <div className="font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700">{removalOrderId}</div>
            </div>
            <div>
              <label className="block font-semibold text-gray-500 dark:text-gray-400 mb-0.5">Tracking #</label>
              <div className="font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700">{trackingNumber}</div>
            </div>
            <div>
              <label className="block font-semibold text-gray-500 dark:text-gray-400 mb-0.5">Merchant SKU</label>
              <div className="font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700">{sellerSku}</div>
            </div>
            <div>
              <label className="block font-semibold text-gray-500 dark:text-gray-400 mb-0.5">FNSKU</label>
              <div className="font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700">{fnsku}</div>
            </div>
          </div>

          {/* LPN */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">LPN Number</label>
            <input
              type="text"
              value={lpnNumber}
              onChange={(e) => setLpnNumber(e.target.value)}
              placeholder="Scan or enter LPN"
              className="w-full h-9 px-3 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Describe the issue (damaged, missing, wrong item, etc.)"
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Create Case
          </button>
        </div>
      </form>
    </div>
  )
}

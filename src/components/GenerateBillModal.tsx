'use client'
import { useState } from 'react'
import { X, AlertCircle, Plus, Trash2 } from 'lucide-react'

interface POLine {
  id: string
  product: { description: string; sku: string }
  grade: { grade: string } | null
  qty: number
  unitCost: string
}

interface PurchaseOrder {
  id: string
  poNumber: number
  vendor: { name: string }
  date: string
  lines: POLine[]
}

interface Adjustment {
  label: string
  amount: string
}

interface GenerateBillModalProps {
  po: PurchaseOrder
  onClose: () => void
  onSuccess: () => void
}

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900">
        <X size={14} />
      </button>
    </div>
  )
}

export default function GenerateBillModal({ po, onClose, onSuccess }: GenerateBillModalProps) {
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const poTotal = po.lines.reduce((s, l) => s + l.qty * parseFloat(l.unitCost), 0)
  const adjTotal = adjustments.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0)
  const billTotal = poTotal + adjTotal

  function addAdjustment() {
    setAdjustments((prev) => [...prev, { label: '', amount: '' }])
  }

  function removeAdjustment(i: number) {
    setAdjustments((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateAdjustment(i: number, field: 'label' | 'amount', value: string) {
    setAdjustments((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)))
  }

  async function submit() {
    setError('')
    if (billTotal <= 0) {
      setError('Bill total must be greater than zero')
      return
    }
    for (let i = 0; i < adjustments.length; i++) {
      const a = adjustments[i]
      if (!a.label.trim()) {
        setError(`Adjustment ${i + 1}: label is required`)
        return
      }
      if (!a.amount || isNaN(parseFloat(a.amount))) {
        setError(`Adjustment ${i + 1}: enter a valid amount`)
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/generate-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorInvoiceNo: vendorInvoiceNo.trim() || undefined,
          description: description.trim() || undefined,
          adjustments: adjustments.map((a) => ({
            label: a.label.trim(),
            amount: parseFloat(a.amount),
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate bill')
      }
      onSuccess()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Generate Bill for PO #{po.poNumber}</h2>
            <p className="text-sm text-gray-500">
              {po.vendor.name} &middot; {new Date(po.date).toLocaleDateString()}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {error && <ErrorBanner msg={error} onClose={() => setError('')} />}

          {/* PO Lines */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">PO Line Items</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-1 font-medium">Product</th>
                  <th className="pb-1 font-medium text-center">Qty</th>
                  <th className="pb-1 font-medium text-right">Unit Cost</th>
                  <th className="pb-1 font-medium text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => (
                  <tr key={l.id} className="border-b border-gray-100">
                    <td className="py-1.5">
                      <span className="font-medium">{l.product.sku}</span>
                      <span className="text-gray-400 ml-1.5">{l.product.description}</span>
                      {l.grade && (
                        <span className="ml-1.5 text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {l.grade.grade}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-center">{l.qty}</td>
                    <td className="py-1.5 text-right">${parseFloat(l.unitCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="py-1.5 text-right font-medium">
                      ${(l.qty * parseFloat(l.unitCost)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={3} className="pt-2 text-right">PO Total</td>
                  <td className="pt-2 text-right">${poTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Adjustments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Adjustments</h3>
              <button
                type="button"
                onClick={addAdjustment}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                <Plus size={14} /> Add Adjustment
              </button>
            </div>
            {adjustments.length === 0 && (
              <p className="text-xs text-gray-400">No adjustments. Add freight, discounts, etc.</p>
            )}
            {adjustments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Label (e.g. Freight)"
                  value={a.label}
                  onChange={(e) => updateAdjustment(i, 'label', e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
                />
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={a.amount}
                    onChange={(e) => updateAdjustment(i, 'amount', e.target.value)}
                    className="w-28 border rounded-lg pl-6 pr-3 py-1.5 text-sm text-right"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeAdjustment(i)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Vendor Invoice # and Description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold text-gray-700">Vendor Invoice #</label>
              <input
                type="text"
                value={vendorInvoiceNo}
                onChange={(e) => setVendorInvoiceNo(e.target.value)}
                placeholder="e.g. INV-12345"
                className="w-full border rounded-lg px-3 py-1.5 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. March order"
                className="w-full border rounded-lg px-3 py-1.5 text-sm mt-1"
              />
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">PO Total</span>
              <span>${poTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            {adjTotal !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Adjustments</span>
                <span className={adjTotal < 0 ? 'text-green-600' : ''}>{adjTotal < 0 ? '-' : '+'}${Math.abs(adjTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-1 border-t border-gray-200">
              <span>Bill Total</span>
              <span className="text-blue-700">${billTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || billTotal <= 0}
            className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
          >
            {saving ? 'Generating...' : `Generate Bill $${billTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </button>
        </div>
      </div>
    </div>
  )
}

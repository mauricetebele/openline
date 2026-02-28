'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { INVALID_REASON_LABELS, InvalidReason } from '@/types'

interface Props {
  selectedIds: string[]
  onClose: () => void
  onDone: () => void
}

export default function BulkReviewModal({ selectedIds, onClose, onDone }: Props) {
  const [status, setStatus] = useState<'VALID' | 'INVALID'>('VALID')
  const [reason, setReason] = useState<InvalidReason | ''>('')
  const [customReason, setCustomReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (status === 'INVALID' && !reason) { toast.error('Select an invalid reason'); return }
    if (status === 'INVALID' && reason === 'OTHER' && !customReason.trim()) {
      toast.error('"Other" requires an explanation'); return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        refundIds: selectedIds,
        status,
        notes: notes || undefined,
      }
      if (status === 'INVALID') {
        body.invalidReason = reason
        if (reason === 'OTHER') body.customReason = customReason
      }
      const res = await fetch('/api/refunds/bulk-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success(`${selectedIds.length} refund(s) marked as ${status.toLowerCase()}`)
      onDone()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg">
            Bulk Review — {selectedIds.length} refund{selectedIds.length !== 1 ? 's' : ''}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Decision</label>
            <div className="flex gap-2">
              {(['VALID', 'INVALID'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`flex-1 btn justify-center ${
                    status === s
                      ? s === 'VALID' ? 'btn-success' : 'btn-danger'
                      : 'btn-ghost'
                  }`}
                >
                  {s === 'VALID' ? 'Valid' : 'Invalid'}
                </button>
              ))}
            </div>
          </div>

          {status === 'INVALID' && (
            <div>
              <label className="label">Reason <span className="text-red-500">*</span></label>
              <select
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value as InvalidReason)}
              >
                <option value="">— Select a reason —</option>
                {Object.entries(INVALID_REASON_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              {reason === 'OTHER' && (
                <input
                  className="input mt-2"
                  placeholder="Explain the reason…"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              )}
            </div>
          )}

          <div>
            <label className="label">Notes (optional — applied to all)</label>
            <textarea
              className="input resize-none"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className={status === 'VALID' ? 'btn-success' : 'btn-danger'}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : `Mark ${status === 'VALID' ? 'Valid' : 'Invalid'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

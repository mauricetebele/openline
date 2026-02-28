'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle, XCircle } from 'lucide-react'
import { INVALID_REASON_LABELS, InvalidReason, ReviewStatus } from '@/types'

interface Props {
  refundId: string
  currentStatus: ReviewStatus
  currentReason?: InvalidReason | null
  currentNotes?: string | null
  onSaved: () => void
}

export default function ReviewForm({
  refundId,
  currentStatus,
  currentReason,
  currentNotes,
  onSaved,
}: Props) {
  const [status, setStatus] = useState<'VALID' | 'INVALID' | ''>(
    currentStatus === 'UNREVIEWED' ? '' : (currentStatus as 'VALID' | 'INVALID'),
  )
  const [reason, setReason] = useState<InvalidReason | ''>(currentReason ?? '')
  const [customReason, setCustomReason] = useState('')
  const [notes, setNotes] = useState(currentNotes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!status) { toast.error('Select Valid or Invalid'); return }
    if (status === 'INVALID' && !reason) { toast.error('Select an invalid reason'); return }
    if (status === 'INVALID' && reason === 'OTHER' && !customReason.trim()) {
      toast.error('"Other" reason requires an explanation'); return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { status, notes: notes || undefined }
      if (status === 'INVALID') {
        body.invalidReason = reason
        if (reason === 'OTHER') body.customReason = customReason
      }
      const res = await fetch(`/api/refunds/${refundId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Review saved')
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Status toggle */}
      <div>
        <label className="label">Decision</label>
        <div className="flex gap-2">
          <button
            onClick={() => setStatus('VALID')}
            className={`flex-1 btn gap-2 justify-center ${status === 'VALID' ? 'btn-success' : 'btn-ghost'}`}
          >
            <CheckCircle size={15} /> Valid
          </button>
          <button
            onClick={() => setStatus('INVALID')}
            className={`flex-1 btn gap-2 justify-center ${status === 'INVALID' ? 'btn-danger' : 'btn-ghost'}`}
          >
            <XCircle size={15} /> Invalid
          </button>
        </div>
      </div>

      {/* Reason (only when INVALID) */}
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

      {/* Notes */}
      <div>
        <label className="label">Notes (optional)</label>
        <textarea
          className="input resize-none"
          rows={3}
          placeholder="Internal notes visible to all reviewers…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <button
        className="btn-primary w-full justify-center"
        onClick={handleSave}
        disabled={saving || !status}
      >
        {saving ? 'Saving…' : 'Save Review'}
      </button>
    </div>
  )
}

'use client'
import { useState } from 'react'
import { toast } from 'sonner'

interface EmailDocumentModalProps {
  type: 'invoice' | 'credit-memo' | 'payment' | 'statement'
  id: string
  defaultEmail: string
  label: string
  viewType?: 'activity' | 'open'
  onClose: () => void
}

export default function EmailDocumentModal({ type, id, defaultEmail, label, viewType, onClose }: EmailDocumentModalProps) {
  const [to, setTo] = useState(defaultEmail)
  const [sending, setSending] = useState(false)

  async function handleSend() {
    const email = to.trim()
    if (!email) { toast.error('Enter an email address'); return }

    setSending(true)
    try {
      const res = await fetch('/api/wholesale/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, viewType, to: email }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed to send email'); return }
      toast.success(`${label} emailed`)
      onClose()
    } catch {
      toast.error('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl mx-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Email {label}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Recipient Email</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoFocus
              placeholder="email@example.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              onKeyDown={(e) => { if (e.key === 'Enter' && to.trim()) handleSend() }}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !to.trim()}
              className="px-6 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Search, AlertCircle, X, Upload, Trash2, Save, Loader2, Download, FilePlus2, CheckCircle2, Archive, ArchiveRestore } from 'lucide-react'

interface ImageAttachment {
  url: string
  filename: string
  contentType: string
  size: number
}

type RemovalCaseStatus =
  | 'CASE_NOT_CREATED'
  | 'CASE_CREATED'
  | 'REIMBURSEMENT_DENIED'
  | 'RESOLVED_REIMBURSED'

interface RemovalCase {
  id: string
  caseNumber: number
  removalOrderId: string
  trackingNumber: string
  lpnNumber: string | null
  fnsku: string
  sellerSku: string
  productTitle: string | null
  note: string | null
  images: ImageAttachment[]
  status: RemovalCaseStatus
  amazonCaseId: string | null
  reimbursementId: string | null
  reimbursementAmount: string | null // Prisma Decimal serializes to a string
  createdBy: { name: string } | null
  createdAt: string
  archivedAt: string | null
}

type RemovalTab = 'active' | 'archive' | 'all'

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const STATUS_LABEL: Record<RemovalCaseStatus, string> = {
  CASE_NOT_CREATED: 'Case Not Yet Created',
  CASE_CREATED: 'Awaiting Reply',
  REIMBURSEMENT_DENIED: 'Reimbursement Denied',
  RESOLVED_REIMBURSED: 'Resolved & Reimbursed',
}

const STATUS_BADGE: Record<RemovalCaseStatus, string> = {
  CASE_NOT_CREATED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  CASE_CREATED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  REIMBURSEMENT_DENIED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  RESOLVED_REIMBURSED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}

const STATUS_ORDER: RemovalCaseStatus[] = [
  'CASE_NOT_CREATED',
  'CASE_CREATED',
  'REIMBURSEMENT_DENIED',
  'RESOLVED_REIMBURSED',
]

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(v: string | null) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function StatusBadge({ status }: { status: RemovalCaseStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${STATUS_BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

/** PATCH a removal case; on failure surfaces a toast and returns null. */
async function patchRemovalCase(id: string, body: Record<string, unknown>): Promise<RemovalCase | null> {
  try {
    const res = await fetch(`/api/removal-cases/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || `Update failed (${res.status})`)
      return null
    }
    const data = await res.json()
    return { ...data, images: Array.isArray(data.images) ? data.images : [] }
  } catch {
    toast.error('Network error')
    return null
  }
}

/* ─── Workflow Modals ───────────────────────────────────────────────────────── */

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function AmazonCaseModal({
  rc,
  onClose,
  onDone,
}: {
  rc: RemovalCase
  onClose: () => void
  onDone: (updated: RemovalCase) => void
}) {
  const [caseId, setCaseId] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const trimmed = caseId.trim()
    if (!trimmed || saving) return
    setSaving(true)
    const updated = await patchRemovalCase(rc.id, { action: 'CREATE_CASE', amazonCaseId: trimmed })
    setSaving(false)
    if (updated) {
      toast.success(`Case created for REMOVALCASE-${rc.caseNumber}`)
      onDone(updated)
    }
  }

  return (
    <ModalShell title={`Enter Amazon Case ID · REMOVALCASE-${rc.caseNumber}`} onClose={onClose}>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Amazon Case ID</label>
      <input
        autoFocus
        value={caseId}
        onChange={(e) => setCaseId(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        placeholder="e.g. 12345678901"
        className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amazon-blue"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!caseId.trim() || saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amazon-blue text-white hover:bg-amazon-blue/90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <FilePlus2 size={12} />}
          Confirm Case Created
        </button>
      </div>
    </ModalShell>
  )
}

function ResolveModal({
  rc,
  onClose,
  onDone,
}: {
  rc: RemovalCase
  onClose: () => void
  onDone: (updated: RemovalCase) => void
}) {
  const [denied, setDenied] = useState(false)
  const [reimbId, setReimbId] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  const amountNum = Number(amount)
  const reimbValid = reimbId.trim().length > 0 && Number.isFinite(amountNum) && amountNum > 0
  const canConfirm = denied || reimbValid

  const submit = async () => {
    if (!canConfirm || saving) return
    setSaving(true)
    const body = denied
      ? { action: 'DENY_REIMBURSEMENT' }
      : { action: 'RESOLVE_REIMBURSED', reimbursementId: reimbId.trim(), reimbursementAmount: amountNum }
    const updated = await patchRemovalCase(rc.id, body)
    setSaving(false)
    if (updated) {
      toast.success(denied ? 'Marked as Reimbursement Denied' : 'Marked as Resolved & Reimbursed')
      onDone(updated)
    }
  }

  return (
    <ModalShell title={`Resolve · REMOVALCASE-${rc.caseNumber}`} onClose={onClose}>
      <div className={`space-y-3 transition-opacity ${denied ? 'opacity-40 pointer-events-none' : ''}`}>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Reimbursement ID</label>
          <input
            autoFocus
            value={reimbId}
            onChange={(e) => setReimbId(e.target.value)}
            disabled={denied}
            placeholder="e.g. 987654321"
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Reimbursement Amount (USD)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={denied}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={denied}
          onChange={(e) => setDenied(e.target.checked)}
          className="rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        Reimbursement Denied
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canConfirm || saving}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-white disabled:opacity-50 ${
            denied ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          {denied ? 'Mark Denied' : 'Confirm Reimbursement'}
        </button>
      </div>
    </ModalShell>
  )
}

/* ─── Detail Modal ──────────────────────────────────────────────────────────── */

function RemovalCaseDetailModal({
  caseId,
  onClose,
  onUpdated,
}: {
  caseId: string
  onClose: () => void
  onUpdated: () => void
}) {
  const [rc, setRc] = useState<RemovalCase | null>(null)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [noteDirty, setNoteDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCaseModal, setShowCaseModal] = useState(false)
  const [showResolveModal, setShowResolveModal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchCase = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/removal-cases/${caseId}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      const images = Array.isArray(data.images) ? data.images : []
      setRc({ ...data, images })
      setNote(data.note ?? '')
      setNoteDirty(false)
    } catch { /* ignore */ }
    setLoading(false)
  }, [caseId])

  useEffect(() => { fetchCase() }, [fetchCase])

  const applyUpdate = (updated: RemovalCase) => {
    setRc({ ...updated, images: Array.isArray(updated.images) ? updated.images : [] })
    onUpdated()
  }

  const saveNote = async () => {
    if (!rc) return
    setSaving(true)
    try {
      const res = await fetch(`/api/removal-cases/${rc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (res.ok) {
        const updated = await res.json()
        setRc({ ...updated, images: Array.isArray(updated.images) ? updated.images : [] })
        setNoteDirty(false)
        onUpdated()
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length || !rc) return
    setUploading(true)
    setError(null)
    try {
      const uploads = await Promise.all(
        Array.from(files).map(async (file) => {
          const fd = new FormData()
          fd.append('file', file)
          const res = await fetch('/api/cases/upload', { method: 'POST', body: fd })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `Upload failed (${res.status})`)
          }
          return res.json() as Promise<ImageAttachment>
        })
      )
      const newImages = [...rc.images, ...uploads]
      const patchRes = await fetch(`/api/removal-cases/${rc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: newImages }),
      })
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}))
        throw new Error(err.error || `Save failed (${patchRes.status})`)
      }
      const updated = await patchRes.json()
      setRc({ ...updated, images: Array.isArray(updated.images) ? updated.images : [] })
      onUpdated()
    } catch (err) {
      console.error('Image upload error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const deleteImage = async (idx: number) => {
    if (!rc) return
    setError(null)
    const newImages = rc.images.filter((_, i) => i !== idx)
    try {
      const res = await fetch(`/api/removal-cases/${rc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: newImages }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Delete failed (${res.status})`)
      }
      const updated = await res.json()
      setRc({ ...updated, images: Array.isArray(updated.images) ? updated.images : [] })
      onUpdated()
    } catch (err) {
      console.error('Image delete error:', err)
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {rc ? `REMOVALCASE-${rc.caseNumber}` : 'Loading...'}
            </h2>
            {rc && <StatusBadge status={rc.status} />}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs">
              <AlertCircle size={14} />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
            </div>
          )}
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Loading...</div>
          ) : !rc ? (
            <div className="py-12 text-center text-sm text-gray-400">Case not found</div>
          ) : (
            <>
              {/* Read-only info grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <InfoField label="Removal Order ID" value={rc.removalOrderId} mono />
                <InfoField label="Tracking #" value={rc.trackingNumber} mono />
                <InfoField label="LPN" value={rc.lpnNumber || '—'} mono />
                <InfoField label="FNSKU" value={rc.fnsku} mono />
                <InfoField label="Merchant SKU" value={rc.sellerSku} mono />
                <InfoField label="Product Title" value={rc.productTitle || '—'} />
                <InfoField label="Created By" value={rc.createdBy?.name || '—'} />
                <InfoField label="Created At" value={fmtDate(rc.createdAt)} />
              </div>

              {/* Case administration */}
              <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Case Administration</span>
                  <StatusBadge status={rc.status} />
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-3">
                  <InfoField label="Amazon Case ID" value={rc.amazonCaseId || '—'} mono />
                  <InfoField label="Reimbursement ID" value={rc.reimbursementId || '—'} mono />
                  <InfoField label="Reimbursement Amount" value={fmtMoney(rc.reimbursementAmount)} />
                </div>
                {rc.status === 'CASE_NOT_CREATED' && (
                  <button
                    onClick={() => setShowCaseModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amazon-blue text-white hover:bg-amazon-blue/90"
                  >
                    <FilePlus2 size={12} /> Enter Case Info
                  </button>
                )}
                {rc.status === 'CASE_CREATED' && (
                  <button
                    onClick={() => setShowResolveModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700"
                  >
                    <CheckCircle2 size={12} /> Resolve
                  </button>
                )}
              </div>

              {/* Editable note */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Note</label>
                <textarea
                  value={note}
                  onChange={(e) => { setNote(e.target.value); setNoteDirty(true) }}
                  rows={3}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
                  placeholder="Add a note..."
                />
                {noteDirty && (
                  <button
                    onClick={saveNote}
                    disabled={saving}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amazon-blue text-white hover:bg-amazon-blue/90 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save Note
                  </button>
                )}
              </div>

              {/* Images */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Images</label>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Upload
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleUpload}
                  />
                </div>
                {rc.images.length === 0 ? (
                  <p className="text-xs text-gray-400">No images uploaded</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {rc.images.map((img, i) => (
                      <div key={i} className="relative group rounded-md overflow-hidden border dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        <a href={img.url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={img.url}
                            alt={img.filename}
                            className="w-full h-24 object-cover cursor-pointer"
                          />
                        </a>
                        <a
                          href={img.url}
                          download={img.filename}
                          className="absolute top-1 right-8 p-1 rounded bg-gray-800/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Download image"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={12} />
                        </a>
                        <button
                          onClick={() => deleteImage(i)}
                          className="absolute top-1 right-1 p-1 rounded bg-red-600/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove image"
                        >
                          <Trash2 size={12} />
                        </button>
                        <div className="px-1.5 py-1 text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          {img.filename}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {rc && showCaseModal && (
        <AmazonCaseModal
          rc={rc}
          onClose={() => setShowCaseModal(false)}
          onDone={(u) => { applyUpdate(u); setShowCaseModal(false) }}
        />
      )}
      {rc && showResolveModal && (
        <ResolveModal
          rc={rc}
          onClose={() => setShowResolveModal(false)}
          onDone={(u) => { applyUpdate(u); setShowResolveModal(false) }}
        />
      )}
    </div>
  )
}

function InfoField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-sm text-gray-900 dark:text-gray-100 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

/* ─── Main List View ────────────────────────────────────────────────────────── */

export default function RemovalCaseView() {
  const [cases, setCases] = useState<RemovalCase[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RemovalCaseStatus | ''>('')
  const [tab, setTab] = useState<RemovalTab>('active')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)

  const fetchCases = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25', tab })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/removal-cases?${params}`)
      const json = await res.json()
      setCases(json.data ?? [])
      setPagination(json.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 })
    } catch { /* ignore */ }
    setLoading(false)
  }, [search, statusFilter, tab])

  useEffect(() => { fetchCases(1) }, [fetchCases])

  async function toggleArchive(c: RemovalCase, e: React.MouseEvent) {
    e.stopPropagation()
    setArchivingId(c.id)
    try {
      const res = await fetch(`/api/removal-cases/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: c.archivedAt ? 'UNARCHIVE' : 'ARCHIVE' }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Failed'); return }
      toast.success(c.archivedAt ? 'Case unarchived' : 'Case archived')
      fetchCases(pagination.page)
    } finally { setArchivingId(null) }
  }

  const TABS: { key: RemovalTab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'archive', label: 'Archive' },
    { key: 'all', label: 'All' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="px-4 pt-3 flex gap-1 border-b bg-white dark:bg-gray-900 dark:border-gray-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-amazon-blue text-amazon-blue'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="px-4 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search case #, order ID, tracking #, SKU, note..."
            className="h-9 pl-8 pr-3 w-72 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RemovalCaseStatus | '')}
          title="Filter by case status"
          className="h-9 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        {pagination.total > 0 && (
          <span className="text-xs text-gray-400">
            {pagination.total} case{pagination.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
        ) : cases.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {search || statusFilter ? 'No cases match your filters' : 'No removal cases created yet'}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Case #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Removal Order ID</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">LPN</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">FNSKU</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Merchant SKU</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Product Title</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Amazon Case ID</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Reimb. ID</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">Reimb. Amt</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Created By</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Created At</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-100 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`border-b border-gray-200 dark:border-gray-700 last:border-0 align-middle cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                    i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'
                  }`}
                >
                  <td className="px-3 py-1.5 font-mono font-semibold text-amazon-blue whitespace-nowrap">REMOVALCASE-{c.caseNumber}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap"><StatusBadge status={c.status} /></td>
                  <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.removalOrderId}</td>
                  <td className="px-3 py-1.5 font-mono font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">{c.trackingNumber}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.lpnNumber || '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.fnsku}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap">{c.sellerSku}</td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-[200px] truncate" title={c.productTitle ?? ''}>{c.productTitle ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.amazonCaseId || '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.reimbursementId || '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtMoney(c.reimbursementAmount)}</td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.createdBy?.name ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <button
                      onClick={(e) => toggleArchive(c, e)}
                      disabled={archivingId === c.id}
                      title={c.archivedAt ? 'Unarchive case' : 'Archive case'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                    >
                      {archivingId === c.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : (c.archivedAt ? <ArchiveRestore size={12} /> : <Archive size={12} />)}
                      {c.archivedAt ? 'Unarchive' : 'Archive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="px-4 py-2 border-t bg-white dark:bg-gray-900 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1} onClick={() => fetchCases(pagination.page - 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Prev</button>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchCases(pagination.page + 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Next</button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedId && (
        <RemovalCaseDetailModal
          caseId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => fetchCases(pagination.page)}
        />
      )}
    </div>
  )
}

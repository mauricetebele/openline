'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Search, AlertCircle, X, Upload, Trash2, Save, Loader2 } from 'lucide-react'

interface ImageAttachment {
  url: string
  filename: string
  contentType: string
  size: number
}

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
  createdBy: { name: string } | null
  createdAt: string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
    try {
      const uploads = await Promise.all(
        Array.from(files).map(async (file) => {
          const fd = new FormData()
          fd.append('file', file)
          const res = await fetch('/api/cases/upload', { method: 'POST', body: fd })
          if (!res.ok) throw new Error()
          return res.json() as Promise<ImageAttachment>
        })
      )
      const newImages = [...rc.images, ...uploads]
      const patchRes = await fetch(`/api/removal-cases/${rc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: newImages }),
      })
      if (patchRes.ok) {
        const updated = await patchRes.json()
        setRc({ ...updated, images: Array.isArray(updated.images) ? updated.images : [] })
        onUpdated()
      }
    } catch { /* ignore */ }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const deleteImage = async (idx: number) => {
    if (!rc) return
    const newImages = rc.images.filter((_, i) => i !== idx)
    try {
      const res = await fetch(`/api/removal-cases/${rc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: newImages }),
      })
      if (res.ok) {
        const updated = await res.json()
        setRc({ ...updated, images: Array.isArray(updated.images) ? updated.images : [] })
        onUpdated()
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {rc ? `REMOVALCASE-${rc.caseNumber}` : 'Loading...'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
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
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const fetchCases = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/removal-cases?${params}`)
      const json = await res.json()
      setCases(json.data ?? [])
      setPagination(json.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 })
    } catch { /* ignore */ }
    setLoading(false)
  }, [search])

  useEffect(() => { fetchCases(1) }, [fetchCases])

  return (
    <div className="h-full flex flex-col">
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
              {search ? 'No cases match your search' : 'No removal cases created yet'}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Case #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Removal Order ID</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">LPN</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">FNSKU</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Merchant SKU</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Product Title</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Note</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Created By</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Created At</th>
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
                  <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.removalOrderId}</td>
                  <td className="px-3 py-1.5 font-mono font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">{c.trackingNumber}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.lpnNumber || '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.fnsku}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap">{c.sellerSku}</td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-[200px] truncate" title={c.productTitle ?? ''}>{c.productTitle ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={c.note ?? ''}>{c.note || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.createdBy?.name ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
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

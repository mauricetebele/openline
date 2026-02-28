'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Search, Pencil, Trash2, X, AlertCircle, Package, ChevronDown, ChevronRight, Tag, Upload, Download, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketplaceSku {
  id: string
  gradeId: string
  marketplace: string
  accountId: string | null
  sellerSku: string
}

interface ProductGrade {
  id: string
  productId: string
  grade: string
  description: string | null
  sortOrder: number
  marketplaceSkus: MarketplaceSku[]
}

interface Product {
  id: string
  description: string
  sku: string
  isSerializable: boolean
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiPut(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiDelete(url: string) {
  const res = await fetch(url, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

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

// ─── Grades Section ───────────────────────────────────────────────────────────

function GradesSection({ productId }: { productId: string }) {
  const [grades, setGrades]           = useState<ProductGrade[]>([])
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState('')
  const [showAdd, setShowAdd]         = useState(false)
  const [expandedGrade, setExpanded]  = useState<string | null>(null)
  // Add grade form
  const [newGrade, setNewGrade]       = useState('')
  const [addingGrade, setAddingGrade] = useState(false)
  // Add marketplace SKU form state: keyed by gradeId
  const [mskuForm, setMskuForm]       = useState<Record<string, { show: boolean; marketplace: string; accountId: string; sellerSku: string }>>({})
  const [addingMsku, setAddingMsku]   = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deletingGrade, setDeletingGrade] = useState<string | null>(null)
  const [deletingMsku, setDeletingMsku]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/products/${productId}/grades`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load grades')
      setGrades(data.data ?? [])
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load grades')
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => { load() }, [load])

  async function handleAddGrade() {
    if (!newGrade.trim()) { setErr('Grade is required'); return }
    setAddingGrade(true)
    try {
      await apiPost(`/api/products/${productId}/grades`, {
        grade: newGrade.trim(),
      })
      setNewGrade(''); setShowAdd(false)
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setAddingGrade(false)
    }
  }

  async function handleDeleteGrade(gradeId: string) {
    setDeletingGrade(gradeId)
    try {
      await apiDelete(`/api/products/${productId}/grades/${gradeId}`)
      setDeleteConfirm(null)
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingGrade(null)
    }
  }

  async function handleAddMsku(gradeId: string) {
    const form = mskuForm[gradeId]
    if (!form) return
    if (!form.marketplace) { setErr('Marketplace is required'); return }
    if (!form.sellerSku.trim()) { setErr('Seller SKU is required'); return }
    setAddingMsku(gradeId)
    try {
      await apiPost(`/api/products/${productId}/grades/${gradeId}/marketplace-skus`, {
        marketplace: form.marketplace,
        accountId: form.accountId.trim() || null,
        sellerSku: form.sellerSku.trim(),
      })
      setMskuForm(p => ({ ...p, [gradeId]: { show: false, marketplace: '', accountId: '', sellerSku: '' } }))
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setAddingMsku(null)
    }
  }

  async function handleDeleteMsku(gradeId: string, mskuId: string) {
    setDeletingMsku(mskuId)
    try {
      await apiDelete(`/api/products/${productId}/grades/${gradeId}/marketplace-skus/${mskuId}`)
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingMsku(null)
    }
  }

  function getMskuForm(gradeId: string) {
    return mskuForm[gradeId] ?? { show: false, marketplace: 'amazon', accountId: '', sellerSku: '' }
  }

  function setMskuField(gradeId: string, field: string, value: string) {
    setMskuForm(p => ({
      ...p,
      [gradeId]: { ...getMskuForm(gradeId), [field]: value },
    }))
  }

  return (
    <div className="mt-6 border-t pt-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Tag size={14} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-800">Grades</h3>
          {grades.length > 0 && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{grades.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(p => !p)}
          className="flex items-center gap-1 text-xs text-amazon-blue hover:underline"
        >
          <Plus size={12} />
          Add Grade
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {/* Add grade form */}
      {showAdd && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <div>
            <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Grade <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={newGrade}
              onChange={e => setNewGrade(e.target.value.toUpperCase())}
              placeholder="A, B, Refurb…"
              className="w-full h-8 rounded border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAdd(false)} className="h-7 px-3 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddGrade}
              disabled={addingGrade}
              className="h-7 px-3 rounded bg-amazon-blue text-white text-xs font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              {addingGrade ? 'Adding…' : 'Add Grade'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 py-2">Loading grades…</p>
      ) : grades.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No grades configured for this product.</p>
      ) : (
        <div className="space-y-1.5">
          {grades.map(g => {
            const isExpanded = expandedGrade === g.id
            const form       = getMskuForm(g.id)
            return (
              <div key={g.id} className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                {/* Grade row */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : g.id)}
                    className="text-gray-400 hover:text-gray-600 shrink-0"
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <span className="font-mono text-xs font-bold text-gray-800 w-12 shrink-0">{g.grade}</span>
                  {g.description && <span className="text-xs text-gray-500 flex-1 truncate">{g.description}</span>}
                  {!g.description && <span className="flex-1" />}
                  <span className="text-[10px] text-gray-400 shrink-0">{g.marketplaceSkus.length} SKU{g.marketplaceSkus.length !== 1 ? 's' : ''}</span>
                  {deleteConfirm === g.id ? (
                    <div className="flex items-center gap-1.5 ml-2">
                      <span className="text-[10px] text-red-600">Delete?</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteGrade(g.id)}
                        disabled={deletingGrade === g.id}
                        className="text-[10px] font-medium text-red-600 hover:underline disabled:opacity-60"
                      >Yes</button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(null)}
                        className="text-[10px] text-gray-500 hover:underline"
                      >No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(g.id)}
                      className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {/* Expanded: marketplace SKUs */}
                {isExpanded && (
                  <div className="border-t border-gray-200 bg-white px-3 py-2.5">
                    {g.marketplaceSkus.length === 0 ? (
                      <p className="text-xs text-gray-400 italic mb-2">No marketplace SKUs yet.</p>
                    ) : (
                      <table className="w-full text-xs mb-2">
                        <thead>
                          <tr className="text-[10px] font-semibold text-gray-400 uppercase">
                            <th className="text-left pb-1 pr-3">Marketplace</th>
                            <th className="text-left pb-1 pr-3">Account ID</th>
                            <th className="text-left pb-1 pr-3">Seller SKU</th>
                            <th className="pb-1 w-8" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {g.marketplaceSkus.map(ms => (
                            <tr key={ms.id} className="group">
                              <td className="py-1 pr-3 capitalize text-gray-700">{ms.marketplace}</td>
                              <td className="py-1 pr-3 text-gray-500 font-mono">{ms.accountId ?? '—'}</td>
                              <td className="py-1 pr-3 font-mono text-gray-800">{ms.sellerSku}</td>
                              <td className="py-1">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMsku(g.id, ms.id)}
                                  disabled={deletingMsku === ms.id}
                                  className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-60"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Add marketplace SKU form */}
                    {form.show ? (
                      <div className="rounded border border-gray-200 bg-gray-50 p-2 space-y-2">
                        <div className="grid grid-cols-[120px_1fr_1fr] gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">Marketplace</label>
                            <select
                              value={form.marketplace}
                              onChange={e => setMskuField(g.id, 'marketplace', e.target.value)}
                              className="w-full h-7 rounded border border-gray-300 px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                            >
                              <option value="amazon">Amazon</option>
                              <option value="backmarket">Back Market</option>
                              <option value="wholesale">Wholesale</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">Account ID (optional)</label>
                            <input
                              type="text"
                              value={form.accountId}
                              onChange={e => setMskuField(g.id, 'accountId', e.target.value)}
                              placeholder="leave blank = all"
                              className="w-full h-7 rounded border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-0.5">Seller SKU <span className="text-red-500">*</span></label>
                            <input
                              type="text"
                              value={form.sellerSku}
                              onChange={e => setMskuField(g.id, 'sellerSku', e.target.value)}
                              placeholder="IP14P-128-BLK-A"
                              className="w-full h-7 rounded border border-gray-300 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                            />
                          </div>
                        </div>
                        <div className="flex gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => setMskuField(g.id, 'show', 'false')}
                            className="h-6 px-2.5 rounded border border-gray-300 text-[10px] text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddMsku(g.id)}
                            disabled={addingMsku === g.id}
                            className="h-6 px-2.5 rounded bg-amazon-blue text-white text-[10px] font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
                          >
                            {addingMsku === g.id ? 'Adding…' : 'Add SKU'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setMskuForm(p => ({
                          ...p,
                          [g.id]: { show: true, marketplace: 'amazon', accountId: '', sellerSku: '' },
                        }))}
                        className="flex items-center gap-1 text-[10px] text-amazon-blue hover:underline"
                      >
                        <Plus size={10} />
                        Add Marketplace SKU
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

interface ImportResult {
  created: number
  skipped: number
  errors: { row: number; sku: string; reason: string }[]
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const inputRef  = useRef<HTMLInputElement>(null)
  const [file,       setFile]       = useState<File | null>(null)
  const [dragging,   setDragging]   = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [result,     setResult]     = useState<ImportResult | null>(null)
  const [err,        setErr]        = useState('')

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) pickFile(dropped)
  }

  function pickFile(f: File) {
    setFile(f)
    setResult(null)
    setErr('')
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setErr('')
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/products/import', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setResult(data as ImportResult)
      if (data.created > 0) onImported()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setUploading(false)
    }
  }

  function downloadTemplate() {
    const csv = 'description,sku,serializable\n' +
      'iPhone 14 Pro 128GB Black,IP14P-128-BLK,yes\n' +
      'Samsung Galaxy S23 256GB,SGS23-256-GRY,no\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'products-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-amazon-blue" />
            <h2 className="text-sm font-semibold text-gray-900">Import Products from Spreadsheet</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {/* Template download */}
          <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-blue-800">Required columns</p>
              <p className="text-xs text-blue-600 mt-0.5">
                <span className="font-mono">description</span>,{' '}
                <span className="font-mono">sku</span>,{' '}
                <span className="font-mono">serializable</span>{' '}
                (yes / no)
              </p>
            </div>
            <button
              type="button"
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-100 shrink-0"
            >
              <Download size={12} />
              Template
            </button>
          </div>

          {/* Drop zone */}
          {!result && (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={clsx(
                'rounded-lg border-2 border-dashed cursor-pointer transition-colors px-6 py-10 text-center',
                dragging
                  ? 'border-amazon-blue bg-blue-50'
                  : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-300 hover:border-gray-400 bg-gray-50',
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }}
              />
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 size={28} className="text-green-500" />
                  <p className="text-sm font-medium text-gray-800">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB · click to change</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <Upload size={28} />
                  <p className="text-sm font-medium text-gray-600">Drop a file here or click to browse</p>
                  <p className="text-xs">CSV, XLSX, or XLS · existing SKUs will be updated</p>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 divide-y">
                <div className="flex items-center gap-3 px-4 py-3">
                  <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                  <span className="text-sm font-medium text-gray-800">
                    {result.created} product{result.created !== 1 ? 's' : ''} created / updated
                  </span>
                </div>
                {result.skipped > 0 && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <AlertCircle size={16} className="text-amber-500 shrink-0" />
                    <span className="text-sm text-gray-700">
                      {result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped
                    </span>
                  </div>
                )}
              </div>

              {result.errors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Row errors</p>
                  <div className="rounded-lg border border-red-200 bg-red-50 divide-y divide-red-100 max-h-48 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                        <span className="font-mono text-gray-400 shrink-0 w-12">Row {e.row}</span>
                        <span className="font-mono text-gray-600 shrink-0 w-32 truncate" title={e.sku}>{e.sku}</span>
                        <span className="text-red-600">{e.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Allow uploading another file */}
              <button
                type="button"
                onClick={() => { setResult(null); setFile(null) }}
                className="text-xs text-amazon-blue hover:underline"
              >
                Upload another file
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50"
            >
              {uploading
                ? <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />Importing…</>
                : <><Upload size={14} />Import</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Product Form Panel ───────────────────────────────────────────────────────

interface FormState {
  description: string
  sku: string
  isSerializable: boolean | null  // null = not yet chosen
}

function ProductPanel({
  editing,
  onSaved,
  onClose,
}: {
  editing: Product | null
  onSaved: () => void
  onClose: () => void
}) {
  const isEdit = editing !== null
  const descRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<FormState>({
    description: editing?.description ?? '',
    sku: editing?.sku ?? '',
    isSerializable: editing != null ? editing.isSerializable : null,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    descRef.current?.focus()
  }, [])

  function set(field: keyof FormState, value: string | boolean | null) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    setErr('')
    if (!form.description.trim()) { setErr('Description is required'); return }
    if (!form.sku.trim()) { setErr('SKU is required'); return }
    if (form.isSerializable === null) { setErr('Please select Serializable or Non-Serializable'); return }

    setSaving(true)
    try {
      if (isEdit) {
        await apiPut(`/api/products/${editing.id}`, form)
      } else {
        await apiPost('/api/products', form)
      }
      onSaved()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[480px] bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {isEdit ? 'Edit Product' : 'New Product'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Product Description <span className="text-red-500">*</span>
            </label>
            <input
              ref={descRef}
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              autoComplete="off"
              placeholder="e.g. iPhone 14 Pro 128GB"
              className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>

          {/* SKU */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              SKU <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.sku}
              onChange={(e) => set('sku', e.target.value.toUpperCase())}
              autoComplete="off"
              placeholder="e.g. IP14P-128-BLK"
              className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
            <p className="mt-1 text-[11px] text-gray-400">Must be unique across all products.</p>
          </div>

          {/* Serializable */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Serialization <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => set('isSerializable', false)}
                className={clsx(
                  'flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 text-sm font-medium transition-colors',
                  form.isSerializable === false
                    ? 'border-amazon-blue bg-amazon-blue/5 text-amazon-blue'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50',
                )}
              >
                <span className="text-xl">📦</span>
                <span>Non-Serializable</span>
                <span className="text-[10px] font-normal text-center leading-tight opacity-70">
                  Tracked by qty only
                </span>
              </button>

              <button
                type="button"
                onClick={() => set('isSerializable', true)}
                className={clsx(
                  'flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 text-sm font-medium transition-colors',
                  form.isSerializable === true
                    ? 'border-amazon-blue bg-amazon-blue/5 text-amazon-blue'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50',
                )}
              >
                <span className="text-xl">🔢</span>
                <span>Serializable</span>
                <span className="text-[10px] font-normal text-center leading-tight opacity-70">
                  Each unit has a serial #
                </span>
              </button>
            </div>
          </div>

          {/* Grades section (only when editing an existing product) */}
          {isEdit && editing && (
            <GradesSection productId={editing.id} />
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Product'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProductsManager() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [panel, setPanel] = useState<'create' | Product | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const url = search.trim() ? `/api/products?search=${encodeURIComponent(search.trim())}` : '/api/products'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setProducts(data.data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await apiDelete(`/api/products/${id}`)
      setDeleteConfirm(null)
      load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            placeholder="Search products or SKUs…"
            className="h-9 w-64 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 font-medium hover:bg-gray-50"
        >
          <Upload size={14} />
          Import
        </button>

        <button
          type="button"
          onClick={() => setPanel('create')}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <Plus size={14} />
          New Product
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
      ) : products.length === 0 ? (
        <div className="py-20 text-center">
          <Package size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">
            {search ? 'No products match your search' : 'No products yet'}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => setPanel('create')}
              className="mt-3 text-sm text-amazon-blue hover:underline"
            >
              Create your first product
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Serialization</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50 group">
                  <td className="px-4 py-3 font-medium text-gray-900">{product.description}</td>
                  <td className="px-4 py-3 font-mono text-gray-700 text-xs">{product.sku}</td>
                  <td className="px-4 py-3">
                    {product.isSerializable ? (
                      <span className="inline-flex items-center rounded-full bg-purple-100 text-purple-700 px-2.5 py-0.5 text-xs font-medium">
                        Serializable
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-600 px-2.5 py-0.5 text-xs font-medium">
                        Non-Serializable
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(product.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {deleteConfirm === product.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-red-600 whitespace-nowrap">Delete?</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(product.id)}
                          disabled={deletingId === product.id}
                          className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => setPanel(product)}
                          className="p-1.5 rounded text-gray-400 hover:text-amazon-blue hover:bg-blue-50"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(product.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel !== null && (
        <ProductPanel
          editing={panel === 'create' ? null : panel}
          onSaved={() => { setPanel(null); load() }}
          onClose={() => setPanel(null)}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  )
}

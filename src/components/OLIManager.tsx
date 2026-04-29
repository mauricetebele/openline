'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Brain, Plus, Search, X, Trash2, Edit2, ToggleLeft, ToggleRight,
  AlertCircle, Check, Tags,
} from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Strategy {
  id: string
  name: string
  marketplace: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  _count: { mskuAssignments: number }
}

const MARKETPLACE_OPTIONS = [
  { value: 'amazon', label: 'Amazon' },
  { value: 'backmarket', label: 'Back Market' },
] as const

interface MskuAssignment {
  id: string
  mskuId: string
  createdAt: string
  msku: {
    id: string
    sellerSku: string
    marketplace: string
    product: { sku: string; description: string }
    grade: { grade: string } | null
  }
}

interface StrategyDetail extends Omit<Strategy, '_count'> {
  mskuAssignments: MskuAssignment[]
}

interface MarketplaceSku {
  id: string
  sellerSku: string
  marketplace: string
  product: { sku: string; description: string }
  grade: { grade: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

async function apiDelete(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error ?? 'Request failed')
  }
}

// ─── Error Banner ────────────────────────────────────────────────────────────

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="shrink-0 text-red-400 hover:text-red-600">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Create Strategy Modal ──────────────────────────────────────────────────

function CreateStrategyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (s: Strategy) => void
}) {
  const [name, setName] = useState('')
  const [marketplace, setMarketplace] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const nameRef = useRef<HTMLInputElement>(null!)

  useEffect(() => { nameRef.current?.focus() }, [])

  async function handleSave() {
    if (!name.trim() || !marketplace) return
    setSaving(true)
    setErr('')
    try {
      const created = await apiPost<Strategy>('/api/oli/strategies', {
        name: name.trim(),
        marketplace,
        description: description.trim() || null,
      })
      onCreated(created)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">New Strategy</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {err && <p className="text-sm text-red-600">{err}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Competitive Match"
              className="w-full h-9 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Marketplace <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {MARKETPLACE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMarketplace(opt.value)}
                  className={clsx(
                    'flex-1 h-9 rounded-md border text-sm font-medium transition-colors',
                    marketplace === opt.value
                      ? 'border-amazon-blue bg-amazon-blue/10 text-amazon-blue dark:bg-amazon-blue/20'
                      : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Optional description..."
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t dark:border-gray-700">
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !marketplace}
            className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SKU Assign Modal ────────────────────────────────────────────────────────

function SkuAssignModal({
  strategyId,
  marketplace,
  existingMskuIds,
  onClose,
  onAssigned,
}: {
  strategyId: string
  marketplace: string
  existingMskuIds: Set<string>
  onClose: () => void
  onAssigned: () => void
}) {
  const [search, setSearch] = useState('')
  const [skus, setSkus] = useState<MarketplaceSku[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/marketplace-skus?marketplace=${marketplace}`)
      .then((r) => r.json())
      .then((d) => setSkus(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [marketplace])

  const filtered = skus.filter((s) => {
    if (existingMskuIds.has(s.id)) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      s.sellerSku.toLowerCase().includes(q) ||
      s.product.sku.toLowerCase().includes(q) ||
      s.product.description.toLowerCase().includes(q)
    )
  })

  function toggleSku(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAssign() {
    if (!selected.size) return
    setSaving(true)
    setErr('')
    try {
      await apiPost(`/api/oli/strategies/${strategyId}/skus`, {
        mskuIds: Array.from(selected),
      })
      onAssigned()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Assign SKUs</h2>
            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
              {marketplace}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="px-5 py-3 border-b dark:border-gray-700 shrink-0">
          {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKUs..."
              className="w-full h-9 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>
        </div>

        {!loading && filtered.length > 0 && (
          <div className="flex items-center gap-2 px-5 py-2 border-b dark:border-gray-700 shrink-0">
            <button
              type="button"
              onClick={() => {
                const allFilteredIds = filtered.map((s) => s.id)
                const allSelected = allFilteredIds.every((id) => selected.has(id))
                setSelected(allSelected ? new Set() : new Set(allFilteredIds))
              }}
              className="text-xs font-medium text-amazon-blue hover:underline"
            >
              {filtered.every((s) => selected.has(s.id)) ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-xs text-gray-400">({filtered.length} available)</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-2">
          {loading ? (
            <p className="text-sm text-gray-400 py-8 text-center">Loading SKUs...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">
              {search ? 'No SKUs match your search' : 'All SKUs are already assigned'}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((sku) => (
                <label
                  key={sku.id}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                    selected.has(sku.id)
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(sku.id)}
                    onChange={() => toggleSku(sku.id)}
                    className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{sku.sellerSku}</span>
                      {sku.grade && (
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                          {sku.grade.grade}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {sku.product.sku} — {sku.product.description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t dark:border-gray-700 shrink-0">
          <span className="text-xs text-gray-500">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button
              onClick={handleAssign}
              disabled={saving || !selected.size}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Assigning...' : `Assign (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main OLIManager ─────────────────────────────────────────────────────────

export default function OLIManager() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StrategyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // Load strategies
  const loadStrategies = useCallback(async () => {
    try {
      const d = await apiFetch<{ data: Strategy[] }>('/api/oli/strategies')
      setStrategies(d.data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load strategies')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStrategies() }, [loadStrategies])

  // Load detail when selected
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const d = await apiFetch<StrategyDetail>(`/api/oli/strategies/${id}`)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  // Toggle active
  async function handleToggleActive() {
    if (!detail) return
    try {
      await apiPut(`/api/oli/strategies/${detail.id}`, { isActive: !detail.isActive })
      setDetail({ ...detail, isActive: !detail.isActive })
      setStrategies((prev) =>
        prev.map((s) => (s.id === detail.id ? { ...s, isActive: !detail.isActive } : s)),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update')
    }
  }

  // Save name/description edit
  async function handleSaveEdit() {
    if (!detail || !editName.trim()) return
    try {
      await apiPut(`/api/oli/strategies/${detail.id}`, {
        name: editName.trim(),
        description: editDesc.trim() || null,
      })
      setDetail({ ...detail, name: editName.trim(), description: editDesc.trim() || null })
      setStrategies((prev) =>
        prev.map((s) => (s.id === detail.id ? { ...s, name: editName.trim() } : s)),
      )
      setEditingName(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update')
    }
  }

  // Delete strategy
  async function handleDelete() {
    if (!detail) return
    try {
      await apiDelete(`/api/oli/strategies/${detail.id}`)
      setStrategies((prev) => prev.filter((s) => s.id !== detail.id))
      setSelectedId(null)
      setDetail(null)
      setDeleteConfirm(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  // Remove SKU
  async function handleRemoveSku(mskuId: string) {
    if (!detail) return
    try {
      await apiDelete(`/api/oli/strategies/${detail.id}/skus`, { mskuIds: [mskuId] })
      setDetail({
        ...detail,
        mskuAssignments: detail.mskuAssignments.filter((a) => a.mskuId !== mskuId),
      })
      setStrategies((prev) =>
        prev.map((s) =>
          s.id === detail.id
            ? { ...s, _count: { mskuAssignments: s._count.mskuAssignments - 1 } }
            : s,
        ),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove SKU')
    }
  }

  const filtered = search.trim()
    ? strategies.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : strategies

  return (
    <div className="flex flex-1 overflow-hidden">
      {err && <ErrorBanner message={err} onClose={() => setErr('')} />}

      {/* ─── Left Column: Strategy List ─── */}
      <div className="w-[380px] border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900 shrink-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search strategies..."
              className="w-full h-9 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="h-9 px-3 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5 shrink-0"
          >
            <Plus size={14} /> New
          </button>
        </div>

        {/* Strategy cards */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-12">Loading...</p>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <Brain size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
              <p className="text-sm font-medium text-gray-400">
                {search ? 'No strategies match your search' : 'No strategies yet'}
              </p>
              {!search && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 text-sm text-amazon-blue hover:underline"
                >
                  Create your first strategy
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={clsx(
                    'w-full text-left px-4 py-3 transition-colors',
                    selectedId === s.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-amazon-blue'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-l-2 border-l-transparent',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white truncate flex-1">
                      {s.name}
                    </span>
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                      {s.marketplace}
                    </span>
                    <span
                      className={clsx(
                        'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0',
                        s.isActive
                          ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-400',
                      )}
                    >
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-500">
                      {s._count.mskuAssignments} SKU{s._count.mskuAssignments !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Right Column: Detail Panel ─── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Brain size={48} className="mx-auto text-gray-200 dark:text-gray-700 mb-3" />
              <p className="text-sm text-gray-400">Select a strategy to view details</p>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">Loading...</p>
          </div>
        ) : detail ? (
          <>
            {/* Strategy Header */}
            <div className="px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
              {editingName ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    className="w-full h-9 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                    autoFocus
                  />
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Description..."
                    rows={2}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editName.trim()}
                      className="h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                    >
                      <Check size={12} /> Save
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="h-8 px-3 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{detail.name}</h2>
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                        {detail.marketplace}
                      </span>
                    </div>
                    {detail.description && (
                      <p className="text-sm text-gray-500 mt-0.5">{detail.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={handleToggleActive}
                      title={detail.isActive ? 'Deactivate' : 'Activate'}
                      className="p-2 rounded-md text-gray-400 hover:text-amazon-blue hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      {detail.isActive ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} />}
                    </button>
                    <button
                      onClick={() => {
                        setEditName(detail.name)
                        setEditDesc(detail.description ?? '')
                        setEditingName(true)
                      }}
                      title="Edit"
                      className="p-2 rounded-md text-gray-400 hover:text-amazon-blue hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      title="Delete"
                      className="p-2 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Assigned SKUs Section */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Assigned SKUs ({detail.mskuAssignments.length})
                </h3>
                <button
                  onClick={() => setShowAssign(true)}
                  className="h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <Tags size={13} /> Assign SKUs
                </button>
              </div>

              {detail.mskuAssignments.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                  <Tags size={28} className="mx-auto text-gray-200 dark:text-gray-600 mb-2" />
                  <p className="text-sm text-gray-400">No SKUs assigned to this strategy</p>
                  <button
                    onClick={() => setShowAssign(true)}
                    className="mt-2 text-sm text-amazon-blue hover:underline"
                  >
                    Assign marketplace SKUs
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Seller SKU</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Marketplace</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Product SKU</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Grade</th>
                        <th className="px-4 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {detail.mskuAssignments.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 group">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{a.msku.sellerSku}</td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                              {a.msku.marketplace}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{a.msku.product.sku}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">{a.msku.product.description}</td>
                          <td className="px-4 py-3">
                            {a.msku.grade ? (
                              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                                {a.msku.grade.grade}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleRemoveSku(a.mskuId)}
                              className="p-1.5 rounded text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Remove SKU"
                            >
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* ─── Modals ─── */}
      {showCreate && (
        <CreateStrategyModal
          onClose={() => setShowCreate(false)}
          onCreated={(s) => {
            setStrategies((prev) => [s, ...prev])
            setShowCreate(false)
            setSelectedId(s.id)
          }}
        />
      )}

      {showAssign && detail && (
        <SkuAssignModal
          strategyId={detail.id}
          marketplace={detail.marketplace}
          existingMskuIds={new Set(detail.mskuAssignments.map((a) => a.mskuId))}
          onClose={() => setShowAssign(false)}
          onAssigned={() => {
            setShowAssign(false)
            loadDetail(detail.id)
            loadStrategies()
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(false)}>
          <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Delete Strategy</h3>
            <p className="text-sm text-gray-500 mb-4">
              Are you sure you want to delete <strong>{detail.name}</strong>? This will also remove all SKU assignments.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="h-9 px-4 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="h-9 px-4 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

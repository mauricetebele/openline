'use client'
import { useState, useEffect, useCallback } from 'react'
import { Boxes, Plus, Search, Trash2, Check, X, Pencil, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

type Status = 'AMPLE' | 'MODERATE' | 'VERY_LOW' | 'CRITICAL'

interface Supply {
  id: string
  name: string
  status: Status
  warehouseNote: string | null
  adminNote: string | null
  createdByLabel: string | null
  updatedAt: string
}

const STATUS_META: Record<Status, { label: string; pill: string; dot: string; tile: string }> = {
  AMPLE:    { label: 'Ample Stock',          pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', tile: 'text-emerald-600' },
  MODERATE: { label: 'Moderate Stock',       pill: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   tile: 'text-amber-600' },
  VERY_LOW: { label: 'Very Low',             pill: 'bg-orange-100 text-orange-700',   dot: 'bg-orange-500',  tile: 'text-orange-600' },
  CRITICAL: { label: 'Out of Stock',         pill: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-500',    tile: 'text-rose-600' },
}
const STATUS_ORDER: Status[] = ['AMPLE', 'MODERATE', 'VERY_LOW', 'CRITICAL']

/** Inline add/edit/clear for a single note field. */
function EditableNote({ value, label, onSave }: { value: string | null; label: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  async function save(next: string) {
    setSaving(true)
    try { await onSave(next); setEditing(false) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <div className="flex items-center gap-2 mt-1">
          <button onClick={() => save(draft)} disabled={saving}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
          </button>
          <button onClick={() => { setDraft(value ?? ''); setEditing(false) }} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="group/note">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover/note:opacity-100 transition-opacity">
          <button onClick={() => { setDraft(value ?? ''); setEditing(true) }} title="Edit" className="text-slate-400 hover:text-indigo-600"><Pencil className="h-3 w-3" /></button>
          {value && <button onClick={() => save('')} title="Clear" className="text-slate-400 hover:text-rose-600"><X className="h-3 w-3" /></button>}
        </div>
      </div>
      {value
        ? <p className="text-sm text-slate-700 whitespace-pre-wrap leading-snug">{value}</p>
        : <button onClick={() => { setDraft(''); setEditing(true) }} className="text-xs text-slate-400 hover:text-indigo-600 inline-flex items-center gap-1"><Plus className="h-3 w-3" /> Add note</button>}
    </div>
  )
}

export default function WarehouseSuppliesManager() {
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Status | null>(null)
  const [newName, setNewName] = useState('')
  const [newStatus, setNewStatus] = useState<Status>('AMPLE')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/warehouse-supplies')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setSupplies(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load supplies')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function createSupply() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/warehouse-supplies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, status: newStatus }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Create failed'); return }
      setSupplies(prev => [...prev, json].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
      setNewStatus('AMPLE')
    } finally {
      setCreating(false)
    }
  }

  async function patch(id: string, body: Partial<Pick<Supply, 'name' | 'status' | 'warehouseNote' | 'adminNote'>>) {
    const res = await fetch(`/api/warehouse-supplies/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) { alert(json.error ?? 'Update failed'); return }
    setSupplies(prev => prev.map(s => s.id === id ? json : s))
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete supply "${name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/warehouse-supplies/${id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Delete failed'); return }
    setSupplies(prev => prev.filter(s => s.id !== id))
  }

  const counts = STATUS_ORDER.reduce((acc, s) => { acc[s] = supplies.filter(x => x.status === s).length; return acc }, {} as Record<Status, number>)
  const q = search.trim().toLowerCase()
  const visible = supplies.filter(s =>
    (!filter || s.status === filter) &&
    (!q || s.name.toLowerCase().includes(q) || (s.warehouseNote ?? '').toLowerCase().includes(q) || (s.adminNote ?? '').toLowerCase().includes(q)))

  return (
    <div className="h-full flex flex-col p-5 gap-5 overflow-auto bg-slate-50/50">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shadow-indigo-500/30">
          <Boxes className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Warehouse Supplies Mgmt</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Track stock levels for warehouse supplies, with warehouse &amp; admin notes.</p>
        </div>
      </div>

      {/* Status summary tiles (click to filter) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STATUS_ORDER.map(s => {
          const m = STATUS_META[s]
          return (
            <button key={s} onClick={() => setFilter(filter === s ? null : s)}
              className={clsx('flex items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition-colors',
                filter === s ? 'border-indigo-400 ring-1 ring-indigo-400' : 'border-slate-200 hover:bg-slate-50')}>
              <span className={clsx('h-2.5 w-2.5 rounded-full', m.dot)} />
              <div>
                <div className={clsx('text-xl font-bold tabular-nums', m.tile)}>{counts[s]}</div>
                <div className="text-xs text-slate-500">{m.label}</div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Add + search */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createSupply() }}
          placeholder="New supply name…"
          className="h-9 w-64 rounded-lg border border-slate-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as Status)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40">
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <button onClick={createSupply} disabled={creating || !newName.trim()}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 text-sm font-semibold text-white shadow-sm shadow-indigo-500/25 hover:from-indigo-500 hover:to-indigo-700 disabled:opacity-50">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Supply
        </button>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplies…"
            className="pl-9 pr-3 h-9 w-60 rounded-lg border border-slate-200 bg-white text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
        </div>
      </div>

      {error && <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-700">{error}</div>}

      {/* Cards */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">No supplies yet — add one above.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map(s => {
            const m = STATUS_META[s.status]
            return (
              <div key={s.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className={clsx('h-1', m.dot)} />
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <input
                      defaultValue={s.name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) patch(s.id, { name: v }) }}
                      className="font-semibold text-slate-900 bg-transparent flex-1 min-w-0 rounded px-1 -ml-1 hover:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                    <button onClick={() => remove(s.id, s.name)} title="Delete supply" className="text-slate-300 hover:text-rose-600 shrink-0"><Trash2 className="h-4 w-4" /></button>
                  </div>

                  {/* Status selector */}
                  <div className="flex items-center gap-2">
                    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', m.pill)}>
                      <span className={clsx('h-1.5 w-1.5 rounded-full', m.dot)} /> {m.label}
                    </span>
                    <select value={s.status} onChange={(e) => patch(s.id, { status: e.target.value as Status })}
                      className="ml-auto h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40">
                      {STATUS_ORDER.map(st => <option key={st} value={st}>{STATUS_META[st].label}</option>)}
                    </select>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <EditableNote label="Warehouse Note" value={s.warehouseNote} onSave={(v) => patch(s.id, { warehouseNote: v })} />
                  </div>
                  <div className="border-t border-slate-100 pt-3">
                    <EditableNote label="Admin Note" value={s.adminNote} onSave={(v) => patch(s.id, { adminNote: v })} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

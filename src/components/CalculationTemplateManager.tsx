'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Save, Loader2, Pencil } from 'lucide-react'

interface PresetOpt { id: string; name: string }
interface PackageCost { packagePresetId: string; cost: string | number }
interface Template { id: string; name: string; commissionPct: string | number; packageCosts: PackageCost[] }

/** CRUD for Calculation Templates (commission % + estimated shipping cost per package preset). */
export default function CalculationTemplateManager({ onChanged }: { onChanged?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [presets, setPresets] = useState<PresetOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<Template | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, pRes] = await Promise.all([
        fetch('/api/calculation-templates').then(r => r.json()),
        fetch('/api/package-presets').then(r => r.json()),
      ])
      setTemplates(tRes.data ?? [])
      setPresets((Array.isArray(pRes) ? pRes : []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
    } catch { setErr('Failed to load templates') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const costFor = (presetId: string): string =>
    String(editing?.packageCosts.find(c => c.packagePresetId === presetId)?.cost ?? '')

  function setCost(presetId: string, val: string) {
    setEditing(e => {
      if (!e) return e
      const others = e.packageCosts.filter(c => c.packagePresetId !== presetId)
      return { ...e, packageCosts: val.trim() === '' ? others : [...others, { packagePresetId: presetId, cost: val }] }
    })
  }

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) { setErr('Template name is required'); return }
    const commissionPct = parseFloat(String(editing.commissionPct))
    if (!Number.isFinite(commissionPct)) { setErr('A valid commission % is required'); return }
    setSaving(true); setErr('')
    const packageCosts = editing.packageCosts
      .filter(c => String(c.cost).trim() !== '' && Number.isFinite(Number(c.cost)))
      .map(c => ({ packagePresetId: c.packagePresetId, cost: Number(c.cost) }))
    const body = { name: editing.name.trim(), commissionPct, packageCosts }
    try {
      const res = editing.id
        ? await fetch(`/api/calculation-templates/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/calculation-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setEditing(null); await load(); onChanged?.()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function remove(t: Template) {
    if (!confirm(`Delete template "${t.name}"? SKUs assigned to it will be unassigned.`)) return
    try {
      await fetch(`/api/calculation-templates/${t.id}`, { method: 'DELETE' })
      await load(); onChanged?.()
    } catch { setErr('Delete failed') }
  }

  return (
    <div className="space-y-4">
      {err && <div className="text-xs text-red-600">{err}</div>}

      {!editing ? (
        <>
          <button onClick={() => setEditing({ id: '', name: '', commissionPct: '', packageCosts: [] })}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">
            <Plus size={14} /> New Template
          </button>
          {loading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="rounded-lg border border-gray-200 divide-y">
              {templates.length === 0 && <div className="p-4 text-sm text-gray-400">No calculation templates yet.</div>}
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{t.name}</div>
                    <div className="text-xs text-gray-500">Commission {Number(t.commissionPct)}% · {t.packageCosts.length} preset shipping cost{t.packageCosts.length === 1 ? '' : 's'}</div>
                  </div>
                  <button onClick={() => setEditing({ ...t, commissionPct: String(t.commissionPct), packageCosts: t.packageCosts.map(c => ({ ...c, cost: String(c.cost) })) })}
                    className="p-1.5 text-gray-400 hover:text-amazon-blue" title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => remove(t)} className="p-1.5 text-gray-400 hover:text-red-500" title="Delete"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Template Name</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Commission %</label>
              <input type="number" step="0.1" min={0} value={String(editing.commissionPct)} onChange={e => setEditing({ ...editing, commissionPct: e.target.value })}
                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Estimated shipping cost per package preset ($ per unit)</label>
            <div className="rounded-lg border border-gray-200 divide-y max-h-72 overflow-y-auto">
              {presets.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="flex-1 text-sm text-gray-700">{p.name}</span>
                  <span className="text-gray-400 text-xs">$</span>
                  <input type="number" step="0.01" min={0} value={costFor(p.id)} onChange={e => setCost(p.id, e.target.value)} placeholder="—"
                    className="w-24 text-right rounded border border-gray-300 px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
                </div>
              ))}
              {presets.length === 0 && <div className="p-3 text-xs text-gray-400">No package presets defined yet.</div>}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-amazon-blue text-white hover:bg-amazon-blue/90 disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Template
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

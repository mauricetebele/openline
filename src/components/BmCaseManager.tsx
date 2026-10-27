'use client'
import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCcw, AlertCircle, Plus, X, ExternalLink, Check, Trash2, Pencil, RotateCcw, Search } from 'lucide-react'

type Status = 'OPEN' | 'RESOLVED'
interface BmCase {
  id: string
  caseId: string
  orderId: string | null
  description: string
  caseUrl: string | null
  status: Status
  resolvedAt: string | null
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}
type Tab = 'open' | 'resolved' | 'all'

const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

export default function BmCaseManager() {
  const [tab, setTab] = useState<Tab>('open')
  const [rows, setRows] = useState<BmCase[]>([])
  const [counts, setCounts] = useState<{ open: number; resolved: number; total: number }>({ open: 0, resolved: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<BmCase | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback((t: Tab) => {
    setLoading(true); setError(null)
    fetch(`/api/bm-cases?status=${t}`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then(d => { setRows(d.rows ?? []); setCounts(d.counts ?? { open: 0, resolved: 0, total: 0 }) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  // Client-side search across case id, order id, description, and URL.
  const q = search.trim().toLowerCase()
  const visibleRows = q
    ? rows.filter(r =>
        r.caseId.toLowerCase().includes(q) ||
        (r.orderId ?? '').toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        (r.caseUrl ?? '').toLowerCase().includes(q))
    : rows

  const setStatus = async (row: BmCase, status: Status) => {
    setBusyId(row.id); setError(null)
    try {
      const res = await fetch(`/api/bm-cases/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      load(tab)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (row: BmCase) => {
    if (!confirm(`Delete case ${row.caseId}? This can't be undone.`)) return
    setBusyId(row.id); setError(null)
    try {
      const res = await fetch(`/api/bm-cases/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      load(tab)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
          {(['open', 'resolved', 'all'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-4 py-1.5 font-medium capitalize', tab === t ? 'bg-gray-800 text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800')}>
              {t}{t === 'open' && counts.open > 0 ? ` (${counts.open})` : ''}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search case, order, description…"
            className="h-8 w-64 rounded-md border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 pl-8 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={13} /></button>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {q ? `${visibleRows.length} of ${counts.total}` : counts.total} case{(q ? visibleRows.length : counts.total) !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => load(tab)} disabled={loading} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            <RefreshCcw size={13} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-blue-700">
            <Plus size={14} /> New Case
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</div>}

      <div className="flex-1 overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-800 text-gray-100 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Case ID</th>
              <th className="px-3 py-2 text-left font-semibold">Order ID</th>
              <th className="px-3 py-2 text-left font-semibold">Description</th>
              <th className="px-3 py-2 text-left font-semibold">Link</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Created</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400"><RefreshCcw size={16} className="animate-spin inline" /></td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">
                {q ? `No cases match “${search.trim()}”.`
                  : tab === 'open' ? 'No open cases. 🎉' : tab === 'resolved' ? 'No resolved cases.' : 'No cases yet — create one with “New Case”.'}
              </td></tr>
            ) : visibleRows.map((r, i) => (
              <tr key={r.id} className={clsx(i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/40', r.status === 'OPEN' && 'bg-amber-50/40 dark:bg-amber-900/10')}>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-200 align-top whitespace-nowrap">{r.caseId}</td>
                <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400 align-top whitespace-nowrap">{r.orderId ?? '—'}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300 align-top max-w-md whitespace-pre-wrap break-words">{r.description}</td>
                <td className="px-3 py-2 align-top">
                  {r.caseUrl
                    ? <a href={r.caseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-amazon-blue hover:underline"><ExternalLink size={12} /> Open</a>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 align-top">
                  <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold',
                    r.status === 'OPEN' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300')}>
                    {r.status === 'OPEN' ? 'Open' : 'Resolved'}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 align-top whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center justify-end gap-1.5">
                    {busyId === r.id ? <RefreshCcw size={13} className="animate-spin text-gray-400" /> : (
                      <>
                        {r.status === 'OPEN' ? (
                          <button onClick={() => setStatus(r, 'RESOLVED')} title="Mark resolved"
                            className="inline-flex items-center gap-1 h-7 px-2 rounded border border-green-300 text-green-700 dark:text-green-300 text-[11px] font-medium hover:bg-green-50 dark:hover:bg-green-900/20">
                            <Check size={12} /> Resolve
                          </button>
                        ) : (
                          <button onClick={() => setStatus(r, 'OPEN')} title="Reopen"
                            className="inline-flex items-center gap-1 h-7 px-2 rounded border border-amber-300 text-amber-700 dark:text-amber-300 text-[11px] font-medium hover:bg-amber-50 dark:hover:bg-amber-900/20">
                            <RotateCcw size={12} /> Reopen
                          </button>
                        )}
                        <button onClick={() => { setEditing(r); setShowForm(true) }} title="Edit"
                          className="p-1.5 rounded text-gray-400 hover:text-amazon-blue hover:bg-gray-100 dark:hover:bg-gray-800"><Pencil size={13} /></button>
                        <button onClick={() => remove(r)} title="Delete"
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <CaseFormModal
          existing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(tab) }}
        />
      )}
    </div>
  )
}

function CaseFormModal({ existing, onClose, onSaved }: { existing: BmCase | null; onClose: () => void; onSaved: () => void }) {
  const [caseId, setCaseId] = useState(existing?.caseId ?? '')
  const [orderId, setOrderId] = useState(existing?.orderId ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [caseUrl, setCaseUrl] = useState(existing?.caseUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setErr(null)
    if (!caseId.trim()) { setErr('Case ID is required'); return }
    if (!description.trim()) { setErr('Description is required'); return }
    setSaving(true)
    try {
      const payload = { caseId: caseId.trim(), orderId: orderId.trim() || null, description: description.trim(), caseUrl: caseUrl.trim() || null }
      const res = await fetch(existing ? `/api/bm-cases/${existing.id}` : '/api/bm-cases', {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b dark:border-gray-700">
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{existing ? 'Edit Back Market Case' : 'New Back Market Case'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Back Market Case ID <span className="text-red-500">*</span></label>
            <input value={caseId} onChange={e => setCaseId(e.target.value)} placeholder="e.g. 12345678"
              className="w-full h-9 rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Back Market Order ID <span className="text-gray-400">(optional)</span></label>
            <input value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="e.g. 73216373"
              className="w-full h-9 rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description of the Issue <span className="text-red-500">*</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} placeholder="Describe the issue…"
              className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue resize-y" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Case URL <span className="text-gray-400">(optional)</span></label>
            <input value={caseUrl} onChange={e => setCaseUrl(e.target.value)} placeholder="https://…"
              className="w-full h-9 rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue" />
          </div>
          {err && <div className="flex items-center gap-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs"><AlertCircle size={13} /> {err}</div>}
        </div>
        <div className="px-5 py-3 border-t dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs bg-amazon-blue text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {saving ? <><RefreshCcw size={12} className="animate-spin" /> Saving…</> : <>{existing ? 'Save Changes' : 'Create Case'}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

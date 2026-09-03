'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { Plus, Trash2, X, Loader2, CheckCircle2, XCircle, AlertTriangle, Flag, PackageOpen, MessageSquare, Clock, PauseCircle, Gavel, Archive, ArchiveRestore, Pencil, Printer } from 'lucide-react'
import { printSerialLabels } from '@/lib/print-serial-labels'

// Administrator processing outcomes
const OUTCOMES = [
  { value: 'PASS', label: 'Pass', icon: CheckCircle2, cls: 'text-green-700 border-green-400 bg-green-50 dark:text-green-300 dark:border-green-600 dark:bg-green-900/25', ring: 'ring-green-500', badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  { value: 'FAIL', label: 'Fail', icon: XCircle, cls: 'text-red-700 border-red-400 bg-red-50 dark:text-red-300 dark:border-red-600 dark:bg-red-900/25', ring: 'ring-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { value: 'NEEDS_EVAL', label: 'Needs Administrator Evaluation', icon: AlertTriangle, cls: 'text-yellow-700 border-yellow-400 bg-yellow-50 dark:text-yellow-300 dark:border-yellow-500 dark:bg-yellow-900/25', ring: 'ring-yellow-500', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
] as const
const outcomeMeta = (v: string | null) => OUTCOMES.find(o => o.value === v)

interface Unit {
  id: string
  serialNumber: string
  grade: string | null
  serialExists: boolean
  sku: string | null
}
interface ProcessReturn {
  id: string
  returnNumber: number
  trackingNumber: string
  carrier: string
  note: string | null
  completed: boolean
  createdByLabel: string | null
  createdAt: string
  adminNote: string | null
  flagged: boolean
  adminNoteByLabel: string | null
  adminNoteAt: string | null
  processedOutcome: string | null // PASS | FAIL | NEEDS_EVAL
  processedAt: string | null
  processedByLabel: string | null
  archived: boolean
  archivedAt: string | null
  archivedByLabel: string | null
  units: Unit[]
}
interface Grade { id: string; grade: string }

const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL', 'OnTrac', 'Amazon']

// ─── Create Return Modal ─────────────────────────────────────────────────────

interface FormUnit {
  key: string
  serial: string
  grade: string
  status: 'idle' | 'checking' | 'exists' | 'missing'
  sku: string | null
}
let unitKey = 0
const blankUnit = (): FormUnit => ({ key: `u${++unitKey}`, serial: '', grade: '', status: 'idle', sku: null })

// Reusable form for creating a new return OR resuming an unfinished ("Not Yet
// Completed") draft. "Resume Later" saves the current partial state so the
// processor can move on and continue it afterward; "Submit" finalizes it.
function ReturnFormModal({ grades, existing, onClose, onSaved }: { grades: Grade[]; existing?: ProcessReturn | null; onClose: () => void; onSaved: () => void }) {
  const [trackingNumber, setTrackingNumber] = useState(existing?.trackingNumber ?? '')
  const [carrier, setCarrier] = useState(existing?.carrier ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [units, setUnits] = useState<FormUnit[]>(() =>
    existing && existing.units.length
      ? existing.units.map(u => ({ key: `u${++unitKey}`, serial: u.serialNumber, grade: u.grade ?? '', status: (u.serialExists ? 'exists' : 'missing') as FormUnit['status'], sku: u.sku }))
      : [blankUnit()])
  const [saving, setSaving] = useState<'submit' | 'resume' | null>(null)
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const patchUnit = (key: string, over: Partial<FormUnit>) =>
    setUnits(prev => prev.map(u => u.key === key ? { ...u, ...over } : u))

  function onSerialChange(key: string, val: string) {
    patchUnit(key, { serial: val, status: val.trim() ? 'checking' : 'idle', sku: null })
    clearTimeout(debounceRef.current[key])
    if (!val.trim()) return
    debounceRef.current[key] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/process-returns/serial-check?sn=${encodeURIComponent(val.trim())}`)
        const d = await res.json()
        patchUnit(key, { status: d.exists ? 'exists' : 'missing', sku: d.sku ?? null })
      } catch {
        patchUnit(key, { status: 'missing', sku: null })
      }
    }, 350)
  }

  // Editing an already-completed record (e.g. to fix a serial) — vs creating a
  // new one or resuming an unfinished draft.
  const editingCompleted = !!existing?.completed
  const showResumeLater = !editingCompleted
  const hasSerials = units.some(u => u.serial.trim())
  const canSubmit = !!(trackingNumber.trim() && carrier.trim() && hasSerials) && !saving
  // Resume Later needs at least *something* entered — no point saving a blank draft.
  const canResume = !!(trackingNumber.trim() || carrier.trim() || hasSerials || note.trim()) && !saving

  async function save(finalize: boolean) {
    if (finalize ? !canSubmit : !canResume) return
    setSaving(finalize ? 'submit' : 'resume')
    try {
      const payload = {
        trackingNumber, carrier, note, completed: finalize,
        units: units.filter(u => u.serial.trim()).map(u => ({ serialNumber: u.serial.trim(), grade: u.grade || null })),
      }
      const res = await fetch(existing ? `/api/process-returns/${existing.id}` : '/api/process-returns', {
        method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to save')
      toast.success(finalize ? (editingCompleted ? 'Changes saved' : 'Return staged') : 'Saved — resume it anytime')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
      setSaving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-white/10">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
            <PackageOpen size={16} className="text-amazon-blue" />
            {existing ? <>{editingCompleted ? 'Edit' : 'Resume'} RET-{existing.returnNumber}</> : 'New Received Return'}
            {existing && !editingCompleted && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded"><Clock size={9} /> NOT YET COMPLETED</span>}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Tracking Number</label>
              <input autoFocus value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-white/15 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Carrier</label>
              <input list="pr-carriers" value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="UPS, FedEx…"
                className="w-full text-sm border border-gray-300 dark:border-white/15 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
              <datalist id="pr-carriers">{CARRIERS.map(c => <option key={c} value={c} />)}</datalist>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Units</label>
            <div className="space-y-2">
              {units.map((u, i) => (
                <div key={u.key} className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 w-5 shrink-0">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="relative">
                        <input value={u.serial} onChange={e => onSerialChange(u.key, e.target.value)} placeholder="Serial number"
                          className={clsx('w-full text-sm rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 font-mono outline-none border-2',
                            u.status === 'exists' ? 'border-green-500 text-green-800 dark:text-green-300'
                            : u.status === 'missing' ? 'border-red-400 text-gray-900 dark:text-white'
                            : 'border-gray-300 dark:border-white/15 text-gray-900 dark:text-white')} />
                        {u.status === 'checking' && <Loader2 size={13} className="animate-spin text-gray-400 absolute right-2 top-1/2 -translate-y-1/2" />}
                        {u.status === 'exists' && <CheckCircle2 size={13} className="text-green-500 absolute right-2 top-1/2 -translate-y-1/2" />}
                      </div>
                      {u.status === 'exists' && u.sku && <p className="text-[11px] text-green-600 dark:text-green-400 mt-0.5 font-mono">{u.sku}</p>}
                      {u.status === 'missing' && <p className="text-[11px] text-red-500 mt-0.5">Not in system — will still be staged</p>}
                    </div>
                    <select value={u.grade} onChange={e => patchUnit(u.key, { grade: e.target.value })}
                      className="w-24 text-xs border border-gray-300 dark:border-white/15 rounded-md px-1.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white shrink-0">
                      <option value="">Grade…</option>
                      {grades.map(g => <option key={g.id} value={g.grade}>{g.grade}</option>)}
                    </select>
                    {units.length > 1 && (
                      <button onClick={() => setUnits(prev => prev.filter(x => x.key !== u.key))} className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setUnits(prev => [...prev, blankUnit()])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amazon-blue hover:underline"><Plus size={13} /> Add unit</button>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Note (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full text-sm border border-gray-300 dark:border-white/15 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 dark:border-white/10">
          <button onClick={onClose} className="text-xs font-medium text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/10">Cancel</button>
          {showResumeLater && (
            <button onClick={() => save(false)} disabled={!canResume} title="Save this unfinished record and continue it later"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60 px-3.5 py-1.5 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40">
              {saving === 'resume' ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />} Resume Later
            </button>
          )}
          <button onClick={() => save(true)} disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amazon-blue text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-40">
            {saving === 'submit' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {editingCompleted ? 'Save Changes' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail / Admin Modal ────────────────────────────────────────────────────

function DetailModal({ ret, onClose, onUpdated, onEdit }: { ret: ProcessReturn; onClose: () => void; onUpdated: (r: ProcessReturn) => void; onEdit: (r: ProcessReturn) => void }) {
  const [adminNote, setAdminNote] = useState(ret.adminNote ?? '')
  const [flagged, setFlagged] = useState(ret.flagged)
  const [outcome, setOutcome] = useState<string | null>(ret.processedOutcome)
  const [saving, setSaving] = useState(false)

  const [archiving, setArchiving] = useState(false)
  const needsEval = outcome === 'NEEDS_EVAL'
  const noteMissing = needsEval && !adminNote.trim()

  async function save() {
    if (noteMissing) { toast.error('A note is required for Needs Administrator Evaluation'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/process-returns/${ret.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote, flagged, processedOutcome: outcome }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      toast.success(outcome ? 'Marked as processed' : 'Saved')
      onUpdated(j.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setSaving(false) }
  }

  // Archive persists any unsaved note/flag/outcome too, then moves the record
  // to the "Already Processed" tab (or restores it back).
  async function toggleArchive() {
    if (!ret.archived && noteMissing) { toast.error('A note is required for Needs Administrator Evaluation'); return }
    setArchiving(true)
    try {
      const res = await fetch(`/api/process-returns/${ret.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ret.archived ? { archived: false } : { adminNote, flagged, processedOutcome: outcome, archived: true }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      toast.success(ret.archived ? 'Restored to Not Yet Processed' : 'Archived to Already Processed')
      onUpdated(j.data)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setArchiving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">RET-{ret.returnNumber}</h2>
            {ret.flagged && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded"><Flag size={9} /> FLAGGED</span>}
            {outcomeMeta(ret.processedOutcome) && (() => { const m = outcomeMeta(ret.processedOutcome)!; const I = m.icon; return (
              <span className={clsx('inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded', m.badge)}><I size={9} /> {m.label.toUpperCase()}</span>
            )})()}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-gray-400">Carrier</span> <span className="text-gray-800 dark:text-gray-200 font-medium">{ret.carrier}</span></div>
            <div><span className="text-gray-400">Tracking</span> <span className="font-mono text-gray-800 dark:text-gray-200">{ret.trackingNumber}</span></div>
            <div><span className="text-gray-400">Processor</span> <span className="text-gray-800 dark:text-gray-200">{ret.createdByLabel ?? '—'}</span></div>
            <div><span className="text-gray-400">Received</span> <span className="text-gray-800 dark:text-gray-200">{new Date(ret.createdAt).toLocaleString()}</span></div>
          </div>

          {ret.note && (
            <div className="text-xs bg-gray-50 dark:bg-white/5 rounded-md px-3 py-2">
              <span className="text-gray-400">Processor note: </span><span className="text-gray-700 dark:text-gray-300">{ret.note}</span>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Units ({ret.units.length})</p>
              <button onClick={() => onEdit(ret)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-amazon-blue hover:underline">
                <Pencil size={11} /> Edit serials
              </button>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/5">
              {ret.units.map((u, i) => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="text-gray-400 w-4">{i + 1}</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200 flex-1">{u.serialNumber}</span>
                  {u.serialExists
                    ? <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-mono">{u.sku ?? 'in system'}</span>
                    : <span className="text-red-500">not in system</span>}
                  <span className="text-gray-500 w-14 text-right">{u.grade ? `Gr ${u.grade}` : '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Administrator: mark as processed */}
          <div className="border-t border-gray-200 dark:border-white/10 pt-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Gavel size={12} className="text-gray-400" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Mark as Processed</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {OUTCOMES.map(o => {
                const I = o.icon; const active = outcome === o.value
                return (
                  <button key={o.value} type="button" onClick={() => setOutcome(active ? null : o.value)}
                    className={clsx('flex flex-col items-center justify-center gap-1 text-center text-[11px] font-semibold rounded-lg border-2 px-2 py-2.5 leading-tight transition',
                      o.cls, active ? 'ring-2 ring-offset-1 dark:ring-offset-gray-900 ' + o.ring : 'opacity-70 hover:opacity-100')}>
                    <I size={16} /> {o.label}
                  </button>
                )
              })}
            </div>
            {outcome && (
              <button type="button" onClick={() => setOutcome(null)} className="mt-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Clear selection</button>
            )}
            {ret.processedByLabel && ret.processedAt && (
              <p className="text-[10px] text-gray-400 mt-1">Processed by {ret.processedByLabel} · {new Date(ret.processedAt).toLocaleString()}</p>
            )}
          </div>

          {/* Administrator: note to processor + flag */}
          <div className="border-t border-gray-200 dark:border-white/10 pt-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Note to Processor{needsEval && <span className="ml-1 text-amber-600 dark:text-amber-400 normal-case tracking-normal">· required for evaluation</span>}
              </p>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none">
                <input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} className="rounded border-gray-300 text-red-600 focus:ring-red-500" />
                <span className={clsx('inline-flex items-center gap-1', flagged ? 'text-red-600' : 'text-gray-500')}><Flag size={12} /> Flag</span>
              </label>
            </div>
            <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={3} placeholder={needsEval ? 'Describe what needs administrator evaluation…' : 'Message for the processor…'}
              className={clsx('w-full text-sm border rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none',
                noteMissing ? 'border-amber-400 dark:border-amber-600' : 'border-gray-300 dark:border-white/15')} />
            {ret.adminNoteByLabel && ret.adminNoteAt && (
              <p className="text-[10px] text-gray-400 mt-1">Last updated by {ret.adminNoteByLabel} · {new Date(ret.adminNoteAt).toLocaleString()}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-gray-200 dark:border-white/10">
          <button onClick={toggleArchive} disabled={archiving || saving}
            className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border disabled:opacity-40',
              ret.archived
                ? 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-white/15 hover:bg-gray-100 dark:hover:bg-white/10'
                : 'text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700/60 hover:bg-purple-50 dark:hover:bg-purple-900/20')}>
            {archiving ? <Loader2 size={14} className="animate-spin" /> : ret.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {ret.archived ? 'Restore' : 'Archive'}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-xs font-medium text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/10">Close</button>
            <button onClick={save} disabled={saving || noteMissing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amazon-blue text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : outcome ? <Gavel size={14} /> : <MessageSquare size={14} />} {outcome ? 'Mark as Processed' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function ProcessReturnsManager() {
  const [returns, setReturns] = useState<ProcessReturn[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [resume, setResume] = useState<ProcessReturn | null>(null)
  const [detail, setDetail] = useState<ProcessReturn | null>(null)
  const [tab, setTab] = useState<'active' | 'archived'>('active')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)

  const activeCount = returns.filter(r => !r.archived).length
  const archivedCount = returns.filter(r => r.archived).length
  const visibleReturns = returns.filter(r => (tab === 'archived' ? r.archived : !r.archived))

  const switchTab = (t: 'active' | 'archived') => { setTab(t); setSelectedIds(new Set()) }
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allVisibleSelected = visibleReturns.length > 0 && visibleReturns.every(r => selectedIds.has(r.id))
  const toggleSelectAll = () => setSelectedIds(prev => {
    if (visibleReturns.every(r => prev.has(r.id))) {
      const next = new Set(prev); visibleReturns.forEach(r => next.delete(r.id)); return next
    }
    const next = new Set(prev); visibleReturns.forEach(r => next.add(r.id)); return next
  })

  // Print serial labels for the selected records — only for units that are
  // currently IN_STOCK (resolved live server-side).
  async function printSelectedLabels() {
    const chosen = visibleReturns.filter(r => selectedIds.has(r.id))
    const serialNumbers = Array.from(new Set(chosen.flatMap(r => r.units.map(u => u.serialNumber).filter(Boolean))))
    if (serialNumbers.length === 0) { toast.error('No serials on the selected records'); return }
    setPrinting(true)
    try {
      const res = await fetch('/api/process-returns/serial-labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumbers }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to look up serials')
      const labels: { serialNumber: string; sku: string | null; grade: string | null; found: boolean; inStock: boolean }[] = j.labels ?? []
      const inStock = labels.filter(l => l.inStock)
      const skipped = serialNumbers.length - inStock.length
      if (inStock.length === 0) { toast.error('None of the selected serials are in stock — nothing to print'); return }
      printSerialLabels(inStock.map(l => ({ serialNumber: l.serialNumber, sku: l.sku, grade: l.grade })))
      toast.success(`Printing ${inStock.length} label${inStock.length > 1 ? 's' : ''}${skipped > 0 ? ` · ${skipped} skipped (not in stock)` : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to print labels')
    } finally { setPrinting(false) }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/process-returns')
      const j = await res.json()
      setReturns(j.data ?? [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/grades').then(r => r.json()).then(d => setGrades(d.data ?? d ?? [])).catch(() => {}) }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><PackageOpen size={18} className="text-amazon-blue" /> Process Returns</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Staging log of received returns — for processor ↔ administrator communication. Does not affect inventory.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-blue-700">
          <Plus size={15} /> Create New Return
        </button>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 flex items-center gap-1">
        {([
          { key: 'active' as const, label: 'Not Yet Processed', count: activeCount },
          { key: 'archived' as const, label: 'Already Processed', count: archivedCount },
        ]).map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={clsx('flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition',
              tab === t.key ? 'border-amazon-blue text-amazon-blue' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200')}>
            {t.key === 'archived' ? <Archive size={14} /> : <PackageOpen size={14} />}
            {t.label}
            <span className={clsx('inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
              tab === t.key ? 'bg-amazon-blue text-white' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300')}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <div className="px-6 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 shrink-0 flex items-center justify-between">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">{selectedIds.size} record{selectedIds.size > 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="text-xs font-medium text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-md hover:bg-white/60 dark:hover:bg-white/10">Clear</button>
            <button onClick={printSelectedLabels} disabled={printing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amazon-blue text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-40">
              {printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Print Serial Labels
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : visibleReturns.length === 0 ? (
          <div className="py-20 text-center">
            <PackageOpen size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">{tab === 'archived' ? 'Nothing processed yet.' : 'No returns to process.'}</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 w-8">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Select all"
                    className="rounded border-gray-400 text-amazon-blue focus:ring-amazon-blue cursor-pointer" />
                </th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Return #</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Carrier</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Serial #</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Units</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Processor</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Received</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {visibleReturns.map((r, i) => (
                <tr key={r.id} onClick={() => (r.completed ? setDetail(r) : setResume(r))}
                  className={clsx('cursor-pointer', selectedIds.has(r.id) ? 'bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-900/30' : !r.completed ? 'bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-900/20' : r.flagged ? 'bg-red-50 hover:bg-red-100/70 dark:bg-red-900/20' : i % 2 === 0 ? 'bg-white dark:bg-gray-900 hover:bg-blue-50/50' : 'bg-gray-50 dark:bg-gray-800/50 hover:bg-blue-50/50')}>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} aria-label={`Select RET-${r.returnNumber}`}
                      className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue cursor-pointer" />
                  </td>
                  <td className="px-3 py-2 font-semibold text-amazon-blue whitespace-nowrap">RET-{r.returnNumber}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.carrier}</td>
                  <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.trackingNumber}</td>
                  <td className="px-3 py-2">
                    {r.units.length === 0 ? <span className="text-gray-300 dark:text-gray-600">—</span> : (
                      <div className="flex flex-col gap-0.5">
                        {r.units.map(u => (
                          <span key={u.id} className="font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{u.serialNumber}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{r.units.length}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.createdByLabel ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {!r.completed && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded"><Clock size={9} /> Not Yet Completed</span>}
                      {outcomeMeta(r.processedOutcome) && (() => { const m = outcomeMeta(r.processedOutcome)!; const I = m.icon; return (
                        <span className={clsx('inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded', m.badge)}><I size={9} /> {m.label}</span>
                      )})()}
                      {r.flagged && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 px-1.5 py-0.5 rounded"><Flag size={9} /> Flagged</span>}
                      {r.adminNote && <span title={r.adminNote} className="inline-flex items-center gap-1 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded"><MessageSquare size={9} /> Note</span>}
                      {r.completed && !r.flagged && !r.adminNote && !r.processedOutcome && <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <ReturnFormModal grades={grades} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load() }} />}
      {resume && <ReturnFormModal grades={grades} existing={resume} onClose={() => setResume(null)} onSaved={() => { setResume(null); load() }} />}
      {detail && <DetailModal ret={detail} onClose={() => setDetail(null)} onEdit={(r) => { setDetail(null); setResume(r) }} onUpdated={(r) => { setDetail(r); setReturns(prev => prev.map(x => x.id === r.id ? r : x)) }} />}
    </div>
  )
}

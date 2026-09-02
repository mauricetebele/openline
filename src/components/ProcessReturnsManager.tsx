'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { clsx } from 'clsx'
import { Plus, Trash2, X, Loader2, CheckCircle2, Flag, PackageOpen, MessageSquare } from 'lucide-react'

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
  createdByLabel: string | null
  createdAt: string
  adminNote: string | null
  flagged: boolean
  adminNoteByLabel: string | null
  adminNoteAt: string | null
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

function CreateReturnModal({ grades, onClose, onCreated }: { grades: Grade[]; onClose: () => void; onCreated: () => void }) {
  const [trackingNumber, setTrackingNumber] = useState('')
  const [carrier, setCarrier] = useState('')
  const [note, setNote] = useState('')
  const [units, setUnits] = useState<FormUnit[]>([blankUnit()])
  const [saving, setSaving] = useState(false)
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

  const canSubmit = trackingNumber.trim() && carrier.trim() && units.some(u => u.serial.trim()) && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      const res = await fetch('/api/process-returns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber, carrier, note,
          units: units.filter(u => u.serial.trim()).map(u => ({ serialNumber: u.serial.trim(), grade: u.grade || null })),
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to create')
      toast.success('Return staged')
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-white/10">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white"><PackageOpen size={16} className="text-amazon-blue" /> New Received Return</h2>
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
          <button onClick={submit} disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amazon-blue text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Submit
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail / Admin Modal ────────────────────────────────────────────────────

function DetailModal({ ret, onClose, onUpdated }: { ret: ProcessReturn; onClose: () => void; onUpdated: (r: ProcessReturn) => void }) {
  const [adminNote, setAdminNote] = useState(ret.adminNote ?? '')
  const [flagged, setFlagged] = useState(ret.flagged)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/process-returns/${ret.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNote, flagged }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      toast.success('Saved')
      onUpdated(j.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">RET-{ret.returnNumber}</h2>
            {ret.flagged && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded"><Flag size={9} /> FLAGGED</span>}
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Units ({ret.units.length})</p>
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

          {/* Administrator section */}
          <div className="border-t border-gray-200 dark:border-white/10 pt-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Note to Processor</p>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none">
                <input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} className="rounded border-gray-300 text-red-600 focus:ring-red-500" />
                <span className={clsx('inline-flex items-center gap-1', flagged ? 'text-red-600' : 'text-gray-500')}><Flag size={12} /> Flag</span>
              </label>
            </div>
            <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={3} placeholder="Message for the processor…"
              className="w-full text-sm border border-gray-300 dark:border-white/15 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none" />
            {ret.adminNoteByLabel && ret.adminNoteAt && (
              <p className="text-[10px] text-gray-400 mt-1">Last updated by {ret.adminNoteByLabel} · {new Date(ret.adminNoteAt).toLocaleString()}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 dark:border-white/10">
          <button onClick={onClose} className="text-xs font-medium text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/10">Close</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amazon-blue text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} Save
          </button>
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
  const [detail, setDetail] = useState<ProcessReturn | null>(null)

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

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : returns.length === 0 ? (
          <div className="py-20 text-center">
            <PackageOpen size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">No returns staged yet.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Return #</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Carrier</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Units</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Processor</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Received</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {returns.map((r, i) => (
                <tr key={r.id} onClick={() => setDetail(r)}
                  className={clsx('cursor-pointer', r.flagged ? 'bg-red-50 hover:bg-red-100/70 dark:bg-red-900/20' : i % 2 === 0 ? 'bg-white dark:bg-gray-900 hover:bg-blue-50/50' : 'bg-gray-50 dark:bg-gray-800/50 hover:bg-blue-50/50')}>
                  <td className="px-3 py-2 font-semibold text-amazon-blue whitespace-nowrap">RET-{r.returnNumber}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.carrier}</td>
                  <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.trackingNumber}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{r.units.length}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.createdByLabel ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {r.flagged && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 px-1.5 py-0.5 rounded"><Flag size={9} /> Flagged</span>}
                      {r.adminNote && <span title={r.adminNote} className="inline-flex items-center gap-1 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded"><MessageSquare size={9} /> Note</span>}
                      {!r.flagged && !r.adminNote && <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateReturnModal grades={grades} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load() }} />}
      {detail && <DetailModal ret={detail} onClose={() => setDetail(null)} onUpdated={(r) => { setDetail(r); setReturns(prev => prev.map(x => x.id === r.id ? r : x)) }} />}
    </div>
  )
}

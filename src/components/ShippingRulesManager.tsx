'use client'
import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Trash2, Pencil, X, RefreshCcw, AlertCircle, Check } from 'lucide-react'

interface Preset { id: string; name: string }
interface SsCarrier { carrierCode: string; carrierName: string; services: { code: string; name: string }[] }
interface Svc { code: string; name: string }
interface UpsAcct { id: string; nickname: string; isDefault: boolean }
interface Options { presets: Preset[]; shipstationCarriers: SsCarrier[]; fedexServices: Svc[]; fedexOneRatePackaging: Svc[]; upsServices: Svc[]; upsAccounts: UpsAcct[] }

interface Rule {
  id: string; name: string; priority: number; active: boolean
  presetEnabled: boolean; packagePresetIds: string[]
  transitEnabled: boolean; transitMaxDays: number | null; transitWithin: boolean
  valueEnabled: boolean; valueOperator: string | null; valueAmount: string | number | null
  thenCarrierType: string; thenCarrierCode: string | null; thenServiceCode: string; thenServiceName: string | null; thenUpsCredentialId: string | null; thenConfirmation: string | null
  thenFedexOneRate: boolean; thenFedexPackaging: string | null; thenFedexPackagingMap: Record<string, string> | null
}

type Draft = Omit<Rule, 'id' | 'packagePreset'> & { id?: string }

const CARRIER_LABEL: Record<string, string> = { shipstation: 'ShipStation', fedex_direct: 'FedEx (linked)', ups_direct: 'UPS (linked)' }
const OP_LABEL: Record<string, string> = { gt: 'greater than', lt: 'less than', gte: '≥', lte: '≤' }

function emptyDraft(): Draft {
  return {
    name: '', priority: 0, active: true, presetEnabled: false, packagePresetIds: [],
    transitEnabled: true, transitMaxDays: 2, transitWithin: true,
    valueEnabled: false, valueOperator: 'gt', valueAmount: null,
    thenCarrierType: 'shipstation', thenCarrierCode: null, thenServiceCode: '', thenServiceName: null, thenUpsCredentialId: null, thenConfirmation: null,
    thenFedexOneRate: false, thenFedexPackaging: null, thenFedexPackagingMap: null,
  }
}

const CONFIRMATION_LABEL: Record<string, string> = { none: 'No signature', delivery: 'Delivery confirmation', signature: 'Signature required', adult_signature: 'Adult signature required' }

export default function ShippingRulesManager() {
  const [rules, setRules] = useState<Rule[]>([])
  const [opts, setOpts] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    Promise.all([
      fetch('/api/shipping-rules').then(r => r.json()),
      fetch('/api/shipping-rules/options').then(r => r.json()),
    ])
      .then(([r, o]) => { setRules(r.rules ?? []); setOpts(o) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const save = async () => {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(draft.id ? `/api/shipping-rules/${draft.id}` : '/api/shipping-rules', {
        method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      setDraft(null); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const del = async (id: string) => {
    if (!confirm('Delete this ruleset?')) return
    await fetch(`/api/shipping-rules/${id}`, { method: 'DELETE' })
    load()
  }

  const describeThen = (r: Rule | Draft) => {
    if (r.thenCarrierType === 'ups_direct') return `UPS (linked) · ${opts?.upsServices.find(s => s.code === r.thenServiceCode)?.name ?? r.thenServiceCode}`
    if (r.thenCarrierType === 'fedex_direct') return `FedEx (linked) · ${opts?.fedexServices.find(s => s.code === r.thenServiceCode)?.name ?? r.thenServiceCode}${r.thenFedexOneRate ? ' (One Rate)' : ''}`
    const carrier = opts?.shipstationCarriers.find(c => c.carrierCode === r.thenCarrierCode)
    return `${carrier?.carrierName ?? 'ShipStation'} · ${r.thenServiceName ?? r.thenServiceCode}`
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 mb-3">
        <p className="text-sm text-gray-500">The first ruleset whose conditions <strong>all</strong> pass wins for an order.</p>
        <button onClick={() => setDraft(emptyDraft())} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-amazon-blue/90">
          <Plus size={14} /> New Ruleset
        </button>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCcw size={13} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {error && <div className="flex items-center gap-2 px-3 py-2 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded"><AlertCircle size={14} /> {error}</div>}

      <div className="flex-1 overflow-auto space-y-2">
        {loading ? (
          <div className="py-10 text-center text-gray-400"><RefreshCcw size={16} className="animate-spin inline" /></div>
        ) : rules.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No rulesets yet. Create one to start.</div>
        ) : rules.map(r => (
          <div key={r.id} className={clsx('rounded-lg border p-3 flex items-start gap-3', r.active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70')}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{r.name}</span>
                {!r.active && <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">inactive</span>}
              </div>
              <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                <div><span className="text-gray-400 font-medium">IF</span> {[
                  r.presetEnabled ? `package preset = ${r.packagePresetIds.map(id => opts?.presets.find(p => p.id === id)?.name ?? '—').join(' or ') || '—'}` : null,
                  r.transitEnabled ? `UPS Ground transit ${r.transitWithin ? '≤' : '>'} ${r.transitMaxDays} business day${r.transitMaxDays === 1 ? '' : 's'}` : null,
                  r.valueEnabled ? `order value ${OP_LABEL[r.valueOperator ?? '']} $${Number(r.valueAmount ?? 0).toFixed(2)}` : null,
                ].filter(Boolean).join('  AND  ')}</div>
                <div><span className="text-gray-400 font-medium">THEN</span> ship via <span className="font-medium text-gray-800">{describeThen(r)}</span>{r.thenConfirmation && <span className="ml-1.5 text-[10px] bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded">✍ {CONFIRMATION_LABEL[r.thenConfirmation] ?? r.thenConfirmation}</span>}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setDraft({ ...r, valueAmount: r.valueAmount != null ? Number(r.valueAmount) : null })} className="p-1.5 rounded text-gray-400 hover:text-amazon-blue hover:bg-blue-50"><Pencil size={14} /></button>
              <button onClick={() => del(r.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {draft && opts && (
        <RuleEditor draft={draft} setDraft={setDraft} opts={opts} onSave={save} onCancel={() => setDraft(null)} saving={saving} />
      )}
    </div>
  )
}

function RuleEditor({ draft, setDraft, opts, onSave, onCancel, saving }: {
  draft: Draft; setDraft: (d: Draft) => void; opts: Options; onSave: () => void; onCancel: () => void; saving: boolean
}) {
  const up = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const ssCarrier = opts.shipstationCarriers.find(c => c.carrierCode === draft.thenCarrierCode)
  const fieldCls = 'h-8 rounded border border-gray-300 px-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-amazon-blue'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-900">{draft.id ? 'Edit' : 'New'} Shipping Ruleset</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="text-xs font-medium text-gray-500 block">Name
            <input value={draft.name} onChange={e => up({ name: e.target.value })} className={clsx(fieldCls, 'w-full mt-1')} placeholder="e.g. Fast ground, high value" />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={draft.active} onChange={e => up({ active: e.target.checked })} /> Active</label>

          {/* Conditions */}
          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Conditions (all must pass)</p>
            <div className="text-sm">
              <label className="flex items-center gap-2 mb-1.5">
                <input type="checkbox" checked={draft.presetEnabled} onChange={e => up({ presetEnabled: e.target.checked })} />
                <span className="text-gray-700">Package preset is any of</span>
              </label>
              <div className={clsx('flex flex-wrap gap-1.5 pl-6', !draft.presetEnabled && 'opacity-40 pointer-events-none')}>
                {opts.presets.map(p => {
                  const on = draft.packagePresetIds.includes(p.id)
                  return (
                    <button key={p.id} type="button"
                      onClick={() => up({ packagePresetIds: on ? draft.packagePresetIds.filter(x => x !== p.id) : [...draft.packagePresetIds, p.id] })}
                      className={clsx('px-2 py-0.5 rounded-full text-xs border transition-colors',
                        on ? 'bg-amazon-blue text-white border-amazon-blue' : 'bg-white text-gray-600 border-gray-300 hover:border-amazon-blue')}>
                      {p.name}
                    </button>
                  )
                })}
                {opts.presets.length === 0 && <span className="text-xs text-gray-400">No package presets defined</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <input type="checkbox" checked={draft.transitEnabled} onChange={e => up({ transitEnabled: e.target.checked })} />
              <span className="text-gray-700">UPS Ground transit is</span>
              <select value={draft.transitWithin ? 'within' : 'beyond'} disabled={!draft.transitEnabled} onChange={e => up({ transitWithin: e.target.value === 'within' })} className={fieldCls}>
                <option value="within">≤</option>
                <option value="beyond">&gt;</option>
              </select>
              <input type="number" min={0} value={draft.transitMaxDays ?? 2} disabled={!draft.transitEnabled} onChange={e => up({ transitMaxDays: parseInt(e.target.value) || 0 })} className={clsx(fieldCls, 'w-16')} />
              <span className="text-gray-700">business days away</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <input type="checkbox" checked={draft.valueEnabled} onChange={e => up({ valueEnabled: e.target.checked })} />
              <span className="text-gray-700">Order value is</span>
              <select value={draft.valueOperator ?? 'gt'} disabled={!draft.valueEnabled} onChange={e => up({ valueOperator: e.target.value })} className={fieldCls}>
                <option value="gt">greater than</option>
                <option value="lt">less than</option>
                <option value="gte">≥</option>
                <option value="lte">≤</option>
              </select>
              <span className="text-gray-700">$</span>
              <input type="number" step="0.01" value={draft.valueAmount ?? ''} disabled={!draft.valueEnabled} onChange={e => up({ valueAmount: e.target.value === '' ? null : parseFloat(e.target.value) })} className={clsx(fieldCls, 'w-24')} placeholder="0.00" />
            </div>
          </div>

          {/* Then */}
          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Then ship via</p>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={draft.thenCarrierType} onChange={e => up({ thenCarrierType: e.target.value, thenCarrierCode: null, thenServiceCode: '', thenServiceName: null, thenUpsCredentialId: null })} className={fieldCls}>
                {Object.entries(CARRIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>

              {draft.thenCarrierType === 'shipstation' && (
                <>
                  <select value={draft.thenCarrierCode ?? ''} onChange={e => up({ thenCarrierCode: e.target.value || null, thenServiceCode: '', thenServiceName: null })} className={fieldCls}>
                    <option value="">Carrier…</option>
                    {opts.shipstationCarriers.map(c => <option key={c.carrierCode} value={c.carrierCode}>{c.carrierName}</option>)}
                  </select>
                  <select value={draft.thenServiceCode} disabled={!ssCarrier} onChange={e => { const s = ssCarrier?.services.find(x => x.code === e.target.value); up({ thenServiceCode: e.target.value, thenServiceName: s?.name ?? null }) }} className={fieldCls}>
                    <option value="">Service…</option>
                    {ssCarrier?.services.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                </>
              )}

              {draft.thenCarrierType === 'fedex_direct' && (
                <select value={draft.thenServiceCode} onChange={e => { const s = opts.fedexServices.find(x => x.code === e.target.value); up({ thenServiceCode: e.target.value, thenServiceName: s?.name ?? null }) }} className={fieldCls}>
                  <option value="">FedEx service…</option>
                  {opts.fedexServices.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              )}

              {draft.thenCarrierType === 'ups_direct' && (
                <>
                  <select value={draft.thenServiceCode} onChange={e => { const s = opts.upsServices.find(x => x.code === e.target.value); up({ thenServiceCode: e.target.value, thenServiceName: s?.name ?? null }) }} className={fieldCls}>
                    <option value="">UPS service…</option>
                    {opts.upsServices.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                  {opts.upsAccounts.length > 0 && (
                    <select value={draft.thenUpsCredentialId ?? ''} onChange={e => up({ thenUpsCredentialId: e.target.value || null })} className={fieldCls}>
                      <option value="">Default UPS acct</option>
                      {opts.upsAccounts.map(a => <option key={a.id} value={a.id}>{a.nickname}{a.isDefault ? ' (default)' : ''}</option>)}
                    </select>
                  )}
                </>
              )}
            </div>

            {draft.thenCarrierType === 'fedex_direct' && (
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input type="checkbox" checked={draft.thenFedexOneRate} onChange={e => up({ thenFedexOneRate: e.target.checked })} />
                  FedEx One Rate (flat rate)
                </label>
                {draft.thenFedexOneRate && (
                  draft.presetEnabled && draft.packagePresetIds.length > 1 ? (
                    <div className="pl-6 space-y-1.5">
                      <p className="text-[11px] text-gray-400">Map each selected package preset to a FedEx One Rate packaging:</p>
                      {draft.packagePresetIds.map(pid => {
                        const name = opts.presets.find(p => p.id === pid)?.name ?? pid
                        const map = draft.thenFedexPackagingMap ?? {}
                        return (
                          <div key={pid} className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 w-32 truncate" title={name}>{name}</span>
                            <span className="text-gray-300">→</span>
                            <select value={map[pid] ?? ''} onChange={e => up({ thenFedexPackagingMap: { ...map, [pid]: e.target.value } })} className={fieldCls}>
                              <option value="">Packaging…</option>
                              {opts.fedexOneRatePackaging.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="pl-6">
                      <select value={draft.thenFedexPackaging ?? ''} onChange={e => up({ thenFedexPackaging: e.target.value || null })} className={fieldCls}>
                        <option value="">One Rate packaging…</option>
                        {opts.fedexOneRatePackaging.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                      </select>
                    </div>
                  )
                )}
              </div>
            )}

            <label className="text-xs font-medium text-gray-500 flex items-center gap-2">Signature
              <select value={draft.thenConfirmation ?? 'none'} onChange={e => up({ thenConfirmation: e.target.value === 'none' ? null : e.target.value })} className={fieldCls}>
                {Object.entries(CONFIRMATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onCancel} className="h-8 px-4 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50 hover:bg-amazon-blue/90">
            {saving ? <RefreshCcw size={13} className="animate-spin" /> : <Check size={14} />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

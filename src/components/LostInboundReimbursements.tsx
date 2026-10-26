'use client'
import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCcw, AlertCircle, Link2, Check } from 'lucide-react'

interface Line { sku: string; fnsku: string | null; quantity: number; amount: number | null }
interface Row {
  accountId: string
  reimbursementId: string
  caseId: string | null
  marketplaceName: string | null
  approvalDate: string | null
  currency: string | null
  lines: Line[]
  totalQty: number
  totalAmount: number
  attributedShipmentId: string | null
  attributedShipmentNumber: string | null
  attributedShipmentName: string | null
  attributedShipmentExternalId: string | null
  attributedAt: string | null
}
interface Shipment { id: string; shipmentNumber: string | null; name: string | null; accountId: string; shipmentConfirmationId: string | null }

type Tab = 'unattributed' | 'attributed' | 'all'

const money = (n: number | null, c: string | null) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: c || 'USD' })
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

export default function LostInboundReimbursements() {
  const [tab, setTab] = useState<Tab>('unattributed')
  const [rows, setRows] = useState<Row[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [counts, setCounts] = useState<{ total: number; unattributed: number }>({ total: 0, unattributed: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback((t: Tab) => {
    setLoading(true); setError(null)
    fetch(`/api/fba-reimbursements/lost-inbound?status=${t}`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then(d => { setRows(d.rows ?? []); setShipments(d.shipments ?? []); setCounts(d.counts ?? { total: 0, unattributed: 0 }) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  const attribute = async (row: Row, shipmentId: string | null) => {
    setSavingId(row.reimbursementId); setError(null)
    try {
      const res = await fetch('/api/fba-reimbursements/lost-inbound', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reimbursementId: row.reimbursementId, accountId: row.accountId, shipmentId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      load(tab)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attribution failed')
    } finally {
      setSavingId(null)
    }
  }

  // Attribute to a free-text Amazon inbound shipment id (FBA…) not in our system.
  const attributeExternal = async (row: Row, externalShipmentId: string | null) => {
    const next = externalShipmentId?.trim() || null
    if (next === (row.attributedShipmentExternalId ?? null)) return
    setSavingId(row.reimbursementId); setError(null)
    try {
      const res = await fetch('/api/fba-reimbursements/lost-inbound', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reimbursementId: row.reimbursementId, accountId: row.accountId, externalShipmentId: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status))
      load(tab)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attribution failed')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['unattributed', 'attributed', 'all'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-4 py-1.5 font-medium capitalize', tab === t ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>
              {t}{t === 'unattributed' && counts.unattributed > 0 ? ` (${counts.unattributed})` : ''}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">{counts.total} Lost Inbound reimbursement{counts.total !== 1 ? 's' : ''}</span>
        <button onClick={() => load(tab)} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCcw size={13} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {error && <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</div>}

      <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-800 text-gray-100 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Approved</th>
              <th className="px-3 py-2 text-left font-semibold">Reimbursement ID</th>
              <th className="px-3 py-2 text-left font-semibold">Case ID</th>
              <th className="px-3 py-2 text-left font-semibold">SKU / FNSKU</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
              <th className="px-3 py-2 text-left font-semibold">Attribute to shipment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400"><RefreshCcw size={16} className="animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">
                {tab === 'unattributed' ? 'Everything is attributed — nothing to assign. 🎉' : 'No Lost Inbound reimbursements.'}
              </td></tr>
            ) : rows.map((r, i) => {
              const opts = shipments.filter(s => s.accountId === r.accountId)
              const attributed = !!r.attributedShipmentId || !!r.attributedShipmentExternalId
              return (
                <tr key={`${r.accountId}-${r.reimbursementId}`} className={clsx(i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50', !attributed && 'bg-amber-50/40')}>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap align-top">{fmtDate(r.approvalDate)}</td>
                  <td className="px-3 py-2 font-mono text-gray-700 align-top">{r.reimbursementId}</td>
                  <td className="px-3 py-2 font-mono text-gray-500 align-top">{r.caseId ?? '—'}</td>
                  <td className="px-3 py-2 align-top">
                    {r.lines.map((l, j) => (
                      <div key={j} className="whitespace-nowrap">
                        <span className="font-mono text-gray-700">{l.sku}</span>
                        {l.fnsku && <span className="font-mono text-gray-400 ml-1.5">{l.fnsku}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700 align-top">{r.totalQty}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700 align-top">{money(r.totalAmount, r.currency)}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-2">
                      <select
                        value={r.attributedShipmentId ?? ''}
                        disabled={savingId === r.reimbursementId || !!r.attributedShipmentExternalId}
                        onChange={e => attribute(r, e.target.value || null)}
                        title={r.attributedShipmentExternalId ? 'Clear the external shipment id to pick one of our shipments' : undefined}
                        className={clsx('h-7 min-w-[13rem] rounded border px-2 text-xs bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400',
                          r.attributedShipmentId ? 'border-green-300' : 'border-amber-300')}
                      >
                        <option value="">— Unattributed —</option>
                        {opts.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.shipmentNumber ?? s.id.slice(-6)}{s.name ? ` · ${s.name}` : ''}{s.shipmentConfirmationId ? ` (${s.shipmentConfirmationId})` : ''}
                          </option>
                        ))}
                      </select>
                      {savingId === r.reimbursementId
                        ? <RefreshCcw size={13} className="animate-spin text-gray-400" />
                        : attributed
                          ? <Check size={14} className="text-green-600" />
                          : <Link2 size={13} className="text-amber-500" />}
                    </div>
                    {/* Free-text Amazon inbound id (FBA…) for shipments not in our system. */}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">or FBA id</span>
                      <input
                        type="text"
                        defaultValue={r.attributedShipmentExternalId ?? ''}
                        key={r.attributedShipmentExternalId ?? ''}
                        disabled={savingId === r.reimbursementId || !!r.attributedShipmentId}
                        placeholder="FBA…"
                        title={r.attributedShipmentId ? 'Clear the shipment selection to enter an external id' : 'Amazon inbound shipment id, e.g. FBA19Q63NMDM'}
                        onBlur={e => attributeExternal(r, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        className={clsx('h-7 w-40 rounded border px-2 text-xs font-mono bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400',
                          r.attributedShipmentExternalId ? 'border-green-300' : 'border-gray-200')}
                      />
                    </div>
                    {attributed && r.marketplaceName && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{r.marketplaceName}</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

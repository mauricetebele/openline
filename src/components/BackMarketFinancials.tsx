'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Upload, X, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react'

type Entry = {
  id: string
  invoice_key: string
  value_date: string | null
  order_id: string
  orderline_id: string | null
  sku: string | null
  designation: string | null
  amount: number
  currency: string | null
  statement_ref: string | null
}

type ImportResult = {
  statements: number
  rowsParsed: number
  rowsIgnored: number
  ordersInStatement: number
  ordersMatched: number
  itemsRepriced: number
  unmatchedCount: number
  corrections: { orderId: string; oldTotal: number; newTotal: number }[]
  unknownKeys: { invoiceKey: string; count: number; totalAmount: number; sampleOrderIds: string[] }[]
}

const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Friendly labels for invoice keys.
const KEY_LABEL: Record<string, string> = {
  sales: 'Sale',
  sales_fees: 'Commission',
  payment_fees: 'Payment fee',
  affirm_fees: 'Payment fee (Affirm)',
  paypal_fees: 'Payment fee (PayPal)',
  klarna_fees: 'Payment fee (Klarna)',
  ccbm_fees: 'Customer Care fee',
  deals_commission_discount: 'Commission discount',
  avoir_sales_fees: 'Commission refund',
  credit_requests: 'Credit request',
  refunds: 'Refund',
  monthly_fees: 'Monthly membership fee',
  sales_dp_adjustment: 'Adjustment (+)',
  dp_adjustment_fee: 'Adjustment (-)',
  dp_adjustment_fee_refund: 'Adjustment reversal',
}

export default function BackMarketFinancials() {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [amountSum, setAmountSum] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showImport, setShowImport] = useState(false)
  const pageSize = 100

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true); setErr('')
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) })
      if (q.trim()) params.set('search', q.trim())
      const res = await fetch(`/api/backmarket/billing-entries?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setRows(data.data); setTotal(data.total); setAmountSum(data.amountSum ?? 0)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1, search) }, 250)
    return () => clearTimeout(t)
  }, [search, load])

  useEffect(() => { load(page, search) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by order #, SKU, or type…"
            className="h-9 w-80 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        <div className="flex-1" />
        <div className="text-xs text-gray-500">
          {total.toLocaleString()} entr{total === 1 ? 'y' : 'ies'} · net {fmt(amountSum)}
        </div>
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 h-9 px-3 rounded-md bg-amazon-blue text-white text-sm font-medium hover:opacity-90"
        >
          <Upload size={14} /> Import Statement
        </button>
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={16} /> {err}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Order #</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Order Line #</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Type</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
              <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Date</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                {search ? 'No entries match your search.' : 'No billing entries yet — import a statement.'}
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 font-mono text-gray-800 whitespace-nowrap">{r.order_id || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-gray-500 whitespace-nowrap">{r.orderline_id ?? '—'}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className="text-gray-700" title={r.invoice_key}>{KEY_LABEL[r.invoice_key] ?? r.invoice_key}</span>
                </td>
                <td className="px-3 py-1.5 font-mono text-gray-500 max-w-[220px] truncate" title={r.designation ?? ''}>{r.sku ?? '—'}</td>
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{r.value_date ? new Date(r.value_date).toLocaleDateString() : '—'}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${r.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="h-8 px-3 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">Prev</button>
          <span className="text-gray-500">Page {page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="h-8 px-3 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); load(1, search); setPage(1) }} />}
    </div>
  )
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<{ name: string; csv: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? [])
    if (list.length === 0) return
    Promise.all(list.map(f => new Promise<{ name: string; csv: string }>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve({ name: f.name, csv: reader.result as string })
      reader.readAsText(f)
    }))).then(loaded => setFiles(prev => {
      const names = new Set(prev.map(p => p.name))
      return [...prev, ...loaded.filter(l => !names.has(l.name))]
    }))
    e.target.value = ''
  }

  async function run() {
    setSaving(true); setErr(''); setResult(null)
    try {
      const res = await fetch('/api/backmarket/import-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statements: files }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setResult(data as ImportResult)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-amazon-blue" />
            <h3 className="text-sm font-semibold text-gray-900">Import BackMarket Billing Statement</h3>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {result ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
                <CheckCircle2 size={16} />
                Imported {result.rowsParsed} entries from {result.statements} statement{result.statements === 1 ? '' : 's'} · {result.ordersMatched}/{result.ordersInStatement} orders matched · {result.itemsRepriced} item prices corrected
              </div>
              {result.unknownKeys.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                    <AlertTriangle size={16} /> Unknown transaction type{result.unknownKeys.length > 1 ? 's' : ''} found — not counted in profit
                  </div>
                  <p className="text-xs text-amber-700 mt-1">
                    These weren&apos;t recognised, so they were stored but excluded from the fee/profit figures. Tell me how each should be treated and I&apos;ll add it.
                  </p>
                  <div className="mt-2 space-y-1">
                    {result.unknownKeys.map(u => (
                      <div key={u.invoiceKey} className="flex items-center justify-between text-xs font-mono text-amber-900">
                        <span>{u.invoiceKey} <span className="text-amber-600">×{u.count}</span></span>
                        <span className="tabular-nums">{fmt(u.totalAmount)}{u.sampleOrderIds[0] ? ` · e.g. #${u.sampleOrderIds[0]}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.unmatchedCount > 0 && (
                <p className="text-xs text-gray-500">{result.unmatchedCount} order(s) aren&apos;t in the system — ignored for profitability, but their entries are stored and searchable in the Explorer.</p>
              )}
              {result.corrections.length > 0 && (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-500">Sale price corrections ({result.corrections.length})</div>
                  <div className="max-h-[280px] overflow-y-auto">
                    <table className="min-w-full text-xs">
                      <tbody className="divide-y divide-gray-100">
                        {result.corrections.map(c => (
                          <tr key={c.orderId}>
                            <td className="px-3 py-1.5 font-mono text-gray-700">{c.orderId}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-red-600 line-through">{fmt(c.oldTotal)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-green-700 font-medium">{fmt(c.newTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Upload the BackMarket billing statement CSV. Sale prices are set from the <code>sales</code> lines,
                and all fees (commission, payment, Customer Care, credits, net-zero adjustments) feed profitability.
                Refunds are stored but excluded from profitability for now. Re-importing the same file is safe.
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 h-9 px-3 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                  <Upload size={14} /> Choose CSV file(s)
                </button>
                {files.length > 0 && <span className="text-xs text-gray-500">{files.length} file{files.length === 1 ? '' : 's'} selected</span>}
                <input ref={fileRef} type="file" accept=".csv,.txt" multiple onChange={onFiles} className="hidden" />
              </div>
              {files.length > 0 && (
                <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {files.map(f => (
                    <div key={f.name} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="font-mono text-gray-600 truncate">{f.name}</span>
                      <button type="button" onClick={() => setFiles(prev => prev.filter(p => p.name !== f.name))}
                        className="text-gray-400 hover:text-red-500 shrink-0 ml-2"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              {err && <div className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle size={14} /> {err}</div>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0">
          {result ? (
            <button type="button" onClick={onDone} className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:opacity-90">Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={run} disabled={saving || files.length === 0}
                className="flex items-center gap-2 h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Import
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

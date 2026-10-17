'use client'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCcw, AlertCircle, ExternalLink } from 'lucide-react'

interface Row {
  orderId: string
  olmNumber: number | null
  shippedAt: string
  ageDays: number
  orderTotal: number | null
  currency: string
  shipToName: string | null
}

const money = (n: number | null, c: string) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: c || 'USD' }))
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export default function BmUnpaidOrders() {
  const [rows, setRows] = useState<Row[]>([])
  const [count, setCount] = useState(0)
  const [totalOutstanding, setTotalOutstanding] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true); setError(null)
    fetch('/api/bm-unpaid-orders')
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error ?? String(r.status)))))
      .then(d => { setRows(d.rows ?? []); setCount(d.count ?? 0); setTotalOutstanding(d.totalOutstanding ?? 0) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-lg bg-red-50 text-red-700 border border-red-200 px-3 py-1 font-semibold">{count} unpaid</span>
          <span className="rounded-lg bg-gray-50 text-gray-700 border border-gray-200 px-3 py-1 font-medium">{money(totalOutstanding, 'USD')} outstanding</span>
        </div>
        <button onClick={load} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCcw size={13} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-600"><AlertCircle size={14} /> {error}</div>
      )}

      <div className="flex-1 overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-800 text-gray-100 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">BM Order #</th>
              <th className="px-3 py-2 text-left font-semibold">OLM #</th>
              <th className="px-3 py-2 text-left font-semibold">Customer</th>
              <th className="px-3 py-2 text-left font-semibold">Shipped</th>
              <th className="px-3 py-2 text-right font-semibold">Age (days)</th>
              <th className="px-3 py-2 text-right font-semibold">Order Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400"><RefreshCcw size={16} className="animate-spin inline" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-400">No unpaid Back Market orders — every shipped order has a payment. 🎉</td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.orderId} className={clsx(i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/40', 'hover:bg-amber-50/50')}>
                <td className="px-3 py-1.5 font-mono">
                  <a href={`https://www.backmarket.com/bo_merchant/orders/${r.orderId}`} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 text-amazon-blue hover:underline">
                    {r.orderId} <ExternalLink size={10} />
                  </a>
                </td>
                <td className="px-3 py-1.5 font-medium">{r.olmNumber != null ? `OLM-${r.olmNumber}` : '—'}</td>
                <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{r.shipToName ?? '—'}</td>
                <td className="px-3 py-1.5 text-gray-500">{fmtDate(r.shippedAt)}</td>
                <td className={clsx('px-3 py-1.5 text-right font-semibold tabular-nums', r.ageDays >= 14 ? 'text-red-600' : r.ageDays >= 7 ? 'text-amber-600' : 'text-gray-500')}>
                  {r.ageDays}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.orderTotal, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

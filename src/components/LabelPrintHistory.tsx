'use client'
import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Search, Download, Loader2, Printer } from 'lucide-react'
import { clsx } from 'clsx'

interface Row {
  id: string
  timestamp: string
  orderType: string | null
  orderSource: string | null
  orderNumber: string | null
  orderId: string
  trackingNumber: string | null
  carrier: string | null
  serviceCode: string | null
  pieces: number | null
  printedBy: string
}

const TYPE_COLOR: Record<string, string> = {
  marketplace: 'bg-orange-100 text-orange-700',
  wholesale: 'bg-purple-100 text-purple-700',
}

export default function LabelPrintHistory() {
  const [rows, setRows] = useState<Row[]>([])
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })
  const [search, setSearch] = useState('')
  const [orderType, setOrderType] = useState<'' | 'marketplace' | 'wholesale'>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)

  const params = useCallback((page: number) => {
    const p = new URLSearchParams({ page: String(page), pageSize: '50' })
    if (search) p.set('search', search)
    if (orderType) p.set('orderType', orderType)
    if (startDate) p.set('startDate', startDate)
    if (endDate) p.set('endDate', endDate)
    return p
  }, [search, orderType, startDate, endDate])

  const fetchRows = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/label-print-history?${params(page)}`)
      if (res.ok) {
        const data = await res.json()
        setRows(data.data)
        setPagination({ page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total })
      }
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [params])

  useEffect(() => { const t = setTimeout(() => fetchRows(1), 250); return () => clearTimeout(t) }, [fetchRows])

  function exportCSV() {
    const p = params(1); p.set('export', 'csv'); p.delete('page'); p.delete('pageSize')
    window.open(`/api/label-print-history?${p}`, '_blank')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b bg-white">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-8 w-full"
            placeholder="Search order #, tracking, or who printed…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value as '' | 'marketplace' | 'wholesale')}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amazon-blue">
          <option value="">All types</option>
          <option value="marketplace">Marketplace</option>
          <option value="wholesale">Wholesale</option>
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} title="From"
          className="h-9 rounded-md border border-gray-300 px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amazon-blue" />
        <span className="text-gray-400 text-sm">–</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} title="To"
          className="h-9 rounded-md border border-gray-300 px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amazon-blue" />
        <button className="btn-ghost" onClick={exportCSV}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-gray-50 border-b z-10">
            <tr>
              {['Printed At', 'Type', 'Order #', 'Tracking', 'Carrier', 'Service', 'Boxes', 'Printed By'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400"><Loader2 size={16} className="animate-spin inline mr-1" /> Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400">No label prints found.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gray-600">{format(new Date(r.timestamp), 'MMM d, yyyy HH:mm:ss')}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize', TYPE_COLOR[r.orderType ?? ''] ?? 'bg-gray-100 text-gray-600')}>
                    {r.orderSource ?? r.orderType ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-900 whitespace-nowrap">{r.orderNumber ?? <span className="text-gray-300">{r.orderId}</span>}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-700 whitespace-nowrap">{r.trackingNumber ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{r.carrier ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{r.serviceCode ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 text-xs text-gray-600 text-center">{r.pieces ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 text-xs text-gray-700 whitespace-nowrap">{r.printedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t bg-white text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5"><Printer size={13} /> {pagination.total} label print{pagination.total !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          <button disabled={pagination.page <= 1 || loading} onClick={() => fetchRows(pagination.page - 1)}
            className="px-2.5 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">Prev</button>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <button disabled={pagination.page >= pagination.totalPages || loading} onClick={() => fetchRows(pagination.page + 1)}
            className="px-2.5 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">Next</button>
        </div>
      </div>
    </div>
  )
}

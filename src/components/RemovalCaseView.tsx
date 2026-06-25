'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { Search, AlertCircle } from 'lucide-react'

interface RemovalCase {
  id: string
  removalOrderId: string
  trackingNumber: string
  lpnNumber: string | null
  fnsku: string
  sellerSku: string
  productTitle: string | null
  note: string | null
  createdBy: { name: string } | null
  createdAt: string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RemovalCaseView() {
  const [cases, setCases] = useState<RemovalCase[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchCases = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/removal-cases?${params}`)
      const json = await res.json()
      setCases(json.data ?? [])
      setPagination(json.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 })
    } catch { /* ignore */ }
    setLoading(false)
  }, [search])

  useEffect(() => { fetchCases(1) }, [fetchCases])

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order ID, tracking #, SKU, note..."
            className="h-9 pl-8 pr-3 w-72 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        {pagination.total > 0 && (
          <span className="text-xs text-gray-400">
            {pagination.total} case{pagination.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
        ) : cases.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle size={36} className="mx-auto text-gray-200 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {search ? 'No cases match your search' : 'No removal cases created yet'}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Removal Order ID</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking #</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">LPN</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">FNSKU</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Merchant SKU</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Product Title</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Note</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Created By</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-100 whitespace-nowrap">Created At</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c, i) => (
                <tr
                  key={c.id}
                  className={`border-b border-gray-200 dark:border-gray-700 last:border-0 align-middle ${
                    i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'
                  }`}
                >
                  <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{c.removalOrderId}</td>
                  <td className="px-3 py-1.5 font-mono font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">{c.trackingNumber}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.lpnNumber || '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.fnsku}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap">{c.sellerSku}</td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-[200px] truncate" title={c.productTitle ?? ''}>{c.productTitle ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={c.note ?? ''}>{c.note || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.createdBy?.name ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="px-4 py-2 border-t bg-white dark:bg-gray-900 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
          <div className="flex gap-1">
            <button disabled={pagination.page <= 1} onClick={() => fetchCases(pagination.page - 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Prev</button>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchCases(pagination.page + 1)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

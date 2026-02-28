'use client'
import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Search, Download } from 'lucide-react'

interface AuditEvent {
  id: string
  timestamp: string
  action: string
  entityType: string
  entityId: string
  actorLabel: string
  before: unknown
  after: unknown
  refund: { orderId: string } | null
}

const ACTION_COLORS: Record<string, string> = {
  REVIEW_UPDATED: 'badge-blue',
  BULK_REVIEW_UPDATED: 'badge-blue',
  IMPORT_STARTED: 'badge-orange',
  IMPORT_COMPLETED: 'badge-green',
  IMPORT_FAILED: 'badge-red',
  REFUND_AMOUNT_CHANGED: 'badge-orange',
}

export default function AuditLog({ refundId }: { refundId?: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchEvents = useCallback(async (page = 1) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: '50' })
    if (search) params.set('search', search)
    if (refundId) params.set('refundId', refundId)
    const res = await fetch(`/api/audit?${params}`)
    if (res.ok) {
      const data = await res.json()
      setEvents(data.data)
      setPagination({ page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total })
    }
    setLoading(false)
  }, [search, refundId])

  useEffect(() => { fetchEvents(1) }, [fetchEvents])

  function exportCSV() {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (refundId) params.set('refundId', refundId)
    window.open(`/api/audit/export?${params}`, '_blank')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b bg-white">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-8"
            placeholder="Search actor, action, entity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn-ghost" onClick={exportCSV}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-gray-50 border-b">
            <tr>
              {['Timestamp', 'Action', 'Entity', 'Order ID', 'Actor', 'Before', 'After'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">Loading…</td></tr>
            )}
            {!loading && events.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">No audit events found.</td></tr>
            )}
            {!loading && events.map((evt) => (
              <tr key={evt.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                  {format(new Date(evt.timestamp), 'MMM d, yyyy HH:mm:ss')}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`badge ${ACTION_COLORS[evt.action] ?? 'badge-gray'} text-[10px]`}>
                    {evt.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{evt.entityType}</td>
                <td className="px-4 py-3 font-mono text-xs">{evt.refund?.orderId ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{evt.actorLabel}</td>
                <td className="px-4 py-3 text-xs text-gray-400 max-w-[160px] truncate">
                  {evt.before ? JSON.stringify(evt.before) : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">
                  {evt.after ? JSON.stringify(evt.after) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t bg-white text-sm text-gray-600">
        <span>{pagination.total} total events</span>
        <div className="flex items-center gap-2">
          <button className="btn-ghost py-1 px-3" disabled={pagination.page <= 1}
            onClick={() => fetchEvents(pagination.page - 1)}>Previous</button>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <button className="btn-ghost py-1 px-3" disabled={pagination.page >= pagination.totalPages}
            onClick={() => fetchEvents(pagination.page + 1)}>Next</button>
        </div>
      </div>
    </div>
  )
}

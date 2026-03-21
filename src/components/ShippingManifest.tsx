'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { detectCarrier, trackingUrl } from '@/lib/tracking-utils'

interface ManifestRow {
  id: string
  source: 'marketplace' | 'wholesale'
  olmNumber: number | null
  amazonOrderId: string | null
  orderRef: string | null
  customerName: string | null
  carrier: string | null
  serviceCode: string | null
  shipDate: string | null
  trackingNumber: string | null
}

interface TrackingInfo {
  status: string
  deliveredAt: string | null
  estimatedDelivery: string | null
}

type TrackingResult = TrackingInfo | { error: string }

const PAGE_SIZES = [25, 50, 100] as const

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function statusBadge(info: TrackingResult | undefined, loading: boolean) {
  if (loading) {
    return <Loader2 size={12} className="animate-spin text-gray-400" />
  }
  if (!info) return <span className="text-gray-400">—</span>

  if ('error' in info) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
        Error
      </span>
    )
  }

  const s = info.status.toLowerCase()
  if (s.includes('delivered')) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-200">
        {info.status}
      </span>
    )
  }
  if (s.includes('out for delivery')) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200">
        {info.status}
      </span>
    )
  }
  if (s.includes('in transit') || s.includes('on the way') || s.includes('picked up') || s.includes('label created')) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
        {info.status}
      </span>
    )
  }
  if (s.includes('cancel')) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 border border-red-200">
        {info.status}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
      {info.status}
    </span>
  )
}

export default function ShippingManifest() {
  const today = new Date().toISOString().slice(0, 10)

  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [rows, setRows] = useState<ManifestRow[]>([])
  const [loading, setLoading] = useState(false)
  const [trackingMap, setTrackingMap] = useState<Record<string, TrackingResult>>({})
  const [trackingLoading, setTrackingLoading] = useState<Set<string>>(new Set())

  // Pagination
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(25)

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const paged = rows.slice(page * pageSize, (page + 1) * pageSize)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setTrackingMap({})
    setPage(0)
    try {
      const res = await fetch(`/api/shipping-manifest?startDate=${startDate}&endDate=${endDate}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data: ManifestRow[] = await res.json()
      setRows(data)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  // Fetch on mount (today's orders)
  useEffect(() => { fetchOrders() }, [fetchOrders])

  // After rows load, batch-fetch UPS + FedEx tracking
  useEffect(() => {
    if (rows.length === 0) return

    const trackable = rows
      .map((r) => r.trackingNumber)
      .filter((tn): tn is string => {
        if (!tn) return false
        const c = detectCarrier(tn)
        return c === 'UPS' || c === 'FEDEX'
      })

    const unique = Array.from(new Set(trackable))
    if (unique.length === 0) return

    // Process in batches of 20
    const batches: string[][] = []
    for (let i = 0; i < unique.length; i += 20) {
      batches.push(unique.slice(i, i + 20))
    }

    setTrackingLoading(new Set(unique))

    batches.forEach(async (batch) => {
      try {
        const res = await fetch('/api/ups/batch-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackingNumbers: batch }),
        })
        if (!res.ok) return
        const data: { results: Record<string, TrackingResult> } = await res.json()
        setTrackingMap((prev) => ({ ...prev, ...data.results }))
      } catch { /* ignore */ }
      setTrackingLoading((prev) => {
        const next = new Set(prev)
        batch.forEach((tn) => next.delete(tn))
        return next
      })
    })
  }, [rows])

  function setQuickRange(daysBack: number) {
    const from = new Date()
    from.setDate(from.getDate() - daysBack)
    setStartDate(from.toISOString().slice(0, 10))
    setEndDate(today)
  }

  const quickFilters = [
    { label: 'Today', days: 0 },
    { label: 'Yesterday', days: 1 },
    { label: 'Last 3 Days', days: 3 },
    { label: 'Last 7 Days', days: 7 },
  ]

  function isQuickActive(days: number) {
    const from = new Date()
    from.setDate(from.getDate() - days)
    return startDate === from.toISOString().slice(0, 10) && endDate === today
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Live Shipping Manifest</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Track all shipped orders with live UPS and FedEx tracking status.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        {/* Quick pick buttons */}
        <div className="flex gap-1">
          {quickFilters.map(({ label, days }) => {
            const active = isQuickActive(days)
            return (
              <button
                key={label}
                onClick={() => setQuickRange(days)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                  active
                    ? 'bg-amazon-orange text-white border-amazon-orange'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-amazon-orange hover:text-amazon-orange dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:border-amazon-orange'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Custom date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input w-36"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            className="input w-36"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <button
          onClick={fetchOrders}
          className="px-3 py-1.5 text-xs rounded-lg border font-medium bg-amazon-blue text-white border-amazon-blue hover:bg-amazon-blue/90 transition-colors"
        >
          Apply
        </button>
        <button
          onClick={() => { setStartDate(today); setEndDate(today) }}
          className="px-3 py-1.5 text-xs rounded-lg border font-medium bg-white text-gray-600 border-gray-200 hover:border-gray-400 transition-colors dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600"
        >
          Reset
        </button>

        {/* Row count */}
        <span className="ml-auto text-xs text-gray-400">
          {rows.length} order{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">
            No shipped orders found for this date range.
          </div>
        ) : (
          <table className="w-full text-xs dark:text-gray-200">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Source</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Order #</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Carrier</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Service</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Ship Date</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking #</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Tracking Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((row, i) => {
                const carrier = row.trackingNumber ? detectCarrier(row.trackingNumber) : null
                const isTrackable = carrier === 'UPS' || carrier === 'FEDEX'
                const tLoading = row.trackingNumber ? trackingLoading.has(row.trackingNumber) : false
                const tInfo = row.trackingNumber ? trackingMap[row.trackingNumber] : undefined

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors align-middle ${
                      i % 2 === 0
                        ? 'bg-white hover:bg-blue-50/50 dark:bg-gray-900 dark:hover:bg-gray-800/70'
                        : 'bg-gray-50 hover:bg-blue-50/50 dark:bg-gray-800/50 dark:hover:bg-gray-800/70'
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      {row.source === 'wholesale' ? (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700 border border-orange-200">WS</span>
                      ) : (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200">MKT</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {row.source === 'wholesale' ? (
                        <span>
                          <span className="text-orange-600 font-medium">{row.orderRef}</span>
                          {row.customerName && <span className="text-gray-400 ml-1.5 font-sans">{row.customerName}</span>}
                        </span>
                      ) : (
                        <span>
                          {row.olmNumber ? <span className="text-gray-500 mr-1.5">OLM-{row.olmNumber}</span> : null}
                          {row.amazonOrderId}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{row.carrier || '—'}</td>
                    <td className="px-3 py-1.5">{row.serviceCode || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(row.shipDate)}</td>
                    <td className="px-3 py-1.5">
                      {row.trackingNumber ? (
                        <a
                          href={trackingUrl(row.trackingNumber)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {row.trackingNumber}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {isTrackable ? statusBadge(tInfo, tLoading) : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between px-6 py-2 border-t bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Rows per page:</span>
            <select
              className="input w-16 text-xs"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-500">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

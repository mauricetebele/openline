'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCcw, Loader2 } from 'lucide-react'
import { trackingUrl } from '@/lib/tracking-utils'
import { clsx } from 'clsx'

interface FreeReplacement {
  id: string
  accountId: string
  replacementOrderId: string
  originalOrderId: string
  asin: string
  title: string
  shippedAt: string | null
  returnTrackingNumber: string | null
  returnCarrierStatus: string | null
  returnDeliveredAt: string | null
  trackingUpdatedAt: string | null
  createdAt: string
}

function statusBadge(status: string | null) {
  if (!status) return <span className="text-gray-400 text-xs">--</span>
  const s = status.toLowerCase()
  const color = s.includes('delivered')
    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
    : s.includes('transit') || s.includes('out for')
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
      : s.includes('exception') || s.includes('delay')
        ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap', color)}>
      {status}
    </span>
  )
}

export default function FreeReplacementsManager() {
  const [data, setData] = useState<FreeReplacement[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/free-replacements?${params}`)
      const json = await res.json()
      setData(json.data ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [search])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleSync() {
    setSyncing(true)
    setMessage('')
    try {
      const res = await fetch('/api/free-replacements/sync', { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        try {
          const json = JSON.parse(text)
          setMessage(json.error ?? `Sync failed (HTTP ${res.status})`)
        } catch {
          setMessage(`Sync failed (HTTP ${res.status})`)
        }
        setSyncing(false)
        return
      }
      const json = await res.json()
      if (json.ok) {
        const debug = json.results?.[0]?.debug
        const debugStr = debug
          ? ` | DEBUG: ${debug.error ? 'ERROR: ' + debug.error : `${debug.totalOrdersFetched} orders fetched (${debug.lookbackDays}d), ${debug.replacementsFound} replacements found, fields=[${debug.sampleOrderKeys?.join(', ') ?? 'none'}]`}`
          : ' | NO DEBUG INFO'
        setMessage(`Sync complete: ${json.created} new, ${json.updated} updated, ${json.trackingRefreshed} tracking refreshed${debugStr}`)
        fetchData()
      } else {
        setMessage(json.error ?? json.message ?? 'Sync failed — check console for details')
      }
    } catch (err) {
      setMessage(`Sync request failed: ${err instanceof Error ? err.message : 'network error'}`)
    }
    setSyncing(false)
  }

  async function handleRefreshTracking() {
    setRefreshing(true)
    setMessage('')
    try {
      const res = await fetch('/api/free-replacements/refresh-tracking', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        setMessage(`Tracking refreshed for ${json.refreshed} records`)
        fetchData()
      } else {
        setMessage(json.error ?? 'Refresh failed')
      }
    } catch {
      setMessage('Refresh request failed')
    }
    setRefreshing(false)
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      <h1 className="text-lg font-bold mb-3 dark:text-white">Free Replacements</h1>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search order ID, ASIN, title..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        <span className="text-xs text-gray-500 dark:text-gray-400">{data.length} records</span>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
          Sync Now
        </button>

        <button
          onClick={handleRefreshTracking}
          disabled={refreshing}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
          Refresh Tracking
        </button>
      </div>

      {message && (
        <div className="mb-3 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
          {message}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading...
        </div>
      ) : data.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No free replacement orders found. Click "Sync Now" to fetch from Amazon.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Replacement Order</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">ASIN</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Title</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Original Order</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Shipped</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Return Tracking #</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Return Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={row.id}
                  className={clsx(
                    'border-b border-gray-100 dark:border-gray-700/50 hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
                    i % 2 === 1 && 'bg-gray-50/50 dark:bg-gray-800/30',
                  )}
                >
                  <td className="px-3 py-1.5 font-mono whitespace-nowrap">{row.replacementOrderId}</td>
                  <td className="px-3 py-1.5 font-mono whitespace-nowrap">{row.asin}</td>
                  <td className="px-3 py-1.5 max-w-[260px] truncate" title={row.title}>{row.title}</td>
                  <td className="px-3 py-1.5 font-mono whitespace-nowrap">{row.originalOrderId}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-500 dark:text-gray-400">
                    {row.shippedAt ? new Date(row.shippedAt).toLocaleDateString() : '--'}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {row.returnTrackingNumber ? (
                      <a
                        href={trackingUrl(row.returnTrackingNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline font-mono"
                      >
                        {row.returnTrackingNumber}
                      </a>
                    ) : (
                      <span className="text-gray-400">--</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{statusBadge(row.returnCarrierStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

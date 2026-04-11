'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown, ChevronUp, Package, Hash, Download,
  RotateCcw, Percent, ShoppingCart,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReturnRow {
  sku: string
  title: string
  grade: string | null
  channel: string
  unitsSold: number
  unitsReturned: number
  returnRate: number
  topReturnReason: string
}

interface Summary {
  unitsSold: number
  unitsReturned: number
  returnRate: number
  uniqueSkus: number
}

type SortKey = keyof ReturnRow
type SortDir = 'asc' | 'desc'

// ─── Helpers ────────────────────────────────────────────────────────────────

function sourceBadge(source: string) {
  switch (source) {
    case 'amazon':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">Amazon</span>
    case 'backmarket':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">BackMarket</span>
    case 'mixed':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Mixed</span>
    default:
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">{source}</span>
  }
}

function rateColor(rate: number) {
  if (rate < 5) return 'text-emerald-600 dark:text-emerald-400'
  if (rate <= 15) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function rateBgColor(rate: number) {
  if (rate < 5) return 'bg-emerald-500'
  if (rate <= 15) return 'bg-amber-500'
  return 'bg-red-500'
}

// ─── Summary Card ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, formatted, icon: Icon, color }: {
  label: string; value: number; formatted?: string; icon: React.ElementType; color: string
}) {
  return (
    <div className={clsx(
      'flex items-center gap-3 rounded-lg border px-4 py-3',
      'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700',
    )}>
      <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', color)}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className={clsx(
          'text-lg font-bold',
          label === 'Return Rate' ? rateColor(value) : 'text-gray-900 dark:text-gray-100',
        )}>
          {formatted ?? value.toLocaleString()}
        </p>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ReturnRatesReport() {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [channel, setChannel] = useState('all')
  const [groupByGrade, setGroupByGrade] = useState(false)
  const [skuInput, setSkuInput] = useState('')

  const [allRows, setAllRows] = useState<ReturnRow[]>([])
  const [summary, setSummary] = useState<Summary>({ unitsSold: 0, unitsReturned: 0, returnRate: 0, uniqueSkus: 0 })
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('returnRate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 50

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // Client-side SKU filter on fetched data
  const filteredRows = useMemo(() => {
    const q = skuInput.trim().toLowerCase()
    if (!q) return allRows
    return allRows.filter((r) => r.sku.toLowerCase().includes(q))
  }, [allRows, skuInput])

  // Recompute summary from filtered rows
  const displaySummary = useMemo(() => {
    const totalSold = filteredRows.reduce((s, r) => s + r.unitsSold, 0)
    const totalReturned = filteredRows.reduce((s, r) => s + r.unitsReturned, 0)
    return {
      unitsSold: totalSold,
      unitsReturned: totalReturned,
      returnRate: totalSold > 0 ? Math.round((totalReturned / totalSold) * 1000) / 10 : 0,
      uniqueSkus: filteredRows.length,
    }
  }, [filteredRows])

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? Number(av ?? 0) - Number(bv ?? 0) : Number(bv ?? 0) - Number(av ?? 0)
    })
    return sorted
  }, [filteredRows, sortKey, sortDir])

  const pagedRows = useMemo(() => {
    return sortedRows.slice((page - 1) * pageSize, page * pageSize)
  }, [sortedRows, page])

  const totalPages = Math.ceil(sortedRows.length / pageSize)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ startDate, endDate })
      if (channel !== 'all') params.set('channel', channel)
      if (groupByGrade) params.set('groupByGrade', 'true')
      const res = await fetch(`/api/return-rates?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setAllRows(data.rows ?? [])
      setSummary(data.summary ?? { unitsSold: 0, unitsReturned: 0, returnRate: 0, uniqueSkus: 0 })
    } catch {
      setAllRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, channel, groupByGrade])

  useEffect(() => { fetchData() }, [fetchData])

  // Reset page when SKU filter changes
  useEffect(() => { setPage(1) }, [skuInput])

  function setQuickRange(daysBack: number) {
    const from = new Date()
    from.setDate(from.getDate() - daysBack)
    setStartDate(from.toISOString().slice(0, 10))
    setEndDate(today)
    setPage(1)
  }

  function handleReset() {
    setStartDate(today)
    setEndDate(today)
    setChannel('all')
    setGroupByGrade(false)
    setSkuInput('')
    setPage(1)
  }

  function handleExport() {
    const params = new URLSearchParams({ startDate, endDate })
    if (channel !== 'all') params.set('channel', channel)
    if (groupByGrade) params.set('groupByGrade', 'true')
    window.open(`/api/return-rates/export?${params}`, '_blank')
  }

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: 'sku', label: 'SKU', align: 'left' },
    { key: 'title', label: 'Title', align: 'left' },
    ...(groupByGrade ? [{ key: 'grade' as SortKey, label: 'Grade', align: 'left' as string }] : []),
    { key: 'channel', label: 'Channel', align: 'left' },
    { key: 'unitsSold', label: 'Units Sold', align: 'right' },
    { key: 'unitsReturned', label: 'Units Returned', align: 'right' },
    { key: 'returnRate', label: 'Return Rate %', align: 'right' },
    { key: 'topReturnReason', label: 'Top Return Reason', align: 'left' },
  ]

  const s = displaySummary

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
        {/* Quick date buttons */}
        <div className="flex gap-1">
          {[
            { label: 'Today', days: 0 },
            { label: 'Last 7 Days', days: 7 },
            { label: 'Last 30 Days', days: 30 },
          ].map(({ label, days }) => {
            const from = new Date()
            from.setDate(from.getDate() - days)
            const isActive = startDate === from.toISOString().slice(0, 10) && endDate === today
            return (
              <button
                key={label}
                onClick={() => setQuickRange(days)}
                className={clsx(
                  'px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors',
                  isActive
                    ? 'bg-amazon-orange text-white border-amazon-orange'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-36"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-36"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
          />
        </div>

        {/* Channel dropdown */}
        <select
          value={channel}
          onChange={(e) => { setChannel(e.target.value); setPage(1) }}
          className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        >
          <option value="all">All Marketplace Channels</option>
          <option value="amazon">Amazon</option>
          <option value="backmarket">BackMarket</option>
        </select>

        {/* SKU search — real-time client-side filter */}
        <input
          type="text"
          placeholder="Search SKU..."
          value={skuInput}
          onChange={(e) => setSkuInput(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-40 placeholder:text-gray-400"
        />

        {/* Group by Grade toggle */}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={groupByGrade}
            onChange={(e) => { setGroupByGrade(e.target.checked); setPage(1) }}
            className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue"
          />
          Group by Grade
        </label>

        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Reset
        </button>

        <button
          onClick={handleExport}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-1.5"
        >
          <Download size={12} />
          Export CSV
        </button>

        {loading && <span className="text-xs text-gray-400 animate-pulse">Loading...</span>}
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 py-4 shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <SummaryCard label="Units Sold" value={s.unitsSold} formatted={s.unitsSold.toLocaleString()} icon={ShoppingCart} color="bg-blue-500" />
        <SummaryCard label="Units Returned" value={s.unitsReturned} formatted={s.unitsReturned.toLocaleString()} icon={RotateCcw} color="bg-orange-500" />
        <SummaryCard label="Return Rate" value={s.returnRate} formatted={`${s.returnRate}%`} icon={Percent} color={rateBgColor(s.returnRate)} />
        <SummaryCard label="Unique SKUs" value={s.uniqueSkus} formatted={s.uniqueSkus.toLocaleString()} icon={Hash} color="bg-cyan-500" />
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs dark:text-gray-200">
          <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
            <tr>
              {columns.map(({ key, label, align }) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={clsx(
                    'px-3 py-2.5 font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:text-white transition-colors',
                    align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {sortKey === key ? (
                      sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    ) : (
                      <ChevronDown size={12} className="opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 && !loading ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-12 text-center text-gray-400">
                  No data found for the selected filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((row, i) => {
                const stripeBg = i % 2 === 0
                  ? 'bg-white dark:bg-gray-900'
                  : 'bg-gray-50 dark:bg-gray-800/50'
                return (
                  <tr
                    key={`${row.sku}-${row.grade ?? ''}-${row.channel}`}
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors',
                      stripeBg,
                      'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono font-medium">{row.sku}</td>
                    <td className="px-3 py-1.5 max-w-[220px] truncate" title={row.title}>{row.title || '\u2014'}</td>
                    {groupByGrade && <td className="px-3 py-1.5">{row.grade || '\u2014'}</td>}
                    <td className="px-3 py-1.5">{sourceBadge(row.channel)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{row.unitsSold}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{row.unitsReturned}</td>
                    <td className={clsx('px-3 py-1.5 text-right font-semibold', rateColor(row.returnRate))}>
                      {row.returnRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-1.5 max-w-[180px] truncate" title={row.topReturnReason}>
                      {row.topReturnReason || '\u2014'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0 text-xs">
        <span className="text-gray-500 dark:text-gray-400">
          {sortedRows.length} SKUs
          {totalPages > 1 && <> &middot; Page {page} of {totalPages}</>}
        </span>
        {totalPages > 1 && (
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

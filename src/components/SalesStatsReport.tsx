'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown, ChevronUp, DollarSign, TrendingUp, TrendingDown,
  Package, Wrench, Hash, Download,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface StatsRow {
  sku: string
  title: string
  channel: string
  unitsSold: number
  revenue: number
  cogs: number
  commission: number
  shipping: number
  costCodes: number
  profit: number
  margin: number
}

interface Summary {
  revenue: number
  unitsSold: number
  cogs: number
  commission: number
  shipping: number
  costCodes: number
  profit: number
}

interface Customer {
  id: string
  companyName: string
}

type SortKey = keyof StatsRow
type SortDir = 'asc' | 'desc'

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function sourceBadge(source: string) {
  switch (source) {
    case 'amazon':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">Amazon</span>
    case 'backmarket':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">BackMarket</span>
    case 'wholesale':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">Wholesale</span>
    case 'mixed':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Mixed</span>
    default:
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">{source}</span>
  }
}

function profitColor(val: number) {
  if (val > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (val < 0) return 'text-red-600 dark:text-red-400'
  return 'text-gray-500'
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
          label === 'Net Profit' ? profitColor(value) : 'text-gray-900 dark:text-gray-100',
        )}>
          {formatted ?? fmt.format(value)}
        </p>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function SalesStatsReport() {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [channel, setChannel] = useState('all')
  const [customerId, setCustomerId] = useState('')
  const [skuInput, setSkuInput] = useState('')
  const [includeFba, setIncludeFba] = useState(false)

  const [rows, setRows] = useState<StatsRow[]>([])
  const [summary, setSummary] = useState<Summary>({ revenue: 0, unitsSold: 0, cogs: 0, commission: 0, shipping: 0, costCodes: 0, profit: 0 })
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Wholesale customers for filter dropdown
  const [customers, setCustomers] = useState<Customer[]>([])
  useEffect(() => {
    fetch('/api/wholesale/customers?active=true')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.data) setCustomers(d.data.map((c: Customer) => ({ id: c.id, companyName: c.companyName })))
      })
      .catch(() => {})
  }, [])

  // Disable customer filter when not wholesale
  const customerDisabled = channel === 'amazon' || channel === 'backmarket'
  useEffect(() => { if (customerDisabled) setCustomerId('') }, [customerDisabled])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av)
    })
    return sorted
  }, [rows, sortKey, sortDir])

  const pagedRows = useMemo(() => {
    return sortedRows.slice((page - 1) * pageSize, page * pageSize)
  }, [sortedRows, page])

  const totalPages = Math.ceil(sortedRows.length / pageSize)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ startDate, endDate })
      if (channel !== 'all') params.set('channel', channel)
      if (customerId) params.set('customerId', customerId)
      if (skuInput.trim()) params.set('sku', skuInput.trim())
      if (includeFba) params.set('includeFba', 'true')
      const res = await fetch(`/api/sales-stats?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setRows(data.rows ?? [])
      setSummary(data.summary ?? { revenue: 0, unitsSold: 0, cogs: 0, commission: 0, shipping: 0, costCodes: 0, profit: 0 })
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, channel, customerId, skuInput, includeFba])

  useEffect(() => { fetchData() }, [fetchData])

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
    setCustomerId('')
    setSkuInput('')
    setIncludeFba(false)
    setPage(1)
  }

  function handleExport() {
    const params = new URLSearchParams({ startDate, endDate })
    if (channel !== 'all') params.set('channel', channel)
    if (customerId) params.set('customerId', customerId)
    if (skuInput.trim()) params.set('sku', skuInput.trim())
    if (includeFba) params.set('includeFba', 'true')
    window.open(`/api/sales-stats/export?${params}`, '_blank')
  }

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: 'sku', label: 'SKU', align: 'left' },
    { key: 'title', label: 'Title', align: 'left' },
    { key: 'channel', label: 'Channel', align: 'left' },
    { key: 'unitsSold', label: 'Units Sold', align: 'right' },
    { key: 'revenue', label: 'Revenue', align: 'right' },
    { key: 'cogs', label: 'COGS', align: 'right' },
    { key: 'commission', label: 'Commission', align: 'right' },
    { key: 'shipping', label: 'Shipping', align: 'right' },
    { key: 'costCodes', label: 'Cost Codes', align: 'right' },
    { key: 'profit', label: 'Profit', align: 'right' },
    { key: 'margin', label: 'Margin %', align: 'right' },
  ]

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
          <option value="all">All Channels</option>
          <option value="amazon">Amazon</option>
          <option value="backmarket">BackMarket</option>
          <option value="wholesale">Wholesale</option>
        </select>

        {/* Customer dropdown */}
        <select
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value); setPage(1) }}
          disabled={customerDisabled}
          className={clsx(
            'px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100',
            customerDisabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          <option value="">All Customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </select>

        {/* SKU filter */}
        <input
          type="text"
          placeholder="Filter by SKU..."
          value={skuInput}
          onChange={(e) => setSkuInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); fetchData() } }}
          className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-40 placeholder:text-gray-400"
        />

        {/* Include FBA toggle */}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeFba}
            onChange={(e) => { setIncludeFba(e.target.checked); setPage(1) }}
            className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue"
          />
          Include FBA
        </label>

        <button
          onClick={() => { setPage(1); fetchData() }}
          className="px-3 py-1.5 text-xs rounded-lg bg-amazon-blue text-white font-medium hover:bg-blue-700 transition-colors"
        >
          Apply
        </button>

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
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 px-6 py-4 shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <SummaryCard label="Revenue" value={summary.revenue} icon={DollarSign} color="bg-blue-500" />
        <SummaryCard label="Units Sold" value={summary.unitsSold} formatted={summary.unitsSold.toLocaleString()} icon={Hash} color="bg-cyan-500" />
        <SummaryCard label="COGS" value={summary.cogs} icon={Package} color="bg-gray-500" />
        <SummaryCard label="Commission" value={summary.commission} icon={TrendingDown} color="bg-orange-500" />
        <SummaryCard label="Shipping" value={summary.shipping} icon={Package} color="bg-indigo-500" />
        <SummaryCard label="Cost Codes" value={summary.costCodes} icon={Wrench} color="bg-amber-500" />
        <SummaryCard
          label="Net Profit"
          value={summary.profit}
          icon={summary.profit >= 0 ? TrendingUp : TrendingDown}
          color={summary.profit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}
        />
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
                    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
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
                <td colSpan={11} className="px-6 py-12 text-center text-gray-400">
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
                    key={row.sku}
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors',
                      stripeBg,
                      'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono font-medium">{row.sku}</td>
                    <td className="px-3 py-1.5 max-w-[220px] truncate" title={row.title}>{row.title || '—'}</td>
                    <td className="px-3 py-1.5">{sourceBadge(row.channel)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{row.unitsSold}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{fmt.format(row.revenue)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(row.cogs)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(row.commission)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(row.shipping)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(row.costCodes)}</td>
                    <td className={clsx('px-3 py-1.5 text-right font-semibold', profitColor(row.profit))}>
                      {fmt.format(row.profit)}
                    </td>
                    <td className={clsx('px-3 py-1.5 text-right font-medium', profitColor(row.margin))}>
                      {row.margin.toFixed(1)}%
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

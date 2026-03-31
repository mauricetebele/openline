'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown, ChevronUp, DollarSign, TrendingUp, TrendingDown, Package, Wrench,
  Search, X,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface SkuRow {
  sellerSku: string
  productName: string
  grade: string
  unitsSold: number
  avgSalePrice: number
  avgUnitCost: number
  avgCostCode: number
  avgCommission: number
  avgFbaFee: number
  avgProfit: number
  totalRevenue: number
  totalCogs: number
  totalCostCodes: number
  totalCommissions: number
  totalFbaFees: number
  totalProfit: number
  margin: number
}

interface OrderRow {
  orderId: string
  olmNumber: number | null
  amazonOrderId: string
  orderDate: string
  sellerSku: string
  productName: string
  grade: string
  salePrice: number
  cogs: number
  costCode: number
  commission: number
  fbaFee: number
  profit: number
  margin: number
}

interface Summary {
  totalRevenue: number
  totalCogs: number
  totalCommissions: number
  totalFbaFees: number
  totalCostCodes: number
  totalProfit: number
  profitMargin: number
}

type ViewMode = 'sku' | 'order'
type SortDir = 'asc' | 'desc'

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function profitColor(val: number) {
  if (val > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (val < 0) return 'text-red-600 dark:text-red-400'
  return 'text-gray-500'
}

// ─── Summary Card ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, color, isProfit }: {
  label: string; value: number; icon: React.ElementType; color: string; isProfit?: boolean
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
        <p className={clsx('text-lg font-bold', isProfit ? profitColor(value) : 'text-gray-900 dark:text-gray-100')}>
          {fmt.format(value)}
        </p>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function FbaSalesReport() {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [rows, setRows] = useState<(SkuRow | OrderRow)[]>([])
  const [summary, setSummary] = useState<Summary>({ totalRevenue: 0, totalCogs: 0, totalCommissions: 0, totalFbaFees: 0, totalCostCodes: 0, totalProfit: 0, profitMargin: 0 })
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<string>('totalProfit')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [pageSize, setPageSize] = useState(100)
  const [viewMode, setViewMode] = useState<ViewMode>('sku')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aRec = a as unknown as Record<string, unknown>
      const bRec = b as unknown as Record<string, unknown>
      let av: string | number = (aRec[sortKey] as string | number) ?? ''
      let bv: string | number = (bRec[sortKey] as string | number) ?? ''
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      av = Number(av); bv = Number(bv)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [rows, sortKey, sortDir])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        startDate, endDate, page: String(page), pageSize: String(pageSize), view: viewMode,
      })
      if (searchQuery) params.set('search', searchQuery)
      const res = await fetch(`/api/fba-sales-report?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setRows(data.rows ?? [])
      setSummary(data.summary ?? { totalRevenue: 0, totalCogs: 0, totalCommissions: 0, totalFbaFees: 0, totalCostCodes: 0, totalProfit: 0, profitMargin: 0 })
      setTotalCount(data.totalCount ?? 0)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, page, pageSize, viewMode, searchQuery])

  useEffect(() => { fetchData() }, [fetchData])

  function setQuickRange(daysBack: number) {
    const from = new Date()
    from.setDate(from.getDate() - daysBack)
    setStartDate(from.toISOString().slice(0, 10))
    setEndDate(today)
    setPage(1)
  }

  function handleViewChange(mode: ViewMode) {
    setViewMode(mode)
    setSortKey(mode === 'sku' ? 'totalProfit' : 'orderDate')
    setSortDir('desc')
    setPage(1)
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      setSearchQuery(searchInput)
      setPage(1)
    }
  }

  function clearSearch() {
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  const skuColumns: { key: string; label: string; align: string }[] = [
    { key: 'sellerSku', label: 'Seller SKU', align: 'left' },
    { key: 'productName', label: 'Product', align: 'left' },
    { key: 'grade', label: 'Grade', align: 'left' },
    { key: 'unitsSold', label: 'Units Sold', align: 'right' },
    { key: 'avgSalePrice', label: 'Avg Sale Price', align: 'right' },
    { key: 'avgUnitCost', label: 'Avg Unit Cost', align: 'right' },
    { key: 'avgCostCode', label: 'Avg Cost Code', align: 'right' },
    { key: 'avgCommission', label: 'Avg Commission', align: 'right' },
    { key: 'avgFbaFee', label: 'Avg FBA Fee', align: 'right' },
    { key: 'avgProfit', label: 'Avg Profit', align: 'right' },
    { key: 'totalProfit', label: 'Total Profit', align: 'right' },
    { key: 'margin', label: 'Margin %', align: 'right' },
  ]

  const orderColumns: { key: string; label: string; align: string }[] = [
    { key: 'amazonOrderId', label: 'Order ID', align: 'left' },
    { key: 'olmNumber', label: 'OLM #', align: 'left' },
    { key: 'orderDate', label: 'Date', align: 'left' },
    { key: 'sellerSku', label: 'SKU', align: 'left' },
    { key: 'salePrice', label: 'Sale Price', align: 'right' },
    { key: 'cogs', label: 'COGS', align: 'right' },
    { key: 'costCode', label: 'Cost Code', align: 'right' },
    { key: 'commission', label: 'Commission', align: 'right' },
    { key: 'fbaFee', label: 'FBA Fee', align: 'right' },
    { key: 'profit', label: 'Profit', align: 'right' },
    { key: 'margin', label: 'Margin %', align: 'right' },
  ]

  const columns = viewMode === 'sku' ? skuColumns : orderColumns

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
        <div className="flex gap-1">
          {[
            { label: 'Today', days: 0 },
            { label: 'This Week', days: 7 },
            { label: 'This Month', days: 30 },
            { label: 'Last 90 Days', days: 90 },
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

        <button
          onClick={() => { setPage(1); fetchData() }}
          className="px-3 py-1.5 text-xs rounded-lg bg-amazon-blue text-white font-medium hover:bg-blue-700 transition-colors"
        >
          Apply
        </button>

        <button
          onClick={() => { setStartDate(today); setEndDate(today); setSearchInput(''); setSearchQuery(''); setPage(1); setViewMode('sku') }}
          className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Reset
        </button>

        {/* View toggle */}
        <div className="flex gap-1 ml-2">
          <button
            onClick={() => handleViewChange('sku')}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors',
              viewMode === 'sku'
                ? 'bg-amazon-orange text-white border-amazon-orange'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400',
            )}
          >
            By SKU
          </button>
          <button
            onClick={() => handleViewChange('order')}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors',
              viewMode === 'order'
                ? 'bg-amazon-orange text-white border-amazon-orange'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400',
            )}
          >
            By Order
          </button>
        </div>

        {/* Search input */}
        <div className="relative ml-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search SKU, product, order..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-56 placeholder:text-gray-400"
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {loading && <span className="text-xs text-gray-400 animate-pulse">Loading...</span>}
      </div>

      {/* ── Net Margin ────────────────────────────────────────────────────── */}
      {summary.totalRevenue !== 0 && (
        <div className="flex items-center gap-3 px-6 py-3 shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
          <div className={clsx(
            'flex items-center gap-2 rounded-lg border px-4 py-2.5',
            'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700',
          )}>
            <span className="text-xs text-gray-500 dark:text-gray-400">FBA Profit Margin</span>
            <span className={clsx('text-lg font-bold', profitColor(summary.totalProfit))}>
              {summary.profitMargin.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 px-6 py-4 shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <SummaryCard label="Total Revenue" value={summary.totalRevenue} icon={DollarSign} color="bg-blue-500" />
        <SummaryCard label="Total COGS" value={summary.totalCogs} icon={Package} color="bg-gray-500" />
        <SummaryCard label="Commissions" value={summary.totalCommissions} icon={TrendingDown} color="bg-red-500" />
        <SummaryCard label="FBA Fees" value={summary.totalFbaFees} icon={TrendingDown} color="bg-orange-500" />
        <SummaryCard label="Cost Codes" value={summary.totalCostCodes} icon={Wrench} color="bg-amber-500" />
        <SummaryCard
          label="Total Profit"
          value={summary.totalProfit}
          icon={summary.totalProfit >= 0 ? TrendingUp : TrendingDown}
          color={summary.totalProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}
          isProfit
        />
        <div className={clsx(
          'flex items-center gap-3 rounded-lg border px-4 py-3',
          'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700',
        )}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-purple-500">
            <TrendingUp size={18} className="text-white" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Margin %</p>
            <p className={clsx('text-lg font-bold', profitColor(summary.totalProfit))}>
              {summary.profitMargin.toFixed(1)}%
            </p>
          </div>
        </div>
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
            {sortedRows.length === 0 && !loading ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-12 text-center text-gray-400">
                  {searchQuery
                    ? 'No results match your search.'
                    : 'No FBA orders found for this date range.'}
                </td>
              </tr>
            ) : viewMode === 'sku' ? (
              sortedRows.map((row, i) => {
                const r = row as SkuRow
                const stripeBg = i % 2 === 0
                  ? 'bg-white dark:bg-gray-900'
                  : 'bg-gray-50 dark:bg-gray-800/50'
                return (
                  <tr
                    key={r.sellerSku}
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors',
                      stripeBg,
                      'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono text-[11px]">{r.sellerSku}</td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate" title={r.productName}>{r.productName}</td>
                    <td className="px-3 py-1.5">{r.grade || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{r.unitsSold}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.avgSalePrice)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.avgUnitCost)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.avgCostCode)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.avgCommission)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.avgFbaFee)}</td>
                    <td className={clsx('px-3 py-1.5 text-right font-medium', profitColor(r.avgProfit))}>
                      {fmt.format(r.avgProfit)}
                    </td>
                    <td className={clsx('px-3 py-1.5 text-right font-semibold', profitColor(r.totalProfit))}>
                      {fmt.format(r.totalProfit)}
                    </td>
                    <td className={clsx('px-3 py-1.5 text-right font-semibold', profitColor(r.margin))}>
                      {r.margin.toFixed(1)}%
                    </td>
                  </tr>
                )
              })
            ) : (
              sortedRows.map((row, i) => {
                const r = row as OrderRow
                const stripeBg = i % 2 === 0
                  ? 'bg-white dark:bg-gray-900'
                  : 'bg-gray-50 dark:bg-gray-800/50'
                return (
                  <tr
                    key={`${r.orderId}:${r.sellerSku}:${i}`}
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors',
                      stripeBg,
                      'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono text-[11px]">{r.amazonOrderId}</td>
                    <td className="px-3 py-1.5 font-medium">
                      {r.olmNumber ? `OLM-${r.olmNumber}` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{formatDate(r.orderDate)}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{r.sellerSku}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{fmt.format(r.salePrice)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.cogs)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.costCode)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.commission)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt.format(r.fbaFee)}</td>
                    <td className={clsx('px-3 py-1.5 text-right font-semibold', profitColor(r.profit))}>
                      {fmt.format(r.profit)}
                    </td>
                    <td className={clsx('px-3 py-1.5 text-right font-semibold', profitColor(r.margin))}>
                      {r.margin.toFixed(1)}%
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
          {totalCount} {viewMode === 'sku' ? 'SKUs' : 'items'}
          {searchQuery && ' (filtered)'}
          {totalPages > 1 && <> &middot; Page {page} of {totalPages}</>}
        </span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
              className="h-7 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 text-xs"
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {totalPages > 1 && (
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

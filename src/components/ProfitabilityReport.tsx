'use client'

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown, ChevronRight, DollarSign, TrendingUp, TrendingDown, Package,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProfitRow {
  id: string
  olmNumber: number | null
  marketplaceOrderId: string
  source: string
  orderDate: string
  saleValue: number
  totalCogs: number
  commission: number
  shippingCost: number
  netProfit: number
  commissionSynced: boolean
}

interface Summary {
  totalRevenue: number
  totalCogs: number
  totalCommission: number
  totalShipping: number
  totalNetProfit: number
}

interface LineItem {
  id: string
  orderItemId: string
  asin: string | null
  sellerSku: string | null
  title: string | null
  quantity: number
  saleValue: number
  cogs: number
  commission: number
  shipping: number
  netProfit: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function sourceBadge(source: string) {
  switch (source) {
    case 'amazon':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">Amazon</span>
    case 'backmarket':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">BackMarket</span>
    case 'wholesale':
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">Wholesale</span>
    default:
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">{source}</span>
  }
}

function profitColor(val: number) {
  if (val > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (val < 0) return 'text-red-600 dark:text-red-400'
  return 'text-gray-500'
}

// ─── Expandable Row ─────────────────────────────────────────────────────────

function ExpandableRow({ row, index }: { row: ProfitRow; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function toggle() {
    if (!expanded && !loaded) {
      setLoading(true)
      try {
        const res = await fetch(`/api/profitability/${row.id}?source=${row.source}`)
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setLineItems(data.lineItems ?? [])
        setLoaded(true)
      } catch {
        setLineItems([])
      } finally {
        setLoading(false)
      }
    }
    setExpanded((e) => !e)
  }

  const stripeBg = index % 2 === 0
    ? 'bg-white dark:bg-gray-900'
    : 'bg-gray-50 dark:bg-gray-800/50'

  return (
    <>
      <tr
        onClick={toggle}
        className={clsx(
          'border-b border-gray-200 dark:border-gray-700 last:border-0 cursor-pointer transition-colors',
          stripeBg,
          'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
        )}
      >
        <td className="px-2 py-1.5 w-8">
          {expanded
            ? <ChevronDown size={12} className="text-gray-400" />
            : <ChevronRight size={12} className="text-gray-400" />}
        </td>
        <td className="px-3 py-1.5 font-medium">
          {row.olmNumber ? `OLM-${row.olmNumber}` : '—'}
        </td>
        <td className="px-3 py-1.5 font-mono text-[11px]">
          {row.marketplaceOrderId}
        </td>
        <td className="px-3 py-1.5">{sourceBadge(row.source)}</td>
        <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{formatDate(row.orderDate)}</td>
        <td className="px-3 py-1.5 text-right font-medium">{fmt.format(row.saleValue)}</td>
        <td className="px-3 py-1.5 text-right">{fmt.format(row.totalCogs)}</td>
        <td className="px-3 py-1.5 text-right">
          {row.commissionSynced
            ? fmt.format(row.commission)
            : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">Not synced</span>}
        </td>
        <td className="px-3 py-1.5 text-right">{fmt.format(row.shippingCost)}</td>
        <td className={clsx('px-3 py-1.5 text-right font-semibold', profitColor(row.netProfit))}>
          {fmt.format(row.netProfit)}
        </td>
      </tr>

      {/* Expanded line items */}
      {expanded && (
        <tr className="border-b border-gray-200 dark:border-gray-700">
          <td colSpan={10} className="p-0">
            <div className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2">
              {loading ? (
                <p className="text-xs text-gray-400 py-3 text-center">Loading line items...</p>
              ) : lineItems.length === 0 ? (
                <p className="text-xs text-gray-400 py-3 text-center">No line items found</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 dark:text-gray-400">
                      <th className="px-2 py-1 text-left font-medium">SKU</th>
                      <th className="px-2 py-1 text-left font-medium">Title</th>
                      <th className="px-2 py-1 text-center font-medium">Qty</th>
                      <th className="px-2 py-1 text-right font-medium">Sale</th>
                      <th className="px-2 py-1 text-right font-medium">COGS</th>
                      <th className="px-2 py-1 text-right font-medium">Commission</th>
                      <th className="px-2 py-1 text-right font-medium">Shipping</th>
                      <th className="px-2 py-1 text-right font-medium">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li) => (
                      <tr key={li.id} className="border-t border-gray-200 dark:border-gray-700">
                        <td className="px-2 py-1.5 font-mono">{li.sellerSku ?? li.asin ?? '—'}</td>
                        <td className="px-2 py-1.5 max-w-[200px] truncate" title={li.title ?? ''}>
                          {li.title ?? '—'}
                        </td>
                        <td className="px-2 py-1.5 text-center">{li.quantity}</td>
                        <td className="px-2 py-1.5 text-right">{fmt.format(li.saleValue)}</td>
                        <td className="px-2 py-1.5 text-right">{fmt.format(li.cogs)}</td>
                        <td className="px-2 py-1.5 text-right">{fmt.format(li.commission)}</td>
                        <td className="px-2 py-1.5 text-right">{fmt.format(li.shipping)}</td>
                        <td className={clsx('px-2 py-1.5 text-right font-semibold', profitColor(li.netProfit))}>
                          {fmt.format(li.netProfit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Summary Card ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.ElementType; color: string
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
        <p className={clsx('text-lg font-bold', label === 'Net Profit' ? profitColor(value) : 'text-gray-900 dark:text-gray-100')}>
          {fmt.format(value)}
        </p>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ProfitabilityReport() {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [rows, setRows] = useState<ProfitRow[]>([])
  const [summary, setSummary] = useState<Summary>({ totalRevenue: 0, totalCogs: 0, totalCommission: 0, totalShipping: 0, totalNetProfit: 0 })
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const pageSize = 50

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/profitability?startDate=${startDate}&endDate=${endDate}&page=${page}&pageSize=${pageSize}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setRows(data.rows ?? [])
      setSummary(data.summary ?? { totalRevenue: 0, totalCogs: 0, totalCommission: 0, totalShipping: 0, totalNetProfit: 0 })
      setTotalCount(data.totalCount ?? 0)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, page])

  useEffect(() => { fetchData() }, [fetchData])

  function setQuickRange(daysBack: number) {
    const from = new Date()
    from.setDate(from.getDate() - daysBack)
    setStartDate(from.toISOString().slice(0, 10))
    setEndDate(today)
    setPage(1)
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
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

        {loading && <span className="text-xs text-gray-400 animate-pulse">Loading...</span>}
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-6 py-4 shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <SummaryCard label="Total Revenue" value={summary.totalRevenue} icon={DollarSign} color="bg-blue-500" />
        <SummaryCard label="Total COGS" value={summary.totalCogs} icon={Package} color="bg-gray-500" />
        <SummaryCard label="Total Fees" value={summary.totalCommission} icon={TrendingDown} color="bg-orange-500" />
        <SummaryCard label="Shipping" value={summary.totalShipping} icon={Package} color="bg-indigo-500" />
        <SummaryCard
          label="Net Profit"
          value={summary.totalNetProfit}
          icon={summary.totalNetProfit >= 0 ? TrendingUp : TrendingDown}
          color={summary.totalNetProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}
        />
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs dark:text-gray-200">
          <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
            <tr>
              <th className="px-2 py-2.5 w-8" />
              <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">OLM #</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Marketplace #</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Source</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap">Ship Date</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Sale Value</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">COGS</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Commission</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Shipping</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-100 whitespace-nowrap">Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                  No shipped orders found for this date range.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <ExpandableRow key={row.id} row={row} index={i} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            {totalCount} orders &middot; Page {page} of {totalPages}
          </span>
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
        </div>
      )}
    </div>
  )
}

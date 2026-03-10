'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface POLineRow {
  id: string
  poNumber: number
  sku: string
  description: string
  grade: string | null
  qty: number
  unitCost: number
  costCodeId: string | null
  costCodeName: string | null
  costCodeAmount: number | null
  date: string
}

interface CostCode {
  id: string
  name: string
  amount: number
}

type SortKey = 'poNumber' | 'sku' | 'description' | 'grade' | 'qty' | 'unitCost' | 'costCodeName' | 'date'
type SortDir = 'asc' | 'desc'

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function POLineItemsReport() {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [rows, setRows] = useState<POLineRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [costCodes, setCostCodes] = useState<CostCode[]>([])
  const [bulkCostCodeId, setBulkCostCodeId] = useState('')
  const [assigning, setAssigning] = useState(false)

  // Fetch cost codes once
  useEffect(() => {
    fetch('/api/cost-codes?active=true')
      .then((r) => r.json())
      .then((d) => setCostCodes(d.data ?? []))
      .catch(() => {})
  }, [])

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
    return sorted
  }, [rows, sortKey, sortDir])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        startDate, endDate, page: String(page), pageSize: String(pageSize),
      })
      if (searchQuery) params.set('search', searchQuery)
      const res = await fetch(`/api/po-line-items?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setRows(data.rows ?? [])
      setTotalCount(data.totalCount ?? 0)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, page, pageSize, searchQuery])

  useEffect(() => { fetchData() }, [fetchData])

  // Clear selection when data changes
  useEffect(() => { setSelectedIds(new Set()) }, [rows])

  function setQuickRange(daysBack: number) {
    const from = new Date()
    from.setDate(from.getDate() - daysBack)
    setStartDate(from.toISOString().slice(0, 10))
    setEndDate(today)
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

  // ─── Selection helpers ──────────────────────────────────────────────────

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === sortedRows.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedRows.map((r) => r.id)))
    }
  }

  // ─── Bulk actions ─────────────────────────────────────────────────────

  async function bulkAssign(costCodeId: string | null) {
    if (selectedIds.size === 0) return
    setAssigning(true)
    try {
      const res = await fetch('/api/po-line-items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineIds: Array.from(selectedIds), costCodeId }),
      })
      if (!res.ok) throw new Error('Failed')
      await fetchData()
    } catch {
      // silently fail
    } finally {
      setAssigning(false)
    }
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: 'poNumber', label: 'PO #', align: 'left' },
    { key: 'sku', label: 'SKU', align: 'left' },
    { key: 'description', label: 'Description', align: 'left' },
    { key: 'grade', label: 'Grade', align: 'left' },
    { key: 'qty', label: 'Qty', align: 'center' },
    { key: 'unitCost', label: 'Unit Cost', align: 'right' },
    { key: 'costCodeName', label: 'Cost Code', align: 'left' },
    { key: 'date', label: 'Date', align: 'left' },
  ]

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

        {/* Search input */}
        <div className="relative ml-2">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search PO #, SKU..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-52 placeholder:text-gray-400"
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

      {/* ── Bulk action bar ─────────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-6 py-2.5 border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 shrink-0">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
            {selectedIds.size} line item{selectedIds.size > 1 ? 's' : ''} selected
          </span>

          <select
            value={bulkCostCodeId}
            onChange={(e) => setBulkCostCodeId(e.target.value)}
            className="h-7 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 text-xs"
          >
            <option value="">Select cost code...</option>
            {costCodes.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name} ({fmt.format(Number(cc.amount))})
              </option>
            ))}
          </select>

          <button
            disabled={!bulkCostCodeId || assigning}
            onClick={() => bulkAssign(bulkCostCodeId)}
            className="px-3 py-1.5 text-xs rounded-lg bg-amazon-blue text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            {assigning ? 'Assigning...' : 'Assign'}
          </button>

          <button
            disabled={assigning}
            onClick={() => bulkAssign(null)}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            Clear Cost Code
          </button>

          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-1"
          >
            Deselect All
          </button>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs dark:text-gray-200">
          <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
            <tr>
              <th className="px-2 py-2.5 w-8">
                <input
                  type="checkbox"
                  checked={sortedRows.length > 0 && selectedIds.size === sortedRows.length}
                  onChange={toggleAll}
                  className="rounded border-gray-400"
                />
              </th>
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
                <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                  {searchQuery
                    ? 'No results match your search.'
                    : 'No PO line items found for this date range.'}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, i) => {
                const stripeBg = i % 2 === 0
                  ? 'bg-white dark:bg-gray-900'
                  : 'bg-gray-50 dark:bg-gray-800/50'
                return (
                  <tr
                    key={row.id}
                    className={clsx(
                      'border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors',
                      stripeBg,
                      'hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
                    )}
                  >
                    <td className="px-2 py-1.5 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-3 py-1.5 font-medium">PO-{row.poNumber}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{row.sku}</td>
                    <td className="px-3 py-1.5 max-w-[220px] truncate" title={row.description}>
                      {row.description}
                    </td>
                    <td className="px-3 py-1.5">{row.grade ?? '—'}</td>
                    <td className="px-3 py-1.5 text-center">{row.qty}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{fmt.format(row.unitCost)}</td>
                    <td className="px-3 py-1.5">
                      {row.costCodeName ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          {row.costCodeName} ({fmt.format(row.costCodeAmount!)})
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
                      {formatDate(row.date)}
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
          {totalCount} line items
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
    </div>
  )
}

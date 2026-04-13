'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Search, ArrowUpDown, Package } from 'lucide-react'
import GradeBadge from './GradeBadge'
import ClientNoteEditor from './ClientNoteEditor'

interface InventoryRow {
  sku: string
  description: string
  grade: string | null
  gradeDescription: string | null
  location: string
  warehouse: string
  warehouseId: string
  locationId: string
  gradeId: string | null
  available: number
}

type SortKey = 'sku' | 'description' | 'grade' | 'location' | 'warehouse' | 'available'
type SortDir = 'asc' | 'desc'

export default function ClientInventoryView() {
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('sku')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const fetchInventory = useCallback(async (q?: string, grade?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('search', q)
      if (grade) params.set('gradeId', grade)
      const res = await fetch(`/api/client/inventory?${params}`)
      if (res.ok) {
        const json = await res.json()
        setRows(json.data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchInventory() }, [fetchInventory])

  function handleSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchInventory(value, gradeFilter), 400)
  }

  function handleGradeChange(value: string) {
    setGradeFilter(value)
    fetchInventory(search, value)
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Derive unique grades for the filter dropdown
  const grades = Array.from(new Map(rows.filter(r => r.grade && r.gradeId).map(r => [r.gradeId!, { id: r.gradeId!, grade: r.grade! }])).values())
    .sort((a, b) => a.grade.localeCompare(b.grade))

  const sorted = [...rows].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av).localeCompare(String(bv)) * mul
  })

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    const active = sortKey === field
    return (
      <th
        className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors"
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <ArrowUpDown size={12} className={active ? 'text-amazon-blue' : 'text-gray-300'} />
        </span>
      </th>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left panel — Notes */}
        <div className="w-full lg:w-[350px] lg:shrink-0">
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-3rem)] lg:flex lg:flex-col">
            <ClientNoteEditor />
          </div>
        </div>

        {/* Right panel — Inventory */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Package size={22} className="text-amazon-blue" />
                Inventory
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {loading ? 'Loading...' : `${sorted.length} items available`}
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by SKU or description..."
                  value={search}
                  onChange={e => handleSearchChange(e.target.value)}
                  className="input pl-9 w-full"
                />
              </div>
              <select
                value={gradeFilter}
                onChange={e => handleGradeChange(e.target.value)}
                className="input w-auto min-w-[120px]"
              >
                <option value="">All Grades</option>
                <option value="none">No Grade</option>
                {grades.map(g => (
                  <option key={g.id} value={g.id}>{g.grade}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <SortHeader label="SKU" field="sku" />
                    <SortHeader label="Description" field="description" />
                    <SortHeader label="Grade" field="grade" />
                    <SortHeader label="Location" field="location" />
                    <SortHeader label="Warehouse" field="warehouse" />
                    <SortHeader label="Available" field="available" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                        Loading inventory...
                      </td>
                    </tr>
                  ) : sorted.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                        {search ? 'No items match your search' : 'No inventory available'}
                      </td>
                    </tr>
                  ) : (
                    sorted.map((row, i) => (
                      <tr key={`${row.sku}-${row.locationId}-${row.gradeId}-${i}`} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900 whitespace-nowrap">
                          {row.sku}
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-xs whitespace-normal break-words">
                          {row.description}
                        </td>
                        <td className="px-4 py-3">
                          {row.grade ? <GradeBadge grade={row.grade} /> : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.location}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.warehouse}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900 text-right tabular-nums">
                          {row.available}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

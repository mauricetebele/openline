'use client'

import { useState, useMemo, useRef } from 'react'
import { Upload, Search, X, FileSpreadsheet, Trash2 } from 'lucide-react'

interface LegacySerial {
  productSku: string
  serial: string
  vendor: string
  receivedDate: string
  cost: number | null
  poCode: string
  _file: string // source filename for reference
}

const PAGE_SIZES = [25, 50, 100, 200] as const

function parseCSV(text: string, fileName: string): LegacySerial[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // Parse header to find column indices
  const header = lines[0].split(',').map(h => h.trim().toLowerCase())
  const idx = {
    productSku: header.indexOf('product_sku'),
    serial: header.indexOf('serial'),
    vendor: header.indexOf('vendor'),
    receivedDate: header.indexOf('received_date'),
    cost: header.indexOf('cost'),
    poCode: header.indexOf('po_unique_code'),
  }

  const rows: LegacySerial[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 2) continue
    rows.push({
      productSku: cols[idx.productSku]?.trim() ?? '',
      serial: cols[idx.serial]?.trim() ?? '',
      vendor: cols[idx.vendor]?.trim() ?? '',
      receivedDate: cols[idx.receivedDate]?.trim() ?? '',
      cost: idx.cost >= 0 && cols[idx.cost]?.trim() ? Number(cols[idx.cost].trim()) : null,
      poCode: cols[idx.poCode]?.trim() ?? '',
      _file: fileName,
    })
  }
  return rows
}

function fmtCost(v: number | null) {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

type SortKey = 'productSku' | 'serial' | 'vendor' | 'receivedDate' | 'cost' | 'poCode'

export default function LegacyPOLibrary() {
  const [records, setRecords] = useState<LegacySerial[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(50)
  const [sortBy, setSortBy] = useState<SortKey>('receivedDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortDir('asc') }
  }

  function sortIcon(key: SortKey) {
    if (sortBy !== key) return '↕'
    return sortDir === 'asc' ? '↑' : '↓'
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    setImporting(true)
    const newRecords: LegacySerial[] = []
    const newFiles: string[] = []

    for (const file of Array.from(fileList)) {
      if (files.includes(file.name)) continue // skip already-loaded files
      const text = await file.text()
      const parsed = parseCSV(text, file.name)
      newRecords.push(...parsed)
      newFiles.push(file.name)
    }

    if (newRecords.length > 0) {
      setRecords(prev => [...prev, ...newRecords])
      setFiles(prev => [...prev, ...newFiles])
      setPage(0)
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeFile(fileName: string) {
    setRecords(prev => prev.filter(r => r._file !== fileName))
    setFiles(prev => prev.filter(f => f !== fileName))
    setPage(0)
  }

  function clearAll() {
    setRecords([])
    setFiles([])
    setSearch('')
    setPage(0)
  }

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let result = records
    if (q) {
      result = records.filter(r =>
        r.serial.toLowerCase().includes(q) ||
        r.productSku.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q) ||
        r.poCode.toLowerCase().includes(q)
      )
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      const ak = a[sortBy]
      const bk = b[sortBy]
      if (ak == null && bk == null) cmp = 0
      else if (ak == null) cmp = -1
      else if (bk == null) cmp = 1
      else if (typeof ak === 'number' && typeof bk === 'number') cmp = ak - bk
      else cmp = String(ak).localeCompare(String(bk))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [records, search, sortBy, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const thClass = 'px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Legacy PO Data</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Upload CSV exports from the previous system to search serial numbers and PO history.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        {/* Upload */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border font-medium bg-amazon-blue text-white border-amazon-blue hover:bg-amazon-blue/90 transition-colors disabled:opacity-50"
        >
          <Upload size={13} />
          {importing ? 'Importing…' : 'Upload CSV'}
        </button>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search serial, SKU, vendor, PO…"
            className="h-8 pl-8 pr-8 w-72 rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-800 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          {search && (
            <button onClick={() => { setSearch(''); setPage(0) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Stats */}
        <span className="text-xs text-gray-400">
          {filtered.length.toLocaleString()} record{filtered.length !== 1 ? 's' : ''}
          {search && ` matching "${search}"`}
          {records.length !== filtered.length && ` of ${records.length.toLocaleString()} total`}
        </span>

        <div className="flex-1" />

        {/* Loaded files */}
        {files.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {files.map(f => (
              <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] text-gray-600 dark:text-gray-300">
                <FileSpreadsheet size={10} />
                {f}
                <button onClick={() => removeFile(f)} className="text-gray-400 hover:text-red-500 ml-0.5" title="Remove this file">
                  <X size={10} />
                </button>
              </span>
            ))}
            <button onClick={clearAll} className="text-[10px] text-red-500 hover:text-red-700 ml-1" title="Clear all data">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Upload size={36} className="mb-3 text-gray-200" />
            <p className="text-sm font-medium">No data loaded</p>
            <p className="text-xs mt-1">Upload one or more CSV files to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">
            No records match your search.
          </div>
        ) : (
          <table className="w-full text-xs dark:text-gray-200">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th onClick={() => handleSort('serial')} className={thClass}>
                  <span className="inline-flex items-center gap-1">Serial
                    <span className={sortBy === 'serial' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('serial')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('productSku')} className={thClass}>
                  <span className="inline-flex items-center gap-1">SKU
                    <span className={sortBy === 'productSku' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('productSku')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('vendor')} className={thClass}>
                  <span className="inline-flex items-center gap-1">Vendor
                    <span className={sortBy === 'vendor' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('vendor')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('poCode')} className={thClass}>
                  <span className="inline-flex items-center gap-1">PO Code
                    <span className={sortBy === 'poCode' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('poCode')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('receivedDate')} className={thClass}>
                  <span className="inline-flex items-center gap-1">Received
                    <span className={sortBy === 'receivedDate' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('receivedDate')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('cost')} className={`${thClass} text-right`}>
                  <span className="inline-flex items-center justify-end gap-1">Cost
                    <span className={sortBy === 'cost' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('cost')}</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => (
                <tr key={`${r.serial}-${r.poCode}-${i}`}
                  className={`border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors align-middle ${
                    i % 2 === 0
                      ? 'bg-white hover:bg-blue-50/50 dark:bg-gray-900 dark:hover:bg-gray-800/70'
                      : 'bg-gray-50 hover:bg-blue-50/50 dark:bg-gray-800/50 dark:hover:bg-gray-800/70'
                  }`}
                >
                  <td className="px-3 py-2 font-mono font-medium text-gray-900 dark:text-gray-100">{r.serial || '—'}</td>
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{r.productSku || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.vendor || '—'}</td>
                  <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{r.poCode || '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.receivedDate || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800 dark:text-gray-200">{fmtCost(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between px-6 py-2 border-t bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Rows per page:</span>
            <select
              className="h-6 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-800 px-1 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}
            >
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-500">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
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

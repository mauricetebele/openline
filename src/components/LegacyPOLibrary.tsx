'use client'

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react'
import { Upload, Search, X, FileSpreadsheet, Trash2, ChevronRight } from 'lucide-react'

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

function parseDate(s: string): number {
  if (!s) return 0
  const t = new Date(s).getTime()
  return isNaN(t) ? 0 : t
}

function fmtCost(v: number | null) {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

interface POLine {
  sku: string
  qty: number
  totalCost: number
  serials: LegacySerial[]
}

interface POGroup {
  poCode: string
  vendor: string
  receivedDate: string
  totalQty: number
  totalAmount: number
  lines: POLine[]
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
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [viewMode, setViewMode] = useState<'serial' | 'po'>('serial')
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set())
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadFromDb = useCallback(async () => {
    try {
      const res = await fetch('/api/legacy-po')
      if (!res.ok) return
      const { data } = await res.json()
      if (!Array.isArray(data) || data.length === 0) return
      const loaded: LegacySerial[] = data.map((r: Record<string, unknown>) => ({
        productSku: (r.productSku as string) ?? '',
        serial: (r.serial as string) ?? '',
        vendor: (r.vendor as string) ?? '',
        receivedDate: (r.receivedDate as string) ?? '',
        cost: (r.cost as number | null) ?? null,
        poCode: (r.poCode as string) ?? '',
        _file: (r.fileName as string) ?? '',
      }))
      setRecords(loaded)
      const uniqueFiles = Array.from(new Set(loaded.map(r => r._file).filter(Boolean)))
      setFiles(uniqueFiles)
    } catch {
      // silent — user can still upload manually
    }
  }, [])

  useEffect(() => {
    loadFromDb().finally(() => setLoading(false))
  }, [loadFromDb])

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
      // persist to DB in chunks — sequential to avoid connection limits
      const CHUNK = 500
      let saved = 0
      for (let i = 0; i < newRecords.length; i += CHUNK) {
        try {
          const res = await fetch('/api/legacy-po', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: newRecords.slice(i, i + CHUNK) }),
          })
          if (res.ok) {
            const json = await res.json()
            saved += json.upserted ?? 0
          } else {
            console.error(`legacy-po chunk ${i} failed: ${res.status}`, await res.text())
          }
        } catch (err) {
          console.error(`legacy-po chunk ${i} network error:`, err)
        }
      }
      console.log(`legacy-po: saved ${saved} of ${newRecords.length} records`)
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeFile(fileName: string) {
    setRecords(prev => prev.filter(r => r._file !== fileName))
    setFiles(prev => prev.filter(f => f !== fileName))
    setPage(0)
    fetch('/api/legacy-po', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
    }).catch(() => {})
  }

  function clearAll() {
    setRecords([])
    setFiles([])
    setSearch('')
    setPage(0)
    fetch('/api/legacy-po', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {})
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
      else if (sortBy === 'receivedDate') cmp = parseDate(String(ak)) - parseDate(String(bk))
      else cmp = String(ak).localeCompare(String(bk))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [records, search, sortBy, sortDir])

  // PO-level aggregation for PO Line View
  const poGroups = useMemo(() => {
    const map = new Map<string, { records: LegacySerial[] }>()
    for (const r of filtered) {
      const key = r.poCode || '(no PO)'
      if (!map.has(key)) map.set(key, { records: [] })
      map.get(key)!.records.push(r)
    }
    const groups: POGroup[] = []
    map.forEach(({ records: recs }, poCode) => {
      const first = recs[0]
      // Group by SKU within PO
      const skuMap = new Map<string, LegacySerial[]>()
      for (const r of recs) {
        const sk = r.productSku || '(no SKU)'
        if (!skuMap.has(sk)) skuMap.set(sk, [])
        skuMap.get(sk)!.push(r)
      }
      const lines: POLine[] = Array.from(skuMap.entries()).map(([sku, serials]) => ({
        sku,
        qty: serials.length,
        totalCost: serials.reduce((sum: number, r: LegacySerial) => sum + (r.cost ?? 0), 0),
        serials,
      }))
      groups.push({
        poCode,
        vendor: first.vendor,
        receivedDate: first.receivedDate,
        totalQty: recs.length,
        totalAmount: recs.reduce((sum: number, r: LegacySerial) => sum + (r.cost ?? 0), 0),
        lines,
      })
    })
    // Sort PO groups by receivedDate desc (newest first)
    groups.sort((a, b) => parseDate(b.receivedDate) - parseDate(a.receivedDate))
    return groups
  }, [filtered])

  const totalItems = viewMode === 'serial' ? filtered.length : poGroups.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)
  const pagedPOs = poGroups.slice(page * pageSize, (page + 1) * pageSize)

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

        {/* View Toggle */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
          <button
            onClick={() => { setViewMode('serial'); setPage(0) }}
            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
              viewMode === 'serial'
                ? 'bg-amazon-blue text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Serial View
          </button>
          <button
            onClick={() => { setViewMode('po'); setPage(0); setExpandedPOs(new Set()); setExpandedSkus(new Set()) }}
            className={`px-2.5 py-1 text-[11px] font-medium border-l border-gray-200 dark:border-gray-600 transition-colors ${
              viewMode === 'po'
                ? 'bg-amazon-blue text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            PO Line View
          </button>
        </div>

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
          {viewMode === 'po'
            ? `${poGroups.length.toLocaleString()} PO${poGroups.length !== 1 ? 's' : ''} (${filtered.length.toLocaleString()} records)`
            : `${filtered.length.toLocaleString()} record${filtered.length !== 1 ? 's' : ''}`}
          {search && ` matching "${search}"`}
          {records.length !== filtered.length && ` of ${records.length.toLocaleString()} total`}
        </span>

        <div className="flex-1" />

        {/* Data Source Files — dropdown-style panel */}
        {files.length > 0 && (
          <div className="relative group">
            <button className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <FileSpreadsheet size={12} />
              {files.length} file{files.length !== 1 ? 's' : ''} loaded
            </button>
            <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block min-w-[220px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Data Source Files</span>
              </div>
              <div className="py-1">
                {files.map(f => (
                  <div key={f} className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300 truncate">
                      <FileSpreadsheet size={11} className="shrink-0 text-gray-400" />
                      {f}
                    </span>
                    <button onClick={() => removeFile(f)} className="shrink-0 text-gray-300 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors" title="Remove this file">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-gray-400 animate-pulse">
            Loading saved PO data…
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <Upload size={36} className="mb-3 text-gray-200" />
            <p className="text-sm font-medium">No data loaded</p>
            <p className="text-xs mt-1">Upload one or more CSV files to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">
            No records match your search.
          </div>
        ) : viewMode === 'serial' ? (
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
        ) : (
          /* PO Line View — accordion table */
          <table className="w-full text-xs dark:text-gray-200">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th className={`${thClass} w-8`} />
                <th className={thClass}>PO #</th>
                <th className={thClass}>Vendor</th>
                <th className={`${thClass} text-right`}>Total Qty</th>
                <th className={`${thClass} text-right`}>Total $</th>
                <th className={thClass}>Received</th>
              </tr>
            </thead>
            <tbody>
              {pagedPOs.map((po, pi) => {
                const poExpanded = expandedPOs.has(po.poCode)
                return (
                  <Fragment key={po.poCode}>
                    {/* Level 1 — PO row */}
                    <tr
                      onClick={() => setExpandedPOs(prev => {
                        const next = new Set(prev)
                        if (next.has(po.poCode)) next.delete(po.poCode)
                        else next.add(po.poCode)
                        return next
                      })}
                      className={`border-b border-gray-200 dark:border-gray-700 cursor-pointer transition-colors align-middle ${
                        pi % 2 === 0
                          ? 'bg-white hover:bg-blue-50/50 dark:bg-gray-900 dark:hover:bg-gray-800/70'
                          : 'bg-gray-50 hover:bg-blue-50/50 dark:bg-gray-800/50 dark:hover:bg-gray-800/70'
                      }`}
                    >
                      <td className="px-3 py-2 text-gray-400">
                        <ChevronRight size={14} className={`transition-transform ${poExpanded ? 'rotate-90' : ''}`} />
                      </td>
                      <td className="px-3 py-2 font-mono font-medium text-gray-900 dark:text-gray-100">{po.poCode}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{po.vendor || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{po.totalQty}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800 dark:text-gray-200">{fmtCost(po.totalAmount)}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{po.receivedDate || '—'}</td>
                    </tr>

                    {/* Level 2 — SKU line items */}
                    {poExpanded && po.lines.map(line => {
                      const skuKey = `${po.poCode}::${line.sku}`
                      const skuExpanded = expandedSkus.has(skuKey)
                      return (
                        <Fragment key={skuKey}>
                          <tr
                            onClick={() => setExpandedSkus(prev => {
                              const next = new Set(prev)
                              if (next.has(skuKey)) next.delete(skuKey)
                              else next.add(skuKey)
                              return next
                            })}
                            className="border-b border-gray-100 dark:border-gray-700/50 cursor-pointer bg-gray-50/50 dark:bg-gray-800/30 hover:bg-blue-50/30 dark:hover:bg-gray-700/40 transition-colors"
                          >
                            <td className="px-3 py-1.5 pl-8 text-gray-400">
                              <ChevronRight size={12} className={`transition-transform ${skuExpanded ? 'rotate-90' : ''}`} />
                            </td>
                            <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300" colSpan={2}>{line.sku}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{line.qty}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmtCost(line.totalCost)}</td>
                            <td />
                          </tr>

                          {/* Level 3 — Serial rows */}
                          {skuExpanded && line.serials.map((sr, si) => (
                            <tr
                              key={`${skuKey}-${si}`}
                              className="border-b border-gray-100/50 dark:border-gray-700/30 bg-gray-50/30 dark:bg-gray-800/20"
                            >
                              <td />
                              <td className="px-3 py-1 pl-14 font-mono text-[11px] text-gray-500 dark:text-gray-400" colSpan={3}>
                                {sr.serial || '—'}
                              </td>
                              <td className="px-3 py-1 text-right tabular-nums text-[11px] text-gray-500 dark:text-gray-400">{fmtCost(sr.cost)}</td>
                              <td />
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination + Clear All */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between px-6 py-2 border-t bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0 text-xs">
          <div className="flex items-center gap-4">
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
            <span className="text-gray-200 dark:text-gray-600">|</span>
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-red-500 font-medium">Delete all {records.length.toLocaleString()} records?</span>
                <button
                  onClick={() => { clearAll(); setConfirmClear(false) }}
                  className="px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
                >
                  Yes, clear all
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1 text-gray-400 hover:text-red-500 transition-colors"
                title="Clear all data"
              >
                <Trash2 size={11} />
                <span>Clear all data</span>
              </button>
            )}
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

'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Upload, Search, X, FileText, Trash2 } from 'lucide-react'

interface InvoiceRecord {
  orderId: string
  sku: string
  serial: string
  _file: string
}

const PAGE_SIZES = [25, 50, 100, 200] as const

type SortKey = 'orderId' | 'sku' | 'serial'

async function extractPagesFromPDF(data: ArrayBuffer): Promise<string[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pages.push(content.items.map((item: any) => (item as { str?: string }).str ?? '').join(' '))
  }
  return pages
}

function parseInvoiceText(text: string, fileName: string): InvoiceRecord[] {
  // Extract Invoice # (Amazon order ID pattern: xxx-xxxxxxx-xxxxxxx)
  const orderMatch = text.match(/(\d{3}-\d{7}-\d{7})/)
  const orderId = orderMatch?.[1] ?? ''

  // Extract SKU(s) and serial(s) from the SERIAL # DETAILS section
  // Format: SKU on one line, then serial number(s) below it
  // Also grab SKU from the line items table as fallback
  const records: InvoiceRecord[] = []

  // Look for SERIAL # DETAILS BY SKU section
  const serialSectionMatch = text.match(/SERIAL\s*#?\s*DETAILS\s*BY\s*SKU[:\s]*([\s\S]*?)(?:POWERED BY|$)/i)
  if (serialSectionMatch) {
    const section = serialSectionMatch[1]
    // SKU lines look like: IPAD-AIR611-256-GRAY-CELL-B
    // Serial lines are numeric: 353974990345273
    // There can be multiple serials per SKU
    const parts = section.split(/\n/).map(l => l.trim()).filter(Boolean)
    let currentSku = ''
    for (const part of parts) {
      // SKU pattern: contains letters, dashes, possibly numbers — but is NOT purely numeric
      if (/^[A-Z0-9].*-/.test(part) && !/^\d+$/.test(part)) {
        currentSku = part
      } else if (/^\d{10,}$/.test(part.replace(/\s/g, ''))) {
        // Serial number — long numeric string
        records.push({
          orderId,
          sku: currentSku,
          serial: part.replace(/\s/g, ''),
          _file: fileName,
        })
      }
    }
  }

  // If no serial section found but we have an order, try to find SKU from the table
  if (records.length === 0 && orderId) {
    // Try to find SKU from text — look for SKU-like patterns (letters-numbers-letters with dashes)
    const skuMatches = text.match(/\b([A-Z][A-Z0-9]+-[A-Z0-9-]+[A-Z0-9])\b/g)
    const skus = skuMatches ? Array.from(new Set(skuMatches)).filter(s => s.length > 5) : []
    // Try to find any serial-like numbers (10+ digit numbers)
    const serialMatches = text.match(/\b(\d{10,})\b/g)
    // Filter out things that look like order IDs, UPCs, tracking numbers
    const serials = serialMatches?.filter(s => {
      if (s === orderId.replace(/-/g, '')) return false
      if (s.startsWith('1Z')) return false // tracking
      return true
    }) ?? []

    if (skus.length > 0) {
      if (serials.length > 0) {
        for (const serial of serials) {
          records.push({ orderId, sku: skus[0], serial, _file: fileName })
        }
      } else {
        records.push({ orderId, sku: skus[0], serial: '', _file: fileName })
      }
    } else if (orderId) {
      records.push({ orderId, sku: '', serial: '', _file: fileName })
    }
  }

  return records
}

export default function LegacyInvoiceLibrary() {
  const [records, setRecords] = useState<InvoiceRecord[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(50)
  const [sortBy, setSortBy] = useState<SortKey>('orderId')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

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
    const newRecords: InvoiceRecord[] = []
    const newFiles: string[] = []
    const pdfFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf'))

    for (let i = 0; i < pdfFiles.length; i++) {
      const file = pdfFiles[i]
      if (files.includes(file.name)) continue
      setImportProgress(`Processing ${i + 1} of ${pdfFiles.length}: ${file.name}`)
      try {
        const buffer = await file.arrayBuffer()
        const pages = await extractPagesFromPDF(buffer)
        for (const pageText of pages) {
          const parsed = parseInvoiceText(pageText, file.name)
          newRecords.push(...parsed)
        }
        newFiles.push(file.name)
      } catch (err) {
        console.error(`Failed to parse ${file.name}:`, err)
      }
    }

    if (newRecords.length > 0) {
      setRecords(prev => [...prev, ...newRecords])
      setFiles(prev => [...prev, ...newFiles])
      setPage(0)
    }
    setImporting(false)
    setImportProgress('')
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let result = records
    if (q) {
      result = records.filter(r =>
        r.orderId.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.serial.toLowerCase().includes(q)
      )
    }
    result = [...result].sort((a, b) => {
      const ak = a[sortBy]
      const bk = b[sortBy]
      const cmp = String(ak).localeCompare(String(bk))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [records, search, sortBy, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const thClass = 'px-3 py-2.5 text-left font-semibold text-gray-100 whitespace-nowrap cursor-pointer select-none hover:bg-gray-700 transition-colors'

  if (!mounted) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Legacy Invoice Data</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Upload invoice PDFs from the previous system to search orders, SKUs, and serial numbers.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b bg-white dark:bg-gray-900 dark:border-gray-700 shrink-0">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
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
          {importing ? 'Processing…' : 'Upload PDFs'}
        </button>

        {importing && importProgress && (
          <span className="text-xs text-gray-500 animate-pulse">{importProgress}</span>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search order #, SKU, serial…"
            className="h-8 pl-8 pr-8 w-72 rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-800 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          {search && (
            <button onClick={() => { setSearch(''); setPage(0) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>

        <span className="text-xs text-gray-400">
          {filtered.length.toLocaleString()} record{filtered.length !== 1 ? 's' : ''}
          {search && ` matching "${search}"`}
          {records.length !== filtered.length && ` of ${records.length.toLocaleString()} total`}
        </span>

        <div className="flex-1" />

        {files.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap max-w-[50%]">
            <span className="text-[10px] text-gray-400 shrink-0">{files.length} file{files.length !== 1 ? 's' : ''}</span>
            {files.length <= 5 && files.map(f => (
              <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] text-gray-600 dark:text-gray-300 max-w-[200px]">
                <FileText size={10} className="shrink-0" />
                <span className="truncate">{f}</span>
                <button onClick={() => removeFile(f)} className="text-gray-400 hover:text-red-500 ml-0.5 shrink-0" title="Remove">
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
            <FileText size={36} className="mb-3 text-gray-200" />
            <p className="text-sm font-medium">No invoices loaded</p>
            <p className="text-xs mt-1">Upload one or more invoice PDF files to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-gray-400">
            No records match your search.
          </div>
        ) : (
          <table className="w-full text-xs dark:text-gray-200">
            <thead className="sticky top-0 bg-gray-800 border-b-2 border-gray-700 z-10">
              <tr>
                <th onClick={() => handleSort('orderId')} className={thClass}>
                  <span className="inline-flex items-center gap-1">Order #
                    <span className={sortBy === 'orderId' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('orderId')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('sku')} className={thClass}>
                  <span className="inline-flex items-center gap-1">SKU
                    <span className={sortBy === 'sku' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('sku')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('serial')} className={thClass}>
                  <span className="inline-flex items-center gap-1">Serial #
                    <span className={sortBy === 'serial' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('serial')}</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => (
                <tr key={`${r.orderId}-${r.serial}-${i}`}
                  className={`border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors align-middle ${
                    i % 2 === 0
                      ? 'bg-white hover:bg-blue-50/50 dark:bg-gray-900 dark:hover:bg-gray-800/70'
                      : 'bg-gray-50 hover:bg-blue-50/50 dark:bg-gray-800/50 dark:hover:bg-gray-800/70'
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{r.orderId || '—'}</td>
                  <td className="px-3 py-2 font-mono font-medium text-gray-900 dark:text-gray-100">{r.sku || '—'}</td>
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{r.serial || '—'}</td>
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

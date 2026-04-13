'use client'

import { useState, useMemo, useRef } from 'react'
import { Upload, Search, X, FileText, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

interface InvoiceItem {
  sku: string
  serial: string
}

interface InvoiceRecord {
  orderId: string
  orderDate: string
  customerName: string
  address: string
  items: InvoiceItem[]
  tracking: string[]
  rawText: string
  _file: string
}

const PAGE_SIZES = [25, 50, 100, 200] as const

type SortKey = 'orderId' | 'orderDate' | 'customerName'

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
  const [error, setError] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<InvoiceRecord | null>(null)
  const [rawExpanded, setRawExpanded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)

  function handleSort(key: SortKey) {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortDir('asc') }
  }

  function sortIcon(key: SortKey) {
    if (sortBy !== key) return '↕'
    return sortDir === 'asc' ? '↑' : '↓'
  }

  async function parseOneFile(file: File): Promise<{ records: InvoiceRecord[]; fileName: string } | null> {
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/legacy-invoices/parse', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json()
      const records: InvoiceRecord[] = (data.records ?? []).map((r: Record<string, unknown>) => ({
        orderId: (r.orderId as string) ?? '',
        orderDate: (r.orderDate as string) ?? '',
        customerName: (r.customerName as string) ?? '',
        address: (r.address as string) ?? '',
        items: (r.items as InvoiceItem[]) ?? [],
        tracking: (r.tracking as string[]) ?? [],
        rawText: (r.rawText as string) ?? '',
        _file: file.name,
      }))
      return { records, fileName: file.name }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(prev => prev ? `${prev}\n${file.name}: ${msg}` : `Failed: ${file.name}: ${msg}`)
      console.error(`Failed to parse ${file.name}:`, err)
      return null
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    setImporting(true)
    setError('')
    cancelRef.current = false
    const pdfFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf') && !files.includes(f.name))
    const total = pdfFiles.length
    if (total === 0) { setImporting(false); return }

    const BATCH_SIZE = 5
    let completed = 0

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (cancelRef.current) break
      const batch = pdfFiles.slice(i, i + BATCH_SIZE)
      setImportProgress(`Processing ${Math.min(i + BATCH_SIZE, total)} of ${total} files…`)

      const results = await Promise.all(batch.map(f => parseOneFile(f)))

      const batchRecords: InvoiceRecord[] = []
      const batchFiles: string[] = []
      for (const result of results) {
        if (result) {
          batchRecords.push(...result.records)
          batchFiles.push(result.fileName)
        }
      }

      if (batchRecords.length > 0) {
        setRecords(prev => [...prev, ...batchRecords])
        setFiles(prev => [...prev, ...batchFiles])
      }

      completed += batch.length
      setImportProgress(`Processed ${completed} of ${total} files`)
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
        r.orderDate.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q) ||
        r.items.some(it => it.sku.toLowerCase().includes(q) || it.serial.toLowerCase().includes(q))
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

        {importing && (
          <>
            {importProgress && <span className="text-xs text-gray-500 animate-pulse">{importProgress}</span>}
            <button
              onClick={() => { cancelRef.current = true }}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
            >
              <X size={12} /> Cancel
            </button>
          </>
        )}
        {error && (
          <span className="text-xs text-red-500">{error}</span>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search order #, customer, SKU…"
            className="h-8 pl-8 pr-8 w-72 rounded-lg border border-gray-200 dark:border-gray-600 dark:bg-gray-800 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          {search && (
            <button onClick={() => { setSearch(''); setPage(0) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>

        <span className="text-xs text-gray-400">
          {filtered.length.toLocaleString()} order{filtered.length !== 1 ? 's' : ''}
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
                <th onClick={() => handleSort('orderDate')} className={thClass}>
                  <span className="inline-flex items-center gap-1">Date
                    <span className={sortBy === 'orderDate' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('orderDate')}</span>
                  </span>
                </th>
                <th onClick={() => handleSort('customerName')} className={thClass}>
                  <span className="inline-flex items-center gap-1">Customer
                    <span className={sortBy === 'customerName' ? 'text-amazon-orange text-[10px]' : 'text-gray-500 text-[10px]'}>{sortIcon('customerName')}</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => (
                <tr key={`${r.orderId}-${i}`}
                  onClick={() => { setSelectedOrder(r); setRawExpanded(false) }}
                  className={`border-b border-gray-200 dark:border-gray-700 last:border-0 transition-colors align-middle cursor-pointer ${
                    i % 2 === 0
                      ? 'bg-white hover:bg-blue-50/50 dark:bg-gray-900 dark:hover:bg-gray-800/70'
                      : 'bg-gray-50 hover:bg-blue-50/50 dark:bg-gray-800/50 dark:hover:bg-gray-800/70'
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{r.orderId || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{r.orderDate || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{r.customerName || '—'}</td>
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

      {/* Detail Modal */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono">{selectedOrder.orderId}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{selectedOrder.orderDate || 'No date'}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
              {/* Customer & Shipping */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Customer & Shipping</h3>
                <div className="text-sm text-gray-800 dark:text-gray-200">
                  <p className="font-medium">{selectedOrder.customerName || '—'}</p>
                  {selectedOrder.address && (
                    <div className="text-gray-600 dark:text-gray-400 mt-0.5">
                      {selectedOrder.address.split(',').map((part, i) => (
                        <p key={i}>{part.trim()}</p>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Items */}
              {selectedOrder.items.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Items ({selectedOrder.items.length})</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b dark:border-gray-700">
                        <th className="text-left py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">SKU</th>
                        <th className="text-left py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Serial #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.map((it, i) => (
                        <tr key={i} className="border-b dark:border-gray-700/50 last:border-0">
                          <td className="py-1.5 font-mono text-gray-800 dark:text-gray-200">{it.sku || '—'}</td>
                          <td className="py-1.5 font-mono text-gray-600 dark:text-gray-400">{it.serial || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* Tracking */}
              {selectedOrder.tracking.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Tracking Numbers</h3>
                  <div className="space-y-1">
                    {selectedOrder.tracking.map((t, i) => (
                      <p key={i} className="text-sm font-mono text-gray-700 dark:text-gray-300">{t}</p>
                    ))}
                  </div>
                </section>
              )}

              {/* Raw Invoice Text */}
              {selectedOrder.rawText && (
                <section>
                  <button
                    onClick={() => setRawExpanded(!rawExpanded)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    {rawExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    Raw Invoice Text
                  </button>
                  {rawExpanded && (
                    <pre className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-400 overflow-auto max-h-64 whitespace-pre-wrap font-mono border dark:border-gray-700">
                      {selectedOrder.rawText}
                    </pre>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload, Download, CheckCircle2, XCircle, AlertCircle, X,
  ChevronLeft, ArrowRight, FileSpreadsheet, Loader2, Info,
} from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Warehouse {
  id: string
  name: string
  locations: { id: string; name: string }[]
}

interface ParsedRow {
  rowNum: number
  valid: boolean
  vendorNumber: number | null
  vendorId: string | null
  vendorName: string | null
  cost: number | null
  sku: string
  grade: string
  serial: string
  error: string | null
  isNewProduct: boolean
  isNewGrade: boolean
}

interface ParseSummary {
  totalRows: number
  validRows: number
  errorRows: number
  newProducts: string[]
  newGrades: string[]
}

interface CommitResult {
  success: boolean
  imported: number
  productsCreated: number
  gradesCreated: number
}

type Step = 'upload' | 'staging' | 'result'

// ─── Component ───────────────────────────────────────────────────────────────

export default function InventoryMigration() {
  const [step, setStep] = useState<Step>('upload')

  // Upload state
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Staging state
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [committing, setCommitting] = useState(false)

  // Result state
  const [result, setResult] = useState<CommitResult | null>(null)

  // ─── Fetch warehouses ────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/warehouses')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setWarehouses(d.data ?? []))
      .catch(() => setErr('Failed to load warehouses'))
  }, [])

  const selectedWarehouse = warehouses.find(w => w.id === warehouseId)

  // Reset location when warehouse changes
  useEffect(() => { setLocationId('') }, [warehouseId])

  // ─── File handling ───────────────────────────────────────────────────────

  function pickFile(f: File) {
    setFile(f)
    setErr('')
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) pickFile(dropped)
  }

  // ─── Template download ───────────────────────────────────────────────────

  function downloadTemplate() {
    const csv = 'Vendor ID,Cost,SKU,Grade,Serial #\n1,49.99,IPHONE-14-128,A,SN001\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'migration-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Parse ───────────────────────────────────────────────────────────────

  const handleParse = useCallback(async () => {
    if (!file || !locationId) return
    setParsing(true)
    setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('locationId', locationId)
      const res = await fetch('/api/inventory/migrate?mode=parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Parse failed')
      setRows(data.rows)
      setSummary(data.summary)
      setStep('staging')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Parse failed')
    } finally {
      setParsing(false)
    }
  }, [file, locationId])

  // ─── Commit ──────────────────────────────────────────────────────────────

  async function handleCommit() {
    if (!summary || summary.errorRows > 0) return
    setCommitting(true)
    setErr('')
    try {
      const commitRows = rows.filter(r => r.valid).map(r => ({
        vendorNumber: r.vendorNumber!,
        vendorId: r.vendorId!,
        vendorName: r.vendorName,
        cost: r.cost,
        sku: r.sku,
        grade: r.grade,
        serial: r.serial,
      }))
      const res = await fetch('/api/inventory/migrate?mode=commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, rows: commitRows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setResult(data)
      setStep('result')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setCommitting(false)
    }
  }

  // ─── Reset ───────────────────────────────────────────────────────────────

  function reset() {
    setStep('upload')
    setFile(null)
    setRows([])
    setSummary(null)
    setResult(null)
    setErr('')
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      <div className="max-w-4xl mx-auto">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {(['upload', 'staging', 'result'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <ArrowRight size={14} className="text-gray-300" />}
              <div className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
                step === s ? 'bg-amazon-blue text-white' :
                  (['upload', 'staging', 'result'].indexOf(step) > i)
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-400',
              )}>
                {(['upload', 'staging', 'result'].indexOf(step) > i) && <CheckCircle2 size={12} />}
                {s === 'upload' ? 'Upload' : s === 'staging' ? 'Review' : 'Done'}
              </div>
            </div>
          ))}
        </div>

        {err && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{err}</span>
            <button type="button" onClick={() => setErr('')} className="shrink-0 hover:text-red-900"><X size={14} /></button>
          </div>
        )}

        {/* ─── UPLOAD STEP ──────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="space-y-5">
            {/* Template & help */}
            <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-blue-800">Spreadsheet columns</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  <span className="font-mono">Vendor ID</span>,{' '}
                  <span className="font-mono">Cost</span>,{' '}
                  <span className="font-mono">SKU</span>,{' '}
                  <span className="font-mono">Grade</span>,{' '}
                  <span className="font-mono">Serial #</span>
                </p>
              </div>
              <button
                type="button"
                onClick={downloadTemplate}
                className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-100 shrink-0"
              >
                <Download size={12} />
                Template
              </button>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <Info size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                Use Vendor ID numbers (not names). Look up Vendor IDs on the{' '}
                <a href="/vendors" className="underline font-medium">Vendors page</a>.
              </p>
            </div>

            {/* Warehouse + Location */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Warehouse <span className="text-red-500">*</span>
                </label>
                <select
                  value={warehouseId}
                  onChange={e => setWarehouseId(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                >
                  <option value="">Select warehouse…</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Location <span className="text-red-500">*</span>
                </label>
                <select
                  value={locationId}
                  onChange={e => setLocationId(e.target.value)}
                  disabled={!warehouseId}
                  className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">Select location…</option>
                  {selectedWarehouse?.locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={clsx(
                'rounded-lg border-2 border-dashed cursor-pointer transition-colors px-6 py-10 text-center',
                dragging
                  ? 'border-amazon-blue bg-blue-50'
                  : file
                    ? 'border-green-400 bg-green-50'
                    : 'border-gray-300 hover:border-gray-400 bg-gray-50',
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }}
              />
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileSpreadsheet size={28} className="text-green-500" />
                  <p className="text-sm font-medium text-gray-800">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB · click to change</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <Upload size={28} />
                  <p className="text-sm font-medium text-gray-600">Drop a file here or click to browse</p>
                  <p className="text-xs">CSV, XLSX, or XLS</p>
                </div>
              )}
            </div>

            {/* Parse button */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleParse}
                disabled={!file || !locationId || parsing}
                className="flex items-center gap-2 h-10 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50"
              >
                {parsing ? (
                  <><Loader2 size={14} className="animate-spin" />Parsing…</>
                ) : (
                  <><Upload size={14} />Parse &amp; Validate</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ─── STAGING STEP ─────────────────────────────────────────────── */}
        {step === 'staging' && summary && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
              <span className="text-sm font-medium text-gray-700">{summary.totalRows} rows</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                {summary.validRows} valid
              </span>
              {summary.errorRows > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                  {summary.errorRows} errors
                </span>
              )}
              {summary.newProducts.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                  {summary.newProducts.length} new product{summary.newProducts.length !== 1 ? 's' : ''}
                </span>
              )}
              {summary.newGrades.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                  {summary.newGrades.length} new grade{summary.newGrades.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Preview table */}
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white max-h-[60vh] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase w-14">Row</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase w-12">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Vendor ID</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Vendor</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Cost</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Grade</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Serial #</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(row => (
                    <tr key={row.rowNum} className={row.valid ? 'hover:bg-gray-50' : 'bg-red-50'}>
                      <td className="px-3 py-2 text-xs text-gray-400 font-mono">{row.rowNum}</td>
                      <td className="px-3 py-2 text-center">
                        {row.valid
                          ? <CheckCircle2 size={14} className="text-green-500 mx-auto" />
                          : <XCircle size={14} className="text-red-500 mx-auto" />}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {row.vendorNumber != null ? (
                          <span className="font-mono text-amazon-blue">V-{row.vendorNumber}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {row.vendorName ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 text-right font-mono">
                        {row.cost != null ? `$${row.cost.toFixed(2)}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-sm font-mono text-gray-900">
                        {row.sku || <span className="text-gray-300">—</span>}
                        {row.isNewProduct && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">NEW</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {row.grade || <span className="text-gray-300">—</span>}
                        {row.isNewGrade && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">NEW</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm font-mono text-gray-900">
                        {row.serial || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-red-600 max-w-xs">
                        {row.error ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => { setStep('upload'); setRows([]); setSummary(null); setErr('') }}
                className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                <ChevronLeft size={14} />
                Back
              </button>
              <button
                type="button"
                onClick={handleCommit}
                disabled={summary.errorRows > 0 || committing}
                className="flex items-center gap-2 h-10 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-50"
              >
                {committing ? (
                  <><Loader2 size={14} className="animate-spin" />Importing…</>
                ) : (
                  <>Import {summary.validRows} item{summary.validRows !== 1 ? 's' : ''}</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ─── RESULT STEP ──────────────────────────────────────────────── */}
        {step === 'result' && result && (
          <div className="space-y-5">
            <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-6 text-center">
              <CheckCircle2 size={40} className="text-green-500 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Import Complete</h2>
              <p className="text-sm text-gray-600">
                Successfully imported <span className="font-semibold">{result.imported}</span> serial{result.imported !== 1 ? 's' : ''}.
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 divide-y">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-600">Serials imported</span>
                <span className="text-sm font-semibold text-gray-900">{result.imported}</span>
              </div>
              {result.productsCreated > 0 && (
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-600">New products created</span>
                  <span className="text-sm font-semibold text-purple-700">{result.productsCreated}</span>
                </div>
              )}
              {result.gradesCreated > 0 && (
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-600">New grades created</span>
                  <span className="text-sm font-semibold text-indigo-700">{result.gradesCreated}</span>
                </div>
              )}
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={reset}
                className="flex items-center gap-2 h-10 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
              >
                <Upload size={14} />
                Import Another Batch
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

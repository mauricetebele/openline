'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Loader2, CheckCircle2, AlertCircle, BatteryCharging, Plus, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

interface Row { serial: string; batteryHealth: string }
type RowStatus = 'valid' | 'not_found' | 'not_in_stock' | 'invalid_pct' | 'duplicate'
interface RowResult { serial: string; batteryHealth: number | null; status: RowStatus; sku?: string | null; model?: string | null; grade?: string | null }
interface Counts { total: number; valid: number; not_found: number; not_in_stock: number; invalid_pct: number; duplicate: number }

const STATUS_LABEL: Record<RowStatus, string> = {
  valid: 'Ready', not_found: 'Not found', not_in_stock: 'Not in stock', invalid_pct: 'Bad %', duplicate: 'Duplicate',
}
const STATUS_CLS: Record<RowStatus, string> = {
  valid: 'bg-emerald-100 text-emerald-700', not_found: 'bg-red-100 text-red-700', not_in_stock: 'bg-amber-100 text-amber-800',
  invalid_pct: 'bg-red-100 text-red-700', duplicate: 'bg-gray-100 text-gray-500',
}

const MIN_ROWS = 8
const blank = (): Row => ({ serial: '', batteryHealth: '' })
const COLS: (keyof Row)[] = ['serial', 'batteryHealth']

export default function BatteryHealthUpload() {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: MIN_ROWS }, blank))
  const [results, setResults] = useState<RowResult[]>([])   // aligned to non-empty rows, in order
  const [counts, setCounts] = useState<Counts | null>(null)
  const [validating, setValidating] = useState(false)
  const [applying, setApplying] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const nonEmpty = rows.map((r, idx) => ({ ...r, idx })).filter(r => r.serial.trim())

  // Debounced realtime validation whenever a serial/value changes.
  const validate = useCallback(async (payload: { serial: string; batteryHealth: string }[]) => {
    if (payload.length === 0) { setResults([]); setCounts(null); return }
    setValidating(true)
    try {
      const res = await fetch('/api/inventory/battery-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload, commit: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Validation failed')
      setResults(data.results ?? [])
      setCounts(data.counts ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Validation failed') }
    finally { setValidating(false) }
  }, [])

  const serialsKey = JSON.stringify(nonEmpty.map(r => [r.serial, r.batteryHealth]))
  useEffect(() => {
    const payload = nonEmpty.map(({ serial, batteryHealth }) => ({ serial, batteryHealth }))
    const t = setTimeout(() => validate(payload), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialsKey, validate])

  // Map a grid row index → its validation result (results are in non-empty order).
  const resultByRowIdx = new Map<number, RowResult>()
  nonEmpty.forEach((r, i) => { if (results[i]) resultByRowIdx.set(r.idx, results[i]) })

  function setCell(rowIdx: number, col: keyof Row, value: string) {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }))
      next[rowIdx][col] = value
      // Auto-grow: keep at least one blank row at the bottom.
      if (rowIdx === next.length - 1 && (next[rowIdx].serial || next[rowIdx].batteryHealth)) next.push(blank())
      return next
    })
  }

  // Spreadsheet paste: spread tab/newline-delimited clipboard across cells/rows.
  function handlePaste(e: React.ClipboardEvent, rowIdx: number, colIdx: number) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\t') && !text.includes('\n')) return // single value → default paste
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n')
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    setRows(prev => {
      const next = prev.map(r => ({ ...r }))
      lines.forEach((line, li) => {
        const cells = line.split('\t')
        const tr = rowIdx + li
        while (next.length <= tr) next.push(blank())
        cells.forEach((cell, ci) => {
          const c = colIdx + ci
          if (c < COLS.length) next[tr][COLS[c]] = cell.trim()
        })
      })
      // Ensure a trailing blank row.
      if (next.length === 0 || next[next.length - 1].serial || next[next.length - 1].batteryHealth) next.push(blank())
      return next
    })
  }

  function removeRow(rowIdx: number) {
    setRows(prev => {
      const next = prev.filter((_, i) => i !== rowIdx)
      return next.length < MIN_ROWS ? [...next, ...Array.from({ length: MIN_ROWS - next.length }, blank)] : next
    })
  }
  function clearAll() { setRows(Array.from({ length: MIN_ROWS }, blank)); setResults([]); setCounts(null) }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false })
    const parsed: Row[] = []
    for (const r of aoa) {
      const serial = String(r?.[0] ?? '').trim()
      const bh = String(r?.[1] ?? '').trim()
      if (!serial) continue
      if (/serial|imei/i.test(serial) && !/^\d/.test(serial)) continue  // skip header
      parsed.push({ serial, batteryHealth: bh })
    }
    setRows([...parsed, blank()])
    if (fileRef.current) fileRef.current.value = ''
  }

  async function apply() {
    if (!counts?.valid) return
    setApplying(true)
    try {
      const res = await fetch('/api/inventory/battery-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: nonEmpty.map(({ serial, batteryHealth }) => ({ serial, batteryHealth })), commit: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Apply failed')
      toast.success(`Applied battery health to ${data.applied} serial${data.applied === 1 ? '' : 's'}`)
      clearAll()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Apply failed') }
    finally { setApplying(false) }
  }

  const cellCls = 'w-full h-8 px-2 text-xs bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-amazon-blue rounded'

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
          <Upload size={14} /> Upload CSV / Excel
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={onFile} className="hidden" />
        </label>
        <span className="text-xs text-gray-400">…or paste from a spreadsheet straight into the grid below.</span>
        {validating && <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> validating…</span>}
      </div>

      {/* Virtual spreadsheet */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-[11px] uppercase tracking-wide">
            <tr>
              <th className="w-8 px-2 py-2 text-right font-semibold">#</th>
              <th className="px-2 py-2 text-left font-semibold border-l border-gray-200 dark:border-gray-700">Serial / IMEI</th>
              <th className="px-2 py-2 text-left font-semibold border-l border-gray-200 dark:border-gray-700 w-32">Battery Health %</th>
              <th className="px-2 py-2 text-left font-semibold border-l border-gray-200 dark:border-gray-700 w-44">Status</th>
              <th className="w-8 border-l border-gray-200 dark:border-gray-700" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const res = resultByRowIdx.get(i)
              const bad = res && res.status !== 'valid'
              return (
                <tr key={i} className={clsx('border-t border-gray-100 dark:border-gray-800', bad && 'bg-red-50/40 dark:bg-red-900/10')}>
                  <td className="px-2 text-right text-[10px] text-gray-300 tabular-nums">{i + 1}</td>
                  <td className="border-l border-gray-100 dark:border-gray-800 p-0">
                    <input
                      value={r.serial}
                      onChange={e => setCell(i, 'serial', e.target.value)}
                      onPaste={e => handlePaste(e, i, 0)}
                      className={clsx(cellCls, 'font-mono')}
                      placeholder={i === 0 ? 'paste here…' : ''}
                    />
                  </td>
                  <td className="border-l border-gray-100 dark:border-gray-800 p-0">
                    <input
                      value={r.batteryHealth}
                      onChange={e => setCell(i, 'batteryHealth', e.target.value)}
                      onPaste={e => handlePaste(e, i, 1)}
                      inputMode="numeric"
                      className={clsx(cellCls, 'tabular-nums')}
                    />
                  </td>
                  <td className="border-l border-gray-100 dark:border-gray-800 px-2">
                    {res
                      ? <div className="flex flex-col leading-tight">
                          <span className={clsx('inline-flex w-fit px-1.5 py-0.5 rounded text-[10px] font-medium', STATUS_CLS[res.status])}>{STATUS_LABEL[res.status]}</span>
                          {res.sku && <span className="text-[10px] text-gray-400 truncate max-w-[160px]" title={`${res.sku}${res.model ? ' · ' + res.model : ''}`}>{res.sku}</span>}
                        </div>
                      : <span className="text-[10px] text-gray-300">—</span>}
                  </td>
                  <td className="border-l border-gray-100 dark:border-gray-800 text-center">
                    {(r.serial || r.batteryHealth) && <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setRows(prev => [...prev, blank()])} className="inline-flex items-center gap-1 text-xs text-amazon-blue hover:underline"><Plus size={12} /> Add row</button>
        <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
        {counts && (
          <div className="ml-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 font-semibold"><CheckCircle2 size={11} /> {counts.valid} ready</span>
            {counts.not_found > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-semibold"><AlertCircle size={11} /> {counts.not_found} not found</span>}
            {counts.not_in_stock > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-semibold">{counts.not_in_stock} not in stock</span>}
            {counts.invalid_pct > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5">{counts.invalid_pct} bad %</span>}
            {counts.duplicate > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">{counts.duplicate} duplicate</span>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={apply}
          disabled={applying || !counts?.valid}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {applying ? <Loader2 size={14} className="animate-spin" /> : <BatteryCharging size={14} />}
          Apply to {counts?.valid ?? 0} serial{counts?.valid === 1 ? '' : 's'}
        </button>
        <span className="text-xs text-gray-400">Only in-stock serials can be updated.</span>
      </div>
    </div>
  )
}

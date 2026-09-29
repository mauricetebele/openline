'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, Loader2, CheckCircle2, AlertCircle, BatteryCharging } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

interface RowResult {
  serial: string
  batteryHealth: number | null
  status: 'valid' | 'not_found' | 'not_in_stock' | 'invalid_pct' | 'duplicate'
  sku?: string | null
  model?: string | null
  grade?: string | null
}
interface Counts { total: number; valid: number; not_found: number; not_in_stock: number; invalid_pct: number; duplicate: number }

const STATUS_LABEL: Record<RowResult['status'], string> = {
  valid: 'Ready', not_found: 'Not found', not_in_stock: 'Not in stock', invalid_pct: 'Bad %', duplicate: 'Duplicate',
}
const STATUS_CLS: Record<RowResult['status'], string> = {
  valid: 'bg-emerald-100 text-emerald-700', not_found: 'bg-red-100 text-red-700', not_in_stock: 'bg-amber-100 text-amber-700',
  invalid_pct: 'bg-red-100 text-red-700', duplicate: 'bg-gray-100 text-gray-500',
}

/** Parse pasted text: one unit per line, "serial<tab|comma>batteryHealth". */
function parsePaste(text: string): { serial: string; batteryHealth: string }[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[\t,]+/).map(p => p.trim())
    return { serial: parts[0] ?? '', batteryHealth: parts[1] ?? '' }
  }).filter(r => r.serial)
}

export default function BatteryHealthUpload() {
  const [rows, setRows] = useState<{ serial: string; batteryHealth: string }[]>([])
  const [pasteText, setPasteText] = useState('')
  const [results, setResults] = useState<RowResult[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [validating, setValidating] = useState(false)
  const [applying, setApplying] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Debounced realtime validation whenever the rows change.
  const validate = useCallback(async (rs: { serial: string; batteryHealth: string }[]) => {
    if (rs.length === 0) { setResults([]); setCounts(null); return }
    setValidating(true)
    try {
      const res = await fetch('/api/inventory/battery-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rs, commit: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Validation failed')
      setResults(data.results ?? [])
      setCounts(data.counts ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Validation failed') }
    finally { setValidating(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => validate(rows), 400)
    return () => clearTimeout(t)
  }, [rows, validate])

  // Paste → rows
  useEffect(() => { setRows(parsePaste(pasteText)) }, [pasteText])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false })
    // Skip a header row if the first cell isn't a plausible serial+number pair.
    const parsed: { serial: string; batteryHealth: string }[] = []
    for (const r of aoa) {
      const serial = String(r?.[0] ?? '').trim()
      const bh = String(r?.[1] ?? '').trim()
      if (!serial) continue
      // Skip an obvious header like "Serial, Battery Health"
      if (/serial|imei/i.test(serial) && !/^\d/.test(serial)) continue
      parsed.push({ serial, batteryHealth: bh })
    }
    setPasteText(parsed.map(p => `${p.serial}\t${p.batteryHealth}`).join('\n'))
    if (fileRef.current) fileRef.current.value = ''
  }

  async function apply() {
    if (!counts?.valid) return
    setApplying(true)
    try {
      const res = await fetch('/api/inventory/battery-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, commit: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Apply failed')
      toast.success(`Applied battery health to ${data.applied} serial${data.applied === 1 ? '' : 's'}`)
      setPasteText(''); setRows([]); setResults([]); setCounts(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Apply failed') }
    finally { setApplying(false) }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
          <Upload size={14} /> Upload CSV / Excel
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={onFile} className="hidden" />
        </label>
        <span className="text-xs text-gray-400">Two columns: <strong>Serial</strong>, <strong>Battery Health %</strong>. Or paste below.</span>
        {validating && <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> validating…</span>}
      </div>

      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Paste serials + battery health (one per line, tab or comma separated)</label>
        <textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          rows={6}
          placeholder={'354886760486617\t92\n355975560488896, 78'}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue"
        />
      </div>

      {counts && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 font-semibold"><CheckCircle2 size={11} /> {counts.valid} ready</span>
          {counts.not_found > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-semibold"><AlertCircle size={11} /> {counts.not_found} not found</span>}
          {counts.not_in_stock > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-semibold">{counts.not_in_stock} not in stock</span>}
          {counts.invalid_pct > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5">{counts.invalid_pct} bad %</span>}
          {counts.duplicate > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">{counts.duplicate} duplicate</span>}
        </div>
      )}

      {results.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Serial</th>
                <th className="text-left px-3 py-2">SKU / Model</th>
                <th className="text-right px-3 py-2 w-20">BH %</th>
                <th className="text-left px-3 py-2 w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {results.map((r, i) => (
                <tr key={i} className={clsx(r.status !== 'valid' && 'bg-red-50/30 dark:bg-red-900/10')}>
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">{r.serial}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">
                    {r.sku ? <span>{r.sku}{r.model ? <span className="text-gray-400"> · {r.model}</span> : null}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{r.batteryHealth ?? '—'}</td>
                  <td className="px-3 py-1.5"><span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium', STATUS_CLS[r.status])}>{STATUS_LABEL[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

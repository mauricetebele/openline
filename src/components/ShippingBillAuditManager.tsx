'use client'
import { useCallback, useRef, useState } from 'react'
import { Upload, FileSpreadsheet, X, AlertCircle, Search, DollarSign } from 'lucide-react'
import { clsx } from 'clsx'

// ─── CSV parsing ────────────────────────────────────────────────────────────
// Proper CSV parser: handles quoted fields containing commas/newlines and
// escaped double-quotes (""). Carrier billing files routinely include both.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\r') {
      // ignore — handled by \n
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  // drop fully-empty rows
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

// Heuristics to surface likely columns for the eventual match (tracking #) and
// the billed amount(s), just to jump-start the mapping discussion.
const TRACKING_HINT = /(track|tracking|1z|pkg.*ref|package.*ref)/i
const AMOUNT_HINT   = /(net|charge|amount|billed|total|price|cost|incentive|published|rate)/i

type Carrier = 'ups' | 'fedex' | 'usps'

export default function ShippingBillAuditManager() {
  const [carrier, setCarrier] = useState<Carrier>('ups')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const ingest = useCallback((text: string, name: string) => {
    setErr('')
    const parsed = parseCsv(text)
    if (parsed.length === 0) { setErr('The file appears to be empty.'); return }
    const [head, ...rest] = parsed
    setHeaders(head.map(h => h.trim()))
    setDataRows(rest)
    setFileName(name)
  }, [])

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return
    const name = file.name.toLowerCase()
    if (!/\.(csv|txt|tsv)$/.test(name)) { setErr('Please upload a .csv file.'); return }
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') ingest(reader.result, file.name) }
    reader.onerror = () => setErr('Could not read the file.')
    reader.readAsText(file)
  }, [ingest])

  function reset() {
    setFileName(''); setHeaders([]); setDataRows([]); setErr('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const trackingCols = headers.map((h, i) => ({ h, i })).filter(c => TRACKING_HINT.test(c.h))
  const amountCols   = headers.map((h, i) => ({ h, i })).filter(c => AMOUNT_HINT.test(c.h))
  const previewRows  = dataRows.slice(0, 25)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* How it works */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
          <p className="font-medium mb-1">How this works</p>
          <p className="text-blue-800 dark:text-blue-300/90 text-[13px] leading-relaxed">
            Upload the billing CSV from your carrier. Each billed shipment is matched to the label we bought
            through the system by <span className="font-semibold">tracking number</span>, then the amount the
            carrier charged is compared to the price we were quoted at purchase. Discrepancies (overcharges,
            surcharges, adjustments) get flagged for dispute. Start by uploading a UPS bill below.
          </p>
        </div>

        {/* Carrier selector */}
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Carrier</label>
          <div className="flex gap-2">
            {([
              { id: 'ups' as const, label: 'UPS', enabled: true },
              { id: 'fedex' as const, label: 'FedEx', enabled: false },
              { id: 'usps' as const, label: 'USPS', enabled: false },
            ]).map(c => (
              <button
                key={c.id}
                type="button"
                disabled={!c.enabled}
                onClick={() => c.enabled && setCarrier(c.id)}
                className={clsx(
                  'h-9 px-4 rounded-md text-sm font-medium border transition-colors',
                  carrier === c.id
                    ? 'bg-amazon-blue text-white border-amazon-blue'
                    : c.enabled
                      ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      : 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed',
                )}
                title={c.enabled ? '' : 'Coming soon'}
              >
                {c.label}{!c.enabled && <span className="ml-1.5 text-[10px]">soon</span>}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{err}</span>
            <button type="button" onClick={() => setErr('')} className="shrink-0 hover:text-red-900"><X size={14} /></button>
          </div>
        )}

        {/* Upload dropzone */}
        {!fileName ? (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
            onClick={() => fileRef.current?.click()}
            className={clsx(
              'rounded-xl border-2 border-dashed px-6 py-14 text-center cursor-pointer transition-colors',
              dragging ? 'border-amazon-blue bg-amazon-blue/5' : 'border-gray-300 hover:border-gray-400 bg-gray-50/50',
            )}
          >
            <Upload size={28} className="mx-auto text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-700">Drop your {carrier.toUpperCase()} billing CSV here, or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">.csv files up to a few thousand rows</p>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
          </div>
        ) : (
          <>
            {/* File summary */}
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
              <FileSpreadsheet size={18} className="text-amazon-blue shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{fileName}</p>
                <p className="text-xs text-gray-500">{dataRows.length.toLocaleString()} rows · {headers.length} columns · {carrier.toUpperCase()}</p>
              </div>
              <button type="button" onClick={reset} className="h-8 px-3 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50">Upload a different file</button>
            </div>

            {/* Detected columns (to jump-start mapping) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><Search size={12} /> Likely tracking-number column(s)</p>
                {trackingCols.length > 0
                  ? <div className="flex flex-wrap gap-1.5">{trackingCols.map(c => <span key={c.i} className="rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-2 py-0.5">{c.h}</span>)}</div>
                  : <p className="text-xs text-gray-400">None auto-detected — we&apos;ll pick this together from the columns below.</p>}
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><DollarSign size={12} /> Likely charge/amount column(s)</p>
                {amountCols.length > 0
                  ? <div className="flex flex-wrap gap-1.5">{amountCols.map(c => <span key={c.i} className="rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-2 py-0.5">{c.h}</span>)}</div>
                  : <p className="text-xs text-gray-400">None auto-detected — we&apos;ll pick this together from the columns below.</p>}
              </div>
            </div>

            {/* All detected columns */}
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">All {headers.length} columns</p>
              <div className="flex flex-wrap gap-1.5">
                {headers.map((h, i) => (
                  <span key={i} className="rounded bg-gray-100 text-gray-600 text-[11px] font-mono px-1.5 py-0.5" title={`Column ${i + 1}`}>
                    <span className="text-gray-400 mr-1">{i + 1}</span>{h || <span className="italic text-gray-400">(blank)</span>}
                  </span>
                ))}
              </div>
            </div>

            {/* Raw preview */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Preview — first {previewRows.length} of {dataRows.length.toLocaleString()} rows</p>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white max-h-[420px] overflow-y-auto">
                <table className="min-w-full text-xs whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <th className="px-2 py-2 text-left font-semibold text-gray-400 w-8">#</th>
                      {headers.map((h, i) => (
                        <th key={i} className={clsx(
                          'px-3 py-2 text-left font-semibold',
                          TRACKING_HINT.test(h) ? 'text-emerald-700' : AMOUNT_HINT.test(h) ? 'text-amber-700' : 'text-gray-500',
                        )}>{h || `col ${i + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map((r, ri) => (
                      <tr key={ri} className="hover:bg-gray-50">
                        <td className="px-2 py-1.5 text-gray-300">{ri + 1}</td>
                        {headers.map((_, ci) => (
                          <td key={ci} className={clsx(
                            'px-3 py-1.5',
                            TRACKING_HINT.test(headers[ci]) ? 'font-mono text-gray-800' : AMOUNT_HINT.test(headers[ci]) ? 'text-right text-gray-700 font-mono' : 'text-gray-600',
                          )}>{r[ci] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Next-step note */}
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <span className="font-medium text-gray-700">Next:</span> confirm which columns hold the <span className="text-emerald-700 font-medium">tracking number</span> and the <span className="text-amber-700 font-medium">billed amount</span> (the highlighted columns are my guesses). Once we lock the UPS format, this screen will match each row to its label, show <span className="font-medium">quoted vs. billed</span> side by side, and flag discrepancies to dispute.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

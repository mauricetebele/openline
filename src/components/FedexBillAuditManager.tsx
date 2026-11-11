'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  Upload, FileSpreadsheet, X, AlertCircle, AlertTriangle, CheckCircle2,
  Loader2, Download, ArrowLeft,
} from 'lucide-react'
import { clsx } from 'clsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (s: unknown): number => {
  const n = parseFloat(String(s ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const normTracking = (s: unknown) => String(s ?? '').replace(/^["'\s]+|["'\s]+$/g, '').toUpperCase()
const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`

// ─── Types ──────────────────────────────────────────────────────────────────
interface Recipient {
  name: string; company: string; addr: string; city: string; state: string; postal: string; country: string
}
type Status = 'MATCH' | 'MISMATCH' | 'NO_QUOTE'

interface Row {
  tracking: string
  billed: number          // FedEx Net Charge (col V), summed per tracking
  service: string
  shipDate: string
  weight: string
  zone: string
  invoiceNumber: string
  invoiceDate: string
  recipient: Recipient
  lineCount: number
  // populated after match
  matched: boolean
  quoted: number | null
  source: 'order' | 'return' | null
  olmNumber: number | null
  amazonOrderId: string | null
  salesOrderId: string | null
  status: Status | null
  variance: number | null  // billed − quoted
}

interface MatchResp {
  source: 'order' | 'return'; quoted: number | null; serviceCode: string | null; serviceLabel: string | null
  olmNumber?: number | null; amazonOrderId?: string | null; salesOrderId?: string | null
}

const DEFAULT_TOL = 0.25

// Locate a column by header name (normalized), falling back to a fixed index
// (the FedEx "Shipment Detail" export layout the user confirmed).
function makeCol(header: string[]) {
  const norm = header.map(h => String(h ?? '').trim().toLowerCase())
  return (names: string[], fallback: number) => {
    for (const n of names) { const i = norm.indexOf(n.toLowerCase()); if (i >= 0) return i }
    return fallback
  }
}

export default function FedexBillAuditManager() {
  const [tolerance, setTolerance] = useState(String(DEFAULT_TOL))
  const [appliedTol, setAppliedTol] = useState(DEFAULT_TOL)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [view, setView] = useState<'MATCHED' | 'UNMATCHED'>('MATCHED')
  const fileRef = useRef<HTMLInputElement>(null)

  const process = useCallback(async (aoa: unknown[][], name: string, tol: number) => {
    if (aoa.length < 2) { setErr('The file has no data rows.'); return }

    // Detect header row: FedEx exports start with "Shipment Tracking Number".
    const first = aoa[0].map(c => String(c ?? '').trim().toLowerCase())
    const hasHeader = first.some(c => c.includes('tracking'))
    const header = hasHeader ? (aoa[0] as string[]) : []
    const dataRows = hasHeader ? aoa.slice(1) : aoa
    const col = makeCol(header)

    const iTrack = col(['shipment tracking number'], 8)              // Column I
    const iNet   = col(['net charge amount usd'], 21)               // Column V
    const iSvcT  = col(['service type'], 3)
    const iSvcD  = col(['service description'], 4)
    const iShip  = col(['shipment date (mm/dd/yyyy)'], 6)
    const iWt    = col(['shipment rated weight (pounds)'], 23)
    const iZone  = col(['pricing zone'], 38)
    const iInvNo = col(['invoice number'], 52)
    const iInvDt = col(['invoice date (mm/dd/yyyy)'], 51)
    const iRName = col(['recipient name'], 26)
    const iRCo   = col(['recipient company name'], 27)
    const iRAddr = col(['recipient address'], 28)
    const iRCity = col(['recipient city'], 29)
    const iRSt   = col(['recipient state/province'], 30)
    const iRCtry = col(['recipient country/territory'], 31)
    const iRZip  = col(['recipient postal code'], 32)

    const buildRcv = (r: unknown[]): Recipient => ({
      name: String(r[iRName] ?? '').trim(), company: String(r[iRCo] ?? '').trim(),
      addr: String(r[iRAddr] ?? '').trim(), city: String(r[iRCity] ?? '').trim(),
      state: String(r[iRSt] ?? '').trim(), postal: String(r[iRZip] ?? '').trim(),
      country: String(r[iRCtry] ?? '').trim(),
    })

    // Group by tracking number, summing Net Charge across any repeated lines.
    const groups = new Map<string, Row>()
    for (const r of dataRows) {
      const tracking = normTracking(r[iTrack])
      if (!tracking) continue
      const charge = money(r[iNet])
      const g = groups.get(tracking)
      if (g) {
        g.billed += charge
        g.lineCount++
        if (!g.recipient.name && !g.recipient.addr) { const rc = buildRcv(r); if (rc.name || rc.addr) g.recipient = rc }
      } else {
        const svcD = String(r[iSvcD] ?? '').trim()
        const svcT = String(r[iSvcT] ?? '').trim()
        groups.set(tracking, {
          tracking, billed: charge, lineCount: 1,
          service: svcD || svcT,
          shipDate: String(r[iShip] ?? '').trim(),
          weight: String(r[iWt] ?? '').trim(),
          zone: String(r[iZone] ?? '').trim(),
          invoiceNumber: String(r[iInvNo] ?? '').trim(),
          invoiceDate: String(r[iInvDt] ?? '').trim(),
          recipient: buildRcv(r),
          matched: false, quoted: null, source: null, olmNumber: null, amazonOrderId: null,
          salesOrderId: null, status: null, variance: null,
        })
      }
    }
    const list = Array.from(groups.values())
    if (list.length === 0) { setErr('No tracking numbers found in column I of the file.'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/fedex-bill-audit/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumbers: list.map(i => i.tracking) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Match lookup failed')
      const matches: Record<string, MatchResp> = data.matches ?? {}

      for (const it of list) {
        const m = matches[it.tracking] ?? matches[it.tracking.replace(/^0+/, '')]
        if (!m) { it.matched = false; it.status = null; continue }
        it.matched = true
        it.source = m.source
        it.quoted = m.quoted
        it.olmNumber = m.olmNumber ?? null
        it.amazonOrderId = m.amazonOrderId ?? null
        it.salesOrderId = m.salesOrderId ?? null
        if (m.quoted == null) { it.status = 'NO_QUOTE'; continue }
        it.variance = it.billed - m.quoted
        it.status = Math.abs(it.variance) <= tol ? 'MATCH' : 'MISMATCH'
      }

      setRows(list)
      setFileName(name)
      setAppliedTol(tol)
      setView('MATCHED')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Match lookup failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return
    setErr('')
    const tol = parseFloat(tolerance)
    if (!Number.isFinite(tol) || tol < 0) { setErr('Enter a valid match tolerance (e.g. 0.25) before uploading.'); return }
    if (!/\.(csv|xlsx|xls|txt|tsv)$/i.test(file.name)) { setErr('Please upload a .csv or .xlsx FedEx billing file.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result as ArrayBuffer, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false })
        process(aoa, file.name, tol)
      } catch {
        setErr('Could not read the file. Make sure it is a valid FedEx CSV/Excel export.')
      }
    }
    reader.onerror = () => setErr('Could not read the file.')
    reader.readAsArrayBuffer(file)
  }, [process, tolerance])

  function reset() {
    setRows(null); setFileName(''); setErr(''); setView('MATCHED')
    if (fileRef.current) fileRef.current.value = ''
  }

  const matched = useMemo(() => (rows ?? []).filter(r => r.matched), [rows])
  const unmatched = useMemo(() => (rows ?? []).filter(r => !r.matched), [rows])

  const summary = useMemo(() => {
    if (!rows) return null
    const totalBilled = rows.reduce((s, r) => s + r.billed, 0)
    const compared = matched.filter(r => r.quoted != null)
    const totalQuoted = compared.reduce((s, r) => s + (r.quoted ?? 0), 0)
    const totalComparedBilled = compared.reduce((s, r) => s + r.billed, 0)
    const overcharge = totalComparedBilled - totalQuoted
    const mismatches = matched.filter(r => r.status === 'MISMATCH').length
    const noQuote = matched.filter(r => r.status === 'NO_QUOTE').length
    return {
      shipments: rows.length, totalBilled,
      matched: matched.length, unmatched: unmatched.length,
      unmatchedBilled: unmatched.reduce((s, r) => s + r.billed, 0),
      compared: compared.length, totalQuoted, totalComparedBilled, overcharge, mismatches, noQuote,
    }
  }, [rows, matched, unmatched])

  function exportCsv(which: 'matched' | 'unmatched') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const addr = (r: Recipient) => [r.addr, r.city, [r.state, r.postal].filter(Boolean).join(' '), r.country].filter(Boolean).join(', ')
    let head: string[]; let lines: string[]
    if (which === 'matched') {
      head = ['Tracking', 'Recipient', 'Address', 'Service', 'Ship Date', 'Order', 'Quoted', 'Billed', 'Overcharge', 'Status']
      lines = [head.join(',')]
      for (const r of matched) lines.push([
        r.tracking, esc(r.recipient.name || r.recipient.company), esc(addr(r.recipient)), esc(r.service), r.shipDate,
        r.olmNumber ? `OLM-${r.olmNumber}` : (r.amazonOrderId ?? r.salesOrderId ?? ''),
        r.quoted != null ? r.quoted.toFixed(2) : '', r.billed.toFixed(2),
        r.variance != null ? r.variance.toFixed(2) : '',
        r.status === 'MATCH' ? 'Match' : r.status === 'MISMATCH' ? 'Mismatch' : 'No quote',
      ].join(','))
      const sm = summary!
      lines.push(['TOTAL', '', '', '', '', '', sm.totalQuoted.toFixed(2), sm.totalComparedBilled.toFixed(2), sm.overcharge.toFixed(2), ''].join(','))
    } else {
      head = ['Tracking', 'Recipient', 'Address', 'Service', 'Ship Date', 'Invoice', 'Charged']
      lines = [head.join(',')]
      for (const r of unmatched) lines.push([
        r.tracking, esc(r.recipient.name || r.recipient.company), esc(addr(r.recipient)), esc(r.service), r.shipDate,
        r.invoiceNumber, r.billed.toFixed(2),
      ].join(','))
      lines.push(['TOTAL', '', '', '', '', '', (summary?.unmatchedBilled ?? 0).toFixed(2)].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `fedex-${which}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Results view ─────────────────────────────────────────────────────────
  if (rows && summary) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
          {/* File bar */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={reset} className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              <ArrowLeft size={13} /> New file
            </button>
            <FileSpreadsheet size={16} className="text-purple-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{fileName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {summary.shipments.toLocaleString()} shipments · {summary.matched} matched · {summary.unmatched} unmatched · ±${appliedTol.toFixed(2)} tolerance
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Total billed" value={fmt(summary.totalBilled)} sub={`${summary.shipments} shipments`} />
            <Card label="Quoted (matched)" value={fmt(summary.totalQuoted)} sub={`${summary.compared} with a quote on file`} />
            <Card label="Overcharge" value={fmt(summary.overcharge)} sub="billed − quoted (matched)" tone={summary.overcharge > appliedTol ? 'bad' : summary.overcharge < -appliedTol ? 'good' : 'neutral'} />
            <Card label="No system record" value={String(summary.unmatched)} sub={`${fmt(summary.unmatchedBilled)} billed`} tone={summary.unmatched > 0 ? 'warn' : 'good'} />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
            {([{ id: 'MATCHED' as const, label: 'Matched', n: matched.length }, { id: 'UNMATCHED' as const, label: 'Not in system', n: unmatched.length }]).map(t => (
              <button key={t.id} type="button" onClick={() => setView(t.id)}
                className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  view === t.id ? 'border-purple-600 text-purple-700 dark:text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
                {t.label} <span className={clsx('ml-1 text-xs', view === t.id ? 'text-purple-500' : 'text-gray-400')}>{t.n}</span>
              </button>
            ))}
            <div className="flex-1" />
            <button type="button" onClick={() => exportCsv(view === 'MATCHED' ? 'matched' : 'unmatched')}
              className="flex items-center gap-1.5 h-8 px-3 my-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Download size={13} /> Export
            </button>
          </div>

          {view === 'MATCHED' ? (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Tracking numbers found on a label purchased through the system. FedEx&apos;s billed Net Charge is compared to the quoted rate —
                a <CheckCircle2 size={12} className="inline text-emerald-600 -mt-0.5" /> means they match (within ±${appliedTol.toFixed(2)}),
                a <AlertTriangle size={12} className="inline text-amber-500 -mt-0.5" /> flags a discrepancy. The last row totals the overcharge.
              </p>
              <MatchedTable rows={matched} summary={summary} tol={appliedTol} />
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Billed by FedEx but with <span className="font-medium">no matching label in the system</span> — verify these shipments belong to us before paying.
              </p>
              <UnmatchedTable rows={unmatched} total={summary.unmatchedBilled} />
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── Upload view ──────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-500/10 dark:border-purple-500/20 px-4 py-3 text-sm text-purple-900 dark:text-purple-200">
          <p className="font-medium mb-1">How this works</p>
          <p className="text-purple-800 dark:text-purple-300/90 text-[13px] leading-relaxed">
            Upload your FedEx billing export. Each shipment is matched to the label we bought through the system by
            {' '}<span className="font-semibold">tracking number</span> (column I), and FedEx&apos;s
            {' '}<span className="font-semibold">Net Charge</span> (column V) is compared to the rate we were quoted.
            Tracking numbers with no label in the system are listed separately so you can verify they&apos;re ours.
          </p>
        </div>

        {/* Match tolerance */}
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Match tolerance ($)</label>
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
              <input type="number" step="0.01" min={0} value={tolerance} onChange={e => setTolerance(e.target.value)}
                className="w-28 h-9 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 pl-6 pr-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              A shipment billed within <span className="font-mono text-gray-700 dark:text-gray-300">${(parseFloat(tolerance) || 0).toFixed(2)}</span> of the quoted rate gets a green check; anything outside that is flagged.
            </p>
          </div>
        </div>

        {err && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{err}</span>
            <button type="button" onClick={() => setErr('')} className="shrink-0 hover:text-red-900"><X size={14} /></button>
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
          onClick={() => !loading && fileRef.current?.click()}
          className={clsx('rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            loading ? 'cursor-wait border-gray-200 bg-gray-50 dark:bg-gray-800/50' : 'cursor-pointer',
            dragging ? 'border-purple-500 bg-purple-500/5' : !loading && 'border-gray-300 dark:border-gray-600 hover:border-gray-400 bg-gray-50/50 dark:bg-gray-800/30')}
        >
          {loading ? (
            <><Loader2 size={28} className="mx-auto text-purple-600 mb-3 animate-spin" /><p className="text-sm font-medium text-gray-600 dark:text-gray-300">Matching against purchased labels…</p></>
          ) : (
            <>
              <Upload size={28} className="mx-auto text-gray-400 mb-3" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Drop your FedEx billing file here, or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">.csv or .xlsx · Tracking = Column I · Net Charge = Column V</p>
            </>
          )}
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
        </div>
      </div>
    </div>
  )
}

// ─── Presentational ───────────────────────────────────────────────────────────
function Card({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'warn' | 'neutral' }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={clsx('text-xl font-bold mt-0.5',
        tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900 dark:text-gray-100')}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function AddressCell({ r }: { r: Recipient }) {
  const line2 = [r.city, [r.state, r.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return (
    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">
      <div className="max-w-[20rem]">
        {(r.name || r.company) && <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{r.name || r.company}</p>}
        {r.addr && <p className="truncate">{r.addr}</p>}
        {line2 && <p className="text-gray-500 dark:text-gray-400">{line2}{r.country && r.country !== 'US' ? ` · ${r.country}` : ''}</p>}
        {!r.name && !r.company && !r.addr && <span className="text-gray-300">—</span>}
      </div>
    </td>
  )
}

function OrderRef({ r }: { r: Row }) {
  const label = r.olmNumber ? `OLM-${r.olmNumber}` : r.amazonOrderId || (r.salesOrderId ? 'Wholesale' : null)
  return (
    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">
      {label ? <span className="font-mono text-xs">{label}</span> : <span className="text-gray-300">—</span>}
      {r.source === 'return' && <span className="ml-1 text-[10px] text-gray-400">(return)</span>}
    </td>
  )
}

interface MatchSummary { compared: number; totalQuoted: number; totalComparedBilled: number; overcharge: number; mismatches: number; noQuote: number }
function MatchedTable({ rows, summary, tol }: { rows: Row[]; summary: MatchSummary; tol: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th className="px-3 py-2 text-center font-semibold text-gray-500 w-10"></th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Tracking</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Recipient / Address</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Order</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Service</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Ship Date</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Quoted</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Billed</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Overcharge</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(r => (
            <tr key={r.tracking} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="px-3 py-1.5 text-center">
                {r.status === 'MATCH'
                  ? <CheckCircle2 size={16} className="inline text-emerald-600" />
                  : <AlertTriangle size={16} className="inline text-amber-500" />}
              </td>
              <td className="px-3 py-1.5 font-mono text-gray-800 dark:text-gray-100 whitespace-nowrap">{r.tracking}</td>
              <AddressCell r={r.recipient} />
              <OrderRef r={r} />
              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.service || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{r.shipDate || '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-500">{r.quoted != null ? fmt(r.quoted) : <span className="text-amber-500">no quote</span>}</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-800 dark:text-gray-100">{fmt(r.billed)}</td>
              <td className={clsx('px-3 py-1.5 text-right font-mono font-medium',
                r.variance == null ? 'text-gray-300' : r.variance > tol ? 'text-red-600' : r.variance < -tol ? 'text-blue-600' : 'text-gray-400')}>
                {r.variance != null ? fmt(r.variance) : '—'}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No tracking numbers on this bill matched a purchased label.</td></tr>}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 font-semibold">
              <td></td>
              <td className="px-3 py-2 text-gray-700 dark:text-gray-200" colSpan={5}>
                Total overcharge (billed − quoted) · {summary.compared} compared
                {summary.mismatches > 0 && <span className="ml-2 text-amber-600 font-normal">{summary.mismatches} flagged</span>}
                {summary.noQuote > 0 && <span className="ml-2 text-gray-400 font-normal">{summary.noQuote} without a quote</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">{fmt(summary.totalQuoted)}</td>
              <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">{fmt(summary.totalComparedBilled)}</td>
              <td className={clsx('px-3 py-2 text-right font-mono text-sm', summary.overcharge > tol ? 'text-red-600' : summary.overcharge < -tol ? 'text-blue-600' : 'text-gray-600 dark:text-gray-300')}>
                {fmt(summary.overcharge)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function UnmatchedTable({ rows, total }: { rows: Row[]; total: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Tracking</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Recipient / Address</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Service</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Ship Date</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Invoice</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Charged by FedEx</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(r => (
            <tr key={r.tracking} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="px-3 py-1.5 font-mono text-gray-800 dark:text-gray-100 whitespace-nowrap">{r.tracking}</td>
              <AddressCell r={r.recipient} />
              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.service || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{r.shipDate || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{r.invoiceNumber || '—'}{r.invoiceDate ? ` · ${r.invoiceDate}` : ''}</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-800 dark:text-gray-100">{fmt(r.billed)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Every billed shipment matched a label in the system. 🎉</td></tr>}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 font-semibold">
              <td className="px-3 py-2 text-gray-700 dark:text-gray-200" colSpan={5}>Total charged — {rows.length} shipment{rows.length !== 1 ? 's' : ''} not in system</td>
              <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">{fmt(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

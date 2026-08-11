'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Upload, FileSpreadsheet, X, AlertCircle, Loader2, Download, ArrowLeft } from 'lucide-react'
import { clsx } from 'clsx'

// ─── CSV parsing ────────────────────────────────────────────────────────────
// Handles quoted fields with embedded commas/newlines and escaped quotes ("").
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

const money = (s: string): number => {
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const normTracking = (s: string) => s.replace(/^["'\s]+|["'\s]+$/g, '').toUpperCase()
const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`

// ─── Types ──────────────────────────────────────────────────────────────────
type Carrier = 'ups' | 'fedex' | 'usps'
type Status = 'OVERCHARGE' | 'UNDERCHARGE' | 'MATCH' | 'NO_QUOTE' | 'UNMATCHED'

interface LabelMatch {
  source: 'order' | 'return'; quoted: number | null; carrier: string | null; serviceCode: string | null
  olmNumber?: number | null; amazonOrderId?: string | null; orderSource?: string | null
  shipToState?: string | null; shipToPostal?: string | null
}
interface AuditItem {
  tracking: string; billed: number; lineCount: number
  shpBilled: number; adjBilled: number // Column F: SHP (shipment) vs ADJ (adjustment)
  invoiceNumber: string; invoiceDate: string; shipDate: string
  service: string; weight: string; zone: string
  quoted: number | null // raw system quote
  expected: number | null // quote × (1 + reseller markup)
  matched: boolean; source: 'order' | 'return' | null
  olmNumber: number | null; amazonOrderId: string | null
  status: Status; variance: number | null // billed − expected
}

const TOL = 0.01 // dollars — within a penny counts as a match

const STATUS_META: Record<Status, { label: string; badge: string }> = {
  OVERCHARGE:  { label: 'Overcharge',  badge: 'bg-red-100 text-red-700 border border-red-200' },
  UNDERCHARGE: { label: 'Undercharge', badge: 'bg-blue-100 text-blue-700 border border-blue-200' },
  MATCH:       { label: 'Match',       badge: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  NO_QUOTE:    { label: 'No quote',    badge: 'bg-gray-100 text-gray-600 border border-gray-200' },
  UNMATCHED:   { label: 'Unmatched',   badge: 'bg-amber-100 text-amber-700 border border-amber-200' },
}

export default function ShippingBillAuditManager() {
  const [carrier, setCarrier] = useState<Carrier>('ups')
  const [markup, setMarkup] = useState('10') // reseller markup % applied over the system quote
  const [appliedMarkup, setAppliedMarkup] = useState(0)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AuditItem[] | null>(null)
  const [view, setView] = useState<'MATCHES' | 'NONMATCHES'>('MATCHES')
  const [subFilter, setSubFilter] = useState<'ALL' | 'OVERCHARGE' | 'UNDERCHARGE' | 'MATCH' | 'NO_QUOTE'>('ALL')
  const fileRef = useRef<HTMLInputElement>(null)

  const processUps = useCallback(async (rows: string[][], name: string, markupPct: number) => {
    if (rows.length < 2) { setErr('The file has no data rows.'); return }
    const header = rows[0].map(h => h.trim().toLowerCase())
    const col = (names: string[], fallback: number) => {
      for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i }
      return fallback
    }
    const iTrack   = col(['tracking number'], 3)          // Column D
    const iTotal   = col(['total charge'], 42)            // Column AQ
    const iInvNo   = col(['invoice number'], 1)
    const iInvDate = col(['invoice date'], 2)
    const iShip    = col(['ship date'], 6)
    const iService = col(['service'], 35)
    const iWeight  = col(['actual weight'], 25)
    const iWUnit   = col(['actual weight_unit', 'actual weight unit'], 26)
    const iZone    = col(['zone'], 28)
    const iSection = col(['invoice section'], 5)          // Column F: SHP vs ADJ

    // Group line items by tracking number → sum Total Charge (and split by section).
    const groups = new Map<string, AuditItem>()
    for (const r of rows.slice(1)) {
      const tracking = normTracking(r[iTrack] ?? '')
      if (!tracking) continue
      const charge = money(r[iTotal] ?? '')
      const isAdj = (r[iSection] ?? '').trim().toUpperCase() === 'ADJ'
      const g = groups.get(tracking)
      if (g) {
        g.billed += charge
        g.lineCount++
        if (isAdj) g.adjBilled += charge; else g.shpBilled += charge
      } else {
        groups.set(tracking, {
          tracking, billed: charge, lineCount: 1,
          shpBilled: isAdj ? 0 : charge, adjBilled: isAdj ? charge : 0,
          invoiceNumber: (r[iInvNo] ?? '').trim(),
          invoiceDate: (r[iInvDate] ?? '').trim(),
          shipDate: (r[iShip] ?? '').trim(),
          service: (r[iService] ?? '').trim(),
          weight: `${(r[iWeight] ?? '').trim()}${(r[iWUnit] ?? '').trim() ? ' ' + (r[iWUnit] ?? '').trim() : ''}`,
          zone: (r[iZone] ?? '').trim(),
          quoted: null, expected: null, matched: false, source: null, olmNumber: null, amazonOrderId: null,
          status: 'UNMATCHED', variance: null,
        })
      }
    }
    const list = Array.from(groups.values())
    if (list.length === 0) { setErr('No tracking numbers found in the file.'); return }

    // Match against purchased labels by tracking number.
    setLoading(true)
    try {
      const res = await fetch('/api/shipping-bill-audit/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumbers: list.map(i => i.tracking) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Match lookup failed')
      const matches: Record<string, LabelMatch> = data.matches ?? {}

      for (const it of list) {
        const m = matches[it.tracking]
        if (!m) { it.status = 'UNMATCHED'; continue }
        it.matched = true
        it.source = m.source
        it.quoted = m.quoted
        it.olmNumber = m.olmNumber ?? null
        it.amazonOrderId = m.amazonOrderId ?? null
        if (m.quoted == null) { it.status = 'NO_QUOTE'; continue }
        // Reseller bills the system quote plus their markup, so compare billed
        // against the marked-up quote, not the raw quote.
        it.expected = m.quoted * (1 + markupPct / 100)
        it.variance = it.billed - it.expected
        it.status = it.variance > TOL ? 'OVERCHARGE' : it.variance < -TOL ? 'UNDERCHARGE' : 'MATCH'
      }

      // Overcharges first, then by billed desc.
      const rank: Record<Status, number> = { OVERCHARGE: 0, UNMATCHED: 1, NO_QUOTE: 2, UNDERCHARGE: 3, MATCH: 4 }
      list.sort((a, b) => rank[a.status] - rank[b.status] || b.billed - a.billed)
      setItems(list)
      setFileName(name)
      setAppliedMarkup(markupPct)
      setView('MATCHES'); setSubFilter('ALL')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Match lookup failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return
    setErr('')
    const mk = parseFloat(markup)
    if (!Number.isFinite(mk) || mk < 0) { setErr('Enter a valid reseller markup % (e.g. 10) before uploading.'); return }
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) { setErr('Please upload a .csv file.'); return }
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') processUps(parseCsv(reader.result), file.name, mk) }
    reader.onerror = () => setErr('Could not read the file.')
    reader.readAsText(file)
  }, [processUps, markup])

  function reset() {
    setItems(null); setFileName(''); setErr(''); setView('MATCHES'); setSubFilter('ALL')
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Summary ──
  const summary = useMemo(() => {
    if (!items) return null
    const totalBilled = items.reduce((s, i) => s + i.billed, 0)
    const compared = items.filter(i => i.expected != null)
    const totalQuoted = compared.reduce((s, i) => s + (i.quoted ?? 0), 0)
    const totalExpected = compared.reduce((s, i) => s + (i.expected ?? 0), 0)
    const netVariance = compared.reduce((s, i) => s + (i.variance ?? 0), 0)
    const overs = items.filter(i => i.status === 'OVERCHARGE')
    const overAmount = overs.reduce((s, i) => s + (i.variance ?? 0), 0)
    const unmatched = items.filter(i => i.status === 'UNMATCHED')
    const invoices = Array.from(new Set(items.map(i => i.invoiceNumber).filter(Boolean)))
    const dates = Array.from(new Set(items.map(i => i.invoiceDate).filter(Boolean)))
    return {
      totalBilled, totalQuoted, totalExpected, netVariance, overs: overs.length, overAmount,
      unmatched: unmatched.length, unmatchedBilled: unmatched.reduce((s, i) => s + i.billed, 0),
      compared: compared.length, shipments: items.length, invoices, dates,
    }
  }, [items])

  const matched = useMemo(() => (items ?? []).filter(i => i.status !== 'UNMATCHED'), [items])
  const nonMatched = useMemo(() => (items ?? []).filter(i => i.status === 'UNMATCHED'), [items])
  const subCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: matched.length, OVERCHARGE: 0, UNDERCHARGE: 0, MATCH: 0, NO_QUOTE: 0 }
    for (const i of matched) c[i.status]++
    return c
  }, [matched])
  const shownMatched = matched.filter(i => subFilter === 'ALL' || i.status === subFilter)

  function exportFlagged() {
    const flagged = (items ?? []).filter(i => i.status === 'OVERCHARGE')
    const head = ['Tracking', 'Invoice', 'Invoice Date', 'Order', 'Service', 'Ship Date', 'Quoted', `Expected(+${appliedMarkup}%)`, 'Billed', 'Overcharge']
    const lines = [head.join(',')]
    for (const i of flagged) {
      lines.push([
        i.tracking, i.invoiceNumber, i.invoiceDate,
        i.olmNumber ? `OLM-${i.olmNumber}` : (i.amazonOrderId ?? ''),
        `"${i.service}"`, i.shipDate,
        (i.quoted ?? 0).toFixed(2), (i.expected ?? 0).toFixed(2), i.billed.toFixed(2), (i.variance ?? 0).toFixed(2),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'shipping-overcharges.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Results view ─────────────────────────────────────────────────────────
  if (items && summary) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
          {/* File bar */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={reset} className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50">
              <ArrowLeft size={13} /> New file
            </button>
            <FileSpreadsheet size={16} className="text-amazon-blue shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{fileName}</p>
              <p className="text-xs text-gray-500">
                {summary.shipments.toLocaleString()} shipments · Invoice {summary.invoices.join(', ') || '—'}
                {summary.dates.length > 0 && ` · ${summary.dates.join(', ')}`} · {appliedMarkup}% reseller markup
              </p>
            </div>
            <div className="flex-1" />
            {summary.overs > 0 && (
              <button type="button" onClick={exportFlagged} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700">
                <Download size={13} /> Export {summary.overs} overcharge{summary.overs !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Total billed" value={fmt(summary.totalBilled)} sub={`${summary.shipments} shipments`} />
            <Card label={`Expected (+${appliedMarkup}%)`} value={fmt(summary.totalExpected)} sub={`quoted ${fmt(summary.totalQuoted)} · ${summary.compared} compared`} />
            <Card
              label="Net variance" value={fmt(summary.netVariance)}
              sub="billed − expected" tone={summary.netVariance > TOL ? 'bad' : summary.netVariance < -TOL ? 'good' : 'neutral'}
            />
            <Card
              label="Overcharges" value={fmt(summary.overAmount)}
              sub={`${summary.overs} shipment${summary.overs !== 1 ? 's' : ''}`} tone={summary.overs > 0 ? 'bad' : 'good'}
            />
          </div>
          {summary.unmatched > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              <AlertCircle size={13} className="shrink-0" />
              {summary.unmatched} shipment{summary.unmatched !== 1 ? 's' : ''} ({fmt(summary.unmatchedBilled)}) on this bill had no matching label purchased through the system — review whether these are ours.
            </div>
          )}

          {/* Matches / Non-Matches split — first question is "is this ours?" */}
          <div className="flex gap-1 border-b border-gray-200">
            {([{ id: 'MATCHES' as const, label: 'Matches', n: matched.length }, { id: 'NONMATCHES' as const, label: 'Non-Matches', n: nonMatched.length }]).map(t => (
              <button key={t.id} type="button" onClick={() => setView(t.id)}
                className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  view === t.id ? 'border-amazon-blue text-amazon-blue' : 'border-transparent text-gray-500 hover:text-gray-700')}>
                {t.label} <span className={clsx('ml-1 text-xs', view === t.id ? 'text-amazon-blue/70' : 'text-gray-400')}>{t.n}</span>
              </button>
            ))}
          </div>

          {view === 'MATCHES' ? (
            <>
              <p className="text-xs text-gray-500">Billed to a label we purchased through the system. Compare quoted vs billed; overcharges are flagged.</p>
              <div className="flex flex-wrap gap-1.5">
                {(['ALL', 'OVERCHARGE', 'UNDERCHARGE', 'MATCH', 'NO_QUOTE'] as const).map(f => (
                  <button key={f} type="button" onClick={() => setSubFilter(f)}
                    className={clsx('h-8 px-3 rounded-md text-xs font-medium border transition-colors',
                      subFilter === f ? 'bg-amazon-blue text-white border-amazon-blue' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50')}>
                    {f === 'ALL' ? 'All' : STATUS_META[f].label} <span className={clsx('ml-1', subFilter === f ? 'text-white/80' : 'text-gray-400')}>{subCounts[f]}</span>
                  </button>
                ))}
              </div>
              <MatchedTable rows={shownMatched} markup={appliedMarkup} />
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">Billed by UPS but with no matching label purchased through the system — verify these belong to us before paying.</p>
              <NonMatchedTable rows={nonMatched} />
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
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
          <p className="font-medium mb-1">How this works</p>
          <p className="text-blue-800 dark:text-blue-300/90 text-[13px] leading-relaxed">
            Upload your UPS billing CSV. Each billed shipment is matched to the label we bought through the system
            by <span className="font-semibold">tracking number</span> (quotes stripped), and the carrier&apos;s
            charge — <span className="font-semibold">Total Charge</span>, summed across all line items for the same
            tracking number — is compared to the quoted price <span className="font-semibold">plus the reseller markup</span> below. Anything billed above that is flagged as an overcharge to dispute.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Carrier</label>
          <div className="flex gap-2">
            {([{ id: 'ups' as const, label: 'UPS', enabled: true }, { id: 'fedex' as const, label: 'FedEx', enabled: false }, { id: 'usps' as const, label: 'USPS', enabled: false }]).map(c => (
              <button key={c.id} type="button" disabled={!c.enabled} onClick={() => c.enabled && setCarrier(c.id)}
                className={clsx('h-9 px-4 rounded-md text-sm font-medium border transition-colors',
                  carrier === c.id ? 'bg-amazon-blue text-white border-amazon-blue'
                    : c.enabled ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    : 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed')}
                title={c.enabled ? '' : 'Coming soon'}>
                {c.label}{!c.enabled && <span className="ml-1.5 text-[10px]">soon</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Reseller markup — the bill = system quote + this % */}
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Reseller markup %</label>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="number" step="0.1" min={0} value={markup}
                onChange={e => setMarkup(e.target.value)}
                className="w-28 h-9 rounded-md border border-gray-300 pl-3 pr-7 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
            </div>
            <p className="text-xs text-gray-500">
              We&apos;re billed the system quote plus this markup — a $20.00 quote at {markup || '0'}% should bill{' '}
              <span className="font-mono text-gray-700">${(20 * (1 + (parseFloat(markup) || 0) / 100)).toFixed(2)}</span> and count as a match.
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
            loading ? 'cursor-wait border-gray-200 bg-gray-50' : 'cursor-pointer',
            dragging ? 'border-amazon-blue bg-amazon-blue/5' : !loading && 'border-gray-300 hover:border-gray-400 bg-gray-50/50')}
        >
          {loading ? (
            <><Loader2 size={28} className="mx-auto text-amazon-blue mb-3 animate-spin" /><p className="text-sm font-medium text-gray-600">Matching against purchased labels…</p></>
          ) : (
            <>
              <Upload size={28} className="mx-auto text-gray-400 mb-3" />
              <p className="text-sm font-medium text-gray-700">Drop your UPS billing CSV here, or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Tracking = Column D · Total Charge = Column AQ</p>
            </>
          )}
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={clsx('text-xl font-bold mt-0.5', tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-gray-900')}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// Column F (Invoice Section): standard shipment vs adjustment.
const chargeType = (i: AuditItem) =>
  Math.abs(i.shpBilled) > 0.005 && Math.abs(i.adjBilled) > 0.005 ? 'Shipment + Adj'
    : Math.abs(i.adjBilled) > 0.005 ? 'Adjustment' : 'Shipment'

function BilledCell({ i }: { i: AuditItem }) {
  return (
    <td className="px-3 py-1.5 text-right font-mono text-gray-800">
      {fmt(i.billed)}
      {Math.abs(i.adjBilled) > 0.005 && <div className="text-[10px] text-gray-400 font-normal">incl. adj {fmt(i.adjBilled)}</div>}
    </td>
  )
}

function Tracking({ i }: { i: AuditItem }) {
  return (
    <td className="px-3 py-1.5 font-mono text-gray-800 whitespace-nowrap">
      {i.tracking}
      {i.lineCount > 1 && <span className="ml-1.5 text-[10px] text-gray-400">({i.lineCount} lines)</span>}
    </td>
  )
}

function MatchedTable({ rows, markup }: { rows: AuditItem[]; markup: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Tracking</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Order</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Service</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Ship Date</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Wt / Zone</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Quoted</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Expected<span className="text-gray-400 font-normal"> +{markup}%</span></th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Billed</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Variance</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(i => (
            <tr key={i.tracking} className="hover:bg-gray-50">
              <Tracking i={i} />
              <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">
                {i.olmNumber ? `OLM-${i.olmNumber}` : i.amazonOrderId ? <span className="font-mono">{i.amazonOrderId}</span> : <span className="text-gray-300">—</span>}
                {i.source === 'return' && <span className="ml-1 text-[10px] text-gray-400">(return)</span>}
              </td>
              <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{i.service || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{i.shipDate || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{i.weight || '—'}{i.zone ? ` · Z${i.zone}` : ''}</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-400">{i.quoted != null ? fmt(i.quoted) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-700">{i.expected != null ? fmt(i.expected) : '—'}</td>
              <BilledCell i={i} />
              <td className={clsx('px-3 py-1.5 text-right font-mono font-medium',
                i.variance == null ? 'text-gray-300' : i.variance > TOL ? 'text-red-600' : i.variance < -TOL ? 'text-blue-600' : 'text-gray-400')}>
                {i.variance != null ? fmt(i.variance) : '—'}
              </td>
              <td className="px-3 py-1.5"><span className={clsx('inline-block rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_META[i.status].badge)}>{STATUS_META[i.status].label}</span></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No shipments in this view.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function NonMatchedTable({ rows }: { rows: AuditItem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Tracking</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Type</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Service</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Ship Date</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Wt / Zone</th>
            <th className="px-3 py-2 text-right font-semibold text-gray-500">Billed</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-500">Invoice</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(i => (
            <tr key={i.tracking} className="hover:bg-gray-50">
              <Tracking i={i} />
              <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{chargeType(i)}</td>
              <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{i.service || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{i.shipDate || '—'}</td>
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{i.weight || '—'}{i.zone ? ` · Z${i.zone}` : ''}</td>
              <BilledCell i={i} />
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{i.invoiceNumber || '—'}{i.invoiceDate ? ` · ${i.invoiceDate}` : ''}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Every billed shipment matched a purchased label. 🎉</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

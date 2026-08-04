'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { X, AlertCircle, CheckCircle2, XCircle, FileSpreadsheet, Download, Upload, ArrowLeft, ClipboardCheck, ShieldAlert, AlertTriangle, Loader2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GradeOption { id: string; grade: string; description: string | null }
interface Product { id: string; description: string; sku: string; isSerializable: boolean }
interface POLine { id: string; productId: string; product: Product; qty: number; unitCost: string; qtyReceived?: number }
interface ResolvedPO { id: string; poNumber: number; status: string; vendor: { name: string }; lines: POLine[] }
interface Warehouse { id: string; name: string; locations: Location[] }
interface Location  { id: string; name: string; warehouseId: string }

interface ParsedRow {
  poRaw: string
  poNumber: number | null
  sku: string
  cost: string
  serial: string
  matchedPo: ResolvedPO | null
  matchedLine: POLine | null
  error: string | null
  loading: boolean
}

interface SerialWarning { type: 'serials_in_stock' | 'existing_serials_warning'; message: string; serials: string[] }
interface POResult { poNumber: number; status: 'success' | 'blocked' | 'skipped' | 'failed'; units: number; message?: string; serials?: string[] }

// Parse a cost string ("$5", "5.00") to integer cents, or null.
function costToCents(s: string): number | null {
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900"><X size={14} /></button>
    </div>
  )
}

// ─── Serial Warning Modal (per-PO, during submit) ─────────────────────────────

function SerialWarningModal({ warning, onProceed, onClose }: { warning: SerialWarning; onProceed: () => void; onClose: () => void }) {
  const isHardBlock = warning.type === 'serials_in_stock'
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
        <div className={`flex items-start justify-between px-5 py-4 border-b shrink-0 ${isHardBlock ? 'bg-red-50' : 'bg-amber-50'}`}>
          <div className="flex items-center gap-2.5">
            {isHardBlock ? <ShieldAlert size={18} className="text-red-600 shrink-0" /> : <AlertTriangle size={18} className="text-amber-600 shrink-0" />}
            <div>
              <h3 className={`text-sm font-semibold ${isHardBlock ? 'text-red-900' : 'text-amber-900'}`}>
                {isHardBlock ? 'Unable to Receive' : 'Shipped Out — Receive Anyway?'}
              </h3>
              <p className={`text-xs mt-0.5 ${isHardBlock ? 'text-red-700' : 'text-amber-700'}`}>{warning.message}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className={`text-xs font-medium mb-2 ${isHardBlock ? 'text-red-700' : 'text-amber-700'}`}>
            {warning.serials.length} serial{warning.serials.length !== 1 ? 's' : ''} affected:
          </p>
          <div className={`rounded-md border p-3 max-h-[240px] overflow-y-auto font-mono text-sm leading-relaxed ${isHardBlock ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            {warning.serials.map((sn, i) => <div key={i}>{sn}</div>)}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0">
          {isHardBlock ? (
            <button type="button" onClick={onClose} className="h-9 px-5 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700">Close</button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Skip this PO</button>
              <button type="button" onClick={onProceed} className="h-9 px-5 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">Receive Anyway</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── BulkSpreadsheetReceiveModal ──────────────────────────────────────────────

export default function BulkSpreadsheetReceiveModal({ onReceived, onClose }: { onReceived: () => void; onClose: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [allGrades, setAllGrades]   = useState<GradeOption[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId]   = useState('')
  const [gradeId, setGradeId]         = useState<string | null>(null)

  const [rawText, setRawText]         = useState('')
  const [parsedRows, setParsedRows]   = useState<ParsedRow[]>([])
  const [phase, setPhase]             = useState<'input' | 'confirm' | 'results'>('input')
  const [poResults, setPoResults]     = useState<POResult[]>([])
  const [serialWarning, setSerialWarning] = useState<SerialWarning | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // PO resolution cache: number → resolved PO, or null if not found.
  const [poCache, setPoCache] = useState<Record<number, ResolvedPO | null>>({})
  const inFlight = useRef<Set<number>>(new Set())
  const warningResolver = useRef<((v: boolean) => void) | null>(null)

  // Load warehouses + grades
  useEffect(() => {
    (async () => {
      setLoadingData(true)
      try {
        const [whRes, gradesRes] = await Promise.all([fetch('/api/warehouses'), fetch('/api/grades')])
        const whData = await whRes.json()
        const gradesData = await gradesRes.json()
        const whs: Warehouse[] = whData.data ?? []
        setWarehouses(whs)
        setAllGrades(gradesData.data ?? [])
        if (whs[0]) {
          setWarehouseId(whs[0].id)
          if (whs[0].locations[0]) setLocationId(whs[0].locations[0].id)
        }
      } catch {
        setErr('Failed to load data')
      } finally {
        setLoadingData(false)
      }
    })()
  }, [])

  // Resolve a PO by its human number via the search route (exact match).
  const fetchPO = useCallback(async (num: number) => {
    if (inFlight.current.has(num)) return
    inFlight.current.add(num)
    try {
      const res = await fetch(`/api/purchase-orders?search=${num}`)
      const data = await res.json()
      const found = (data.data ?? []).find((p: ResolvedPO) => p.poNumber === num) ?? null
      setPoCache(prev => ({ ...prev, [num]: found }))
    } catch {
      setPoCache(prev => ({ ...prev, [num]: null }))
    } finally {
      inFlight.current.delete(num)
    }
  }, [])

  // Parse raw text → rows; kick off PO fetches for any unseen PO number.
  useEffect(() => {
    const text = rawText.trim()
    if (!text) { setParsedRows([]); return }
    const lines = text.split('\n').filter(l => l.trim())
    const delimiter = lines[0]?.includes('\t') ? '\t' : ','

    // Trigger fetches for PO numbers we haven't resolved yet.
    for (const line of lines) {
      const c0 = (line.split(delimiter)[0] ?? '').trim().replace(/[^0-9]/g, '')
      const n = parseInt(c0, 10)
      if (Number.isFinite(n) && n > 0 && !(n in poCache) && !inFlight.current.has(n)) fetchPO(n)
    }

    const rows: ParsedRow[] = []
    const qtyUsed = new Map<string, number>() // key `${poNumber}:${lineId}`

    for (const line of lines) {
      const cols = line.split(delimiter)
      const poRaw  = (cols[0] ?? '').trim()
      const sku    = (cols[1] ?? '').trim()
      const cost   = (cols[2] ?? '').trim()
      const serial = (cols[3] ?? '').trim()
      const base = { poRaw, sku, cost, serial, matchedPo: null as ResolvedPO | null, matchedLine: null as POLine | null }

      const poNumber = parseInt(poRaw.replace(/[^0-9]/g, ''), 10)
      if (!poRaw || !Number.isFinite(poNumber) || poNumber <= 0) {
        rows.push({ ...base, poNumber: null, error: 'Missing or invalid PO #', loading: false }); continue
      }
      const cached = poCache[poNumber]
      if (cached === undefined) { rows.push({ ...base, poNumber, error: null, loading: true }); continue }
      if (cached === null) { rows.push({ ...base, poNumber, error: `PO #${poNumber} not found`, loading: false }); continue }
      if (cached.status === 'CANCELLED') { rows.push({ ...base, poNumber, matchedPo: cached, error: `PO #${poNumber} is cancelled`, loading: false }); continue }
      if (!sku) { rows.push({ ...base, poNumber, matchedPo: cached, error: 'Missing SKU', loading: false }); continue }

      const candidates = cached.lines.filter(l => l.product.sku.toLowerCase() === sku.toLowerCase())
      if (candidates.length === 0) { rows.push({ ...base, poNumber, matchedPo: cached, error: `SKU "${sku}" not on PO #${poNumber}`, loading: false }); continue }

      let pool = candidates
      if (candidates.length > 1) {
        const costList = candidates.map(l => `$${l.unitCost}`).join(', ')
        const cents = costToCents(cost)
        if (cents === null) { rows.push({ ...base, poNumber, matchedPo: cached, error: `SKU "${sku}" has multiple costs (${costList}) — add the matching cost`, loading: false }); continue }
        pool = candidates.filter(l => costToCents(l.unitCost) === cents)
        if (pool.length === 0) { rows.push({ ...base, poNumber, matchedPo: cached, error: `Cost $${cost} doesn't match "${sku}" on PO #${poNumber} (${costList})`, loading: false }); continue }
      }

      let matched: POLine | null = null
      for (const l of pool) {
        const remaining = l.qty - (l.qtyReceived ?? 0)
        const used = qtyUsed.get(`${poNumber}:${l.id}`) ?? 0
        if (used + 1 <= remaining) { matched = l; break }
      }
      if (!matched) {
        const remaining = pool.reduce((s, l) => s + (l.qty - (l.qtyReceived ?? 0)), 0)
        rows.push({ ...base, poNumber, matchedPo: cached, matchedLine: pool[0], error: `Exceeds remaining qty (${remaining}) for "${sku}" on PO #${poNumber}`, loading: false }); continue
      }
      qtyUsed.set(`${poNumber}:${matched.id}`, (qtyUsed.get(`${poNumber}:${matched.id}`) ?? 0) + 1)

      if (matched.product.isSerializable && !serial) {
        rows.push({ ...base, poNumber, matchedPo: cached, matchedLine: matched, error: 'Serial number required for this product', loading: false }); continue
      }
      rows.push({ ...base, poNumber, matchedPo: cached, matchedLine: matched, error: null, loading: false })
    }

    // Duplicate serials within the paste (per product).
    const seen = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.error || !r.serial || !r.matchedLine) continue
      const key = `${r.matchedLine.productId}::${r.serial.toLowerCase()}`
      if (seen.has(key)) rows[i] = { ...r, error: `Duplicate serial "${r.serial}"` }
      else seen.set(key, i)
    }

    setParsedRows(rows)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText, poCache])

  const validRows   = parsedRows.filter(r => !r.error && r.matchedLine && r.matchedPo && !r.loading)
  const invalidRows = parsedRows.filter(r => r.error)
  const loadingRows = parsedRows.filter(r => r.loading)
  const locations   = warehouses.find(w => w.id === warehouseId)?.locations ?? []
  const canReview   = validRows.length > 0 && invalidRows.length === 0 && loadingRows.length === 0 && !!locationId

  // Group valid rows by PO → by PO line.
  function buildByPo() {
    const byPo = new Map<string, { po: ResolvedPO; groups: Map<string, { line: POLine; serials: string[]; qty: number }> }>()
    for (const row of validRows) {
      const po = row.matchedPo!
      const line = row.matchedLine!
      let bucket = byPo.get(po.id)
      if (!bucket) { bucket = { po, groups: new Map() }; byPo.set(po.id, bucket) }
      const g = bucket.groups.get(line.id)
      if (g) { g.qty++; if (row.serial) g.serials.push(row.serial) }
      else bucket.groups.set(line.id, { line, serials: row.serial ? [row.serial] : [], qty: 1 })
    }
    return Array.from(byPo.values())
      .map(b => ({ po: b.po, groups: Array.from(b.groups.values()) }))
      .sort((a, b) => a.po.poNumber - b.po.poNumber)
  }

  const stagedPos = phase === 'confirm' ? buildByPo() : []

  function handleDownloadTemplate() {
    const rows = ['PO #,SKU,Cost,Serial', '1000,ABC-123,25.00,SN-00001', '1000,ABC-123,25.00,SN-00002', '1001,DEF-456,15.50,SN-00003']
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'bulk-receive-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length === 0) return
      const delimiter = lines[0].includes('\t') ? '\t' : ','
      const firstCols = lines[0].split(delimiter).map(c => c.trim().toLowerCase())
      const isHeader = firstCols[0].startsWith('po') || firstCols.includes('sku') || firstCols.includes('cost') || firstCols.includes('serial')
      const dataLines = isHeader ? lines.slice(1) : lines
      setRawText(dataLines.map(l => l.split(delimiter).map(c => c.trim()).join('\t')).join('\n'))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleReview() {
    setErr('')
    if (!locationId) { setErr('Select a warehouse and location'); return }
    if (loadingRows.length > 0) { setErr('Still resolving some PO numbers — wait a moment'); return }
    if (invalidRows.length > 0) { setErr('Fix all validation errors before submitting'); return }
    if (validRows.length === 0) { setErr('No valid rows to submit'); return }
    setPhase('confirm')
  }

  function askProceed(warning: SerialWarning): Promise<boolean> {
    return new Promise(resolve => { warningResolver.current = resolve; setSerialWarning(warning) })
  }

  async function postOnePo(poId: string, groups: { line: POLine; serials: string[]; qty: number }[], confirmExisting: boolean) {
    const payload = {
      notes: 'Received via bulk spreadsheet',
      confirmExisting: confirmExisting || undefined,
      lines: groups.map(g => ({
        purchaseOrderLineId: g.line.id,
        productId: g.line.productId,
        qtyReceived: g.qty,
        locationId,
        gradeId: gradeId ?? null,
        serials: g.line.product.isSerializable ? g.serials.filter(Boolean) : undefined,
      })),
    }
    const res = await fetch(`/api/purchase-orders/${poId}/receipts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true as const }
    return { ok: false as const, error: data.error as string | undefined, serials: data.serials as string[] | undefined, message: data.message as string | undefined }
  }

  async function handleConfirmSubmit() {
    setErr('')
    setSaving(true)
    const byPo = buildByPo()
    const results: POResult[] = []
    for (const { po, groups } of byPo) {
      const units = groups.reduce((s, g) => s + g.qty, 0)
      let confirmExisting = false
      for (;;) {
        const r = await postOnePo(po.id, groups, confirmExisting)
        if (r.ok) { results.push({ poNumber: po.poNumber, status: 'success', units }); break }
        if (r.error === 'serials_in_stock') { results.push({ poNumber: po.poNumber, status: 'blocked', units, message: r.message, serials: r.serials }); break }
        if (r.error === 'existing_serials_warning' && !confirmExisting) {
          const proceed = await askProceed({ type: 'existing_serials_warning', message: `PO #${po.poNumber}: ${r.message ?? 'Some serials were shipped out previously.'}`, serials: r.serials ?? [] })
          setSerialWarning(null)
          if (proceed) { confirmExisting = true; continue }
          results.push({ poNumber: po.poNumber, status: 'skipped', units }); break
        }
        results.push({ poNumber: po.poNumber, status: 'failed', units, message: r.error ?? 'Receive failed' }); break
      }
    }
    setSaving(false)
    setPoResults(results)
    setPhase('results')
  }

  // ─── Results view ───────────────────────────────────────────────────────────
  if (phase === 'results') {
    const ok = poResults.filter(r => r.status === 'success')
    const bad = poResults.filter(r => r.status !== 'success')
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={16} className="text-amazon-blue" />
              <h2 className="text-sm font-semibold text-gray-900">Bulk Receive — Results</h2>
            </div>
            <button type="button" onClick={() => onReceived()} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-600"><CheckCircle2 size={14} /> {ok.length} PO{ok.length !== 1 ? 's' : ''} received</span>
              {bad.length > 0 && <span className="flex items-center gap-1 text-red-600"><XCircle size={14} /> {bad.length} not received</span>}
            </div>
            <div className="space-y-2">
              {poResults.map(r => (
                <div key={r.poNumber} className={`rounded-lg border px-4 py-2.5 ${
                  r.status === 'success' ? 'border-green-200 bg-green-50/50'
                  : r.status === 'skipped' ? 'border-gray-200 bg-gray-50'
                  : 'border-red-200 bg-red-50/50'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">PO #{r.poNumber}</span>
                    <span className={`text-xs font-medium ${
                      r.status === 'success' ? 'text-green-700'
                      : r.status === 'skipped' ? 'text-gray-500'
                      : 'text-red-700'}`}>
                      {r.status === 'success' ? `Received ${r.units} unit${r.units !== 1 ? 's' : ''}`
                        : r.status === 'blocked' ? 'Blocked — serials in stock'
                        : r.status === 'skipped' ? 'Skipped'
                        : 'Failed'}
                    </span>
                  </div>
                  {r.message && r.status !== 'success' && <p className="text-xs text-gray-500 mt-1">{r.message}</p>}
                  {r.serials && r.serials.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.serials.map((s, i) => <span key={i} className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-mono text-red-700">{s}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end px-6 py-4 border-t shrink-0">
            <button type="button" onClick={() => onReceived()} className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">Done</button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Confirmation view ──────────────────────────────────────────────────────
  if (phase === 'confirm') {
    const totalUnits = stagedPos.reduce((s, p) => s + p.groups.reduce((t, g) => t + g.qty, 0), 0)
    const selectedWarehouse = warehouses.find(w => w.id === warehouseId)
    const selectedLocation  = locations.find(l => l.id === locationId)
    const selectedGrade     = allGrades.find(g => g.id === gradeId)
    return (
      <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[820px] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={16} className="text-amazon-blue" />
                  <h2 className="text-sm font-semibold text-gray-900">Confirm Bulk Receiving — {stagedPos.length} PO{stagedPos.length !== 1 ? 's' : ''}</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">Review each PO before processing</p>
              </div>
              <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}
              <div className="flex items-center gap-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm">
                <div><span className="text-gray-500">POs:</span> <span className="font-semibold text-gray-800">{stagedPos.length}</span></div>
                <div><span className="text-gray-500">Units:</span> <span className="font-semibold text-gray-800">{totalUnits}</span></div>
                <div><span className="text-gray-500">Warehouse:</span> <span className="font-semibold text-gray-800">{selectedWarehouse?.name ?? '—'}</span></div>
                <div><span className="text-gray-500">Location:</span> <span className="font-semibold text-gray-800">{selectedLocation?.name ?? '—'}</span></div>
                {selectedGrade && <div><span className="text-gray-500">Grade:</span> <span className="font-semibold text-gray-800">{selectedGrade.grade}</span></div>}
              </div>
              <div className="space-y-4">
                {stagedPos.map(({ po, groups }) => (
                  <div key={po.id} className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between bg-amazon-blue/5 px-4 py-2 border-b border-gray-200">
                      <span className="text-sm font-semibold text-gray-800">PO #{po.poNumber} <span className="font-normal text-gray-500">· {po.vendor.name}</span></span>
                      <span className="text-xs font-semibold text-gray-600">{groups.reduce((s, g) => s + g.qty, 0)} unit{groups.reduce((s, g) => s + g.qty, 0) !== 1 ? 's' : ''}</span>
                    </div>
                    {groups.map(g => (
                      <div key={g.line.id} className="px-4 py-2 border-b border-gray-100 last:border-b-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-sm font-semibold text-gray-800">{g.line.product.sku}</span>
                            <span className="text-xs text-gray-500">${g.line.unitCost}</span>
                            <span className="text-xs text-gray-400 truncate">{g.line.product.description}</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-700 shrink-0">Qty: {g.qty}</span>
                        </div>
                        {g.line.product.isSerializable && g.serials.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {g.serials.filter(Boolean).map((sn, i) => <span key={i} className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700">{sn}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-t shrink-0">
              <button type="button" onClick={() => { setPhase('input'); setErr('') }} className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                <ArrowLeft size={14} /> Back
              </button>
              <button type="button" onClick={handleConfirmSubmit} disabled={saving} className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60">
                {saving ? 'Processing…' : `Confirm & Receive ${totalUnits} item${totalUnits !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
        {serialWarning && (
          <SerialWarningModal
            warning={serialWarning}
            onProceed={() => { warningResolver.current?.(true) }}
            onClose={() => { warningResolver.current?.(false) }}
          />
        )}
      </>
    )
  }

  // ─── Input view ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[820px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-amazon-blue" />
              <h2 className="text-sm font-semibold text-gray-900">Bulk Spreadsheet Receive</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Receive against multiple existing POs at once — one row per unit, keyed by PO #</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}
          {loadingData ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
          ) : warehouses.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-gray-700 mb-1">No warehouses configured</p>
              <p className="text-xs text-gray-500">Add at least one warehouse with a location before receiving.</p>
            </div>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse</label>
                  <select value={warehouseId} onChange={e => { setWarehouseId(e.target.value); setLocationId(warehouses.find(w => w.id === e.target.value)?.locations[0]?.id ?? '') }}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue">
                    <option value="">Select…</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                  <select value={locationId} onChange={e => setLocationId(e.target.value)} disabled={!warehouseId || locations.length === 0}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:opacity-50">
                    <option value="">Select…</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                {allGrades.length > 0 && (
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Grade</label>
                    <select value={gradeId ?? ''} onChange={e => setGradeId(e.target.value || null)}
                      className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue">
                      <option value="">Select grade…</option>
                      {allGrades.map(g => <option key={g.id} value={g.id}>{g.grade}{g.description ? ` — ${g.description}` : ''}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">
                    Paste or upload data <span className="text-gray-400 font-normal">(PO #, SKU, Cost, Serial)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleDownloadTemplate} className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"><Download size={12} /> Download Template</button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"><Upload size={12} /> Upload CSV</button>
                    <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
                  </div>
                </div>
                <textarea value={rawText} onChange={e => setRawText(e.target.value)} rows={8} spellCheck={false}
                  placeholder={`1000\tIPHONE-14-128\t199.99\tSN-00001\n1000\tIPHONE-14-128\t199.99\tSN-00002\n1001\tSAMSUNG-S23\t149.99\tSN-00003`}
                  className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none" />
              </div>

              {parsedRows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Preview — {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''}</p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1 text-green-600"><CheckCircle2 size={12} /> {validRows.length} valid</span>
                      {loadingRows.length > 0 && <span className="flex items-center gap-1 text-gray-400"><Loader2 size={12} className="animate-spin" /> {loadingRows.length} resolving</span>}
                      {invalidRows.length > 0 && <span className="flex items-center gap-1 text-red-600"><XCircle size={12} /> {invalidRows.length} error{invalidRows.length !== 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[240px] overflow-y-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 sticky top-0">
                          <th className="px-3 py-2 text-left font-semibold text-gray-500 w-8" />
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">PO #</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">SKU</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-500">Cost</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">Serial</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {parsedRows.map((row, i) => (
                          <tr key={i} className={row.error ? 'bg-red-50/50' : ''}>
                            <td className="px-3 py-1.5 text-center">
                              {row.loading ? <Loader2 size={13} className="text-gray-400 inline animate-spin" />
                                : row.error ? <XCircle size={13} className="text-red-500 inline" />
                                : <CheckCircle2 size={13} className="text-green-500 inline" />}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-gray-700">{row.poRaw || '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-gray-700">{row.sku || '—'}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{row.cost ? `$${row.cost}` : '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-gray-700">{row.serial || '—'}</td>
                            <td className="px-3 py-1.5">
                              {row.loading ? <span className="text-gray-400">Resolving PO…</span>
                                : row.error ? <span className="text-red-600">{row.error}</span>
                                : <span className="text-green-600">OK</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          {warehouses.length > 0 && (
            <button type="button" onClick={handleReview} disabled={!canReview || loadingData}
              className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60">
              Review {validRows.length} item{validRows.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Plus, Pencil, Trash2, X, AlertCircle, ShoppingCart, ChevronDown, ChevronUp, PackageCheck, Clock, Upload, Search, Download, FileUp, Eye, Receipt } from 'lucide-react'
import { clsx } from 'clsx'
import ReceiveModal from './ReceiveModal'
import SpreadsheetReceiveModal from './SpreadsheetReceiveModal'
import GenerateBillModal from './GenerateBillModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vendor  { id: string; vendorNumber: number; name: string }
interface Product { id: string; description: string; sku: string; isSerializable: boolean }
interface Grade   { id: string; grade: string }

interface CostCode { id: string; name: string; amount: string }

interface POLine {
  id: string
  productId: string
  product: Product
  gradeId: string | null
  grade: Grade | null
  costCodeId: string | null
  costCode: CostCode | null
  qty: number
  unitCost: string
  qtyReceived?: number
}

interface PurchaseOrder {
  id: string
  poNumber: number
  vendor: Vendor
  date: string
  notes: string | null
  status: 'OPEN' | 'RECEIVED' | 'CANCELLED'
  vendorInvoiceBase64: string | null
  vendorInvoiceFilename: string | null
  createdAt: string
  lines: POLine[]
  ledgerEntry: { id: string } | null
}

interface FormLine {
  id?: string
  productId: string
  sku: string
  description: string
  qty: number
  unitCost: string
  gradeId: string | null
  gradeName: string | null
  grades: Grade[]
  costCodeId: string | null
  qtyReceived: number
}

interface ReceiptSerial {
  id: string
  serialNumber: string
  status: string
  grade: { grade: string } | null
}

interface ReceiptLine {
  id: string
  productId: string
  product: { description: string; sku: string }
  qtyReceived: number
  location: { name: string; warehouse: { name: string } }
  serials: ReceiptSerial[]
}

interface Receipt {
  id: string
  receivedAt: string
  notes: string | null
  lines: ReceiptLine[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

async function apiFetch(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

const STATUS_LABEL: Record<string, string> = { OPEN: 'Open', RECEIVED: 'Received', CANCELLED: 'Cancelled' }
const STATUS_COLOR: Record<string, string> = {
  OPEN:      'bg-blue-100 text-blue-700',
  RECEIVED:  'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
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

// ─── Dedup helper ─────────────────────────────────────────────────────────────

function dedupKey(sku: string, unitCost: string, grade: string | null) {
  return `${sku.toLowerCase()}|${unitCost}|${(grade || '').toLowerCase()}`
}

function mergeFormLines(existing: FormLine[], incoming: FormLine[]): FormLine[] {
  const map = new Map<string, FormLine>()
  for (const l of [...existing, ...incoming]) {
    if (!l.productId) continue
    const k = dedupKey(l.sku, l.unitCost, l.gradeName)
    const prev = map.get(k)
    if (prev) {
      map.set(k, { ...prev, qty: prev.qty + l.qty })
    } else {
      map.set(k, { ...l })
    }
  }
  return Array.from(map.values())
}

// ─── PO Form Modal ───────────────────────────────────────────────────────────

function POPanel({
  editing,
  vendors,
  products,
  onSaved,
  onClose,
}: {
  editing: PurchaseOrder | null
  vendors: Vendor[]
  products: Product[]
  onSaved: () => void
  onClose: () => void
}) {
  const isEdit = editing !== null
  const isReceived = editing?.status === 'RECEIVED'

  const [vendorId, setVendorId]   = useState(editing?.vendor.id ?? '')
  const [date,     setDate]       = useState(editing ? editing.date.slice(0, 10) : today())
  const [notes,    setNotes]      = useState(editing?.notes ?? '')
  const [status,   setStatus]     = useState<'OPEN' | 'RECEIVED' | 'CANCELLED'>(editing?.status ?? 'OPEN')
  const [saving,   setSaving]     = useState(false)
  const [err,      setErr]        = useState('')

  // ── Invoice state ──────────────────────────────────────────────────────
  const [invoiceBase64,   setInvoiceBase64]   = useState<string | null>(editing?.vendorInvoiceBase64 ?? null)
  const [invoiceFilename, setInvoiceFilename] = useState<string | null>(editing?.vendorInvoiceFilename ?? null)
  const invoiceRef = useRef<HTMLInputElement>(null)

  function handleInvoiceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setErr('Invoice file must be under 5 MB'); return }
    if (!file.type.match(/^(application\/pdf|image\/(png|jpe?g|webp|gif))$/)) {
      setErr('Invoice must be a PDF or image (PNG, JPG, WebP, GIF)'); return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setInvoiceBase64(reader.result)
        setInvoiceFilename(file.name)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Line items state ──────────────────────────────────────────────────────
  const [lines, setLines] = useState<FormLine[]>([])
  const [linesReady, setLinesReady] = useState(false)

  // Build product lookup by SKU (lowercase)
  const skuMap = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) m.set(p.sku.toLowerCase(), p)
    return m
  }, [products])

  // Global grades
  const [globalGrades, setGlobalGrades] = useState<Grade[]>([])
  // Cost codes
  const [costCodes, setCostCodes] = useState<CostCode[]>([])

  useEffect(() => {
    fetch('/api/grades')
      .then(r => r.json())
      .then(j => setGlobalGrades((j.data ?? []).map((g: { id: string; grade: string }) => ({ id: g.id, grade: g.grade }))))
      .catch(() => {})
    fetch('/api/cost-codes?active=true')
      .then(r => r.json())
      .then(j => setCostCodes(j.data ?? []))
      .catch(() => {})
  }, [])

  // Init lines from editing PO
  useEffect(() => {
    if (isEdit && editing.lines.length) {
      const formLines: FormLine[] = editing.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        sku: l.product.sku,
        description: l.product.description,
        qty: l.qty,
        unitCost: String(l.unitCost),
        gradeId: l.gradeId ?? null,
        gradeName: l.grade?.grade ?? null,
        grades: globalGrades,
        costCodeId: l.costCodeId ?? null,
        qtyReceived: l.qtyReceived ?? 0,
      }))
      setLines(formLines)
      setLinesReady(true)
    } else {
      setLinesReady(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function removeLine(i: number) {
    if (lines[i]?.qtyReceived > 0) { setErr('Cannot remove a line that has been partially received'); return }
    setLines(p => p.filter((_, idx) => idx !== i))
  }
  function updateLine(i: number, patch: Partial<FormLine>) {
    setLines(p => p.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  const lineTotal = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0)

  // ── SKU autocomplete ──────────────────────────────────────────────────────
  const [skuSearch, setSkuSearch]       = useState('')
  const [skuResults, setSkuResults]     = useState<Product[]>([])
  const [skuDropOpen, setSkuDropOpen]   = useState(false)
  const [skuLoading, setSkuLoading]     = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()
  const skuWrapRef = useRef<HTMLDivElement>(null)

  function handleSkuChange(val: string) {
    setSkuSearch(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!val.trim()) { setSkuResults([]); setSkuDropOpen(false); return }
    searchTimer.current = setTimeout(async () => {
      setSkuLoading(true)
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(val.trim())}`)
        const data = await res.json()
        setSkuResults(data.data ?? [])
        setSkuDropOpen(true)
      } catch { /* ignore */ }
      setSkuLoading(false)
    }, 250)
  }

  async function selectProduct(p: Product) {
    setSkuSearch('')
    setSkuResults([])
    setSkuDropOpen(false)
    setLines(prev => [...prev, {
      productId: p.id,
      sku: p.sku,
      description: p.description,
      qty: 1,
      unitCost: '',
      gradeId: null,
      gradeName: null,
      grades: globalGrades,
      costCodeId: null,
      qtyReceived: 0,
    }])
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (skuWrapRef.current && !skuWrapRef.current.contains(e.target as Node)) setSkuDropOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // ── Spreadsheet import ────────────────────────────────────────────────────
  const [showSpreadsheet, setShowSpreadsheet] = useState(false)
  const [pasteText, setPasteText]             = useState('')
  const [importErrors, setImportErrors]       = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImport() {
    const raw = pasteText.trim()
    if (!raw) return
    setImportErrors([])

    // auto-detect delimiter
    const firstLine = raw.split('\n')[0]
    const delim = firstLine.includes('\t') ? '\t' : ','

    const rows = raw.split('\n').map(r => r.split(delim).map(c => c.trim().replace(/^"|"$/g, '')))

    // Detect column mapping from header row (flexible order)
    let startIdx = 0
    let colSku = 0, colCost = 1, colGrade = 2, colQty = 3
    const hdr = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''))
    const hasHeader = hdr.some(h => ['sku', 'cost', 'qty', 'grade', 'quantity', 'price', 'unitcost'].includes(h))
    if (hasHeader && rows.length > 1) {
      startIdx = 1
      const findCol = (...names: string[]) => hdr.findIndex(h => names.includes(h))
      const s = findCol('sku')
      const c = findCol('cost', 'unitcost', 'price')
      const g = findCol('grade')
      const q = findCol('qty', 'quantity')
      if (s >= 0) colSku = s
      if (c >= 0) colCost = c
      if (g >= 0) colGrade = g
      if (q >= 0) colQty = q
    }

    const errors: string[] = []
    const parsed: FormLine[] = []
    const uniqueProductIds = new Set<string>()

    // Pre-collect unique SKUs
    for (let i = startIdx; i < rows.length; i++) {
      const sku = rows[i][colSku]
      if (!sku) continue
      const product = skuMap.get(sku.toLowerCase())
      if (product) uniqueProductIds.add(product.id)
    }

    for (let i = startIdx; i < rows.length; i++) {
      const row = rows[i]
      const sku = row[colSku] ?? ''
      const rawCost = row[colCost] ?? ''
      const gradeStr = row[colGrade] ?? ''
      const rawQty = row[colQty] ?? ''
      if (!sku) continue

      const product = skuMap.get(sku.toLowerCase())
      if (!product) { errors.push(`Row ${i + 1}: SKU "${sku}" not found`); continue }

      const costClean = rawCost.replace(/[$,\s]/g, '')
      const qtyClean = rawQty.replace(/[$,\s]/g, '')

      const cost = parseFloat(costClean)
      if (isNaN(cost) || cost < 0) { errors.push(`Row ${i + 1}: invalid Cost "${rawCost}"`); continue }

      const qty = parseInt(qtyClean, 10)
      if (!qty || qty < 1) { errors.push(`Row ${i + 1}: invalid QTY "${rawQty}"`); continue }

      let gradeId: string | null = null
      let gradeName: string | null = null
      if (gradeStr) {
        const match = globalGrades.find(g => g.grade.toLowerCase() === gradeStr.toLowerCase())
        if (!match) { errors.push(`Row ${i + 1}: grade "${gradeStr}" not found`); continue }
        gradeId = match.id
        gradeName = match.grade
      }

      parsed.push({
        productId: product.id,
        sku: product.sku,
        description: product.description,
        qty,
        unitCost: cost.toFixed(2),
        gradeId,
        gradeName,
        grades: globalGrades,
        costCodeId: null,
        qtyReceived: 0,
      })
    }

    setImportErrors(errors)
    if (parsed.length > 0) {
      setLines(prev => mergeFormLines(prev, parsed))
      setPasteText('')
      if (errors.length === 0) setShowSpreadsheet(false)
    }
  }

  function downloadTemplate() {
    const header = 'SKU,Cost,Grade,QTY'
    const example = 'ABC-123,25.00,A,10'
    const blob = new Blob([header + '\n' + example + '\n'], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'po-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') setPasteText(reader.result) }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setErr('')
    if (!vendorId)    { setErr('Select a vendor'); return }
    if (!date)        { setErr('Date is required'); return }
    if (!lines.length){ setErr('Add at least one line item'); return }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l.productId) { setErr(`Line ${i + 1}: select a product`); return }
      if (!l.qty || l.qty < 1) { setErr(`Line ${i + 1}: qty must be at least 1`); return }
      if (l.qtyReceived > 0 && l.qty < l.qtyReceived) { setErr(`Line ${i + 1}: qty cannot be less than ${l.qtyReceived} received units`); return }
    }

    setSaving(true)
    try {
      const payload = {
        vendorId, date, notes: notes.trim() || null,
        status: isEdit ? status : 'OPEN',
        vendorInvoiceBase64: invoiceBase64,
        vendorInvoiceFilename: invoiceFilename,
        lines: lines.map(l => ({
          ...(l.id ? { id: l.id } : {}),
          productId: l.productId,
          qty: Number(l.qty),
          unitCost: Number(l.unitCost),
          gradeId: l.gradeId || null,
          costCodeId: l.costCodeId || null,
        })),
      }
      if (isEdit) {
        await apiFetch(`/api/purchase-orders/${editing.id}`, 'PUT', payload)
      } else {
        await apiFetch('/api/purchase-orders', 'POST', payload)
      }
      onSaved()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!linesReady) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-xl shadow-2xl flex flex-col mx-4">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {isEdit ? (isReceived ? `Edit Costs — PO${editing.poNumber}` : `Edit PO${editing.poNumber}`) : 'New Purchase Order'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {/* Vendor + Date row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Vendor <span className="text-red-500">*</span>
              </label>
              <select
                value={vendorId}
                onChange={e => setVendorId(e.target.value)}
                disabled={isReceived}
                className={clsx("w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue", isReceived && "bg-gray-100 text-gray-500 cursor-not-allowed")}
              >
                <option value="">Select vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>V-{v.vendorNumber} — {v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                disabled={isReceived}
                className={clsx("w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue", isReceived && "bg-gray-100 text-gray-500 cursor-not-allowed")}
              />
            </div>
          </div>

          {/* Status (edit only, hidden for received POs) */}
          {isEdit && !isReceived && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <div className="flex gap-2">
                {(['OPEN', 'RECEIVED', 'CANCELLED'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={clsx(
                      'h-8 px-3 rounded-full text-xs font-medium border transition-colors',
                      status === s
                        ? STATUS_COLOR[s] + ' border-transparent'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300',
                    )}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              autoComplete="off"
              placeholder="Optional notes…"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
            />
          </div>

          {/* Vendor Invoice */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Vendor Invoice</label>
            {invoiceBase64 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 truncate flex-1">{invoiceFilename ?? 'Invoice attached'}</span>
                <button
                  type="button"
                  onClick={() => window.open(invoiceBase64!, '_blank')}
                  className="flex items-center gap-1 h-7 px-2 rounded text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200"
                >
                  <Eye size={12} /> View
                </button>
                <button
                  type="button"
                  onClick={() => { setInvoiceBase64(null); setInvoiceFilename(null) }}
                  className="flex items-center gap-1 h-7 px-2 rounded text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200"
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => invoiceRef.current?.click()}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-gray-300 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700 hover:bg-gray-50"
                >
                  <FileUp size={13} /> Upload PDF or Image
                </button>
                <span className="text-[10px] text-gray-400">Max 5 MB</span>
              </div>
            )}
            <input
              ref={invoiceRef}
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleInvoiceFile}
            />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">
                Line Items <span className="text-red-500">*</span>
              </label>
              {!isReceived && (
                <button
                  type="button"
                  onClick={() => setShowSpreadsheet(s => !s)}
                  className={clsx(
                    'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border transition-colors',
                    showSpreadsheet
                      ? 'text-purple-700 bg-purple-50 border-purple-200'
                      : 'text-gray-500 hover:text-gray-700 border-gray-200 hover:border-gray-300',
                  )}
                >
                  <Upload size={12} /> Spreadsheet Import
                </button>
              )}
            </div>

            {/* Spreadsheet paste area */}
            {showSpreadsheet && (
              <div className="mb-3 rounded-md border border-dashed border-purple-300 bg-purple-50/50 p-3 space-y-2">
                <p className="text-[11px] text-gray-500">
                  Paste or upload CSV/TSV with columns: <span className="font-semibold">SKU, Cost, Grade, QTY</span>
                </p>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  rows={4}
                  placeholder={"SKU\tCost\tGrade\tQTY\nABC-123\t25.00\tA\t10\nDEF-456\t15.50\tB\t5"}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
                {importErrors.length > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 space-y-0.5">
                    {importErrors.map((e, i) => (
                      <p key={i} className="text-[11px] text-red-600">{e}</p>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleImport} disabled={!pasteText.trim()}
                    className="h-7 px-3 rounded text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                    Import
                  </button>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="h-7 px-3 rounded text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">
                    Upload File
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFileUpload} />
                  <div className="flex-1" />
                  <button type="button" onClick={downloadTemplate}
                    className="flex items-center gap-1 h-7 px-3 rounded text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100">
                    <Download size={11} /> Template
                  </button>
                </div>
              </div>
            )}

            {/* Column headers */}
            {lines.length > 0 && (
              <>
                <div className="grid grid-cols-[120px_1fr_100px_120px_60px_90px_28px] gap-2 mb-1 px-1">
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">SKU</span>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Description</span>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Grade</span>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Cost Code</span>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide text-center">Qty</span>
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide text-right">Cost</span>
                  <span />
                </div>

                <div className="space-y-1.5">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-[120px_1fr_100px_120px_60px_90px_28px] gap-2 items-center">
                      {/* SKU (read-only) */}
                      <span className="h-9 flex items-center px-2 rounded-md bg-gray-50 border border-gray-200 text-xs font-mono text-gray-700 truncate">
                        {line.sku}
                      </span>

                      {/* Description (read-only) */}
                      <span className="h-9 flex items-center px-2 rounded-md bg-gray-50 border border-gray-200 text-xs text-gray-600 truncate">
                        {line.description}
                      </span>

                      {/* Grade dropdown */}
                      <select
                        value={line.gradeId ?? ''}
                        onChange={e => {
                          const gid = e.target.value || null
                          const g = line.grades.find(g => g.id === gid)
                          updateLine(i, { gradeId: gid, gradeName: g?.grade ?? null })
                        }}
                        disabled={isReceived}
                        className={clsx("h-9 rounded-md border border-gray-300 px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue", isReceived && "bg-gray-100 text-gray-500 cursor-not-allowed")}
                      >
                        <option value="">—</option>
                        {line.grades.map(g => (
                          <option key={g.id} value={g.id}>{g.grade}</option>
                        ))}
                      </select>

                      {/* Cost Code dropdown */}
                      <select
                        value={line.costCodeId ?? ''}
                        onChange={e => updateLine(i, { costCodeId: e.target.value || null })}
                        className="h-9 rounded-md border border-gray-300 px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                      >
                        <option value="">—</option>
                        {costCodes.map(cc => (
                          <option key={cc.id} value={cc.id}>{cc.name} (${Number(cc.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</option>
                        ))}
                      </select>

                      {/* Qty */}
                      <input
                        type="number"
                        min={Math.max(1, line.qtyReceived)}
                        value={line.qty}
                        onChange={e => updateLine(i, { qty: Math.max(Math.max(1, line.qtyReceived), parseInt(e.target.value) || 1) })}
                        autoComplete="off"
                        disabled={isReceived}
                        className={clsx("h-9 w-full rounded-md border border-gray-300 px-2 text-xs text-center focus:outline-none focus:ring-2 focus:ring-amazon-blue", isReceived && "bg-gray-100 text-gray-500 cursor-not-allowed")}
                      />
                      {line.qtyReceived > 0 && (
                        <p className="text-[10px] text-gray-400 text-center mt-0.5">{line.qtyReceived} received</p>
                      )}

                      {/* Unit Cost */}
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">$</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitCost}
                          onChange={e => updateLine(i, { unitCost: e.target.value })}
                          autoComplete="off"
                          placeholder="0.00"
                          className="h-9 w-full rounded-md border border-gray-300 pl-5 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                        />
                      </div>

                      {/* Remove */}
                      {isReceived ? (
                        <div className="h-9 w-7" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          className="h-9 w-7 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* SKU autocomplete input to add lines — hidden for received POs */}
            {!isReceived && (
              <div className="mt-3 relative" ref={skuWrapRef}>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={skuSearch}
                    onChange={e => handleSkuChange(e.target.value)}
                    onFocus={() => { if (skuResults.length) setSkuDropOpen(true) }}
                    placeholder="Type SKU or description to add a line…"
                    autoComplete="off"
                    className="w-full h-9 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  />
                  {skuLoading && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>
                  )}
                </div>
                {skuDropOpen && skuResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {skuResults.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectProduct(p)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
                      >
                        <span className="font-mono text-xs text-gray-500 shrink-0">{p.sku}</span>
                        <span className="text-gray-700 truncate">{p.description}</span>
                      </button>
                    ))}
                  </div>
                )}
                {skuDropOpen && skuResults.length === 0 && skuSearch.trim() && !skuLoading && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg px-3 py-2 text-xs text-gray-400">
                    No products found
                  </div>
                )}
              </div>
            )}

            {/* Total */}
            {lines.length > 0 && (
              <div className="mt-3 flex justify-end border-t pt-3">
                <div className="text-right">
                  <span className="text-xs text-gray-500">Order Total</span>
                  <p className="text-lg font-bold text-gray-900">${lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-4 border-t shrink-0">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create PO'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Receipt History ───────────────────────────────────────────────────────────

function ReceiptLineRow({ rl }: { rl: ReceiptLine }) {
  const [showSerials, setShowSerials] = useState(false)
  const hasSerials = rl.serials.length > 0

  return (
    <>
      <tr
        className={clsx(hasSerials && 'cursor-pointer hover:bg-gray-50')}
        onClick={() => hasSerials && setShowSerials(v => !v)}
      >
        <td className="px-3 py-1.5 text-gray-700">
          <span className="inline-flex items-center gap-1.5">
            {hasSerials && (
              <ChevronDown size={10} className={clsx('text-gray-400 transition-transform shrink-0', showSerials && 'rotate-180')} />
            )}
            {rl.product.description} <span className="font-mono text-gray-400">({rl.product.sku})</span>
          </span>
        </td>
        <td className="px-3 py-1.5 text-gray-500">{rl.location.warehouse.name} / {rl.location.name}</td>
        <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{rl.qtyReceived}</td>
      </tr>
      {showSerials && (
        <tr onClick={e => e.stopPropagation()}>
          <td colSpan={3} className="px-3 pb-2 pt-0">
            <div className="ml-4 bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-500">
                    <th className="text-left px-3 py-1.5 font-medium w-8">#</th>
                    <th className="text-left px-3 py-1.5 font-medium">Serial Number</th>
                    <th className="text-left px-3 py-1.5 font-medium">Grade</th>
                    <th className="text-left px-3 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rl.serials.map((s, i) => (
                    <tr key={s.id} className="bg-white">
                      <td className="px-3 py-1 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-1 font-mono text-gray-700">{s.serialNumber}</td>
                      <td className="px-3 py-1 text-gray-600">{s.grade ? <span className="font-semibold text-indigo-600">{s.grade.grade}</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-1 text-gray-500">{s.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ReceiptHistory({ poId }: { poId: string }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState('')

  useEffect(() => {
    fetch(`/api/purchase-orders/${poId}/receipts`)
      .then(r => r.json())
      .then(d => { setReceipts(d.data ?? []); setLoading(false) })
      .catch(() => { setErr('Failed to load receipts'); setLoading(false) })
  }, [poId])

  if (loading) return <p className="text-xs text-gray-400 py-2">Loading receipts…</p>
  if (err)     return <p className="text-xs text-red-500 py-2">{err}</p>
  if (receipts.length === 0) return <p className="text-xs text-gray-400 py-2 italic">No receipts recorded yet</p>

  const totalSerials = receipts.reduce((sum, r) => sum + r.lines.reduce((s, l) => s + l.serials.length, 0), 0)

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
        <Clock size={11} /> Receipt History
        {totalSerials > 0 && <span className="font-normal text-gray-400">· {totalSerials} serial{totalSerials !== 1 ? 's' : ''}</span>}
      </p>
      {receipts.map(r => (
        <div key={r.id} className="rounded-md border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-100">
            <PackageCheck size={12} className="text-green-600 shrink-0" />
            <span className="text-xs font-semibold text-gray-700">
              {new Date(r.receivedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            {r.notes && <span className="text-xs text-gray-500 truncate">· {r.notes}</span>}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left px-3 py-1.5 font-medium">Product</th>
                <th className="text-left px-3 py-1.5 font-medium">Warehouse / Location</th>
                <th className="text-right px-3 py-1.5 font-medium">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {r.lines.map(rl => (
                <ReceiptLineRow key={rl.id} rl={rl} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// ─── PO Row (expandable) ──────────────────────────────────────────────────────

function PORow({
  po,
  onEdit,
  onDeleted,
  onReceive,
  onSpreadsheetReceive,
  onGenerateBill,
}: {
  po: PurchaseOrder
  onEdit: (po: PurchaseOrder) => void
  onDeleted: () => void
  onReceive: (po: PurchaseOrder) => void
  onSpreadsheetReceive: (po: PurchaseOrder) => void
  onGenerateBill: (po: PurchaseOrder) => void
}) {
  const [expanded,      setExpanded]      = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [err,           setErr]           = useState('')
  const [returnCounts,  setReturnCounts]  = useState<{ totalReturns: number; byLine: Record<string, number> } | null>(null)
  const returnsFetched = useRef(false)

  const total = po.lines.reduce((s, l) => s + l.qty * Number(l.unitCost), 0)
  const unitCount = po.lines.reduce((s, l) => s + l.qty, 0)
  const receivedCount = po.lines.reduce((s, l) => s + (l.qtyReceived ?? 0), 0)

  useEffect(() => {
    if (expanded && !returnsFetched.current) {
      returnsFetched.current = true
      fetch(`/api/purchase-orders/${po.id}/returns`)
        .then(r => r.json())
        .then(d => setReturnCounts(d))
        .catch(() => {})
    }
  }, [expanded, po.id])

  async function handleDelete() {
    setDeleting(true)
    try {
      await apiFetch(`/api/purchase-orders/${po.id}`, 'DELETE')
      onDeleted()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
      setDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <tr className={clsx('group hover:bg-gray-50 cursor-pointer', expanded && 'bg-gray-50')}
          onClick={() => setExpanded(e => !e)}>
        <td className="px-3 py-1.5 font-semibold text-gray-900 whitespace-nowrap">
          <div className="flex items-center gap-1">
            {expanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
            PO{po.poNumber}
          </div>
        </td>
        <td className="px-3 py-1.5 text-gray-700">{po.vendor.name}</td>
        <td className="px-3 py-1.5 text-gray-500">
          {new Date(po.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </td>
        <td className="px-3 py-1.5 text-gray-600">{po.lines.length}</td>
        <td className="px-3 py-1.5 text-right">
          <span className="text-gray-600">{unitCount}</span>
          {returnCounts && returnCounts.totalReturns > 0 && (
            <span className="text-amber-600 ml-1">· {returnCounts.totalReturns} ret</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right">
          <span className={clsx('font-medium',
            receivedCount === 0 ? 'text-red-500' :
            receivedCount >= unitCount ? 'text-green-600' : 'text-orange-500',
          )}>
            {receivedCount}
          </span>
        </td>
        <td className="px-3 py-1.5 font-medium text-gray-900 text-right">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td className="px-3 py-1.5">
          <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_COLOR[po.status])}>
            {STATUS_LABEL[po.status]}
          </span>
        </td>
        <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
          {err && <span className="text-xs text-red-500">{err}</span>}
          {deleteConfirm ? (
            <div className="flex items-center gap-2 justify-end">
              <span className="text-xs text-red-600 whitespace-nowrap">Delete?</span>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Yes</button>
              <button type="button" onClick={() => setDeleteConfirm(false)}
                className="text-xs text-gray-500 hover:underline">No</button>
            </div>
          ) : (
            <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
              {po.ledgerEntry ? (
                <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600">
                  <Receipt size={12} /> Billed
                </span>
              ) : po.status !== 'CANCELLED' ? (
                <button
                  type="button"
                  onClick={() => onGenerateBill(po)}
                  title="Generate bill for vendor ledger"
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200"
                >
                  <Receipt size={12} /> Bill
                </button>
              ) : null}
              {po.status !== 'CANCELLED' && po.status !== 'RECEIVED' && (
                <>
                  <button
                    type="button"
                    onClick={() => onReceive(po)}
                    title="Receive inventory"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200"
                  >
                    <PackageCheck size={12} /> Receive
                  </button>
                  <button
                    type="button"
                    onClick={() => onSpreadsheetReceive(po)}
                    title="Receive via spreadsheet paste"
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200"
                  >
                    Spreadsheet
                  </button>
                </>
              )}
              <button type="button" onClick={() => onEdit(po)}
                className="p-1.5 rounded text-gray-400 hover:text-amazon-blue hover:bg-blue-50">
                <Pencil size={13} />
              </button>
              {po.status !== 'RECEIVED' && (
                <button type="button" onClick={() => setDeleteConfirm(true)}
                  className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}
        </td>
      </tr>

      {/* Expanded: line items + receipt history */}
      {expanded && (
        <tr>
          <td colSpan={9} className="px-0 py-0 border-b border-gray-100">
            <div className="bg-gray-50 border-t border-gray-100 px-6 py-3">
              {po.notes && (
                <p className="text-xs text-gray-500 italic mb-2">{po.notes}</p>
              )}
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-1">SKU</th>
                    <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-1">Description</th>
                    <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-1">Grade</th>
                    <th className="text-right text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-1">Qty</th>
                    <th className="text-right text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-1">Returned</th>
                    <th className="text-right text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-1">Unit Cost</th>
                    <th className="text-right text-[10px] font-medium text-gray-400 uppercase tracking-wide pb-1">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {po.lines.map(line => (
                    <tr key={line.id}>
                      <td className="py-1 pr-3 font-mono text-xs font-semibold text-gray-900 whitespace-nowrap">{line.product.sku}</td>
                      <td className="py-1 pr-3 text-gray-500 truncate max-w-[200px]">{line.product.description}</td>
                      <td className="py-1 pr-3 text-gray-500">{line.grade?.grade ?? '—'}</td>
                      <td className="py-1 text-right text-gray-700">{line.qty}</td>
                      <td className="py-1 text-right">
                        {line.product.isSerializable ? (
                          returnCounts?.byLine[line.id]
                            ? <span className="text-amber-600 font-medium">{returnCounts.byLine[line.id]}</span>
                            : <span className="text-gray-400">0</span>
                        ) : (
                          <span className="text-gray-300">&mdash;</span>
                        )}
                      </td>
                      <td className="py-1 text-right text-gray-700">${Number(line.unitCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-1 text-right font-medium text-gray-900">
                        ${(line.qty * Number(line.unitCost)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td colSpan={6} className="pt-1.5 text-right text-xs font-semibold text-gray-600 pr-3">Total</td>
                    <td className="pt-1.5 text-right font-bold text-gray-900">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                </tfoot>
              </table>

              {/* Download Spreadsheet */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.open(`/api/purchase-orders/${po.id}/export-csv`, '_blank')
                  }}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-200"
                >
                  <Download size={13} /> Download Spreadsheet
                </button>
              </div>

              {/* Vendor Invoice */}
              {po.vendorInvoiceBase64 && (
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); window.open(po.vendorInvoiceBase64!, '_blank') }}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200"
                  >
                    <Eye size={13} /> View Invoice
                  </button>
                  {po.vendorInvoiceFilename && (
                    <span className="text-xs text-gray-400">{po.vendorInvoiceFilename}</span>
                  )}
                </div>
              )}

              {/* Receipt history */}
              <ReceiptHistory poId={po.id} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PurchaseOrdersManager() {
  const [orders,   setOrders]   = useState<PurchaseOrder[]>([])
  const [vendors,  setVendors]  = useState<Vendor[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState('')
  const [panel,    setPanel]    = useState<'create' | PurchaseOrder | null>(null)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [spreadsheetReceiving, setSpreadsheetReceiving] = useState<PurchaseOrder | null>(null)
  const [billing, setBilling] = useState<PurchaseOrder | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (searchQuery) params.set('search', searchQuery)
      const qs = params.toString()
      const url = `/api/purchase-orders${qs ? `?${qs}` : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setOrders(data.data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, searchQuery])

  useEffect(() => {
    Promise.all([
      fetch('/api/vendors').then(r => r.json()),
      fetch('/api/products').then(r => r.json()),
    ]).then(([v, p]) => {
      setVendors(v.data ?? [])
      setProducts(p.data ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])


  const grandTotal = orders.reduce(
    (sum, po) => sum + po.lines.reduce((s, l) => s + l.qty * Number(l.unitCost), 0), 0
  )

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setSearchQuery(searchInput.trim()) }}
            placeholder="Search by PO#, SKU, or Serial…"
            autoComplete="off"
            className="h-9 w-64 rounded-md border border-gray-300 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearchQuery('') }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        {orders.length > 0 && (
          <span className="text-xs text-gray-400">
            {orders.length} PO{orders.length !== 1 ? 's' : ''} · Total: <span className="font-semibold text-gray-600">${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setPanel('create')}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <Plus size={14} /> New PO
        </button>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="py-20 text-center">
          <ShoppingCart size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">
            {statusFilter ? 'No purchase orders with this status' : 'No purchase orders yet'}
          </p>
          {!statusFilter && (
            <button type="button" onClick={() => setPanel('create')}
              className="mt-3 text-sm text-amazon-blue hover:underline">
              Create your first PO
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">PO #</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Items</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Units</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Received</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-3 py-2 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map(po => (
                <PORow
                  key={po.id}
                  po={po}
                  onEdit={p => setPanel(p)}
                  onDeleted={load}
                  onReceive={p => setReceiving(p)}
                  onSpreadsheetReceive={p => setSpreadsheetReceiving(p)}
                  onGenerateBill={p => setBilling(p)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel !== null && vendors.length > 0 && (
        <POPanel
          editing={panel === 'create' ? null : panel}
          vendors={vendors}
          products={products}
          onSaved={() => { setPanel(null); load() }}
          onClose={() => setPanel(null)}
        />
      )}

      {panel !== null && vendors.length === 0 && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <p className="text-sm font-semibold text-gray-900 mb-2">No vendors found</p>
            <p className="text-xs text-gray-500 mb-4">Add at least one vendor before creating a purchase order.</p>
            <button type="button" onClick={() => setPanel(null)}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium w-full">OK</button>
          </div>
        </div>
      )}

      {receiving !== null && (
        <ReceiveModal
          po={receiving}
          onReceived={() => { setReceiving(null); load() }}
          onClose={() => setReceiving(null)}
        />
      )}

      {spreadsheetReceiving !== null && (
        <SpreadsheetReceiveModal
          po={spreadsheetReceiving}
          onReceived={() => { setSpreadsheetReceiving(null); load() }}
          onClose={() => setSpreadsheetReceiving(null)}
        />
      )}

      {billing !== null && (
        <GenerateBillModal
          po={billing}
          onClose={() => setBilling(null)}
          onSuccess={() => { setBilling(null); load() }}
        />
      )}
    </div>
  )
}

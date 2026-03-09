'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { X, AlertCircle, PackageCheck, CheckCircle2, XCircle, FileSpreadsheet, Download, Upload, ArrowLeft, ClipboardCheck } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GradeOption {
  id: string
  grade: string
  description: string | null
}

interface Product {
  id: string
  description: string
  sku: string
  isSerializable: boolean
}

interface POLine {
  id: string
  productId: string
  product: Product
  qty: number
  unitCost: string
}

interface PurchaseOrder {
  id: string
  poNumber: number
  vendor: { name: string }
  date: string
  lines: POLine[]
}

interface Warehouse { id: string; name: string; locations: Location[] }
interface Location  { id: string; name: string; warehouseId: string }

interface ParsedRow {
  sku: string
  cost: string
  serial: string
  // Validation results
  matchedLine: POLine | null
  error: string | null
}

interface ReceiptLineAPI {
  purchaseOrderLineId: string
  qtyReceived: number
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── SpreadsheetReceiveModal ──────────────────────────────────────────────────

export default function SpreadsheetReceiveModal({
  po,
  onReceived,
  onClose,
}: {
  po: PurchaseOrder
  onReceived: () => void
  onClose: () => void
}) {
  const [warehouses,  setWarehouses]  = useState<Warehouse[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState('')

  // Warehouse / location / grade selection
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId,  setLocationId]  = useState('')
  const [gradeId,     setGradeId]     = useState<string | null>(null)

  // Raw paste text + parsed rows
  const [rawText,    setRawText]    = useState('')
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [showConfirmation, setShowConfirmation] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Already-received qty per PO line
  const [receivedMap, setReceivedMap] = useState<Map<string, number>>(new Map())
  const [allGrades, setAllGrades] = useState<GradeOption[]>([])
  const anySerializable = po.lines.some(l => l.product.isSerializable)

  // Load warehouses + existing receipts
  const init = useCallback(async () => {
    setLoadingData(true)
    try {
      const [whRes, receiptRes, gradesRes] = await Promise.all([
        fetch('/api/warehouses'),
        fetch(`/api/purchase-orders/${po.id}/receipts`),
        fetch('/api/grades'),
      ])
      const whData      = await whRes.json()
      const receiptData = await receiptRes.json()
      const gradesData  = await gradesRes.json()

      const whs: Warehouse[] = whData.data ?? []
      setWarehouses(whs)
      setAllGrades(gradesData.data ?? [])

      if (whs[0]) {
        setWarehouseId(whs[0].id)
        if (whs[0].locations[0]) setLocationId(whs[0].locations[0].id)
      }

      const rMap = new Map<string, number>()
      for (const receipt of (receiptData.data ?? [])) {
        for (const rl of (receipt.lines as ReceiptLineAPI[])) {
          rMap.set(rl.purchaseOrderLineId, (rMap.get(rl.purchaseOrderLineId) ?? 0) + rl.qtyReceived)
        }
      }
      setReceivedMap(rMap)
    } catch {
      setErr('Failed to load data')
    } finally {
      setLoadingData(false)
    }
  }, [po.id])

  useEffect(() => { init() }, [init])

  // Download CSV template with one row per remaining unit
  function handleDownloadTemplate() {
    const rows: string[] = ['SKU,Cost,Serial']
    for (const line of po.lines) {
      const alreadyReceived = receivedMap.get(line.id) ?? 0
      const remaining = line.qty - alreadyReceived
      for (let i = 0; i < remaining; i++) {
        rows.push(`${line.product.sku},,`)
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `PO-${po.poNumber}-template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Upload CSV and feed into rawText as tab-separated
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length === 0) return
      // Detect delimiter from first line
      const firstLine = lines[0]
      const delimiter = firstLine.includes('\t') ? '\t' : ','
      // Skip header row if it looks like one
      const firstCols = firstLine.split(delimiter).map(c => c.trim().toLowerCase())
      const isHeader = firstCols[0] === 'sku' || firstCols.includes('cost') || firstCols.includes('serial')
      const dataLines = isHeader ? lines.slice(1) : lines
      // Convert to tab-separated for existing parser
      const tsv = dataLines.map(line => line.split(delimiter).map(c => c.trim()).join('\t')).join('\n')
      setRawText(tsv)
    }
    reader.readAsText(file)
    // Reset input so the same file can be re-uploaded
    e.target.value = ''
  }

  // Build SKU → PO line lookup
  const skuToLine = new Map<string, POLine>()
  for (const l of po.lines) {
    skuToLine.set(l.product.sku.toLowerCase(), l)
  }

  // Parse raw text into rows whenever it changes
  useEffect(() => {
    if (!rawText.trim()) {
      setParsedRows([])
      return
    }

    const lines = rawText.split('\n').filter(l => l.trim())
    const rows: ParsedRow[] = []
    // Track qty usage per PO line within this paste
    const qtyUsed = new Map<string, number>()

    // Auto-detect delimiter from first data line
    const delimiter = (lines[0]?.includes('\t')) ? '\t' : ','

    for (const line of lines) {
      const cols = line.split(delimiter)
      const sku    = (cols[0] ?? '').trim()
      const cost   = (cols[1] ?? '').trim()
      const serial = (cols[2] ?? '').trim()

      if (!sku) {
        rows.push({ sku, cost, serial, matchedLine: null, error: 'Missing SKU' })
        continue
      }

      const matched = skuToLine.get(sku.toLowerCase()) ?? null
      if (!matched) {
        rows.push({ sku, cost, serial, matchedLine: null, error: `SKU "${sku}" not found on this PO` })
        continue
      }

      // Check remaining qty
      const alreadyReceived = receivedMap.get(matched.id) ?? 0
      const remaining = matched.qty - alreadyReceived
      const used = qtyUsed.get(matched.id) ?? 0
      if (used + 1 > remaining) {
        rows.push({ sku, cost, serial, matchedLine: matched, error: `Exceeds remaining qty (${remaining}) for SKU "${sku}"` })
        continue
      }
      qtyUsed.set(matched.id, used + 1)

      // Serial check (basic: must be non-empty for serializable products)
      if (matched.product.isSerializable && !serial) {
        rows.push({ sku, cost, serial, matchedLine: matched, error: 'Serial number required for this product' })
        continue
      }

      rows.push({ sku, cost, serial, matchedLine: matched, error: null })
    }

    // Check for duplicate serials within paste
    const serialsSeen = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.error || !r.serial) continue
      const key = `${r.sku.toLowerCase()}::${r.serial}`
      if (serialsSeen.has(key)) {
        rows[i] = { ...r, error: `Duplicate serial "${r.serial}"` }
      } else {
        serialsSeen.set(key, i)
      }
    }

    setParsedRows(rows)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText, receivedMap])

  const validRows   = parsedRows.filter(r => !r.error && r.matchedLine)
  const invalidRows = parsedRows.filter(r => r.error)
  const canSubmit   = validRows.length > 0 && invalidRows.length === 0 && !!locationId

  const locations = warehouses.find(w => w.id === warehouseId)?.locations ?? []

  // Group valid rows by PO line for staging summary
  function buildGrouped() {
    const grouped = new Map<string, { line: POLine; serials: string[]; costSum: number; qty: number }>()
    for (const row of validRows) {
      const line = row.matchedLine!
      const existing = grouped.get(line.id)
      if (existing) {
        existing.qty++
        existing.serials.push(row.serial)
        if (row.cost) existing.costSum += parseFloat(row.cost) || 0
      } else {
        grouped.set(line.id, {
          line,
          serials: row.serial ? [row.serial] : [],
          costSum: row.cost ? (parseFloat(row.cost) || 0) : 0,
          qty: 1,
        })
      }
    }
    return Array.from(grouped.values())
  }

  const stagedGroups = showConfirmation ? buildGrouped() : []

  // Step 1: Validate and show confirmation
  function handleReview() {
    setErr('')
    if (!locationId) { setErr('Select a warehouse and location'); return }
    if (invalidRows.length > 0) { setErr('Fix all validation errors before submitting'); return }
    if (validRows.length === 0) { setErr('No valid rows to submit'); return }
    if (allGrades.length > 0 && !gradeId) { setErr('Select a grade'); return }
    setShowConfirmation(true)
  }

  // Step 2: Actually submit after confirmation
  async function handleConfirmSubmit() {
    setErr('')
    const grouped = buildGrouped()

    const payload = {
      notes: 'Received via spreadsheet',
      lines: grouped.map(g => ({
        purchaseOrderLineId: g.line.id,
        productId:           g.line.productId,
        qtyReceived:         g.qty,
        locationId,
        gradeId:             gradeId ?? null,
        serials:             g.line.product.isSerializable ? g.serials.filter(Boolean) : undefined,
      })),
    }

    setSaving(true)
    try {
      const res  = await fetch(`/api/purchase-orders/${po.id}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Receive failed')
      onReceived()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Receive failed')
    } finally {
      setSaving(false)
    }
  }

  // ─── Confirmation view ──────────────────────────────────────────────────────
  if (showConfirmation) {
    const totalUnits = stagedGroups.reduce((s, g) => s + g.qty, 0)
    const selectedWarehouse = warehouses.find(w => w.id === warehouseId)
    const selectedLocation  = locations.find(l => l.id === locationId)
    const selectedGrade     = allGrades.find(g => g.id === gradeId)

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl shadow-2xl w-[780px] max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardCheck size={16} className="text-amazon-blue" />
                <h2 className="text-sm font-semibold text-gray-900">Confirm Receiving — PO #{po.poNumber}</h2>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Review the items below before processing
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

            {/* Summary bar */}
            <div className="flex items-center gap-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm">
              <div>
                <span className="text-gray-500">Items:</span>{' '}
                <span className="font-semibold text-gray-800">{totalUnits}</span>
              </div>
              <div>
                <span className="text-gray-500">SKUs:</span>{' '}
                <span className="font-semibold text-gray-800">{stagedGroups.length}</span>
              </div>
              <div>
                <span className="text-gray-500">Warehouse:</span>{' '}
                <span className="font-semibold text-gray-800">{selectedWarehouse?.name ?? '—'}</span>
              </div>
              <div>
                <span className="text-gray-500">Location:</span>{' '}
                <span className="font-semibold text-gray-800">{selectedLocation?.name ?? '—'}</span>
              </div>
              {selectedGrade && (
                <div>
                  <span className="text-gray-500">Grade:</span>{' '}
                  <span className="font-semibold text-gray-800">{selectedGrade.grade}</span>
                </div>
              )}
            </div>

            {/* Grouped items */}
            <div className="space-y-3">
              {stagedGroups.map(g => (
                <div key={g.line.id} className="rounded-lg border border-gray-200 overflow-hidden">
                  {/* SKU header row */}
                  <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-gray-800">{g.line.product.sku}</span>
                      <span className="text-xs text-gray-500">{g.line.product.description}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-700">
                      Qty: {g.qty}
                    </span>
                  </div>

                  {/* Serial list (if serializable) */}
                  {g.line.product.isSerializable && g.serials.length > 0 && (
                    <div className="px-4 py-2.5">
                      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Serials</p>
                      <div className="flex flex-wrap gap-1.5">
                        {g.serials.filter(Boolean).map((sn, i) => (
                          <span key={i} className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700">
                            {sn}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t shrink-0">
            <button
              type="button"
              onClick={() => { setShowConfirmation(false); setErr('') }}
              className="flex items-center gap-1.5 h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              onClick={handleConfirmSubmit}
              disabled={saving}
              className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              {saving ? 'Processing…' : `Confirm & Receive ${totalUnits} item${totalUnits !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Input view (paste / upload) ───────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[780px] max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-amazon-blue" />
              <h2 className="text-sm font-semibold text-gray-900">Spreadsheet Receive — PO #{po.poNumber}</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {po.vendor.name} · Paste, upload CSV, or download a template
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
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
              {/* Warehouse / Location / Grade row */}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse</label>
                  <select
                    value={warehouseId}
                    onChange={e => {
                      setWarehouseId(e.target.value)
                      const firstLoc = warehouses.find(w => w.id === e.target.value)?.locations[0]?.id ?? ''
                      setLocationId(firstLoc)
                    }}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  >
                    <option value="">Select…</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                  <select
                    value={locationId}
                    onChange={e => setLocationId(e.target.value)}
                    disabled={!warehouseId || locations.length === 0}
                    className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:opacity-50"
                  >
                    <option value="">Select…</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                {allGrades.length > 0 && (
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Grade</label>
                    <select
                      value={gradeId ?? ''}
                      onChange={e => setGradeId(e.target.value || null)}
                      className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                    >
                      <option value="">Select grade…</option>
                      {allGrades.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.grade}{g.description ? ` — ${g.description}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Paste area */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">
                    Paste or upload data <span className="text-gray-400 font-normal">(SKU{anySerializable ? ', Cost, Serial' : ', Cost'})</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <Download size={12} /> Download Template
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <Upload size={12} /> Upload CSV
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>
                </div>
                <textarea
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  rows={8}
                  placeholder={`IPHONE-14-128\t199.99\tSN-00001\nIPHONE-14-128\t199.99\tSN-00002\nSAMSUNG-S23\t149.99\tSN-00003`}
                  spellCheck={false}
                  className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
                />
              </div>

              {/* Preview table */}
              {parsedRows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Preview — {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''}
                    </p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 size={12} /> {validRows.length} valid
                      </span>
                      {invalidRows.length > 0 && (
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle size={12} /> {invalidRows.length} error{invalidRows.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[240px] overflow-y-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 sticky top-0">
                          <th className="px-3 py-2 text-left font-semibold text-gray-500 w-8" />
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
                              {row.error
                                ? <XCircle size={13} className="text-red-500 inline" />
                                : <CheckCircle2 size={13} className="text-green-500 inline" />
                              }
                            </td>
                            <td className="px-3 py-1.5 font-mono text-gray-700">{row.sku || '—'}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{row.cost ? `$${row.cost}` : '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-gray-700">{row.serial || '—'}</td>
                            <td className="px-3 py-1.5">
                              {row.error ? (
                                <span className="text-red-600">{row.error}</span>
                              ) : (
                                <span className="text-green-600">OK</span>
                              )}
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          {warehouses.length > 0 && (
            <button
              type="button"
              onClick={handleReview}
              disabled={!canSubmit || loadingData}
              className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              Review {validRows.length} item{validRows.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

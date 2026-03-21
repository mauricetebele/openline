'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { X, AlertCircle, PackageCheck, Hash, CheckCircle2 } from 'lucide-react'

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

interface ReceiptLineAPI {
  purchaseOrderLineId: string
  qtyReceived: number
}

// What we track per PO line in local state
interface LineState {
  poLineId:        string
  product:         Product
  ordered:         number
  alreadyReceived: number
  qtyInput:        string   // raw input string — avoids Safari type="number" DOM exception
  warehouseId:     string
  locationId:      string
  gradeId:         string | null
  serials:         string[]   // confirmed serial list (empty = not yet entered)
}

// Safely parse qtyInput to an integer, clamped to [0, max]
function parseQty(raw: string, max: number): number {
  const n = parseInt(raw, 10)
  if (isNaN(n) || n < 0) return 0
  return Math.min(n, max)
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

// ─── Serial Entry Sub-Modal ───────────────────────────────────────────────────

function SerialEntryModal({
  product,
  expectedQty,
  initial,
  onConfirm,
  onClose,
}: {
  product: Product
  expectedQty: number
  initial: string[]
  onConfirm: (serials: string[]) => void
  onClose: () => void
}) {
  const [raw, setRaw]   = useState(initial.join('\n'))
  const [err, setErr]   = useState('')
  const textareaRef     = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const lines      = raw.split('\n').map(s => s.trim()).filter(Boolean)
  const count      = lines.length
  const isMatch    = count === expectedQty
  const isTooMany  = count > expectedQty
  const isTooFew   = count > 0 && count < expectedQty

  function handleConfirm() {
    setErr('')

    if (count === 0) {
      setErr('Paste at least one serial number.')
      return
    }
    if (!isMatch) {
      setErr(
        isTooMany
          ? `Too many — ${count} entered but only ${expectedQty} expected. Remove ${count - expectedQty} serial number(s).`
          : `Too few — ${count} entered but ${expectedQty} expected. Add ${expectedQty - count} more serial number(s).`,
      )
      return
    }

    // Check duplicates within the list
    const deduped = new Set(lines)
    if (deduped.size !== lines.length) {
      const seen = new Set<string>()
      const dupes: string[] = []
      for (const sn of lines) {
        if (seen.has(sn)) dupes.push(sn)
        seen.add(sn)
      }
      setErr(`Duplicate serial number(s) in list: ${dupes.slice(0, 3).join(', ')}${dupes.length > 3 ? ` (+${dupes.length - 3} more)` : ''}`)
      return
    }

    onConfirm(lines)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Hash size={14} className="text-purple-600" />
              <h3 className="text-sm font-semibold text-gray-900">Enter Serial Numbers</h3>
            </div>
            <p className="text-xs text-gray-500">
              {product.description} · <span className="font-mono">{product.sku}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {/* Counter badge */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Paste one serial number per line. Order does not matter.
            </p>
            <span
              className={`text-sm font-bold tabular-nums px-2.5 py-0.5 rounded-full ${
                isMatch
                  ? 'bg-green-100 text-green-700'
                  : isTooMany
                  ? 'bg-red-100 text-red-700'
                  : isTooFew
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {count} / {expectedQty}
            </span>
          </div>

          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={raw}
            onChange={e => { setRaw(e.target.value); setErr('') }}
            rows={14}
            placeholder={`SN-000001\nSN-000002\nSN-000003\n…`}
            spellCheck={false}
            className={`w-full flex-1 rounded-md border px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none ${
              err ? 'border-red-300' : 'border-gray-300'
            }`}
          />

          {/* Live status strip */}
          <div className={`rounded-md px-3 py-2 text-xs font-medium flex items-center gap-2 ${
            isMatch
              ? 'bg-green-50 text-green-700 border border-green-200'
              : isTooMany
              ? 'bg-red-50 text-red-700 border border-red-200'
              : isTooFew
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-gray-50 text-gray-500 border border-gray-200'
          }`}>
            {isMatch ? (
              <>
                <CheckCircle2 size={13} className="shrink-0" />
                {expectedQty} serial number{expectedQty !== 1 ? 's' : ''} ready to confirm
              </>
            ) : isTooMany ? (
              <>
                <AlertCircle size={13} className="shrink-0" />
                {count - expectedQty} too many — remove {count - expectedQty} serial number{count - expectedQty !== 1 ? 's' : ''}
              </>
            ) : isTooFew ? (
              <>
                <AlertCircle size={13} className="shrink-0" />
                {expectedQty - count} more needed
              </>
            ) : (
              <>
                <Hash size={13} className="shrink-0" />
                Expecting {expectedQty} serial number{expectedQty !== 1 ? 's' : ''}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isMatch}
            className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm {expectedQty} Serial{expectedQty !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ReceiveModal ─────────────────────────────────────────────────────────────

export default function ReceiveModal({
  po,
  onReceived,
  onClose,
}: {
  po: PurchaseOrder
  onReceived: () => void
  onClose: () => void
}) {
  const [warehouses,    setWarehouses]    = useState<Warehouse[]>([])
  const [grades,        setGrades]        = useState<GradeOption[]>([])
  const [lineStates,    setLineStates]    = useState<LineState[]>([])
  const [loadingData,   setLoadingData]   = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [err,           setErr]           = useState('')
  const [notes,         setNotes]         = useState('')
  // Global warehouse/location quick-fill
  const [globalWH,  setGlobalWH]  = useState('')
  const [globalLoc, setGlobalLoc] = useState('')
  // Which line's serial modal is open (by index)
  const [serialModalIdx, setSerialModalIdx] = useState<number | null>(null)

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
      setGrades(gradesData.data ?? [])

      // Compute already-received per PO line
      const receivedMap = new Map<string, number>()
      for (const receipt of (receiptData.data ?? [])) {
        for (const rl of (receipt.lines as ReceiptLineAPI[])) {
          receivedMap.set(rl.purchaseOrderLineId, (receivedMap.get(rl.purchaseOrderLineId) ?? 0) + rl.qtyReceived)
        }
      }

      const defaultWH  = whs[0]?.id ?? ''
      const defaultLoc = whs[0]?.locations[0]?.id ?? ''
      setGlobalWH(defaultWH)
      setGlobalLoc(defaultLoc)

      setLineStates(
        po.lines.map(l => ({
          poLineId:        l.id,
          product:         l.product,
          ordered:         l.qty,
          alreadyReceived: receivedMap.get(l.id) ?? 0,
          qtyInput:        '',
          warehouseId:     defaultWH,
          locationId:      defaultLoc,
          gradeId:         null,
          serials:         [],
        })),
      )
    } catch {
      setErr('Failed to load data')
    } finally {
      setLoadingData(false)
    }
  }, [po])

  useEffect(() => { init() }, [init])

  function applyGlobal() {
    if (!globalWH || !globalLoc) return
    setLineStates(p => p.map(l => ({ ...l, warehouseId: globalWH, locationId: globalLoc })))
  }

  useEffect(() => {
    if (globalWH && globalLoc) applyGlobal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalWH, globalLoc])

  function setLine(idx: number, patch: Partial<LineState>) {
    setLineStates(p => p.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  function handleLineWHChange(idx: number, whId: string) {
    const firstLoc = warehouses.find(w => w.id === whId)?.locations[0]?.id ?? ''
    setLine(idx, { warehouseId: whId, locationId: firstLoc })
  }

  function locationsFor(whId: string) {
    return warehouses.find(w => w.id === whId)?.locations ?? []
  }

  async function handleSubmit() {
    setErr('')

    const activeLines = lineStates
      .map(l => ({ ...l, qty: parseQty(l.qtyInput, l.ordered - l.alreadyReceived) }))
      .filter(l => l.qty > 0)

    if (activeLines.length === 0) {
      setErr('Enter a quantity to receive for at least one line')
      return
    }

    // Check serializable lines have their serials confirmed; validate grade if product has grades
    for (const l of activeLines) {
      if (l.product.isSerializable && l.serials.length !== l.qty) {
        setErr(`Serial numbers not confirmed for "${l.product.description}" — click "Enter Serials" to add them`)
        return
      }
      if (!l.locationId) {
        setErr(`Select a location for "${l.product.description}"`)
        return
      }
    }

    await submitReceive(activeLines, false)
  }

  async function submitReceive(activeLines: Array<LineState & { qty: number }>, confirmExisting: boolean) {
    setSaving(true)
    setErr('')
    try {
      const payload = {
        notes: notes.trim() || undefined,
        confirmExisting: confirmExisting || undefined,
        lines: activeLines.map(l => ({
          purchaseOrderLineId: l.poLineId,
          productId:           l.product.id,
          qtyReceived:         l.qty,
          locationId:          l.locationId,
          gradeId:             l.gradeId ?? null,
          serials:             l.product.isSerializable ? l.serials : undefined,
        })),
      }

      const res  = await fetch(`/api/purchase-orders/${po.id}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        // Soft warning: serials exist but not IN_STOCK — prompt user
        if (data.error === 'existing_serials_warning' && data.warnings?.length) {
          const msg = data.warnings.join('\n') + '\n\nDo you want to proceed anyway?'
          if (window.confirm(msg)) {
            await submitReceive(activeLines, true)
            return
          }
          setSaving(false)
          return
        }
        throw new Error(data.error ?? 'Receive failed')
      }
      onReceived()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Receive failed')
    } finally {
      setSaving(false)
    }
  }

  const anyActive = lineStates.some(l => parseQty(l.qtyInput, l.ordered - l.alreadyReceived) > 0)
  const serialModalLine = serialModalIdx !== null ? lineStates[serialModalIdx] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <PackageCheck size={16} className="text-amazon-blue" />
              <h2 className="text-sm font-semibold text-gray-900">Receive PO{po.poNumber}</h2>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {po.vendor.name} · {new Date(po.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {loadingData ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
          ) : warehouses.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-gray-700 mb-1">No warehouses configured</p>
              <p className="text-xs text-gray-500">
                Go to <strong>Warehouses</strong> and add at least one warehouse with a location before receiving inventory.
              </p>
            </div>
          ) : (
            <>
              {/* Global warehouse / location quick-fill */}
              <div className="flex items-center gap-3 bg-blue-50 rounded-lg px-4 py-3 border border-blue-100">
                <span className="text-xs font-medium text-blue-700 shrink-0 w-28">Apply to all lines:</span>
                <select
                  value={globalWH}
                  onChange={e => setGlobalWH(e.target.value)}
                  className="h-8 flex-1 rounded-md border border-blue-200 bg-white px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                >
                  <option value="">Select warehouse…</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select
                  value={globalLoc}
                  onChange={e => setGlobalLoc(e.target.value)}
                  disabled={!globalWH}
                  className="h-8 flex-1 rounded-md border border-blue-200 bg-white px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue disabled:opacity-50"
                >
                  <option value="">Select location…</option>
                  {locationsFor(globalWH).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button type="button" onClick={applyGlobal} disabled={!globalWH || !globalLoc}
                  className="h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap">
                  Apply
                </button>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. 'UPS shipment #12345'"
                  className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                />
              </div>

              {/* Per-line entries */}
              <div className="space-y-4">
                {lineStates.map((ls, idx) => {
                  const remaining      = ls.ordered - ls.alreadyReceived
                  const fullyReceived  = remaining <= 0
                  const qtyToReceive   = parseQty(ls.qtyInput, remaining)
                  const locs           = locationsFor(ls.warehouseId)
                  const serialsOk      = !ls.product.isSerializable || qtyToReceive === 0 || ls.serials.length === qtyToReceive
                  const needsSerials   = ls.product.isSerializable && qtyToReceive > 0 && ls.serials.length !== qtyToReceive

                  return (
                    <div
                      key={ls.poLineId}
                      className={`rounded-lg border p-4 space-y-3 ${fullyReceived ? 'bg-green-50 border-green-200 opacity-70' : 'border-gray-200'}`}
                    >
                      {/* Product info + status badges */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{ls.product.description}</p>
                          <p className="text-xs font-mono text-gray-500">{ls.product.sku}</p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0 flex-wrap justify-end">
                          <span>Ordered: <strong className="text-gray-800">{ls.ordered}</strong></span>
                          <span>Received: <strong className="text-gray-800">{ls.alreadyReceived}</strong></span>
                          <span className={`font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                            {remaining > 0 ? `${remaining} remaining` : 'Fully received'}
                          </span>
                          {ls.product.isSerializable && (
                            <span className="inline-flex rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 font-medium">
                              Serialized
                            </span>
                          )}
                        </div>
                      </div>

                      {!fullyReceived && (
                        <>
                          <div className="grid grid-cols-[100px_1fr_1fr] gap-3 items-end">
                            {/* Qty */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Receive qty <span className="text-gray-400 font-normal">(max {remaining})</span>
                              </label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={ls.qtyInput}
                                onChange={e => {
                                  const raw = e.target.value.replace(/[^0-9]/g, '')
                                  setLine(idx, { qtyInput: raw, serials: [] })
                                }}
                                placeholder="0"
                                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                              />
                            </div>

                            {/* Warehouse */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse</label>
                              <select
                                value={ls.warehouseId}
                                onChange={e => handleLineWHChange(idx, e.target.value)}
                                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                              >
                                <option value="">Select…</option>
                                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                              </select>
                            </div>

                            {/* Location */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                              <select
                                value={ls.locationId}
                                onChange={e => setLine(idx, { locationId: e.target.value })}
                                disabled={!ls.warehouseId || locs.length === 0}
                                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:opacity-50"
                              >
                                <option value="">Select…</option>
                                {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* Grade selector — shown if global grades exist */}
                          {grades.length > 0 && (
                            <div className="mt-1">
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Grade
                              </label>
                              <select
                                value={ls.gradeId ?? ''}
                                onChange={e => setLine(idx, { gradeId: e.target.value || null })}
                                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                              >
                                <option value="">Select grade…</option>
                                {grades.map(g => (
                                  <option key={g.id} value={g.id}>
                                    {g.grade}{g.description ? ` — ${g.description}` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </>
                      )}

                      {/* Serial number entry button — only for serializable with qty > 0 */}
                      {!fullyReceived && ls.product.isSerializable && qtyToReceive > 0 && (
                        <div className="flex items-center gap-3 pt-1">
                          <button
                            type="button"
                            onClick={() => setSerialModalIdx(idx)}
                            className={`flex items-center gap-2 h-9 px-4 rounded-md border text-sm font-medium transition-colors ${
                              serialsOk
                                ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                                : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            }`}
                          >
                            {serialsOk ? (
                              <>
                                <CheckCircle2 size={14} />
                                {ls.serials.length} serial{ls.serials.length !== 1 ? 's' : ''} confirmed — edit
                              </>
                            ) : (
                              <>
                                <Hash size={14} />
                                Enter {qtyToReceive} serial number{qtyToReceive !== 1 ? 's' : ''}
                              </>
                            )}
                          </button>
                          {needsSerials && (
                            <span className="text-xs text-amber-600 font-medium">Required before submitting</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
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
              onClick={handleSubmit}
              disabled={saving || !anyActive || loadingData}
              className="h-9 px-5 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Confirm Receipt'}
            </button>
          )}
        </div>
      </div>

      {/* Serial entry sub-modal */}
      {serialModalLine !== null && serialModalIdx !== null && (
        <SerialEntryModal
          product={serialModalLine.product}
          expectedQty={parseQty(serialModalLine.qtyInput, serialModalLine.ordered - serialModalLine.alreadyReceived)}
          initial={serialModalLine.serials}
          onConfirm={serials => {
            setLine(serialModalIdx, { serials })
            setSerialModalIdx(null)
          }}
          onClose={() => setSerialModalIdx(null)}
        />
      )}
    </div>
  )
}

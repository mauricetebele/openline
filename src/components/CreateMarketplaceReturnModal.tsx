'use client'
import React, { useState, useEffect } from 'react'
import { X, CheckCircle2, Package } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Exported Types ──────────────────────────────────────────────────────────

export interface RMASerial {
  id: string
  serialNumber: string
  inventorySerialId: string | null
  receivedAt: string | null
  locationId: string | null
  gradeId: string | null
  note: string | null
  location?: { id: string; name: string; warehouse: { id: string; name: string } } | null
  grade?: { id: string; grade: string } | null
  inventorySerial?: { gradeId: string | null; grade: { id: string; grade: string } | null } | null
}

export interface RMAItem {
  id: string
  orderItemId: string
  productId: string | null
  sellerSku: string | null
  asin: string | null
  title: string | null
  quantityReturned: number
  returnReason: string | null
  product?: { id: string; sku: string; description: string; isSerializable: boolean } | null
  orderItem?: { id: string; quantityOrdered: number; sellerSku: string | null; title: string | null }
  serials: RMASerial[]
}

export interface MarketplaceRMA {
  id: string
  rmaNumber: string
  status: 'OPEN' | 'RECEIVED'
  notes: string | null
  createdAt: string
  updatedAt: string
  order: {
    id: string
    olmNumber: number | null
    amazonOrderId: string
    orderSource: string
    shipToName: string | null
    shipToCity?: string | null
    shipToState?: string | null
  }
  items: RMAItem[]
}

export interface OrderSearchResult {
  id: string
  olmNumber: number | null
  amazonOrderId: string
  orderSource: string
  shipToName: string | null
  shipToCity: string | null
  shipToState: string | null
  purchaseDate: string
  items: Array<{
    id: string
    orderItemId: string
    asin: string | null
    sellerSku: string | null
    title: string | null
    quantityOrdered: number
    quantityShipped: number
    serialAssignments: Array<{
      inventorySerial: {
        id: string
        serialNumber: string
        productId: string
        product: { id: string; sku: string; description: string; isSerializable: boolean }
        grade: { id: string; grade: string } | null
      }
    }>
  }>
}

export interface Warehouse { id: string; name: string; locations: Location[] }
export interface Location { id: string; name: string; warehouseId: string }
export interface Grade { id: string; grade: string }

// ─── CreateReturnModal ───────────────────────────────────────────────────────

export default function CreateReturnModal({
  order,
  onClose,
  onCreated,
}: {
  order: OrderSearchResult
  onClose: () => void
  onCreated: () => void
}) {
  // Step 1: select returns, Step 2: receive returns
  const [step, setStep] = useState<1 | 2>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdRma, setCreatedRma] = useState<MarketplaceRMA | null>(null)

  // Step 1 state: selections
  const [selectedSerials, setSelectedSerials] = useState<Set<string>>(new Set())
  const [nonSerialQtys, setNonSerialQtys] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [returnReasons, setReturnReasons] = useState<Array<{ id: string; label: string }>>([])
  // Return reason per order item id
  const [itemReasons, setItemReasons] = useState<Record<string, string>>({})

  // Fetch return reasons
  useEffect(() => {
    fetch('/api/rma-return-reasons')
      .then(r => r.json())
      .then(j => setReturnReasons(j.data ?? []))
      .catch(() => {})
  }, [])

  // Step 2 state: receiving info
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [serialReceive, setSerialReceive] = useState<Record<string, {
    warehouseId: string; locationId: string; gradeId: string; note: string
  }>>({})
  const [nonSerialReceive, setNonSerialReceive] = useState<Record<string, {
    warehouseId: string; locationId: string; gradeId: string
  }>>({})
  const [globalGrades, setGlobalGrades] = useState<Grade[]>([])
  const [receiving, setReceiving] = useState(false)
  const [regradeSerials, setRegradeSerials] = useState<Set<string>>(new Set())

  // Fetch warehouses + grades when step 2
  useEffect(() => {
    if (step !== 2) return
    Promise.all([
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/grades').then(r => r.json()),
    ]).then(([whJson, grJson]) => {
      setWarehouses(whJson.data ?? whJson ?? [])
      setGlobalGrades(grJson.data ?? [])
    }).catch(() => {})
  }, [step])

  // Collect all items with serials and non-serial items
  const serializedItems: Array<{
    orderItem: OrderSearchResult['items'][0]
    serial: OrderSearchResult['items'][0]['serialAssignments'][0]['inventorySerial']
  }> = []
  const nonSerializedItems: OrderSearchResult['items'][0][] = []

  for (const item of order.items) {
    if (item.serialAssignments.length > 0) {
      for (const sa of item.serialAssignments) {
        serializedItems.push({ orderItem: item, serial: sa.inventorySerial })
      }
    } else {
      nonSerializedItems.push(item)
    }
  }

  const hasSelection = selectedSerials.size > 0 || Object.values(nonSerialQtys).some(q => q > 0)

  // ─── Step 1: Create RMA ─────────────────────────────────────────────────
  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      const items: Array<{
        orderItemId: string
        productId?: string
        sellerSku?: string
        asin?: string
        title?: string
        quantityReturned: number
        returnReason?: string
        serials?: Array<{ serialNumber: string; inventorySerialId: string }>
      }> = []

      // Group selected serials by orderItem
      const serialsByItem = new Map<string, typeof serializedItems>()
      for (const si of serializedItems) {
        if (!selectedSerials.has(si.serial.id)) continue
        const group = serialsByItem.get(si.orderItem.id) ?? []
        group.push(si)
        serialsByItem.set(si.orderItem.id, group)
      }

      Array.from(serialsByItem.entries()).forEach(([orderItemId, group]) => {
        const first = group[0]
        items.push({
          orderItemId,
          productId: first.serial.product.id,
          sellerSku: first.orderItem.sellerSku ?? undefined,
          asin: first.orderItem.asin ?? undefined,
          title: first.orderItem.title ?? undefined,
          quantityReturned: group.length,
          returnReason: itemReasons[orderItemId] || undefined,
          serials: group.map((g: typeof serializedItems[0]) => ({
            serialNumber: g.serial.serialNumber,
            inventorySerialId: g.serial.id,
          })),
        })
      })

      // Non-serial items
      for (const item of nonSerializedItems) {
        const qty = nonSerialQtys[item.id] ?? 0
        if (qty <= 0) continue
        items.push({
          orderItemId: item.id,
          sellerSku: item.sellerSku ?? undefined,
          asin: item.asin ?? undefined,
          title: item.title ?? undefined,
          quantityReturned: qty,
          returnReason: itemReasons[item.id] || undefined,
        })
      }

      const res = await fetch('/api/marketplace-rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, notes: notes.trim() || undefined, items }),
      })

      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to create RMA')
      }

      const rma = await res.json()
      setCreatedRma(rma)

      // Initialize step 2 state — default grade to the serial's shipped grade
      const gradeBySerialId = new Map<string, string>()
      for (const si of serializedItems) {
        if (si.serial.grade?.id) gradeBySerialId.set(si.serial.id, si.serial.grade.id)
      }
      const serialRec: typeof serialReceive = {}
      for (const item of rma.items ?? []) {
        for (const s of item.serials ?? []) {
          const shippedGradeId = s.inventorySerialId ? (gradeBySerialId.get(s.inventorySerialId) ?? '') : ''
          serialRec[s.id] = { warehouseId: '', locationId: '', gradeId: shippedGradeId, note: '' }
        }
      }
      setSerialReceive(serialRec)

      // Non-serial receive state
      const nsRec: typeof nonSerialReceive = {}
      for (const item of rma.items ?? []) {
        if ((item.serials ?? []).length === 0) {
          nsRec[item.id] = { warehouseId: '', locationId: '', gradeId: '' }
        }
      }
      setNonSerialReceive(nsRec)

      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setSaving(false)
  }

  // ─── Step 2: Receive Returns ────────────────────────────────────────────
  const allSerialsReady = Object.values(serialReceive).every(s => s.locationId)
  const allNonSerialsReady = Object.values(nonSerialReceive).every(s => s.locationId)
  const canReceive = allSerialsReady && allNonSerialsReady && !receiving

  async function handleReceive() {
    if (!createdRma) return
    setReceiving(true)
    setError('')
    try {
      const serialUpdates = Object.entries(serialReceive).map(([rmaSerialId, data]) => {
        const rmaSerial = createdRma.items.flatMap(i => i.serials).find(s => s.id === rmaSerialId)
        return {
          rmaSerialId,
          inventorySerialId: rmaSerial?.inventorySerialId ?? undefined,
          locationId: data.locationId,
          gradeId: data.gradeId || null,
          note: data.note || undefined,
        }
      })

      const nonSerialItems = Object.entries(nonSerialReceive).map(([rmaItemId, data]) => {
        const rmaItem = createdRma.items.find(i => i.id === rmaItemId)
        return {
          rmaItemId,
          productId: rmaItem?.productId ?? '',
          locationId: data.locationId,
          gradeId: data.gradeId || null,
          quantityReturned: rmaItem?.quantityReturned ?? 1,
        }
      }).filter(i => i.productId)

      const res = await fetch(`/api/marketplace-rma/${createdRma.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialUpdates, nonSerialItems: nonSerialItems.length ? nonSerialItems : undefined }),
      })

      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to receive returns')
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setReceiving(false)
  }

  // Apply to all
  const [applyAllWh, setApplyAllWh] = useState('')
  const [applyAllLoc, setApplyAllLoc] = useState('')

  function handleApplyToAll() {
    if (!applyAllWh || !applyAllLoc) return
    setSerialReceive(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], warehouseId: applyAllWh, locationId: applyAllLoc }
      }
      return next
    })
    setNonSerialReceive(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], warehouseId: applyAllWh, locationId: applyAllLoc }
      }
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {step === 1 ? 'Select Returns' : `Receive Returns — ${createdRma?.rmaNumber}`}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {order.olmNumber ? `OLM-${order.olmNumber}` : ''} {order.amazonOrderId} &middot; {order.shipToName}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Step 1: Select Returns */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Serialized items */}
            {serializedItems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Serialized Items</h3>
                <div className="space-y-2">
                  {serializedItems.map(({ orderItem, serial }) => (
                    <label
                      key={serial.id}
                      className={clsx(
                        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        selectedSerials.has(serial.id)
                          ? 'border-amazon-blue bg-blue-50/50'
                          : 'border-gray-200 hover:bg-gray-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSerials.has(serial.id)}
                        onChange={() => {
                          setSelectedSerials(prev => {
                            const next = new Set(prev)
                            next.has(serial.id) ? next.delete(serial.id) : next.add(serial.id)
                            return next
                          })
                        }}
                        className="rounded border-gray-300 text-amazon-blue focus:ring-amazon-blue"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-gray-900">{serial.serialNumber}</span>
                          <span className="text-xs text-gray-500">{serial.product.sku}</span>
                          {serial.grade && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                              {serial.grade.grade}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{orderItem.title}</p>
                      </div>
                      <select
                        value={itemReasons[orderItem.id] ?? ''}
                        onChange={(e) => {
                          e.stopPropagation()
                          setItemReasons(prev => ({ ...prev, [orderItem.id]: e.target.value }))
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="border border-gray-200 rounded px-2 py-1 text-sm shrink-0"
                      >
                        <option value="">Return reason...</option>
                        {returnReasons.map(r => (
                          <option key={r.id} value={r.label}>{r.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Non-serialized items */}
            {nonSerializedItems.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Non-Serialized Items</h3>
                <div className="space-y-2">
                  {nonSerializedItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200"
                    >
                      <Package size={16} className="text-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{item.sellerSku}</span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">{item.title}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={itemReasons[item.id] ?? ''}
                          onChange={(e) => setItemReasons(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        >
                          <option value="">Return reason...</option>
                          {returnReasons.map(r => (
                            <option key={r.id} value={r.label}>{r.label}</option>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400">Qty:</span>
                        <select
                          value={nonSerialQtys[item.id] ?? 0}
                          onChange={(e) => setNonSerialQtys(prev => ({
                            ...prev,
                            [item.id]: parseInt(e.target.value, 10),
                          }))}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        >
                          <option value={0}>0</option>
                          {Array.from({ length: item.quantityOrdered }, (_, i) => i + 1).map(n => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400">of {item.quantityOrdered}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amazon-blue focus:border-transparent"
                placeholder="Reason for return..."
              />
            </div>
          </div>
        )}

        {/* Step 2: Receive Returns */}
        {step === 2 && createdRma && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Apply to all */}
            <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap items-end gap-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider self-center">Apply to all:</span>
              <div className="flex-1 min-w-[140px]">
                <select
                  value={applyAllWh}
                  onChange={(e) => { setApplyAllWh(e.target.value); setApplyAllLoc('') }}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Warehouse...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <select
                  value={applyAllLoc}
                  onChange={(e) => setApplyAllLoc(e.target.value)}
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                  disabled={!applyAllWh}
                >
                  <option value="">Location...</option>
                  {warehouses.find(w => w.id === applyAllWh)?.locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleApplyToAll}
                disabled={!applyAllWh || !applyAllLoc}
                className="px-3 py-1.5 text-sm font-medium rounded bg-amazon-blue text-white disabled:opacity-40 hover:bg-amazon-blue/90 transition"
              >
                Apply
              </button>
            </div>

            {/* Serial rows */}
            {createdRma.items.filter(i => i.serials.length > 0).map(item => (
              <div key={item.id} className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  {item.sellerSku ?? item.title ?? 'Item'}
                </h3>
                {item.serials.map(serial => {
                  const state = serialReceive[serial.id] ?? { warehouseId: '', locationId: '', gradeId: '', note: '' }
                  const filteredLocs = warehouses.find(w => w.id === state.warehouseId)?.locations ?? []
                  return (
                    <div key={serial.id} className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-gray-200">
                      <span className="font-mono text-sm font-medium text-gray-900 min-w-[120px]">{serial.serialNumber}</span>
                      <select
                        value={state.warehouseId}
                        onChange={(e) => setSerialReceive(prev => ({
                          ...prev,
                          [serial.id]: { ...prev[serial.id], warehouseId: e.target.value, locationId: '' },
                        }))}
                        className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                      >
                        <option value="">Warehouse...</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <select
                        value={state.locationId}
                        onChange={(e) => setSerialReceive(prev => ({
                          ...prev,
                          [serial.id]: { ...prev[serial.id], locationId: e.target.value },
                        }))}
                        className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                        disabled={!state.warehouseId}
                      >
                        <option value="">Location...</option>
                        {filteredLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      {globalGrades.length > 0 && (
                        !regradeSerials.has(serial.id) ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${state.gradeId ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                              {state.gradeId ? (globalGrades.find(g => g.id === state.gradeId)?.grade ?? 'Graded') : 'No Grade'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setRegradeSerials(prev => new Set(prev).add(serial.id))}
                              className="text-xs text-gray-500 hover:text-amazon-blue underline"
                            >
                              Regrade
                            </button>
                          </div>
                        ) : (
                          <select
                            value={state.gradeId}
                            onChange={(e) => setSerialReceive(prev => ({
                              ...prev,
                              [serial.id]: { ...prev[serial.id], gradeId: e.target.value },
                            }))}
                            className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[80px]"
                          >
                            <option value="">Grade...</option>
                            {globalGrades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
                          </select>
                        )
                      )}
                      <input
                        value={state.note}
                        onChange={(e) => setSerialReceive(prev => ({
                          ...prev,
                          [serial.id]: { ...prev[serial.id], note: e.target.value },
                        }))}
                        placeholder="Note..."
                        className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[100px]"
                      />
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Non-serial rows */}
            {createdRma.items.filter(i => i.serials.length === 0).map(item => {
              const state = nonSerialReceive[item.id] ?? { warehouseId: '', locationId: '', gradeId: '' }
              const filteredLocs = warehouses.find(w => w.id === state.warehouseId)?.locations ?? []
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-gray-200">
                  <div className="min-w-[120px]">
                    <span className="text-sm font-medium text-gray-900">{item.sellerSku ?? item.title}</span>
                    <span className="text-xs text-gray-400 ml-2">x{item.quantityReturned}</span>
                  </div>
                  <select
                    value={state.warehouseId}
                    onChange={(e) => setNonSerialReceive(prev => ({
                      ...prev,
                      [item.id]: { ...prev[item.id], warehouseId: e.target.value, locationId: '' },
                    }))}
                    className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                  >
                    <option value="">Warehouse...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <select
                    value={state.locationId}
                    onChange={(e) => setNonSerialReceive(prev => ({
                      ...prev,
                      [item.id]: { ...prev[item.id], locationId: e.target.value },
                    }))}
                    className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]"
                    disabled={!state.warehouseId}
                  >
                    <option value="">Location...</option>
                    {filteredLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  {globalGrades.length > 0 && (
                    <select
                      value={state.gradeId}
                      onChange={(e) => setNonSerialReceive(prev => ({
                        ...prev,
                        [item.id]: { ...prev[item.id], gradeId: e.target.value },
                      }))}
                      className="border border-gray-200 rounded px-2 py-1.5 text-sm min-w-[80px]"
                    >
                      <option value="">Grade...</option>
                      {globalGrades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition"
          >
            Cancel
          </button>
          {step === 1 && (
            <button
              onClick={handleCreate}
              disabled={!hasSelection || saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-amazon-blue rounded-lg shadow hover:bg-amazon-blue/90 disabled:opacity-40 transition"
            >
              {saving ? 'Creating...' : 'Create RMA'}
            </button>
          )}
          {step === 2 && (
            <button
              onClick={handleReceive}
              disabled={!canReceive}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg shadow hover:bg-green-700 disabled:opacity-40 transition"
            >
              <CheckCircle2 size={16} />
              {receiving ? 'Receiving...' : 'Receive'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

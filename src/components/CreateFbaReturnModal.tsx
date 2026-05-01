'use client'
import React, { useState, useEffect, useRef } from 'react'
import { X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Warehouse {
  id: string
  name: string
  locations: { id: string; name: string }[]
}

interface Grade {
  id: string
  grade: string
}

interface ValidatedSerial {
  inventorySerialId: string
  serialNumber: string
  productId: string
  sku: string
  description: string
  gradeId: string | null
  grade: string | null
  fbaShipmentId: string
  fbaShipmentNumber: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateFbaReturnModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [serialInput, setSerialInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [validated, setValidated] = useState<ValidatedSerial | null>(null)
  const [validationError, setValidationError] = useState('')

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [showRegrade, setShowRegrade] = useState(false)
  const [note, setNote] = useState('')

  const [receiving, setReceiving] = useState(false)
  const [receiveError, setReceiveError] = useState('')
  const [lastReceipt, setLastReceipt] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // Load warehouses and grades
  useEffect(() => {
    Promise.all([
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/grades').then(r => r.json()),
    ]).then(([whJson, grJson]) => {
      setWarehouses(whJson.data ?? whJson ?? [])
      setGrades(grJson.data ?? [])
    })
  }, [])

  // Focus serial input
  useEffect(() => {
    inputRef.current?.focus()
  }, [lastReceipt])

  async function handleValidate() {
    const sn = serialInput.trim()
    if (!sn) return

    setValidating(true)
    setValidationError('')
    setValidated(null)
    setShowRegrade(false)

    try {
      const res = await fetch('/api/fba-return-receipts/validate-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber: sn }),
      })
      const json = await res.json()
      if (!res.ok) {
        setValidationError(json.error || 'Validation failed')
      } else {
        setValidated(json.data)
        setGradeId(json.data.gradeId ?? '')
      }
    } catch {
      setValidationError('Failed to validate serial')
    }
    setValidating(false)
  }

  async function handleReceive() {
    if (!validated || !locationId) return

    setReceiving(true)
    setReceiveError('')

    try {
      const res = await fetch('/api/fba-return-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventorySerialId: validated.inventorySerialId,
          locationId,
          gradeId: showRegrade ? (gradeId || null) : undefined,
          note: note.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setReceiveError(json.error || 'Failed to receive')
      } else {
        setLastReceipt(json.receiptNumber)
        onCreated()
        // Reset for next scan
        setSerialInput('')
        setValidated(null)
        setShowRegrade(false)
        setNote('')
        // Keep warehouse/location for consecutive scans
        inputRef.current?.focus()
      }
    } catch {
      setReceiveError('Failed to receive')
    }
    setReceiving(false)
  }

  function handleReset() {
    setSerialInput('')
    setValidated(null)
    setValidationError('')
    setReceiveError('')
    setShowRegrade(false)
    setNote('')
    setLastReceipt(null)
    inputRef.current?.focus()
  }

  const filteredLocations = warehouses.find(w => w.id === warehouseId)?.locations ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Receive FBA Return</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Success banner */}
          {lastReceipt && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 size={16} />
              <span>Received <strong>{lastReceipt}</strong> — scan next serial</span>
            </div>
          )}

          {/* Serial Input */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Serial Number
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                autoFocus
                value={serialInput}
                onChange={(e) => { setSerialInput(e.target.value); setValidated(null); setValidationError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleValidate() }}
                placeholder="Scan or type serial..."
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amazon-blue focus:border-transparent"
                disabled={!!validated}
              />
              {validated ? (
                <button
                  onClick={handleReset}
                  className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Clear
                </button>
              ) : (
                <button
                  onClick={handleValidate}
                  disabled={!serialInput.trim() || validating}
                  className="px-4 py-2 text-sm font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90 disabled:opacity-40"
                >
                  {validating ? <Loader2 size={14} className="animate-spin" /> : 'Validate'}
                </button>
              )}
            </div>
          </div>

          {/* Validation error */}
          {validationError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              <AlertCircle size={16} />
              {validationError}
            </div>
          )}

          {/* Product card */}
          {validated && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{validated.sku}</span>
                {validated.fbaShipmentNumber && (
                  <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{validated.fbaShipmentNumber}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{validated.description}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Serial: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{validated.serialNumber}</span>
              </p>
            </div>
          )}

          {/* Warehouse + Location */}
          {validated && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Warehouse</label>
                <select
                  value={warehouseId}
                  onChange={(e) => { setWarehouseId(e.target.value); setLocationId('') }}
                  className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Select...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Location</label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  disabled={!warehouseId}
                  className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-40"
                >
                  <option value="">Select...</option>
                  {filteredLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Grade */}
          {validated && (
            <div>
              {!showRegrade ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Grade:</span>
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    validated.grade
                      ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800'
                      : 'bg-gray-50 text-gray-500 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                  }`}>
                    {validated.grade ?? 'No Grade'}
                  </span>
                  <button
                    onClick={() => setShowRegrade(true)}
                    className="text-xs text-gray-500 hover:text-amazon-blue underline"
                  >
                    Regrade
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">New Grade</label>
                  <select
                    value={gradeId}
                    onChange={(e) => setGradeId(e.target.value)}
                    className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">No Grade</option>
                    {grades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Note */}
          {validated && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Note (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Condition notes..."
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
          )}

          {/* Receive error */}
          {receiveError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              <AlertCircle size={16} />
              {receiveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 transition">
            Close
          </button>
          {validated && (
            <button
              onClick={handleReceive}
              disabled={!locationId || receiving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg shadow hover:bg-green-700 disabled:opacity-40 transition"
            >
              {receiving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {receiving ? 'Receiving...' : 'Receive'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

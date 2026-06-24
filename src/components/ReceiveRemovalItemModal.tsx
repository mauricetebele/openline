'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { X, CheckCircle2, AlertCircle, Loader2, Search } from 'lucide-react'

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

interface ProductSuggestion {
  productId: string
  sku: string
  description: string
  gradeId: string | null
  grade: string | null
}

interface ProductSearchResult {
  id: string
  sku: string
  description: string
}

interface ValidatedSerial {
  inventorySerialId: string
  serialNumber: string
  productId: string
  sku: string
  description: string
  gradeId: string | null
  grade: string | null
  fbaShipmentId: string | null
  fbaShipmentNumber: string | null
}

interface Props {
  shipmentId: string
  shipmentItemId: string
  trackingNumber: string
  sellerSku: string
  fnsku: string
  onClose: () => void
  onReceived: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReceiveRemovalItemModal({
  shipmentId,
  shipmentItemId,
  trackingNumber,
  sellerSku,
  fnsku,
  onClose,
  onReceived,
}: Props) {
  // Step tracking: 1=LPN, 2=SKU, 3=Grade, 4=Serial, 5=Location
  const [step, setStep] = useState(1)

  // Step 1 — LPN
  const [lpnNumber, setLpnNumber] = useState('')
  const lpnRef = useRef<HTMLInputElement>(null)

  // Step 2 — Product
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedProductSku, setSelectedProductSku] = useState('')
  const [selectedProductDesc, setSelectedProductDesc] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([])
  const [searchingProducts, setSearchingProducts] = useState(false)

  // Step 3 — Grade
  const [grades, setGrades] = useState<Grade[]>([])
  const [gradeId, setGradeId] = useState('')

  // Step 4 — Serial
  const [serialInput, setSerialInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [validated, setValidated] = useState<ValidatedSerial | null>(null)
  const [validationError, setValidationError] = useState('')
  const serialRef = useRef<HTMLInputElement>(null)

  // Step 5 — Warehouse / Location
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId] = useState('')

  // Submission
  const [receiving, setReceiving] = useState(false)
  const [receiveError, setReceiveError] = useState('')
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null)

  // Load static data on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/grades').then(r => r.json()),
      fetch(`/api/removal-shipments/${shipmentId}/product-lookup?sellerSku=${encodeURIComponent(sellerSku)}`).then(r => r.json()),
    ]).then(([whJson, grJson, lookupJson]) => {
      const wh = whJson.data ?? whJson ?? []
      setWarehouses(wh)
      setGrades(grJson.data ?? [])

      const suggs: ProductSuggestion[] = lookupJson.suggestions ?? []
      setSuggestions(suggs)

      // Auto-select first suggestion
      if (suggs.length > 0) {
        setSelectedProductId(suggs[0].productId)
        setSelectedProductSku(suggs[0].sku)
        setSelectedProductDesc(suggs[0].description)
        if (suggs[0].gradeId) setGradeId(suggs[0].gradeId)
      }

      // Restore last used warehouse/location from sessionStorage
      const lastWh = sessionStorage.getItem('removal-receive-warehouseId')
      const lastLoc = sessionStorage.getItem('removal-receive-locationId')
      if (lastWh) {
        setWarehouseId(lastWh)
        const hasLoc = wh.find((w: Warehouse) => w.id === lastWh)?.locations.some((l: { id: string }) => l.id === lastLoc)
        if (lastLoc && hasLoc) setLocationId(lastLoc)
      }
    })
  }, [shipmentId, sellerSku])

  // Auto-focus LPN input
  useEffect(() => { lpnRef.current?.focus() }, [])

  // Search products debounced
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleProductSearch = useCallback((query: string) => {
    setProductSearch(query)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (query.trim().length < 2) { setProductResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearchingProducts(true)
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(query.trim())}`)
        const json = await res.json()
        setProductResults((json.data ?? json ?? []).slice(0, 10))
      } catch { /* ignore */ }
      setSearchingProducts(false)
    }, 300)
  }, [])

  function selectProduct(p: { id: string; sku: string; description?: string }) {
    setSelectedProductId(p.id)
    setSelectedProductSku(p.sku)
    setSelectedProductDesc(p.description ?? '')
    setProductSearch('')
    setProductResults([])
  }

  async function handleValidateSerial() {
    const sn = serialInput.trim()
    if (!sn) return
    setValidating(true)
    setValidationError('')
    setValidated(null)
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
        const data: ValidatedSerial = json.data
        // Check product match
        if (data.productId !== selectedProductId) {
          setValidationError(`Serial belongs to product ${data.sku}, not ${selectedProductSku}`)
        } else {
          setValidated(data)
        }
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
          gradeId: gradeId || null,
          removalShipmentId: shipmentId,
          removalShipmentItemId: shipmentItemId,
          removalTrackingNumber: trackingNumber,
          lpnNumber: lpnNumber.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setReceiveError(json.error || 'Failed to receive')
      } else {
        // Save warehouse/location for next receive
        sessionStorage.setItem('removal-receive-warehouseId', warehouseId)
        sessionStorage.setItem('removal-receive-locationId', locationId)
        setReceiptNumber(json.receiptNumber)
        onReceived()
      }
    } catch {
      setReceiveError('Failed to receive')
    }
    setReceiving(false)
  }

  const filteredLocations = warehouses.find(w => w.id === warehouseId)?.locations ?? []

  // ── Success screen ──
  if (receiptNumber) {
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[8vh] bg-black/40">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4">
          <div className="px-6 py-8 text-center space-y-4">
            <CheckCircle2 size={48} className="mx-auto text-green-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Unit Received</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Receipt <strong className="text-gray-900 dark:text-gray-100">{receiptNumber}</strong> created
            </p>
          </div>
          <div className="flex justify-center px-6 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
            <button onClick={onClose} className="px-6 py-2 text-sm font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Multi-step form ──
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[6vh] bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Receive Unit</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {sellerSku} &middot; {fnsku} &middot; Tracking: {trackingNumber}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {/* Step 1: LPN */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              1. LPN Number
            </label>
            <input
              ref={lpnRef}
              autoFocus
              value={lpnNumber}
              onChange={(e) => setLpnNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && lpnNumber.trim()) setStep(2) }}
              placeholder="Scan or type LPN..."
              disabled={step > 1}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60"
            />
            {step === 1 && (
              <button
                onClick={() => { if (lpnNumber.trim()) setStep(2) }}
                disabled={!lpnNumber.trim()}
                className="mt-2 px-4 py-1.5 text-xs font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90 disabled:opacity-40"
              >
                Next
              </button>
            )}
          </div>

          {/* Step 2: Internal SKU / Product */}
          {step >= 2 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                2. Internal Product
              </label>
              {selectedProductId ? (
                <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{selectedProductSku}</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{selectedProductDesc}</p>
                  </div>
                  {step === 2 && (
                    <button
                      onClick={() => { setSelectedProductId(''); setSelectedProductSku(''); setSelectedProductDesc('') }}
                      className="text-xs text-gray-500 hover:text-red-500 underline shrink-0"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={productSearch}
                    onChange={(e) => handleProductSearch(e.target.value)}
                    placeholder="Search by SKU or name..."
                    className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  {searchingProducts && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
                  {productResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {productResults.map(p => (
                        <button
                          key={p.id}
                          onClick={() => selectProduct(p)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0"
                        >
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{p.sku}</span>
                          <span className="ml-2 text-gray-500 dark:text-gray-400">{p.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {step === 2 && selectedProductId && (
                <button
                  onClick={() => setStep(3)}
                  className="mt-2 px-4 py-1.5 text-xs font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90"
                >
                  Next
                </button>
              )}
            </div>
          )}

          {/* Step 3: Grade */}
          {step >= 3 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                3. Grade
              </label>
              <select
                value={gradeId}
                onChange={(e) => setGradeId(e.target.value)}
                disabled={step > 3}
                className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60"
              >
                <option value="">No Grade</option>
                {grades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
              </select>
              {step === 3 && (
                <button
                  onClick={() => { setStep(4); setTimeout(() => serialRef.current?.focus(), 50) }}
                  className="mt-2 px-4 py-1.5 text-xs font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90"
                >
                  Next
                </button>
              )}
            </div>
          )}

          {/* Step 4: Serial Number */}
          {step >= 4 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                4. Serial Number
              </label>
              {validated ? (
                <div className="p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                    <span className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{validated.serialNumber}</span>
                    <span className="text-xs text-gray-500">— {validated.sku}</span>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    ref={serialRef}
                    value={serialInput}
                    onChange={(e) => { setSerialInput(e.target.value); setValidationError('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleValidateSerial() }}
                    placeholder="Scan or type serial..."
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <button
                    onClick={handleValidateSerial}
                    disabled={!serialInput.trim() || validating}
                    className="px-4 py-2 text-sm font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90 disabled:opacity-40"
                  >
                    {validating ? <Loader2 size={14} className="animate-spin" /> : 'Validate'}
                  </button>
                </div>
              )}
              {validationError && (
                <div className="mt-2 flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400">
                  <AlertCircle size={14} />
                  {validationError}
                </div>
              )}
              {step === 4 && validated && (
                <button
                  onClick={() => setStep(5)}
                  className="mt-2 px-4 py-1.5 text-xs font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90"
                >
                  Next
                </button>
              )}
            </div>
          )}

          {/* Step 5: Warehouse / Location */}
          {step >= 5 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                5. Warehouse &amp; Location
              </label>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={warehouseId}
                  onChange={(e) => { setWarehouseId(e.target.value); setLocationId('') }}
                  className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Warehouse...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  disabled={!warehouseId}
                  className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-40"
                >
                  <option value="">Location...</option>
                  {filteredLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
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
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900">
            Cancel
          </button>
          {step >= 5 && validated && (
            <button
              onClick={handleReceive}
              disabled={!locationId || receiving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg shadow hover:bg-green-700 disabled:opacity-40"
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

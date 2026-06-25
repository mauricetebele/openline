'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { X, CheckCircle2, AlertCircle, Loader2, Search, Printer } from 'lucide-react'
import SickwCheckButton from './SickwCheckButton'

/** Pick SICKW service based on device type:
 *  iPhone / Apple Watch → iCloud ON/OFF (id 3)
 *  MacBook / iPad       → Apple Basic Info (id 30)
 */
function getFmiService(text: string): { serviceId: number; serviceName: string } | null {
  const t = text.toLowerCase()
  if (/iphone|apple\s*watch/.test(t)) return { serviceId: 3, serviceName: 'iCloud ON/OFF' }
  if (/macbook|ipad/.test(t)) return { serviceId: 30, serviceName: 'Basic Info' }
  return null
}
import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'

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

interface ProductSearchResult {
  id: string
  sku: string
  description: string
}

interface Vendor {
  id: string
  name: string
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
  // Step tracking: 1=LPN, 2=Serial, 3=Grade, 4=Location
  const [step, setStep] = useState(1)

  // Step 1 — LPN
  const [lpnNumber, setLpnNumber] = useState('')
  const lpnRef = useRef<HTMLInputElement>(null)

  // Step 2 — Serial (validate first, then product is determined)
  const [serialInput, setSerialInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [validated, setValidated] = useState<ValidatedSerial | null>(null)
  const [validationError, setValidationError] = useState('')
  const [overrideMode, setOverrideMode] = useState(false)
  const serialRef = useRef<HTMLInputElement>(null)

  // Override — product picker + cost + vendor
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedProductSku, setSelectedProductSku] = useState('')
  const [selectedProductDesc, setSelectedProductDesc] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([])
  const [searchingProducts, setSearchingProducts] = useState(false)
  const [overrideCost, setOverrideCost] = useState('')
  const [overrideVendorId, setOverrideVendorId] = useState('')

  // Step 3 — Grade + Note
  const [grades, setGrades] = useState<Grade[]>([])
  const [gradeId, setGradeId] = useState('')
  const [note, setNote] = useState('')

  // Step 4 — Warehouse / Location
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId] = useState('')

  // Submission
  const [receiving, setReceiving] = useState(false)
  const [receiveError, setReceiveError] = useState('')
  const [receiptData, setReceiptData] = useState<{
    receiptNumber: string
    serialNumber: string
    sku: string
    grade: string | null
  } | null>(null)

  // Load static data on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/grades').then(r => r.json()),
      fetch('/api/vendors').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([whJson, grJson, vnJson]) => {
      const wh = whJson.data ?? whJson ?? []
      setWarehouses(wh)
      setGrades(grJson.data ?? [])
      setVendors(vnJson.data ?? vnJson ?? [])

      // Restore last used warehouse/location from sessionStorage
      const lastWh = sessionStorage.getItem('removal-receive-warehouseId')
      const lastLoc = sessionStorage.getItem('removal-receive-locationId')
      if (lastWh) {
        setWarehouseId(lastWh)
        const hasLoc = wh.find((w: Warehouse) => w.id === lastWh)?.locations.some((l: { id: string }) => l.id === lastLoc)
        if (lastLoc && hasLoc) setLocationId(lastLoc)
      }
    })
  }, [])

  // Auto-focus LPN input
  useEffect(() => { lpnRef.current?.focus() }, [])

  // Search products debounced (for override mode)
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

  async function handleValidateSerial() {
    const sn = serialInput.trim()
    if (!sn) return
    setValidating(true)
    setValidationError('')
    setValidated(null)
    setOverrideMode(false)
    try {
      const res = await fetch('/api/fba-return-receipts/validate-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber: sn }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 404) {
          setValidationError('Serial not found — you can override to create a new serial record.')
        } else {
          setValidationError(json.error || 'Validation failed')
        }
      } else {
        const data: ValidatedSerial = json.data
        setValidated(data)
        // Auto-populate grade from the serial
        if (data.gradeId) setGradeId(data.gradeId)
      }
    } catch {
      setValidationError('Failed to validate serial')
    }
    setValidating(false)
  }

  async function handleReceive() {
    if (!overrideMode && !validated) return
    if (!locationId) return
    setReceiving(true)
    setReceiveError('')
    try {
      const body = overrideMode
        ? {
            createSerial: true,
            serialNumber: serialInput.trim(),
            productId: selectedProductId,
            locationId,
            gradeId: gradeId || null,
            note: note.trim() || undefined,
            removalShipmentId: shipmentId,
            removalShipmentItemId: shipmentItemId,
            removalTrackingNumber: trackingNumber,
            lpnNumber: lpnNumber.trim(),
            unitCost: overrideCost ? parseFloat(overrideCost) : undefined,
            vendorId: overrideVendorId || undefined,
          }
        : {
            inventorySerialId: validated!.inventorySerialId,
            locationId,
            gradeId: gradeId || null,
            note: note.trim() || undefined,
            removalShipmentId: shipmentId,
            removalShipmentItemId: shipmentItemId,
            removalTrackingNumber: trackingNumber,
            lpnNumber: lpnNumber.trim(),
          }
      const res = await fetch('/api/fba-return-receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setReceiveError(json.error || 'Failed to receive')
      } else {
        sessionStorage.setItem('removal-receive-warehouseId', warehouseId)
        sessionStorage.setItem('removal-receive-locationId', locationId)
        setReceiptData({
          receiptNumber: json.receiptNumber,
          serialNumber: json.serialNumber,
          sku: json.product?.sku ?? json.sku ?? '',
          grade: json.grade?.grade ?? null,
        })
      }
    } catch {
      setReceiveError('Failed to receive')
    }
    setReceiving(false)
  }

  function printSerialLabel() {
    if (!receiptData) return

    // Label size: DYMO 30334 = 2.25" x 1.25"
    const W = 2.25 * 72 // points
    const H = 1.25 * 72 // points
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [H, W] })

    const margin = 4
    const maxTextW = W - margin * 2

    // SKU line (bold) — shrink font to fit
    doc.setFont('helvetica', 'bold')
    let skuSize = 10
    doc.setFontSize(skuSize)
    while (skuSize > 5 && doc.getTextWidth(receiptData.sku) > maxTextW) {
      skuSize -= 0.5
      doc.setFontSize(skuSize)
    }
    doc.text(receiptData.sku, margin, 12)

    // Grade line (bold, only if exists)
    let yAfterGrade = 12
    if (receiptData.grade) {
      yAfterGrade = 22
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(receiptData.grade, margin, yAfterGrade)
    }

    // Barcode — render at 4x resolution for crisp PDF output
    const scale = 4
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, receiptData.serialNumber, {
      format: 'CODE128',
      width: 2 * scale,
      height: 40 * scale,
      displayValue: false,
      margin: 0,
    })
    const barcodeY = yAfterGrade + 6
    const barcodeImg = canvas.toDataURL('image/png')
    const barcodeW = W - margin * 2
    const barcodeH = 42
    doc.addImage(barcodeImg, 'PNG', margin, barcodeY, barcodeW, barcodeH)

    // Serial number text below barcode
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.text(receiptData.serialNumber, W / 2, barcodeY + barcodeH + 8, { align: 'center' })

    // Timestamp
    const timestamp = new Date().toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: '2-digit',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.text(timestamp, W - margin, H - 4, { align: 'right' })

    // Open print dialog
    const pdfBlob = doc.output('blob')
    const url = URL.createObjectURL(pdfBlob)
    const printWindow = window.open(url, '_blank')
    if (printWindow) {
      printWindow.onload = () => { printWindow.print() }
    }
  }

  const filteredLocations = warehouses.find(w => w.id === warehouseId)?.locations ?? []

  // Can advance from step 2?
  const step2Complete = validated || (overrideMode && selectedProductId && !!overrideCost && !!overrideVendorId)

  // ── Success screen ──
  if (receiptData) {
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[8vh] bg-black/40">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4">
          <div className="px-6 py-8 text-center space-y-4">
            <CheckCircle2 size={48} className="mx-auto text-green-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Unit Received</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Receipt <strong className="text-gray-900 dark:text-gray-100">{receiptData.receiptNumber}</strong> created
            </p>
            <p className="text-xs text-gray-400">
              {receiptData.sku} &middot; {receiptData.serialNumber}
            </p>
          </div>
          <div className="flex justify-center gap-3 px-6 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-2xl">
            <button onClick={printSerialLabel} className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-gray-800 rounded-lg hover:bg-gray-900">
              <Printer size={15} /> Print Label
            </button>
            <button onClick={onReceived} className="px-5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
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
              onKeyDown={(e) => { if (e.key === 'Enter' && lpnNumber.trim()) { setStep(2); setTimeout(() => serialRef.current?.focus(), 50) } }}
              placeholder="Scan or type LPN..."
              disabled={step > 1}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60"
            />
            {step === 1 && (
              <button
                onClick={() => { if (lpnNumber.trim()) { setStep(2); setTimeout(() => serialRef.current?.focus(), 50) } }}
                disabled={!lpnNumber.trim()}
                className="mt-2 px-4 py-1.5 text-xs font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90 disabled:opacity-40"
              >
                Next
              </button>
            )}
          </div>

          {/* Step 2: Serial Number */}
          {step >= 2 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                2. Serial Number
              </label>
              {validated ? (
                <div className="p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                    <span className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{validated.serialNumber}</span>
                    {(() => {
                      const svc = getFmiService(`${validated.sku} ${validated.description}`)
                      return svc ? <SickwCheckButton serial={validated.serialNumber} compact serviceId={svc.serviceId} serviceName={svc.serviceName} /> : null
                    })()}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Product: <span className="font-semibold text-gray-700 dark:text-gray-300">{validated.sku}</span> — {validated.description}
                  </div>
                  {validated.fbaShipmentNumber && (
                    <div className="text-xs text-blue-600 dark:text-blue-400 font-mono">{validated.fbaShipmentNumber}</div>
                  )}
                </div>
              ) : !overrideMode ? (
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
              ) : (
                <div className="p-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Override — New Serial: </span>
                    <span className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{serialInput.trim()}</span>
                    {(() => {
                      const svc = getFmiService(`${selectedProductSku} ${selectedProductDesc}`)
                      return svc ? <SickwCheckButton serial={serialInput.trim()} compact serviceId={svc.serviceId} serviceName={svc.serviceName} /> : null
                    })()}
                  </div>
                </div>
              )}

              {/* Validation error + override button */}
              {validationError && !overrideMode && (
                <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
                    <AlertCircle size={14} />
                    {validationError}
                  </div>
                  {validationError.includes('not found') && (
                    <button
                      onClick={() => { setOverrideMode(true); setValidationError('') }}
                      className="px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
                    >
                      Override — Create New Serial
                    </button>
                  )}
                </div>
              )}

              {/* Override: product picker + cost + vendor */}
              {overrideMode && (
                <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg space-y-3">
                  {/* Product search */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Product <span className="text-red-500">*</span></label>
                    {selectedProductId ? (
                      <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{selectedProductSku}</span>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{selectedProductDesc}</p>
                        </div>
                        <button onClick={() => { setSelectedProductId(''); setSelectedProductSku(''); setSelectedProductDesc('') }} className="text-xs text-gray-500 hover:text-red-500 underline shrink-0">Change</button>
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
                              <button key={p.id} onClick={() => { setSelectedProductId(p.id); setSelectedProductSku(p.sku); setSelectedProductDesc(p.description); setProductSearch(''); setProductResults([]) }}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <span className="font-semibold text-gray-900 dark:text-gray-100">{p.sku}</span>
                                <span className="ml-2 text-gray-500 dark:text-gray-400">{p.description}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Cost + Vendor */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Unit Cost <span className="text-red-500">*</span></label>
                      <input
                        type="number" step="0.01" min="0"
                        value={overrideCost}
                        onChange={(e) => setOverrideCost(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Vendor <span className="text-red-500">*</span></label>
                      <select
                        value={overrideVendorId}
                        onChange={(e) => setOverrideVendorId(e.target.value)}
                        className="w-full px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      >
                        <option value="">Select vendor...</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && step2Complete && (
                <button
                  onClick={() => setStep(3)}
                  className="mt-2 px-4 py-1.5 text-xs font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90"
                >
                  Next
                </button>
              )}
            </div>
          )}

          {/* Step 3: Grade + Note */}
          {step >= 3 && (
            <div className="space-y-3">
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
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                  Note <span className="normal-case tracking-normal font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={step > 3}
                  placeholder="Add a note for this serial..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-60 resize-none"
                />
              </div>
              {step === 3 && (
                <button
                  onClick={() => setStep(4)}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-amazon-blue rounded-lg hover:bg-amazon-blue/90"
                >
                  Next
                </button>
              )}
            </div>
          )}

          {/* Step 4: Warehouse / Location */}
          {step >= 4 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                4. Warehouse &amp; Location
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
          {step >= 4 && (validated || overrideMode) && (
            <button
              onClick={handleReceive}
              disabled={!locationId || receiving || (overrideMode && (!overrideCost || !overrideVendorId || !selectedProductId))}
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

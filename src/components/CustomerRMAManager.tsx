'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, X, ChevronDown, ChevronUp, AlertCircle, Search,
  CheckCircle2, XCircle, Download, ArrowLeft, PackageCheck, Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import jsPDF from 'jspdf'

// ─── Types ────────────────────────────────────────────────────────────────────

type RMAStatus = 'PENDING' | 'RECEIVED' | 'INSPECTED' | 'REFUNDED' | 'REJECTED'

interface RMASerialRow {
  id: string
  serialNumber: string
  productId: string
  product: { id: string; sku: string; description: string }
  grade: { id: string; grade: string } | null
  salePrice: string | null
  salesOrderId: string | null
  soldAt: string | null
  returnReason: string
  receivedAt: string | null
  receivedLocation: { name: string; warehouse: { name: string } } | null
  inventorySerial: { status: string; locationId: string } | null
  notes: string | null
}

interface RMAItem {
  id: string
  productId: string
  quantity: number
  unitPrice: string | null
  condition: string | null
  notes: string | null
  product: { id: string; sku: string; description: string }
}

interface CustomerRMA {
  id: string
  rmaNumber: string
  status: RMAStatus
  reason: string | null
  notes: string | null
  creditAmount: string | null
  createdAt: string
  customer: { id: string; companyName: string }
  items: RMAItem[]
  serials: RMASerialRow[]
}

interface Customer { id: string; companyName: string }
interface Location { id: string; name: string }
interface Warehouse { id: string; name: string; locations: Location[] }

interface ValidatedSerial {
  serialNumber: string
  valid: true
  inventorySerialId: string
  productId: string
  productSku: string
  productDescription: string
  gradeName: string | null
  salePrice: number | null
  salesOrderId: string
  salesOrderNumber: string
  soldAt: string | null
  daysSinceSold: number | null
}

interface InvalidSerial {
  serialNumber: string
  valid: false
  reason: string
}

type ValidationResult = ValidatedSerial | InvalidSerial

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RMAStatus, string> = {
  PENDING:   'Pending',
  RECEIVED:  'Received',
  INSPECTED: 'Inspected',
  REFUNDED:  'Refunded',
  REJECTED:  'Rejected',
}
const STATUS_COLOR: Record<RMAStatus, string> = {
  PENDING:   'bg-yellow-100 text-yellow-700',
  RECEIVED:  'bg-blue-100 text-blue-700',
  INSPECTED: 'bg-purple-100 text-purple-700',
  REFUNDED:  'bg-green-100 text-green-700',
  REJECTED:  'bg-red-100 text-red-700',
}
const NEXT_STATUS: Record<RMAStatus, RMAStatus | null> = {
  PENDING:   null, // auto-transitions via receiving
  RECEIVED:  'INSPECTED',
  INSPECTED: 'REFUNDED',
  REFUNDED:  null,
  REJECTED:  null,
}
const NEXT_LABEL: Record<RMAStatus, string> = {
  PENDING:   '',
  RECEIVED:  'Mark Inspected',
  INSPECTED: 'Mark Refunded',
  REFUNDED:  '',
  REJECTED:  '',
}

const RETURN_REASONS = [
  'Defective',
  'Wrong Item',
  'Customer Dissatisfied',
  'Damaged in Transit',
  'Other',
]

const ALL_STATUSES = Object.keys(STATUS_LABEL) as RMAStatus[]

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysSince(d: string | null) {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button onClick={onClose}><X size={13} /></button>
    </div>
  )
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

interface StoreSettings {
  storeName: string
  logoBase64: string | null
  phone: string | null
  email: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  zip: string | null
}

async function generateRMAPDF(rma: CustomerRMA) {
  // Fetch store settings
  let store: StoreSettings = {
    storeName: 'Open Line Mobility', logoBase64: null,
    phone: null, email: null, addressLine: null, city: null, state: null, zip: null,
  }
  try {
    const res = await fetch('/api/store-settings')
    if (res.ok) store = { ...store, ...(await res.json()) }
  } catch { /* defaults */ }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const w = doc.internal.pageSize.getWidth()
  const margin = 45
  const right = w - margin
  const cw = right - margin
  let y = margin

  // ── Header
  doc.setFillColor(20, 40, 75)
  doc.rect(0, 0, w, 70, 'F')

  // Logo
  if (store.logoBase64) {
    try { doc.addImage(store.logoBase64, 'PNG', margin, 12, 44, 44) } catch { /* skip */ }
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('RETURN AUTHORIZATION', store.logoBase64 ? margin + 52 : margin, 38)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(store.storeName, store.logoBase64 ? margin + 52 : margin, 52)

  doc.setFontSize(11)
  doc.text(rma.rmaNumber, right, 38, { align: 'right' })
  doc.setFontSize(8)
  doc.text(fmt(rma.createdAt), right, 52, { align: 'right' })

  y = 90

  // ── RMA Info box
  doc.setTextColor(60, 60, 60)
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  doc.roundedRect(margin, y, cw, 50, 4, 4, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Customer', margin + 10, y + 15)
  doc.text('Status', margin + cw / 2, y + 15)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(rma.customer.companyName, margin + 10, y + 30)
  doc.text(STATUS_LABEL[rma.status], margin + cw / 2, y + 30)

  if (rma.reason) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Reason', margin + cw * 0.75, y + 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(rma.reason, margin + cw * 0.75, y + 30)
  }

  y += 65

  // ── Serials table
  if (rma.serials.length > 0) {
    const cols = [
      { label: 'SERIAL #',       x: margin + 8,   align: 'left' as const },
      { label: 'SKU',            x: margin + 120,  align: 'left' as const },
      { label: 'GRADE',          x: margin + 215,  align: 'left' as const },
      { label: 'SALE PRICE',     x: margin + 280,  align: 'right' as const },
      { label: 'RETURN REASON',  x: margin + 360,  align: 'left' as const },
    ]

    // Header
    doc.setFillColor(20, 40, 75)
    doc.roundedRect(margin, y, cw, 18, 3, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    y += 12
    for (const col of cols) {
      doc.text(col.label, col.x, y, { align: col.align })
    }
    y += 12

    // Rows
    doc.setTextColor(50, 50, 50)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)

    rma.serials.forEach((s, i) => {
      if (y > doc.internal.pageSize.getHeight() - 100) {
        doc.addPage()
        y = margin
      }

      if (i % 2 === 0) {
        doc.setFillColor(245, 247, 250)
        doc.rect(margin, y - 10, cw, 16, 'F')
      }

      doc.text(s.serialNumber, cols[0].x, y)
      doc.text(s.product.sku, cols[1].x, y)
      doc.text(s.grade?.grade ?? '—', cols[2].x, y)
      doc.text(s.salePrice ? `$${parseFloat(s.salePrice).toFixed(2)}` : '—', cols[3].x, y, { align: 'right' })
      doc.text(s.returnReason, cols[4].x, y)

      y += 16
    })

    // Total
    y += 4
    const totalCredit = rma.serials.reduce((sum, s) => sum + (s.salePrice ? parseFloat(s.salePrice) : 0), 0)
    if (totalCredit > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text('Total Credit:', margin + 200, y, { align: 'right' })
      doc.text(`$${totalCredit.toFixed(2)}`, cols[3].x, y, { align: 'right' })
      y += 20
    }
  }

  // ── Notes
  if (rma.notes) {
    y += 10
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Notes:', margin, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(rma.notes, cw - 10)
    doc.text(lines, margin, y + 12)
    y += 12 + lines.length * 10
  }

  // ── Return Instructions
  y += 20
  if (y > doc.internal.pageSize.getHeight() - 100) {
    doc.addPage()
    y = margin
  }

  doc.setFillColor(240, 245, 255)
  doc.setDrawColor(20, 40, 75)
  doc.setLineWidth(1)
  const boxH = 80
  doc.roundedRect(margin, y, cw, boxH, 4, 4, 'FD')

  doc.setTextColor(20, 40, 75)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Return Instructions', margin + 10, y + 18)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(50, 50, 50)
  doc.text('Please ship all items to:', margin + 10, y + 34)

  const addrLines = [
    store.storeName,
    store.addressLine,
    [store.city, store.state, store.zip].filter(Boolean).join(', '),
  ].filter(Boolean)

  let ay = y + 48
  doc.setFont('helvetica', 'bold')
  for (const line of addrLines) {
    doc.text(line!, margin + 10, ay)
    ay += 12
  }

  doc.save(`RMA-${rma.rmaNumber}.pdf`)
}

// ─── Create Wizard Panel ──────────────────────────────────────────────────────

type WizardStep = 'customer' | 'serials' | 'review'

function CreateWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<WizardStep>('customer')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [custSearch, setCustSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [err, setErr] = useState('')

  // Step 2 — serials
  const [serialText, setSerialText] = useState('')
  const [validating, setValidating] = useState(false)
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([])
  const [validated, setValidated] = useState(false)

  // Step 3 — review
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [serialNotes, setSerialNotes] = useState<Record<string, string>>({})
  const [overallNotes, setOverallNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/wholesale/customers')
      .then(r => r.json()).then(d => setCustomers(d.data ?? []))
  }, [])

  const filteredCusts = customers.filter(c =>
    c.companyName.toLowerCase().includes(custSearch.toLowerCase()),
  )

  const validSerials = validationResults.filter((r): r is ValidatedSerial => r.valid)
  const invalidSerials = validationResults.filter((r): r is InvalidSerial => !r.valid)

  // ── Validate serials
  async function handleValidate() {
    setErr('')
    const lines = serialText.split('\n').map(s => s.trim()).filter(Boolean)
    if (lines.length === 0) { setErr('Paste at least one serial number'); return }

    setValidating(true)
    try {
      const res = await fetch('/api/wholesale/customer-rma/validate-serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, serialNumbers: lines }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Validation failed')
      setValidationResults(data.results)
      setValidated(true)

      // Pre-fill reasons
      const newReasons: Record<string, string> = {}
      for (const r of data.results) {
        if (r.valid) newReasons[r.serialNumber] = 'Defective'
      }
      setReasons(newReasons)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  function removeInvalid(sn: string) {
    setValidationResults(prev => prev.filter(r => r.serialNumber !== sn))
  }

  // ── Create RMA
  async function handleCreate() {
    setErr('')
    for (const s of validSerials) {
      if (!reasons[s.serialNumber]) {
        setErr(`Select a return reason for ${s.serialNumber}`)
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/wholesale/customer-rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          notes: overallNotes.trim() || null,
          serials: validSerials.map(s => ({
            inventorySerialId: s.inventorySerialId,
            returnReason: reasons[s.serialNumber],
            salePrice: s.salePrice,
            salesOrderId: s.salesOrderId,
            soldAt: s.soldAt,
            notes: serialNotes[s.serialNumber]?.trim() || null,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create RMA')
      onCreated()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[620px] bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            {step !== 'customer' && (
              <button onClick={() => {
                if (step === 'serials') setStep('customer')
                else if (step === 'review') setStep('serials')
              }} className="text-gray-400 hover:text-gray-600">
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 className="text-sm font-semibold text-gray-900">
              New Customer RMA — {step === 'customer' ? 'Select Customer' : step === 'serials' ? 'Paste Serials' : 'Review & Reasons'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 px-5 py-3 border-b bg-gray-50">
          {(['customer', 'serials', 'review'] as WizardStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-gray-300" />}
              <div className={clsx(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                step === s ? 'bg-amazon-blue text-white' :
                  (['customer', 'serials', 'review'].indexOf(step) > i)
                    ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
              )}>
                {i + 1}
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {err && <ErrBanner msg={err} onClose={() => setErr('')} />}

          {/* ─── Step 1: Customer ─── */}
          {step === 'customer' && (
            <>
              <label className="block text-xs font-medium text-gray-700 mb-1">Customer <span className="text-red-500">*</span></label>
              <div className="relative mb-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={custSearch}
                  onChange={e => setCustSearch(e.target.value)}
                  placeholder="Search customers..."
                  className="w-full h-8 rounded-md border border-gray-300 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                />
              </div>
              <select
                value={customerId}
                onChange={e => {
                  setCustomerId(e.target.value)
                  const c = customers.find(c => c.id === e.target.value)
                  setCustomerName(c?.companyName ?? '')
                }}
                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              >
                <option value="">Select customer...</option>
                {filteredCusts.map(c => (
                  <option key={c.id} value={c.id}>{c.companyName}</option>
                ))}
              </select>
            </>
          )}

          {/* ─── Step 2: Paste Serials ─── */}
          {step === 'serials' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Paste serial numbers (one per line)
                </label>
                <textarea
                  rows={8}
                  value={serialText}
                  onChange={e => { setSerialText(e.target.value); setValidated(false) }}
                  placeholder={'SN-001\nSN-002\nSN-003'}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue resize-none"
                />
              </div>

              <button
                onClick={handleValidate}
                disabled={validating || !serialText.trim()}
                className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
              >
                {validating ? 'Validating...' : 'Validate Serials'}
              </button>

              {validated && validationResults.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  <p className="text-xs font-medium text-gray-500">
                    {validSerials.length} valid, {invalidSerials.length} invalid
                  </p>
                  {validationResults.map(r => (
                    <div key={r.serialNumber} className={clsx(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-xs',
                      r.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700',
                    )}>
                      {r.valid
                        ? <CheckCircle2 size={13} className="shrink-0 text-green-500" />
                        : <XCircle size={13} className="shrink-0 text-red-500" />
                      }
                      <span className="font-mono font-medium">{r.serialNumber}</span>
                      {r.valid ? (
                        <span className="text-gray-500 ml-2">
                          {(r as ValidatedSerial).productSku} &middot; {(r as ValidatedSerial).gradeName ?? 'No grade'}
                          {(r as ValidatedSerial).salePrice != null && ` · $${(r as ValidatedSerial).salePrice!.toFixed(2)}`}
                        </span>
                      ) : (
                        <>
                          <span className="flex-1">{(r as InvalidSerial).reason}</span>
                          <button onClick={() => removeInvalid(r.serialNumber)} className="text-red-400 hover:text-red-600">
                            <X size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ─── Step 3: Review & Reasons ─── */}
          {step === 'review' && (
            <>
              <p className="text-xs text-gray-500 mb-2">
                {validSerials.length} serial{validSerials.length !== 1 ? 's' : ''} for <strong>{customerName}</strong>
              </p>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[10px] font-semibold text-gray-400 uppercase">
                      <th className="text-left px-3 py-2">Serial #</th>
                      <th className="text-left px-3 py-2">SKU</th>
                      <th className="text-left px-3 py-2">Grade</th>
                      <th className="text-right px-3 py-2">Sale Price</th>
                      <th className="text-right px-3 py-2">Days</th>
                      <th className="text-left px-3 py-2 w-36">Return Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {validSerials.map(s => (
                      <tr key={s.serialNumber}>
                        <td className="px-3 py-2 font-mono text-gray-700">{s.serialNumber}</td>
                        <td className="px-3 py-2 text-gray-600">{s.productSku}</td>
                        <td className="px-3 py-2 text-gray-500">{s.gradeName ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {s.salePrice != null ? `$${s.salePrice.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {s.daysSinceSold ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={reasons[s.serialNumber] || ''}
                            onChange={e => setReasons(prev => ({ ...prev, [s.serialNumber]: e.target.value }))}
                            className="w-full h-7 rounded border border-gray-300 px-1 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                          >
                            <option value="">Select...</option>
                            {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  rows={2}
                  value={overallNotes}
                  onChange={e => setOverallNotes(e.target.value)}
                  placeholder="Internal notes..."
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue resize-none"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>

          {step === 'customer' && (
            <button
              onClick={() => { if (!customerId) { setErr('Select a customer'); return }; setStep('serials') }}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
            >
              Next
            </button>
          )}

          {step === 'serials' && (
            <button
              onClick={() => setStep('review')}
              disabled={validSerials.length === 0 || invalidSerials.length > 0}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              Next
            </button>
          )}

          {step === 'review' && (
            <button onClick={handleCreate} disabled={saving}
              className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60">
              {saving ? 'Creating...' : 'Create RMA'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── RMA Detail View ──────────────────────────────────────────────────────────

function RMADetail({ rmaId, onBack, onUpdated }: { rmaId: string; onBack: () => void; onUpdated: () => void }) {
  const [rma, setRma] = useState<CustomerRMA | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Receiving
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [scanSerial, setScanSerial] = useState('')
  const [locationId, setLocationId] = useState('')
  const [receiving, setReceiving] = useState(false)

  const [advancing, setAdvancing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadRMA = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/wholesale/customer-rma/${rmaId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setRma(data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [rmaId])

  useEffect(() => { loadRMA() }, [loadRMA])

  useEffect(() => {
    fetch('/api/warehouses')
      .then(r => r.json())
      .then(d => {
        const wh: Warehouse[] = Array.isArray(d) ? d : (d.data ?? [])
        setWarehouses(wh)
      })
  }, [])

  async function handleReceive() {
    if (!scanSerial.trim() || !locationId) {
      setErr('Enter serial number and select a location')
      return
    }
    setErr('')
    setReceiving(true)
    try {
      const res = await fetch(`/api/wholesale/customer-rma/${rmaId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber: scanSerial.trim(), locationId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Receive failed')
      setScanSerial('')
      loadRMA()
      onUpdated()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Receive failed')
    } finally {
      setReceiving(false)
    }
  }

  async function advance() {
    if (!rma) return
    const next = NEXT_STATUS[rma.status]
    if (!next) return
    setAdvancing(true)
    try {
      await fetch(`/api/wholesale/customer-rma/${rma.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      loadRMA()
      onUpdated()
    } finally {
      setAdvancing(false)
    }
  }

  async function reject() {
    if (!rma) return
    setRejecting(true)
    try {
      await fetch(`/api/wholesale/customer-rma/${rma.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED' }),
      })
      loadRMA()
      onUpdated()
    } finally {
      setRejecting(false)
    }
  }

  async function handleDelete() {
    if (!rma) return
    setDeleting(true)
    setErr('')
    try {
      const res = await fetch(`/api/wholesale/customer-rma/${rma.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Delete failed')
      onUpdated()
      onBack()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
      setDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
  if (!rma) return <div className="py-20 text-center text-sm text-gray-400">RMA not found</div>

  const receivedCount = rma.serials.filter(s => s.receivedAt).length
  const totalSerials = rma.serials.length
  const next = NEXT_STATUS[rma.status]
  const canReceive = rma.status === 'PENDING' || rma.status === 'RECEIVED'
  const canDelete = receivedCount === 0

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Back + Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </button>
        <span className="font-mono text-sm font-bold text-gray-800">{rma.rmaNumber}</span>
        <span className="text-sm text-gray-500">{rma.customer.companyName}</span>
        <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_COLOR[rma.status])}>
          {STATUS_LABEL[rma.status]}
        </span>
        <span className="text-xs text-gray-400">{fmt(rma.createdAt)}</span>
        <div className="flex-1" />

        <button
          onClick={() => generateRMAPDF(rma)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Download size={13} /> Download PDF
        </button>

        {next && (
          <button
            onClick={advance}
            disabled={advancing}
            className="h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
          >
            {advancing ? '...' : NEXT_LABEL[rma.status]}
          </button>
        )}
        {rma.status !== 'REJECTED' && rma.status !== 'REFUNDED' && (
          <button
            onClick={reject}
            disabled={rejecting}
            className="h-8 px-3 rounded-md border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 disabled:opacity-60"
          >
            {rejecting ? '...' : 'Reject'}
          </button>
        )}
        {canDelete && !deleteConfirm && (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="h-8 px-3 rounded-md border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50"
          >
            <Trash2 size={13} />
          </button>
        )}
        {deleteConfirm && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600">Delete?</span>
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Yes</button>
            <button onClick={() => setDeleteConfirm(false)}
              className="text-xs text-gray-500 hover:underline">No</button>
          </div>
        )}
      </div>

      {err && <ErrBanner msg={err} onClose={() => setErr('')} />}

      {/* Info bar */}
      {rma.reason && (
        <div className="text-xs text-gray-500 mb-2">
          <span className="text-gray-400">Reason: </span>{rma.reason}
        </div>
      )}
      {rma.notes && (
        <div className="text-xs text-gray-500 mb-4">
          <span className="text-gray-400">Notes: </span>{rma.notes}
        </div>
      )}

      {/* Serials table */}
      {totalSerials > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-semibold text-gray-700">Serials</h3>
            <span className="text-xs text-gray-400">{receivedCount} of {totalSerials} received</span>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-[10px] font-semibold text-gray-400 uppercase">
                  <th className="text-left px-3 py-2">Serial #</th>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Grade</th>
                  <th className="text-right px-3 py-2">Sale Price</th>
                  <th className="text-left px-3 py-2">Sold</th>
                  <th className="text-right px-3 py-2">Days</th>
                  <th className="text-left px-3 py-2">Return Reason</th>
                  <th className="text-center px-3 py-2">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rma.serials.map(s => (
                  <tr key={s.id} className={s.receivedAt ? 'bg-green-50/40' : ''}>
                    <td className="px-3 py-2 font-mono text-gray-700">{s.serialNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{s.product.sku}</td>
                    <td className="px-3 py-2 text-gray-500">{s.grade?.grade ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {s.salePrice ? `$${parseFloat(s.salePrice).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{s.soldAt ? fmt(s.soldAt) : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{daysSince(s.soldAt) ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{s.returnReason}</td>
                    <td className="px-3 py-2 text-center">
                      {s.receivedAt ? (
                        <span className="text-green-600" title={`Received ${fmt(s.receivedAt)}${s.receivedLocation ? ` at ${s.receivedLocation.warehouse.name} / ${s.receivedLocation.name}` : ''}`}>
                          <CheckCircle2 size={14} />
                        </span>
                      ) : (
                        <span className="text-gray-300">&mdash;</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Credit total */}
          {rma.creditAmount && (
            <div className="text-xs text-gray-600 mb-4">
              <span className="text-gray-400">Total Credit: </span>
              <span className="font-medium">${parseFloat(rma.creditAmount).toFixed(2)}</span>
            </div>
          )}
        </>
      )}

      {/* Legacy items table (for old qty-based RMAs) */}
      {rma.items.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-semibold text-gray-400 uppercase">
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Unit Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rma.items.map(item => (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-mono text-gray-700">{item.product.sku}</td>
                  <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]">{item.product.description}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{item.quantity}</td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {item.unitPrice ? `$${parseFloat(item.unitPrice).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Receiving section */}
      {canReceive && totalSerials > 0 && receivedCount < totalSerials && (
        <div className="border border-blue-200 rounded-lg bg-blue-50/50 p-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <PackageCheck size={16} className="text-blue-600" />
            <h3 className="text-xs font-semibold text-blue-800">Receive Serials</h3>
            <span className="text-xs text-blue-500">{receivedCount} of {totalSerials} received</span>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Scan / Enter Serial</label>
              <input
                value={scanSerial}
                onChange={e => setScanSerial(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleReceive() }}
                placeholder="Serial number..."
                className="w-full h-8 rounded-md border border-gray-300 px-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              />
            </div>
            <div className="w-48">
              <label className="block text-[10px] font-medium text-gray-600 mb-0.5">Location</label>
              <select
                value={locationId}
                onChange={e => setLocationId(e.target.value)}
                className="w-full h-8 rounded-md border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              >
                <option value="">Select location...</option>
                {warehouses.map(wh => (
                  <optgroup key={wh.id} label={wh.name}>
                    {wh.locations.map(loc => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button
              onClick={handleReceive}
              disabled={receiving}
              className="h-8 px-4 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              {receiving ? '...' : 'Receive'}
            </button>
          </div>
        </div>
      )}

      {/* All received indicator */}
      {totalSerials > 0 && receivedCount === totalSerials && (
        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700 mt-4">
          <CheckCircle2 size={14} />
          All {totalSerials} serial{totalSerials !== 1 ? 's' : ''} received
        </div>
      )}
    </div>
  )
}

// ─── RMA Row ──────────────────────────────────────────────────────────────────

function RMARow({ rma, onClick }: { rma: CustomerRMA; onClick: () => void }) {
  const serialCount = rma.serials.length
  const receivedCount = rma.serials.filter(s => s.receivedAt).length

  return (
    <div
      className="border border-gray-200 rounded-lg bg-white overflow-hidden hover:border-gray-300 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="font-mono text-xs font-bold text-gray-800 shrink-0 w-28">{rma.rmaNumber}</span>
        <span className="text-sm font-medium text-gray-700 flex-1 truncate">{rma.customer.companyName}</span>

        {serialCount > 0 && (
          <span className="text-xs text-gray-400 shrink-0">
            {serialCount} serial{serialCount !== 1 ? 's' : ''}
            {receivedCount > 0 && ` (${receivedCount} recv)`}
          </span>
        )}

        <span className="text-xs text-gray-400 shrink-0 hidden sm:block">{fmt(rma.createdAt)}</span>

        <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0', STATUS_COLOR[rma.status])}>
          {STATUS_LABEL[rma.status]}
        </span>

        <ChevronDown size={14} className="text-gray-300 shrink-0" />
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CustomerRMAManager() {
  const [rmas, setRmas]         = useState<CustomerRMA[]>([])
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState('')
  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState<string>('')
  const [showCreate, setCreate] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (status)        params.set('status', status)
      const res  = await fetch(`/api/wholesale/customer-rma?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setRmas(data.data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  // Detail view
  if (detailId) {
    return (
      <RMADetail
        rmaId={detailId}
        onBack={() => setDetailId(null)}
        onUpdated={load}
      />
    )
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value) }}
            placeholder="Search RMA #, customer, serial..."
            className="h-9 w-64 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>

        <div className="flex-1" />
        <span className="text-xs text-gray-400">{rmas.length} RMA{rmas.length !== 1 ? 's' : ''}</span>

        <button
          onClick={() => setCreate(true)}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
        >
          <Plus size={14} />
          New RMA
        </button>
      </div>

      {err && <ErrBanner msg={err} onClose={() => setErr('')} />}

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
      ) : rmas.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm font-medium text-gray-400">
            {search || status ? 'No RMAs match your filters' : 'No customer RMAs yet'}
          </p>
          {!search && !status && (
            <button onClick={() => setCreate(true)}
              className="mt-3 text-sm text-amazon-blue hover:underline">
              Create the first RMA
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rmas.map(rma => (
            <RMARow key={rma.id} rma={rma} onClick={() => setDetailId(rma.id)} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateWizard
          onClose={() => setCreate(false)}
          onCreated={() => { setCreate(false); load() }}
        />
      )}
    </div>
  )
}

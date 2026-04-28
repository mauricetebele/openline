'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, ChevronDown, ChevronUp, Trash2, AlertCircle, Truck, Tag, ScanLine, Search, CheckCircle2, Download, Loader2, ExternalLink, Barcode, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { trackingUrl } from '@/lib/tracking-utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type RMAStatus = 'AWAITING_VENDOR_APPROVAL' | 'APPROVED_TO_RETURN' | 'SHIPPED_AWAITING_CREDIT' | 'CREDIT_RECEIVED'

interface VendorRMASerial { id: string; serialNumber: string; scannedOutAt: string | null }
interface VendorRMAItem {
  id: string; productId: string; quantity: number; unitCost: string | null; notes: string | null
  product: { id: string; sku: string; description: string; isSerializable: boolean }
  serials: VendorRMASerial[]
}
interface VendorRMA {
  id: string; rmaNumber: string; status: RMAStatus
  vendorApprovalNumber: string | null; carrier: string | null; trackingNumber: string | null
  carrierStatus: string | null; deliveredAt: string | null; estimatedDelivery: string | null; trackingUpdatedAt: string | null
  notes: string | null; createdAt: string; updatedAt: string
  vendor: { id: string; vendorNumber: number; name: string }
  items: VendorRMAItem[]
}
interface Vendor { id: string; vendorNumber: number; name: string }
interface Product { id: string; sku: string; description: string; isSerializable: boolean }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RMAStatus, string> = {
  AWAITING_VENDOR_APPROVAL: 'Awaiting Vendor Approval',
  APPROVED_TO_RETURN:       'Approved to Return',
  SHIPPED_AWAITING_CREDIT:  'Shipped & Awaiting Credit',
  CREDIT_RECEIVED:          'Credit Received',
}
const STATUS_COLOR: Record<RMAStatus, string> = {
  AWAITING_VENDOR_APPROVAL: 'bg-yellow-100 text-yellow-700',
  APPROVED_TO_RETURN:       'bg-blue-100 text-blue-700',
  SHIPPED_AWAITING_CREDIT:  'bg-orange-100 text-orange-700',
  CREDIT_RECEIVED:          'bg-green-100 text-green-700',
}
const NEXT_STATUS: Record<RMAStatus, RMAStatus | null> = {
  AWAITING_VENDOR_APPROVAL: 'APPROVED_TO_RETURN',
  APPROVED_TO_RETURN:       'SHIPPED_AWAITING_CREDIT',
  SHIPPED_AWAITING_CREDIT:  'CREDIT_RECEIVED',
  CREDIT_RECEIVED:          null,
}
const NEXT_LABEL: Record<RMAStatus, string> = {
  AWAITING_VENDOR_APPROVAL: 'Mark as Approved',
  APPROVED_TO_RETURN:       'Mark as Shipped',
  SHIPPED_AWAITING_CREDIT:  'Mark Credit Received',
  CREDIT_RECEIVED:          '',
}
const ALL_STATUSES = Object.keys(STATUS_LABEL) as RMAStatus[]
const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL', 'Other']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <span className="flex-1">{msg}</span>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-600">✕</button>
    </div>
  )
}

function parseScanInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i)
}

// ─── Approval Modal ───────────────────────────────────────────────────────────

function ApprovalModal({
  current, onConfirm, onCancel, saving,
}: { current?: string | null; onConfirm: (val: string) => void; onCancel: () => void; saving: boolean }) {
  const [val, setVal] = useState(current ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Vendor RMA Approval #</h3>
        <p className="text-xs text-gray-500 mb-4">Enter the approval number provided by the vendor.</p>
        <input
          ref={ref}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue mb-4"
          placeholder="e.g. RMA-2024-001"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && val.trim()) onConfirm(val.trim()) }}
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => onConfirm(val.trim())}
            disabled={!val.trim() || saving}
            className="px-3 py-1.5 text-sm bg-amazon-blue text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shipping Modal ───────────────────────────────────────────────────────────

function ShippingModal({
  onConfirm, onCancel, saving,
}: { onConfirm: (carrier: string, tracking: string) => void; onCancel: () => void; saving: boolean }) {
  const [carrier, setCarrier] = useState('UPS')
  const [customCarrier, setCustomCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const effectiveCarrier = carrier === 'Other' ? customCarrier : carrier
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Shipping Information</h3>
        <p className="text-xs text-gray-500 mb-4">Enter the carrier and tracking number for this return shipment.</p>
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Carrier</label>
            <div className="flex flex-wrap gap-1.5">
              {CARRIERS.map(c => (
                <button
                  key={c}
                  onClick={() => setCarrier(c)}
                  className={clsx(
                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                    carrier === c ? 'bg-amazon-blue text-white border-amazon-blue' : 'text-gray-600 border-gray-300 hover:bg-gray-50',
                  )}
                >{c}</button>
              ))}
            </div>
            {carrier === 'Other' && (
              <input
                autoFocus
                className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                placeholder="Carrier name…"
                value={customCarrier}
                onChange={e => setCustomCarrier(e.target.value)}
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tracking Number</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              placeholder="e.g. 1Z999AA10123456784"
              value={tracking}
              onChange={e => setTracking(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => onConfirm(effectiveCarrier, tracking.trim())}
            disabled={!effectiveCarrier || !tracking.trim() || saving}
            className="px-3 py-1.5 text-sm bg-amazon-blue text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Scan Out Modal ──────────────────────────────────────────────────────────

type ScanOutResult = { serialNumber: string; status: 'scanned' | 'already_scanned' | 'not_on_rma' }

function ScanOutModal({
  rma, onUpdate, onClose,
}: { rma: VendorRMA; onUpdate: (rma: VendorRMA) => void; onClose: () => void }) {
  const [scannedSet, setScannedSet] = useState<Set<string>>(() => {
    const set = new Set<string>()
    for (const item of rma.items) {
      for (const s of item.serials) {
        if (s.scannedOutAt) set.add(s.serialNumber.toLowerCase())
      }
    }
    return set
  })

  const [singleInput, setSingleInput] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [processing, setProcessing] = useState(false)
  const [flash, setFlash] = useState<{ type: 'success' | 'warning' | 'error'; msg: string } | null>(null)
  const [bulkResults, setBulkResults] = useState<ScanOutResult[]>([])
  const singleRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { singleRef.current?.focus() }, [])

  // Poll for real-time updates from other users
  useEffect(() => {
    const interval = setInterval(async () => {
      if (processing) return
      try {
        const res = await fetch(`/api/vendor-rma/${rma.id}`)
        if (!res.ok) return
        const updated: VendorRMA = await res.json()
        // Sync scannedSet from server without overwriting local scanOrder
        const serverScanned = new Set<string>()
        for (const item of updated.items) {
          for (const s of item.serials) {
            if (s.scannedOutAt) serverScanned.add(s.serialNumber.toLowerCase())
          }
        }
        setScannedSet(serverScanned)
        onUpdate(updated)
      } catch { /* ignore poll errors */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [rma.id, processing])

  // Track scan order so most recently scanned appears at top
  const [scanOrder, setScanOrder] = useState<string[]>([])

  function playErrorBeep() {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 200
      gain.gain.value = 0.3
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.25)
      osc.onended = () => ctx.close()
    } catch { /* audio not available */ }
  }

  function playSuccessChime() {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.value = 0.2
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.frequency.setValueAtTime(1174, ctx.currentTime + 0.1)
      osc.stop(ctx.currentTime + 0.2)
      osc.onended = () => ctx.close()
    } catch { /* audio not available */ }
  }

  // Build grid rows from all items' serials
  const allSerials = rma.items.flatMap(item =>
    item.serials.map(s => ({
      serialNumber: s.serialNumber,
      sku: item.product.sku,
      description: item.product.description,
      scanned: scannedSet.has(s.serialNumber.toLowerCase()),
    })),
  )
  const sorted = [...allSerials].sort((a, b) => {
    if (a.scanned !== b.scanned) return a.scanned ? -1 : 1
    if (a.scanned && b.scanned) {
      // Most recently scanned first
      const aIdx = scanOrder.indexOf(a.serialNumber.toLowerCase())
      const bIdx = scanOrder.indexOf(b.serialNumber.toLowerCase())
      if (aIdx !== -1 && bIdx !== -1) return bIdx - aIdx
      if (aIdx !== -1) return -1
      if (bIdx !== -1) return 1
    }
    return a.serialNumber.localeCompare(b.serialNumber)
  })

  const totalSerials = allSerials.length
  const scannedCount = allSerials.filter(s => s.scanned).length

  function showFlash(type: 'success' | 'warning' | 'error', msg: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash({ type, msg })
    flashTimer.current = setTimeout(() => setFlash(null), 2500)
  }

  async function callScanOut(serialNumbers: string[]): Promise<{ rma: VendorRMA; results: ScanOutResult[] } | null> {
    setProcessing(true)
    try {
      const res = await fetch(`/api/vendor-rma/${rma.id}/scan-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumbers }),
      })
      const data = await res.json()
      if (!res.ok) { showFlash('error', data.error ?? 'Failed'); return null }
      return data
    } catch {
      showFlash('error', 'Network error')
      return null
    } finally {
      setProcessing(false)
      setTimeout(() => singleRef.current?.focus(), 0)
    }
  }

  async function handleSingleScan() {
    const sn = singleInput.trim()
    if (!sn) return
    const data = await callScanOut([sn])
    if (!data) return

    const result = data.results[0]
    if (result.status === 'scanned') {
      showFlash('success', `${sn} scanned out`)
      setScannedSet(prev => new Set(prev).add(sn.toLowerCase()))
      setScanOrder(prev => [...prev, sn.toLowerCase()])
      playSuccessChime()
      onUpdate(data.rma)
      setTimeout(() => gridRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 0)
    } else if (result.status === 'already_scanned') {
      showFlash('warning', `${sn} already scanned`)
    } else {
      showFlash('error', `${sn} not on this RMA`)
      playErrorBeep()
    }
    setSingleInput('')
    setTimeout(() => singleRef.current?.focus(), 0)
  }

  async function handleUnscan(serialNumber: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/vendor-rma/${rma.id}/scan-out`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber }),
      })
      const data = await res.json()
      if (!res.ok) { showFlash('error', data.error ?? 'Failed'); return }
      setScannedSet(prev => {
        const next = new Set(prev)
        next.delete(serialNumber.toLowerCase())
        return next
      })
      setScanOrder(prev => prev.filter(sn => sn !== serialNumber.toLowerCase()))
      onUpdate(data.rma)
    } catch {
      showFlash('error', 'Network error')
    } finally {
      setProcessing(false)
      setTimeout(() => singleRef.current?.focus(), 0)
    }
  }

  async function handleBulkScan() {
    const serials = parseScanInput(bulkInput)
    if (serials.length === 0) return
    const data = await callScanOut(serials)
    if (!data) return

    setBulkResults(data.results)
    const newScanned = data.results.filter(r => r.status === 'scanned').map(r => r.serialNumber.toLowerCase())
    const hasErrors = data.results.some(r => r.status === 'not_on_rma')
    if (newScanned.length > 0) {
      setScannedSet(prev => {
        const next = new Set(prev)
        for (const sn of newScanned) next.add(sn)
        return next
      })
      setScanOrder(prev => [...prev, ...newScanned])
      if (!hasErrors) playSuccessChime()
      onUpdate(data.rma)
    }
    if (hasErrors) playErrorBeep()
    if (data.results.every(r => r.status === 'scanned')) setBulkInput('')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-900">Scan Out — {rma.rmaNumber}</h3>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {scannedCount} / {totalSerials} scanned
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Input section */}
        <div className="px-6 py-4 border-b border-gray-200">
          {flash && (
            <div className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-3 transition-opacity',
              flash.type === 'success' && 'bg-green-50 border border-green-200 text-green-700',
              flash.type === 'warning' && 'bg-yellow-50 border border-yellow-200 text-yellow-700',
              flash.type === 'error' && 'bg-red-50 border border-red-200 text-red-700',
            )}>
              {flash.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
              {flash.msg}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {/* Single scan */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scanner Input</label>
              <input
                ref={singleRef}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                placeholder="Scan or type serial #"
                value={singleInput}
                onChange={e => setSingleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSingleScan() }}
                disabled={processing}
              />
              <p className="text-[10px] text-gray-400 mt-1">Press Enter to scan</p>
            </div>
            {/* Bulk paste */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Bulk Paste</label>
              <textarea
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
                placeholder="Paste serials (one per line)…"
                value={bulkInput}
                onChange={e => { setBulkInput(e.target.value); setBulkResults([]) }}
                disabled={processing}
              />
              <button
                onClick={handleBulkScan}
                disabled={processing || parseScanInput(bulkInput).length === 0}
                className="mt-1.5 text-xs bg-amazon-blue text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {processing ? 'Processing…' : `Process All (${parseScanInput(bulkInput).length})`}
              </button>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div ref={gridRef} className="flex-1 overflow-y-auto px-6 py-3">
          <table className="w-full text-left">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['Serial #', 'SKU', 'Description', 'Status', ''].map(h => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(row => (
                <tr key={row.serialNumber} className={row.scanned ? 'bg-green-50' : 'bg-red-50'}>
                  <td className="px-3 py-2 text-xs font-mono font-medium text-gray-900">{row.serialNumber}</td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-500">{row.sku}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px] truncate">{row.description}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.scanned
                      ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 size={13} /> Scanned</span>
                      : <span className="text-gray-400">—</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.scanned && (
                      <button
                        onClick={() => handleUnscan(row.serialNumber)}
                        disabled={processing}
                        className="text-gray-300 hover:text-red-500 disabled:opacity-50"
                        title="Unscan"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-400">No serials on this RMA</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200">
          {bulkResults.length > 0 && (
            <div className="space-y-1 max-h-32 overflow-y-auto mb-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                {bulkResults.filter(r => r.status === 'scanned').length} scanned
                {' · '}{bulkResults.filter(r => r.status === 'already_scanned').length} already scanned
                {' · '}{bulkResults.filter(r => r.status === 'not_on_rma').length} not on RMA
              </p>
              {bulkResults.map(r => (
                <div
                  key={r.serialNumber}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs',
                    r.status === 'scanned' && 'bg-green-50 border border-green-200',
                    r.status === 'already_scanned' && 'bg-yellow-50 border border-yellow-200',
                    r.status === 'not_on_rma' && 'bg-red-50 border border-red-200',
                  )}
                >
                  {r.status === 'scanned' && <CheckCircle2 size={13} className="text-green-600" />}
                  {r.status === 'already_scanned' && <AlertCircle size={13} className="text-yellow-500" />}
                  {r.status === 'not_on_rma' && <AlertCircle size={13} className="text-red-500" />}
                  <span className="font-mono font-semibold">{r.serialNumber}</span>
                  <span className={clsx(
                    r.status === 'scanned' && 'text-green-700',
                    r.status === 'already_scanned' && 'text-yellow-700',
                    r.status === 'not_on_rma' && 'text-red-600',
                  )}>
                    {r.status === 'scanned' && 'Scanned out'}
                    {r.status === 'already_scanned' && 'Already scanned'}
                    {r.status === 'not_on_rma' && 'Not on this RMA'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Done</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Item Row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, onRemove, onAddSerial, onRemoveSerial, readonly }: {
  item: VendorRMAItem
  onRemove: () => void
  onAddSerial: (sn: string) => Promise<void>
  onRemoveSerial: (serialId: string) => Promise<void>
  readonly: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [serialInput, setSerialInput] = useState('')
  const [addingSerial, setAddingSerial] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleAddSerial() {
    if (!serialInput.trim()) return
    setAddingSerial(true)
    setErr(null)
    try {
      await onAddSerial(serialInput.trim())
      setSerialInput('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally { setAddingSerial(false) }
  }

  return (
    <>
      <tr className="hover:bg-gray-50 group">
        <td className="px-3 py-2.5 text-xs font-mono text-gray-700">{item.product.sku}</td>
        <td className="px-3 py-2.5 text-sm text-gray-900">{item.product.description}</td>
        <td className="px-3 py-2.5 text-xs text-center">
          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', item.product.isSerializable ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600')}>
            {item.product.isSerializable ? 'Serial' : 'Qty'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm text-center text-gray-700">{item.quantity}</td>
        <td className="px-3 py-2.5 text-xs text-gray-700">
          {item.unitCost ? `$${(parseFloat(item.unitCost) * item.quantity).toFixed(2)}` : '—'}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1 justify-end">
            {item.product.isSerializable && (
              <button onClick={() => setExpanded(v => !v)} className="text-xs text-amazon-blue hover:underline">
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            {!readonly && (
              <button onClick={onRemove} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && item.product.isSerializable && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-5 pb-3 pt-1">
            {err && <p className="text-xs text-red-500 mb-1">{err}</p>}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {item.serials.map(s => (
                <span key={s.id} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-0.5 text-xs font-mono text-gray-700">
                  {s.serialNumber}
                  {!readonly && (
                    <button onClick={() => onRemoveSerial(s.id)} className="text-gray-300 hover:text-red-500 ml-0.5">✕</button>
                  )}
                </span>
              ))}
              {item.serials.length === 0 && <span className="text-xs text-gray-400">No serials added</span>}
            </div>
            {!readonly && (
              <div className="flex gap-2">
                <input
                  className="border border-gray-300 rounded px-2 py-1 text-xs font-mono w-44 focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                  placeholder="Scan or type serial #"
                  value={serialInput}
                  onChange={e => setSerialInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddSerial() }}
                />
                <button
                  onClick={handleAddSerial}
                  disabled={!serialInput.trim() || addingSerial}
                  className="text-xs bg-amazon-blue text-white rounded px-2 py-1 disabled:opacity-50 hover:opacity-90"
                >
                  {addingSerial ? '…' : '+ Add'}
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ rma: initial, onClose, onUpdated, onDeleted }: {
  rma: VendorRMA
  onClose: () => void
  onUpdated: (r: VendorRMA) => void
  onDeleted: (id: string) => void
}) {
  const [rma, setRma] = useState<VendorRMA>(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Editable fields
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [approvalEdit, setApprovalEdit] = useState(initial.vendorApprovalNumber ?? '')
  const [editingApproval, setEditingApproval] = useState(false)

  // Status modals
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [showShippingModal, setShowShippingModal] = useState(false)
  const [showScanOutModal, setShowScanOutModal] = useState(false)

  // Items view toggle
  const [itemsView, setItemsView] = useState<'lines' | 'serials'>('lines')

  // Add item
  const [addMode, setAddMode] = useState<'product' | 'serial'>('product')

  // Product-search mode
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [addQty, setAddQty] = useState(1)
  const [pendingSerials, setPendingSerials] = useState<string[]>([])
  const [serialInput, setSerialInput] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Product-search mode — serial validation
  const [serialValidating, setSerialValidating] = useState(false)
  const [serialValidationError, setSerialValidationError] = useState<string | null>(null)

  // Serial-scan mode
  const [scanInput, setScanInput] = useState('')
  const [scanProcessing, setScanProcessing] = useState(false)
  const [scanResults, setScanResults] = useState<{ sn: string; status: 'added' | 'error'; message: string }[]>([])
  const scanTextareaRef = useRef<HTMLTextAreaElement>(null)

  const readonly = rma.status === 'CREDIT_RECEIVED'

  // Auto-fetch tracking status when viewing a shipped RMA
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [trackingError, setTrackingError] = useState<string | null>(null)

  useEffect(() => {
    if (rma.status !== 'SHIPPED_AWAITING_CREDIT' && rma.status !== 'CREDIT_RECEIVED') return
    if (!rma.trackingNumber) return
    // Skip if already fetched recently (< 5 min)
    if (rma.trackingUpdatedAt) {
      const age = Date.now() - new Date(rma.trackingUpdatedAt).getTime()
      if (age < 5 * 60 * 1000) return
    }
    let cancelled = false
    setTrackingLoading(true)
    setTrackingError(null)
    fetch(`/api/vendor-rma/${rma.id}/tracking`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.error) {
          setTrackingError(data.error)
        } else {
          setRma(prev => ({
            ...prev,
            carrierStatus: data.carrierStatus,
            deliveredAt: data.deliveredAt,
            estimatedDelivery: data.estimatedDelivery,
            trackingUpdatedAt: data.trackingUpdatedAt,
          }))
        }
      })
      .catch(() => { if (!cancelled) setTrackingError('Failed to fetch tracking') })
      .finally(() => { if (!cancelled) setTrackingLoading(false) })
    return () => { cancelled = true }
  }, [rma.id, rma.status, rma.trackingNumber])

  // Poll for real-time scan-out updates from other users
  useEffect(() => {
    if (showScanOutModal) return // modal has its own polling
    if (rma.status !== 'APPROVED_TO_RETURN' && rma.status !== 'SHIPPED_AWAITING_CREDIT') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/vendor-rma/${rma.id}`)
        if (!res.ok) return
        const updated: VendorRMA = await res.json()
        setRma(updated)
        onUpdated(updated)
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [rma.id, rma.status, showScanOutModal])

  // Product search
  useEffect(() => {
    if (!productSearch.trim()) { setProductResults([]); setShowDropdown(false); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/products?search=${encodeURIComponent(productSearch)}`)
      const data = await res.json()
      setProductResults(data.data ?? [])
      setShowDropdown(true)
    }, 250)
  }, [productSearch])

  function selectProduct(p: Product) {
    setSelectedProduct(p)
    setProductSearch(p.description)
    setShowDropdown(false)
    setAddQty(1)
    setPendingSerials([])
    setSerialInput('')
  }

  async function addPendingSerial() {
    const sn = serialInput.trim()
    if (!sn || pendingSerials.some(s => s.toLowerCase() === sn.toLowerCase())) return
    setSerialValidating(true)
    setSerialValidationError(null)
    try {
      const res = await fetch(`/api/vendor-rma/serial-lookup?sn=${encodeURIComponent(sn)}`)
      const data = await res.json()
      if (!data.found) {
        setSerialValidationError(`Serial ${sn} not found in inventory`)
        return
      }
      if (data.inventoryStatus !== 'IN_STOCK') {
        setSerialValidationError(`Serial ${sn} is ${data.inventoryStatus.replace('_', ' ')} — only In Stock units can be added`)
        return
      }
      if (selectedProduct && data.product?.id !== selectedProduct.id) {
        setSerialValidationError(`Serial ${sn} belongs to a different product (${data.product?.sku})`)
        return
      }
      setPendingSerials(prev => [...prev, sn])
      setSerialInput('')
    } finally {
      setSerialValidating(false)
    }
  }

  function removePendingSerial(sn: string) {
    setPendingSerials(prev => prev.filter(s => s !== sn))
  }

  // ── Serial-scan (bulk) helpers ───────────────────────────────────────────────

  async function processBulkScan() {
    const serials = parseScanInput(scanInput)
    if (serials.length === 0) return
    setScanProcessing(true)
    setScanResults([])

    const results: { sn: string; status: 'added' | 'error'; message: string }[] = []
    // Use a local accumulator so each iteration sees the latest items state
    let liveItems = rma.items

    for (const sn of serials) {
      // Already on this RMA?
      const alreadyAdded = liveItems.some(i => i.serials.some(s => s.serialNumber.toLowerCase() === sn.toLowerCase()))
      if (alreadyAdded) {
        results.push({ sn, status: 'error', message: 'Already on this return' })
        continue
      }

      // Lookup in inventory
      let lookupData: { found: boolean; product?: Product; inventoryStatus?: string }
      try {
        const res = await fetch(`/api/vendor-rma/serial-lookup?sn=${encodeURIComponent(sn)}`)
        lookupData = await res.json()
      } catch {
        results.push({ sn, status: 'error', message: 'Network error' })
        continue
      }

      if (!lookupData.found) {
        results.push({ sn, status: 'error', message: 'Not found in inventory' })
        continue
      }
      if (lookupData.inventoryStatus !== 'IN_STOCK') {
        results.push({ sn, status: 'error', message: `Not in stock (${lookupData.inventoryStatus!.replace('_', ' ')})` })
        continue
      }

      const product = lookupData.product!
      const existingItem = liveItems.find(i => i.productId === product.id)
      try {
        if (existingItem) {
          const res = await fetch(`/api/vendor-rma/${rma.id}/items/${existingItem.id}/serials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serialNumber: sn }),
          })
          const data = await res.json()
          if (!res.ok) { results.push({ sn, status: 'error', message: data.error ?? 'Failed' }); continue }
          liveItems = liveItems.map(i =>
            i.id === existingItem.id ? { ...i, serials: [...i.serials, data], quantity: i.quantity + 1 } : i,
          )
        } else {
          const res = await fetch(`/api/vendor-rma/${rma.id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: product.id, serials: [sn] }),
          })
          const data = await res.json()
          if (!res.ok) { results.push({ sn, status: 'error', message: data.error ?? 'Failed' }); continue }
          liveItems = [...liveItems, data]
        }
        results.push({ sn, status: 'added', message: `${product.sku} · ${product.description}` })
      } catch {
        results.push({ sn, status: 'error', message: 'Network error' })
      }
    }

    setRma(prev => ({ ...prev, items: liveItems }))
    setScanResults(results)
    setScanProcessing(false)
    // Clear the textarea if everything succeeded
    if (results.every(r => r.status === 'added')) setScanInput('')
  }

  // ── Product-search add ───────────────────────────────────────────────────────

  async function handleAddItem() {
    if (!selectedProduct) return
    setAddingItem(true)
    setErr(null)
    try {
      const res = await fetch(`/api/vendor-rma/${rma.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          quantity: selectedProduct.isSerializable ? pendingSerials.length : addQty,
          serials: selectedProduct.isSerializable ? pendingSerials : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Failed to add item'); return }
      setRma(prev => ({ ...prev, items: [...prev.items, data] }))
      setSelectedProduct(null)
      setProductSearch('')
      setPendingSerials([])
      setAddQty(1)
    } finally { setAddingItem(false) }
  }

  async function handleRemoveItem(itemId: string) {
    const res = await fetch(`/api/vendor-rma/${rma.id}/items/${itemId}`, { method: 'DELETE' })
    if (res.ok) setRma(prev => ({ ...prev, items: prev.items.filter(i => i.id !== itemId) }))
  }

  async function handleAddSerial(itemId: string, sn: string) {
    const res = await fetch(`/api/vendor-rma/${rma.id}/items/${itemId}/serials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: sn }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed')
    setRma(prev => ({
      ...prev,
      items: prev.items.map(i =>
        i.id === itemId ? { ...i, serials: [...i.serials, data], quantity: i.quantity + 1 } : i,
      ),
    }))
  }

  async function handleRemoveSerial(itemId: string, serialId: string) {
    const res = await fetch(`/api/vendor-rma/${rma.id}/items/${itemId}/serials/${serialId}`, { method: 'DELETE' })
    if (res.ok) {
      setRma(prev => ({
        ...prev,
        items: prev.items.map(i =>
          i.id === itemId
            ? { ...i, serials: i.serials.filter(s => s.id !== serialId), quantity: i.quantity - 1 }
            : i,
        ),
      }))
    }
  }

  async function handleExport() {
    try {
      const res = await fetch(`/api/vendor-rma/${rma.id}/export`)
      if (!res.ok) { setErr('Failed to export'); return }
      const data = await res.json()
      const rows = data.rows as { rmaNumber: string; vendor: string; sku: string; description: string; serialNumber: string; quantity: number; cost: number | null; dateReceived: string | null; poNumber: number | null; note: string }[]
      const headers = ['VRMA #', 'Vendor', 'SKU', 'Description', 'Serial #', 'Qty', 'Cost', 'Date Received', 'PO #', 'Note']
      const csvRows = [headers.join(',')]
      for (const r of rows) {
        csvRows.push([
          r.rmaNumber,
          `"${r.vendor.replace(/"/g, '""')}"`,
          r.sku,
          `"${(r.description ?? '').replace(/"/g, '""')}"`,
          r.serialNumber,
          r.quantity,
          r.cost != null ? r.cost.toFixed(2) : '',
          r.dateReceived ? `"${new Date(r.dateReceived).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}"` : '',
          r.poNumber ?? '',
          `"${(r.note ?? '').replace(/"/g, '""')}"`,
        ].join(','))
      }
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${rma.rmaNumber}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch { setErr('Export failed') }
  }

  async function saveNotes() {
    setSaving(true)
    const res = await fetch(`/api/vendor-rma/${rma.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    })
    if (res.ok) { const d = await res.json(); setRma(d); onUpdated(d) }
    setSaving(false)
  }

  async function saveApprovalNumber() {
    setSaving(true)
    const res = await fetch(`/api/vendor-rma/${rma.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorApprovalNumber: approvalEdit }),
    })
    if (res.ok) { const d = await res.json(); setRma(d); onUpdated(d); setEditingApproval(false) }
    setSaving(false)
  }

  async function handleStatusChange(newStatus: RMAStatus, extra?: Record<string, string>) {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/vendor-rma/${rma.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Failed'); return }
      setRma(data)
      onUpdated(data)
      setApprovalEdit(data.vendorApprovalNumber ?? '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed — please try again')
    } finally {
      setSaving(false)
      setShowApprovalModal(false)
      setShowShippingModal(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${rma.rmaNumber}? This cannot be undone.`)) return
    const res = await fetch(`/api/vendor-rma/${rma.id}`, { method: 'DELETE' })
    if (res.ok) { onDeleted(rma.id); onClose() }
    else { const d = await res.json(); setErr(d.error ?? 'Cannot delete') }
  }

  const next = NEXT_STATUS[rma.status]

  return (
    <>
      {showApprovalModal && createPortal(
        <ApprovalModal
          current={rma.vendorApprovalNumber}
          onConfirm={val => handleStatusChange('APPROVED_TO_RETURN', { vendorApprovalNumber: val })}
          onCancel={() => setShowApprovalModal(false)}
          saving={saving}
        />,
        document.body,
      )}
      {showShippingModal && createPortal(
        <ShippingModal
          onConfirm={(carrier, trackingNumber) => handleStatusChange('SHIPPED_AWAITING_CREDIT', { carrier, trackingNumber })}
          onCancel={() => setShowShippingModal(false)}
          saving={saving}
        />,
        document.body,
      )}
      {showScanOutModal && createPortal(
        <ScanOutModal
          rma={rma}
          onUpdate={updated => { setRma(updated); onUpdated(updated) }}
          onClose={() => setShowScanOutModal(false)}
        />,
        document.body,
      )}

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-base font-bold text-amazon-orange">{rma.rmaNumber}</span>
          <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLOR[rma.status])}>
            {STATUS_LABEL[rma.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} title="Download CSV" className="text-gray-400 hover:text-amazon-blue p-1"><Download size={17} /></button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
      </div>

      {err && <div className="mb-4"><ErrorBanner msg={err} onDismiss={() => setErr(null)} /></div>}

      {/* Vendor */}
      <div className="mb-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Vendor</p>
        <p className="text-sm text-gray-900 font-medium">V-{rma.vendor.vendorNumber} — {rma.vendor.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">Created {fmt(rma.createdAt)}</p>
      </div>

      {/* Status Actions */}
      {!readonly && next && (
        <div className="mb-5 p-4 bg-gray-50 rounded-xl border border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Status</p>
          {(() => {
            const allSerialsCount = rma.items.reduce((s, i) => s + i.serials.length, 0)
            const allScanned = allSerialsCount > 0 && rma.items.every(i => i.serials.every(s => s.scannedOutAt))
            const needsScanOut = next === 'SHIPPED_AWAITING_CREDIT' && allSerialsCount > 0 && !allScanned
            return (
              <>
                <button
                  disabled={saving || needsScanOut}
                  onClick={() => {
                    if (next === 'APPROVED_TO_RETURN') setShowApprovalModal(true)
                    else if (next === 'SHIPPED_AWAITING_CREDIT') setShowShippingModal(true)
                    else handleStatusChange(next)
                  }}
                  className="inline-flex items-center gap-2 bg-amazon-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {NEXT_LABEL[rma.status]}
                </button>
                {needsScanOut && (
                  <span className="ml-2 text-xs text-orange-600">All serials must be scanned out first</span>
                )}
              </>
            )
          })()}
          {rma.status === 'AWAITING_VENDOR_APPROVAL' && (
            <button onClick={handleDelete} className="ml-3 text-xs text-red-500 hover:text-red-700 underline">Delete Return</button>
          )}
          {(rma.status === 'APPROVED_TO_RETURN' || rma.status === 'SHIPPED_AWAITING_CREDIT') && (() => {
            const totalSerials = rma.items.reduce((sum, i) => sum + i.serials.length, 0)
            const scannedCount = rma.items.reduce((sum, i) => sum + i.serials.filter(s => s.scannedOutAt).length, 0)
            const fullyScanned = totalSerials > 0 && scannedCount === totalSerials
            return totalSerials > 0 ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => setShowScanOutModal(true)}
                  className="inline-flex items-center gap-1.5 bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-orange-600"
                >
                  <ScanLine size={14} />
                  Scan Out
                  <span className="text-xs opacity-80">({scannedCount}/{totalSerials})</span>
                </button>
                {fullyScanned && (
                  <span className="inline-flex items-center gap-1.5 text-green-600 font-semibold text-sm">
                    <CheckCircle2 size={18} />
                    Fully Scanned — Ready to Ship!
                  </span>
                )}
              </div>
            ) : null
          })()}
        </div>
      )}

      {/* Vendor Approval # */}
      {(rma.status === 'APPROVED_TO_RETURN' || rma.status === 'SHIPPED_AWAITING_CREDIT' || rma.status === 'CREDIT_RECEIVED') && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Vendor Approval #</p>
          {editingApproval ? (
            <div className="flex gap-2 items-center">
              <input
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                value={approvalEdit}
                onChange={e => setApprovalEdit(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveApprovalNumber(); if (e.key === 'Escape') setEditingApproval(false) }}
              />
              <button onClick={saveApprovalNumber} disabled={saving} className="text-xs bg-amazon-blue text-white px-2 py-1.5 rounded-lg disabled:opacity-50">Save</button>
              <button onClick={() => setEditingApproval(false)} className="text-xs text-gray-500 px-2 py-1.5">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg font-mono font-bold text-gray-900">{rma.vendorApprovalNumber || '—'}</span>
              <button onClick={() => { setApprovalEdit(rma.vendorApprovalNumber ?? ''); setEditingApproval(true) }} className="text-xs text-amazon-blue hover:underline">Edit</button>
            </div>
          )}
        </div>
      )}

      {/* Shipping Info */}
      {(rma.status === 'SHIPPED_AWAITING_CREDIT' || rma.status === 'CREDIT_RECEIVED') && (
        <div className="mb-5">
          <div className="grid grid-cols-2 gap-4 mb-2">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1"><Truck size={11} />Carrier</p>
              <p className="text-sm text-gray-900">{rma.carrier || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1"><Tag size={11} />Tracking #</p>
              {rma.trackingNumber ? (
                <a href={trackingUrl(rma.trackingNumber)} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-mono text-blue-600 hover:underline inline-flex items-center gap-1">
                  {rma.trackingNumber} <ExternalLink size={10} />
                </a>
              ) : (
                <p className="text-sm font-mono text-gray-900">—</p>
              )}
            </div>
          </div>

          {/* Live tracking status */}
          {rma.trackingNumber && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
              {trackingLoading ? (
                <span className="text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Fetching tracking status...</span>
              ) : trackingError ? (
                <span className="text-red-500 text-xs">{trackingError}</span>
              ) : rma.carrierStatus ? (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-900">{rma.carrierStatus}</span>
                    {rma.deliveredAt && (
                      <span className="text-xs text-gray-500 ml-2">Delivered {fmt(rma.deliveredAt)}</span>
                    )}
                    {!rma.deliveredAt && rma.estimatedDelivery && (
                      <span className="text-xs text-gray-500 ml-2">ETA {fmt(rma.estimatedDelivery)}</span>
                    )}
                  </div>
                  {rma.trackingUpdatedAt && (
                    <span className="text-[10px] text-gray-400">
                      Updated {new Date(rma.trackingUpdatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Items */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Items ({rma.items.reduce((s, i) => s + i.quantity, 0)} units)
          </p>
          {rma.items.length > 0 && (
            <div className="flex gap-1 p-0.5 bg-gray-200 rounded-lg">
              <button
                onClick={() => setItemsView('lines')}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors',
                  itemsView === 'lines' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >Line Items</button>
              <button
                onClick={() => setItemsView('serials')}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors',
                  itemsView === 'serials' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >Serials</button>
            </div>
          )}
        </div>

        {rma.items.length > 0 && itemsView === 'lines' && (
          <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['SKU', 'Product', 'Type', 'Qty', 'Cost', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rma.items.map(item => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    readonly={readonly}
                    onRemove={() => handleRemoveItem(item.id)}
                    onAddSerial={sn => handleAddSerial(item.id, sn)}
                    onRemoveSerial={sid => handleRemoveSerial(item.id, sid)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rma.items.length > 0 && itemsView === 'serials' && (() => {
          const flatSerials = rma.items.flatMap(item =>
            item.serials.map(s => ({
              serialNumber: s.serialNumber,
              sku: item.product.sku,
              description: item.product.description,
              unitCost: item.unitCost,
            })),
          ).sort((a, b) => a.sku.localeCompare(b.sku) || a.serialNumber.localeCompare(b.serialNumber))
          const totalCost = flatSerials.reduce((sum, s) => sum + (s.unitCost ? parseFloat(s.unitCost) : 0), 0)
          return (
            <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Serial #', 'SKU', 'Description', 'Cost'].map(h => (
                      <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flatSerials.map(s => (
                    <tr key={s.serialNumber} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs font-mono font-medium text-gray-900">{s.serialNumber}</td>
                      <td className="px-3 py-2 text-xs font-mono text-gray-500">{s.sku}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{s.description}</td>
                      <td className="px-3 py-2 text-xs text-gray-700">{s.unitCost ? `$${parseFloat(s.unitCost).toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                  {flatSerials.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-400">No serials on this RMA</td></tr>
                  )}
                </tbody>
                {flatSerials.length > 0 && (
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-xs font-semibold text-gray-500 text-right">Total</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-900">{totalCost > 0 ? `$${totalCost.toFixed(2)}` : '—'}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )
        })()}

        {/* Add Item */}
        {!readonly && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            {/* Mode toggle */}
            <div className="flex gap-1 mb-4 p-1 bg-gray-200 rounded-lg">
              <button
                onClick={() => { setAddMode('product'); setScanResults([]); setScanInput('') }}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  addMode === 'product' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                <Search size={12} /> Search Product
              </button>
              <button
                onClick={() => { setAddMode('serial'); setSelectedProduct(null); setProductSearch(''); setTimeout(() => scanTextareaRef.current?.focus(), 50) }}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  addMode === 'serial' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                <ScanLine size={12} /> Scan Serial #
              </button>
            </div>

            {/* ── Search Product mode ──────────────────────────────────────────── */}
            {addMode === 'product' && (
              <>
                <div className="relative mb-3" ref={dropdownRef}>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                    placeholder="Search by SKU or description…"
                    value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setSelectedProduct(null) }}
                  />
                  {showDropdown && productResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {productResults.map(p => (
                        <button
                          key={p.id}
                          onClick={() => selectProduct(p)}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                          <span className="font-mono text-xs text-gray-500 mr-2">{p.sku}</span>
                          <span className="text-gray-900">{p.description}</span>
                          {p.isSerializable && <span className="ml-2 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Serializable</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedProduct && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <span className="font-mono text-gray-500">{selectedProduct.sku}</span>
                      <span>·</span>
                      <span>{selectedProduct.description}</span>
                      {selectedProduct.isSerializable && <span className="ml-auto bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Serializable</span>}
                    </div>

                    {selectedProduct.isSerializable ? (
                      <div>
                        <div className="flex gap-2 mb-1.5">
                          <input
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                            placeholder="Scan or type serial #"
                            value={serialInput}
                            onChange={e => { setSerialInput(e.target.value); setSerialValidationError(null) }}
                            onKeyDown={e => { if (e.key === 'Enter') addPendingSerial() }}
                          />
                          <button
                            onClick={addPendingSerial}
                            disabled={!serialInput.trim() || serialValidating}
                            className="text-xs bg-gray-200 text-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-300 disabled:opacity-50 whitespace-nowrap"
                          >
                            {serialValidating ? '…' : '+ Add'}
                          </button>
                        </div>
                        {serialValidationError && (
                          <p className="text-xs text-red-600 mb-1.5">{serialValidationError}</p>
                        )}
                        {pendingSerials.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {pendingSerials.map(sn => (
                              <span key={sn} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-0.5 text-xs font-mono text-gray-700">
                                {sn}
                                <button onClick={() => removePendingSerial(sn)} className="text-gray-300 hover:text-red-500">✕</button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600">Qty:</label>
                        <input
                          type="number"
                          min={1}
                          className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                          value={addQty}
                          onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
                        />
                      </div>
                    )}

                    <button
                      onClick={handleAddItem}
                      disabled={addingItem || (selectedProduct.isSerializable ? pendingSerials.length === 0 : addQty < 1)}
                      className="w-full bg-amazon-blue text-white text-sm font-medium py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      {addingItem ? 'Adding…' : `Add to Return${selectedProduct.isSerializable ? ` (${pendingSerials.length} serial${pendingSerials.length !== 1 ? 's' : ''})` : ''}`}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Scan Serial # mode ───────────────────────────────────────────── */}
            {addMode === 'serial' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Serial Numbers
                    <span className="text-gray-400 font-normal ml-1.5">— one per line, or paste multiple</span>
                  </label>
                  <textarea
                    ref={scanTextareaRef}
                    rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amazon-blue resize-none"
                    placeholder={'Scan or paste serial numbers here…\nSN001\nSN002\nSN003'}
                    value={scanInput}
                    onChange={e => { setScanInput(e.target.value); setScanResults([]) }}
                  />
                  {(() => {
                    const count = parseScanInput(scanInput).length
                    return count > 0 ? (
                      <p className="text-xs text-gray-500 mt-1">{count} serial{count !== 1 ? 's' : ''} detected</p>
                    ) : null
                  })()}
                </div>

                <button
                  onClick={processBulkScan}
                  disabled={parseScanInput(scanInput).length === 0 || scanProcessing}
                  className="w-full bg-amazon-blue text-white text-sm font-medium py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {scanProcessing
                    ? 'Processing…'
                    : `Add ${parseScanInput(scanInput).length || ''} Serial${parseScanInput(scanInput).length !== 1 ? 's' : ''}`.trim()
                  }
                </button>

                {/* Per-serial results */}
                {scanResults.length > 0 && (
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                      {scanResults.filter(r => r.status === 'added').length} added · {scanResults.filter(r => r.status === 'error').length} failed
                    </p>
                    {scanResults.map(r => (
                      <div
                        key={r.sn}
                        className={clsx(
                          'flex items-start gap-2 px-3 py-1.5 rounded-lg text-xs',
                          r.status === 'added' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200',
                        )}
                      >
                        {r.status === 'added'
                          ? <CheckCircle2 size={13} className="text-green-600 mt-0.5 shrink-0" />
                          : <AlertCircle size={13} className="text-red-500 mt-0.5 shrink-0" />
                        }
                        <span className="font-mono font-semibold shrink-0">{r.sn}</span>
                        <span className={r.status === 'added' ? 'text-green-700' : 'text-red-600'}>{r.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</p>
        <textarea
          rows={3}
          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amazon-blue disabled:bg-gray-50"
          placeholder="Internal notes about this return…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={readonly}
        />
        {!readonly && notes !== (rma.notes ?? '') && (
          <button onClick={saveNotes} disabled={saving} className="mt-1.5 text-xs text-amazon-blue hover:underline disabled:opacity-50">
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        )}
      </div>
    </>
  )
}

// ─── Create Panel ─────────────────────────────────────────────────────────────

function CreatePanel({ vendors, onCreate, onClose }: {
  vendors: Vendor[]
  onCreate: (rma: VendorRMA) => void
  onClose: () => void
}) {
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleCreate() {
    if (!vendorId) { setErr('Please select a vendor'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/vendor-rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId, notes }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Failed'); return }
      onCreate(data)
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold text-gray-900">New Vendor Return</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreate}
            disabled={saving || !vendorId}
            className="flex items-center gap-1.5 bg-amazon-blue text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
      </div>
      {err && <div className="mb-4"><ErrorBanner msg={err} onDismiss={() => setErr(null)} /></div>}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Vendor <span className="text-red-500">*</span></label>
          <select
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            value={vendorId}
            onChange={e => setVendorId(e.target.value)}
          >
            <option value="">Select vendor…</option>
            {vendors.map(v => <option key={v.id} value={v.id}>V-{v.vendorNumber} — {v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            rows={3}
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            placeholder="Optional notes about this return…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VendorRMAManager() {
  const [rmas, setRmas] = useState<VendorRMA[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [panelMode, setPanelMode] = useState<'create' | 'detail' | null>(null)
  const [selectedRMA, setSelectedRMA] = useState<VendorRMA | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRMAs = useCallback(async (q = search, s = statusFilter) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('search', q)
      if (s !== 'ALL') params.set('status', s)
      const res = await fetch(`/api/vendor-rma?${params}`)
      const data = await res.json()
      setRmas(data.data ?? [])
    } finally { setLoading(false) }
  }, [search, statusFilter])

  useEffect(() => { loadRMAs() }, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetch('/api/vendors').then(r => r.json()).then(d => setVendors(d.data ?? []))
  }, [])

  function handleSearch(val: string) {
    setSearch(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => loadRMAs(val), 300)
  }

  function openDetail(rma: VendorRMA) {
    // Load full detail (with items/serials)
    fetch(`/api/vendor-rma/${rma.id}`)
      .then(r => r.json())
      .then(data => { setSelectedRMA(data); setPanelMode('detail') })
  }

  function handleCreated(rma: VendorRMA) {
    setRmas(prev => [rma, ...prev])
    setSelectedRMA(rma)
    setPanelMode('detail')
  }

  function handleUpdated(updated: VendorRMA) {
    setRmas(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r))
    setSelectedRMA(updated)
  }

  function handleDeleted(id: string) {
    setRmas(prev => prev.filter(r => r.id !== id))
  }

  const panelOpen = panelMode !== null

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vendor Returns</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage RMAs sent back to vendors</p>
        </div>
        <button
          onClick={() => { setSelectedRMA(null); setPanelMode('create') }}
          className="flex items-center gap-2 bg-amazon-blue text-white text-sm font-medium px-4 py-2 rounded-xl hover:opacity-90"
        >
          <Plus size={15} /> New Return
        </button>
      </div>

      {/* Filter Bar */}
      <div className="px-6 py-3 border-b bg-white flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex gap-1.5">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={clsx('px-3 py-1 rounded-full text-xs font-medium transition-colors', statusFilter === 'ALL' ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
          >All</button>
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx('px-3 py-1 rounded-full text-xs font-medium transition-colors', statusFilter === s ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
            >{STATUS_LABEL[s]}</button>
          ))}
        </div>
        <input
          className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue w-56"
          placeholder="Search RMA # or vendor…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
            <tr>
              {['RMA #', 'Vendor', 'Approval #', 'Units', 'Scanned Out', 'Total Cost', 'Tracking', 'Status', 'Created', ''].map(h => (
                <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
            ) : rmas.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-400">
                {search || statusFilter !== 'ALL' ? 'No returns match your filter.' : 'No vendor returns yet — click "New Return" to get started.'}
              </td></tr>
            ) : rmas.map(rma => {
              const totalSerials = rma.items.reduce((sum, i) => sum + i.serials.length, 0)
              const scannedCount = rma.items.reduce((sum, i) => sum + i.serials.filter(s => s.scannedOutAt).length, 0)
              const totalCost = rma.items.reduce((sum, i) => sum + (i.unitCost ? parseFloat(i.unitCost) * i.quantity : 0), 0)
              return (
                <tr
                  key={rma.id}
                  onClick={() => openDetail(rma)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-200"
                >
                  <td className="px-4 py-3 font-mono text-sm text-amazon-orange font-semibold">{rma.rmaNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{rma.vendor.name}</td>
                  <td className="px-4 py-3 text-xs font-mono font-semibold text-gray-600">{rma.vendorApprovalNumber || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-center">{rma.items.reduce((s, i) => s + i.quantity, 0)}</td>
                  <td className="px-4 py-3 text-sm text-center">
                    {totalSerials > 0 ? (
                      <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1', scannedCount === totalSerials ? 'text-green-600 border-green-300 bg-green-50' : 'text-gray-500 border-gray-200 bg-gray-50')}>
                        {scannedCount}/{totalSerials}
                        {scannedCount === totalSerials && (
                          <span className="inline-flex items-center gap-0.5 bg-green-100 text-green-700 px-1 py-0.5 rounded-full">
                            <Barcode size={13} /><Check size={12} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{totalCost > 0 ? `$${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                  <td className="px-4 py-3">
                    {rma.trackingNumber ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-mono text-gray-700">{rma.trackingNumber}</span>
                        {rma.carrierStatus && (
                          <span className={clsx('text-[10px] font-medium', rma.carrierStatus === 'Delivered' ? 'text-green-600' : rma.carrierStatus === 'In Transit' ? 'text-blue-600' : 'text-gray-500')}>
                            {rma.carrier ? `${rma.carrier} · ` : ''}{rma.carrierStatus}
                          </span>
                        )}
                        {!rma.carrierStatus && rma.carrier && (
                          <span className="text-[10px] text-gray-400">{rma.carrier}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2.5 py-1 rounded-full text-xs font-medium', STATUS_COLOR[rma.status])}>
                      {STATUS_LABEL[rma.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{fmt(rma.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-amazon-blue">View →</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Slide-in Panel Overlay */}
      {panelOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPanelMode(null)} />
          <div className="relative z-10 w-[600px] max-w-full h-full bg-white shadow-2xl overflow-y-auto">
            <div className="p-6">
              {panelMode === 'create' && (
                <CreatePanel
                  vendors={vendors}
                  onCreate={handleCreated}
                  onClose={() => setPanelMode(null)}
                />
              )}
              {panelMode === 'detail' && selectedRMA && (
                <DetailPanel
                  rma={selectedRMA}
                  onClose={() => setPanelMode(null)}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

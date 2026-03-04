'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, X, AlertCircle, ShoppingCart, ChevronDown, ChevronUp, PackageCheck, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import ReceiveModal from './ReceiveModal'
import SpreadsheetReceiveModal from './SpreadsheetReceiveModal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vendor  { id: string; name: string }
interface Product { id: string; description: string; sku: string; isSerializable: boolean }

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
  vendor: Vendor
  date: string
  notes: string | null
  status: 'OPEN' | 'RECEIVED' | 'CANCELLED'
  createdAt: string
  lines: POLine[]
}

interface FormLine {
  productId: string
  qty: number
  unitCost: string
}

interface ReceiptLine {
  id: string
  productId: string
  product: { description: string; sku: string }
  qtyReceived: number
  location: { name: string; warehouse: { name: string } }
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

// ─── PO Form Panel ────────────────────────────────────────────────────────────

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
  const firstRef = useRef<HTMLSelectElement>(null)

  const [vendorId, setVendorId]   = useState(editing?.vendor.id ?? '')
  const [date,     setDate]       = useState(editing ? editing.date.slice(0, 10) : today())
  const [notes,    setNotes]      = useState(editing?.notes ?? '')
  const [status,   setStatus]     = useState<'OPEN' | 'RECEIVED' | 'CANCELLED'>(editing?.status ?? 'OPEN')
  const [lines,    setLines]      = useState<FormLine[]>(
    editing?.lines.length
      ? editing.lines.map(l => ({ productId: l.productId, qty: l.qty, unitCost: String(l.unitCost) }))
      : [{ productId: '', qty: 1, unitCost: '' }]
  )
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  useEffect(() => { firstRef.current?.focus() }, [])

  const lineTotal = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0)

  function addLine()             { setLines(p => [...p, { productId: '', qty: 1, unitCost: '' }]) }
  function removeLine(i: number) { setLines(p => p.filter((_, idx) => idx !== i)) }
  function setLine(i: number, field: keyof FormLine, val: string | number) {
    setLines(p => p.map((l, idx) => idx === i ? { ...l, [field]: val } : l))
  }

  async function handleSave() {
    setErr('')
    if (!vendorId)    { setErr('Select a vendor'); return }
    if (!date)        { setErr('Date is required'); return }
    if (!lines.length){ setErr('Add at least one line item'); return }

    setSaving(true)
    try {
      const payload = {
        vendorId, date, notes: notes.trim() || null,
        status: isEdit ? status : 'OPEN',
        lines: lines.map(l => ({
          productId: l.productId,
          qty: Number(l.qty),
          unitCost: Number(l.unitCost),
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

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[540px] bg-white shadow-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {isEdit ? `Edit PO #${editing.poNumber}` : 'New Purchase Order'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

          {/* Vendor + Date row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Vendor <span className="text-red-500">*</span>
              </label>
              <select
                ref={firstRef}
                value={vendorId}
                onChange={e => setVendorId(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              >
                <option value="">Select vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
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
                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              />
            </div>
          </div>

          {/* Status (edit only) */}
          {isEdit && (
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

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">
                Line Items <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={addLine}
                className="flex items-center gap-1 text-xs text-amazon-blue hover:underline"
              >
                <Plus size={12} /> Add item
              </button>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_60px_96px_32px] gap-2 mb-1 px-1">
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Product</span>
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide text-center">Qty</span>
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide text-right">Unit Cost</span>
              <span />
            </div>

            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_60px_96px_32px] gap-2 items-center">
                  {/* Product */}
                  <select
                    value={line.productId}
                    onChange={e => setLine(i, 'productId', e.target.value)}
                    className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue truncate"
                  >
                    <option value="">Select product…</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.description} ({p.sku})</option>
                    ))}
                  </select>

                  {/* Qty */}
                  <input
                    type="number"
                    min={1}
                    value={line.qty}
                    onChange={e => setLine(i, 'qty', e.target.value)}
                    autoComplete="off"
                    className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                  />

                  {/* Unit Cost */}
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitCost}
                      onChange={e => setLine(i, 'unitCost', e.target.value)}
                      autoComplete="off"
                      placeholder="0.00"
                      className="h-9 w-full rounded-md border border-gray-300 pl-6 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
                    />
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1}
                    className="h-9 w-8 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-0 disabled:pointer-events-none"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="mt-3 flex justify-end border-t pt-3">
              <div className="text-right">
                <span className="text-xs text-gray-500">Order Total</span>
                <p className="text-lg font-bold text-gray-900">${lineTotal.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
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

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
        <Clock size={11} /> Receipt History
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
                <tr key={rl.id}>
                  <td className="px-3 py-1.5 text-gray-700">{rl.product.description} <span className="font-mono text-gray-400">({rl.product.sku})</span></td>
                  <td className="px-3 py-1.5 text-gray-500">{rl.location.warehouse.name} / {rl.location.name}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{rl.qtyReceived}</td>
                </tr>
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
}: {
  po: PurchaseOrder
  onEdit: (po: PurchaseOrder) => void
  onDeleted: () => void
  onReceive: (po: PurchaseOrder) => void
  onSpreadsheetReceive: (po: PurchaseOrder) => void
}) {
  const [expanded,      setExpanded]      = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [err,           setErr]           = useState('')

  const total = po.lines.reduce((s, l) => s + l.qty * Number(l.unitCost), 0)

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
        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {expanded ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
            #{po.poNumber}
          </div>
        </td>
        <td className="px-4 py-3 text-gray-700">{po.vendor.name}</td>
        <td className="px-4 py-3 text-gray-500 text-sm">
          {new Date(po.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </td>
        <td className="px-4 py-3 text-gray-600 text-sm">{po.lines.length} item{po.lines.length !== 1 ? 's' : ''}</td>
        <td className="px-4 py-3 font-medium text-gray-900 text-right">${total.toFixed(2)}</td>
        <td className="px-4 py-3">
          <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_COLOR[po.status])}>
            {STATUS_LABEL[po.status]}
          </span>
        </td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
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
              {po.status !== 'RECEIVED' && (
                <button type="button" onClick={() => onEdit(po)}
                  className="p-1.5 rounded text-gray-400 hover:text-amazon-blue hover:bg-blue-50">
                  <Pencil size={13} />
                </button>
              )}
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
          <td colSpan={7} className="px-0 py-0 border-b border-gray-100">
            <div className="bg-gray-50 border-t border-gray-100 px-10 py-4">
              {po.notes && (
                <p className="text-xs text-gray-500 italic mb-3">{po.notes}</p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-400 pb-2 w-[40%]">Product</th>
                    <th className="text-left text-xs font-medium text-gray-400 pb-2">SKU</th>
                    <th className="text-right text-xs font-medium text-gray-400 pb-2">Qty</th>
                    <th className="text-right text-xs font-medium text-gray-400 pb-2">Unit Cost</th>
                    <th className="text-right text-xs font-medium text-gray-400 pb-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {po.lines.map(line => (
                    <tr key={line.id}>
                      <td className="py-1.5 pr-4 text-gray-800 font-medium">{line.product.description}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs text-gray-500">{line.product.sku}</td>
                      <td className="py-1.5 text-right text-gray-700">{line.qty}</td>
                      <td className="py-1.5 text-right text-gray-700">${Number(line.unitCost).toFixed(2)}</td>
                      <td className="py-1.5 text-right font-medium text-gray-900">
                        ${(line.qty * Number(line.unitCost)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td colSpan={4} className="pt-2 text-right text-xs font-semibold text-gray-600 pr-4">Total</td>
                    <td className="pt-2 text-right font-bold text-gray-900">${total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

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
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const url = statusFilter ? `/api/purchase-orders?status=${statusFilter}` : '/api/purchase-orders'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setOrders(data.data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

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
      <div className="flex items-center gap-3 mb-4">
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
            {orders.length} PO{orders.length !== 1 ? 's' : ''} · Total: <span className="font-semibold text-gray-600">${grandTotal.toFixed(2)}</span>
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
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">PO #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Items</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 w-36" />
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
    </div>
  )
}

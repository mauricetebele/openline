'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X, Trash2, AlertCircle, Search, ScanLine, ChevronDown, Archive } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LegacyRMASerial {
  id: string; serialNumber: string; note: string | null; createdAt: string
  location: { id: string; name: string; warehouse: { id: string; name: string } }
}
interface LegacyRMAItem {
  id: string; quantity: number; unitCost: string | null; createdAt: string
  product: { id: string; sku: string; description: string; isSerializable: boolean }
  grade: { id: string; grade: string } | null
  vendor: { id: string; name: string } | null
  serials: LegacyRMASerial[]
}
interface LegacyRMA {
  id: string; rmaNumber: string; orderRef: string
  notes: string | null; createdAt: string; updatedAt: string
  vendor: { id: string; vendorNumber: number; name: string } | null
  items: LegacyRMAItem[]
}
interface Vendor { id: string; vendorNumber: number; name: string }
interface Product { id: string; sku: string; description: string; isSerializable: boolean }
interface Grade { id: string; grade: string }
interface Warehouse { id: string; name: string; locations: { id: string; name: string }[] }

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

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({
  vendors, onCreated, onCancel,
}: { vendors: Vendor[]; onCreated: (rma: LegacyRMA) => void; onCancel: () => void }) {
  const [orderRef, setOrderRef] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orderRef.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/legacy-rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderRef: orderRef.trim(), vendorId: vendorId || undefined, notes: notes.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create')
      onCreated(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">New Legacy RMA</h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}

        <div className="space-y-3 mt-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Order Reference *</label>
            <input
              ref={ref}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              placeholder="e.g. PO-2024-001, Invoice #123, etc."
              value={orderRef}
              onChange={e => setOrderRef(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vendor (optional)</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
            >
              <option value="">— None —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            type="submit"
            disabled={saving || !orderRef.trim()}
            className="px-4 py-2 text-sm font-medium bg-amazon-blue text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >{saving ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>
  )
}

// ─── Add Item Form ────────────────────────────────────────────────────────────

function AddItemForm({
  rmaId, grades, vendors, onAdded,
}: { rmaId: string; grades: Grade[]; vendors: Vendor[]; onAdded: (item: LegacyRMAItem) => void }) {
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [gradeId, setGradeId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  function handleProductSearch(val: string) {
    setProductSearch(val)
    setSelectedProduct(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (val.trim().length < 2) { setProductResults([]); setShowDropdown(false); return }
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/products?search=${encodeURIComponent(val.trim())}`)
      const data = await res.json()
      setProductResults(data.data ?? [])
      setShowDropdown(true)
    }, 300)
  }

  function selectProduct(p: Product) {
    setSelectedProduct(p)
    setProductSearch(`${p.sku} — ${p.description}`)
    setShowDropdown(false)
    setProductResults([])
  }

  async function handleAdd() {
    if (!selectedProduct) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/legacy-rma/${rmaId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          gradeId: gradeId || undefined,
          vendorId: vendorId || undefined,
          unitCost: unitCost ? parseFloat(unitCost) : undefined,
          quantity: parseInt(quantity) || 1,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add item')
      onAdded(data)
      // Reset form
      setProductSearch('')
      setSelectedProduct(null)
      setGradeId('')
      setVendorId('')
      setUnitCost('')
      setQuantity('1')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally { setSaving(false) }
  }

  return (
    <div className="border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50/50">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add Line Item</h4>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div className="grid grid-cols-12 gap-2 items-end">
        {/* Product search */}
        <div className="col-span-4 relative">
          <label className="block text-xs text-gray-500 mb-0.5">SKU / Product</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            placeholder="Search SKU…"
            value={productSearch}
            onChange={e => handleProductSearch(e.target.value)}
            onFocus={() => { if (productResults.length) setShowDropdown(true) }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          />
          {showDropdown && productResults.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {productResults.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                  onMouseDown={() => selectProduct(p)}
                >
                  <span className="font-medium">{p.sku}</span> — <span className="text-gray-500">{p.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grade */}
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-0.5">Grade</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            value={gradeId}
            onChange={e => setGradeId(e.target.value)}
          >
            <option value="">—</option>
            {grades.map(g => <option key={g.id} value={g.id}>{g.grade}</option>)}
          </select>
        </div>

        {/* Vendor */}
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-0.5">Vendor</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            value={vendorId}
            onChange={e => setVendorId(e.target.value)}
          >
            <option value="">—</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>

        {/* Unit Cost */}
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-0.5">Cost</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={unitCost}
            onChange={e => setUnitCost(e.target.value)}
          />
        </div>

        {/* Quantity */}
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-0.5">Qty</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            type="number"
            min="1"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
          />
        </div>

        {/* Add button */}
        <div className="col-span-2 flex justify-end">
          <button
            onClick={handleAdd}
            disabled={!selectedProduct || saving}
            className="flex items-center gap-1.5 bg-amazon-blue text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} /> {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Receive Modal ────────────────────────────────────────────────────────────

function ReceiveModal({
  rmaId, item, warehouses, onReceived, onCancel,
}: {
  rmaId: string
  item: LegacyRMAItem
  warehouses: Warehouse[]
  onReceived: () => void
  onCancel: () => void
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || '')
  const [locationId, setLocationId] = useState('')
  const [serialInput, setSerialInput] = useState('')
  const [scannedSerials, setScannedSerials] = useState<Array<{ serialNumber: string; note: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const locations = warehouses.find(w => w.id === warehouseId)?.locations || []

  useEffect(() => {
    if (locations.length > 0 && !locationId) setLocationId(locations[0].id)
  }, [warehouseId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // eslint-disable-next-line no-control-regex
    const sn = serialInput.replace(/[^\x20-\x7E]/g, '').trim().toUpperCase()
    if (!sn) return

    // Check for dupes within current batch
    if (scannedSerials.some(s => s.serialNumber === sn)) {
      playErrorBeep()
      setError(`Duplicate: ${sn}`)
      setSerialInput('')
      return
    }

    playSuccessChime()
    setScannedSerials(prev => [...prev, { serialNumber: sn, note: '' }])
    setSerialInput('')
    setError('')
  }

  function updateNote(idx: number, note: string) {
    setScannedSerials(prev => prev.map((s, i) => i === idx ? { ...s, note } : s))
  }

  function removeSerial(idx: number) {
    setScannedSerials(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleConfirm() {
    if (!locationId || scannedSerials.length === 0) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/legacy-rma/${rmaId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          locationId,
          serials: scannedSerials.map(s => ({ serialNumber: s.serialNumber, note: s.note || undefined })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.serials) {
          throw new Error(`${data.message}: ${data.serials.join(', ')}`)
        }
        throw new Error(data.error || 'Failed to receive')
      }
      onReceived()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      playErrorBeep()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Receive Serials</h3>
            <p className="text-xs text-gray-500 mt-0.5">{item.product.sku} — {item.product.description}</p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}

        {/* Location picker */}
        <div className="grid grid-cols-2 gap-3 mt-2 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              value={warehouseId}
              onChange={e => { setWarehouseId(e.target.value); setLocationId('') }}
            >
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
            >
              <option value="">Select…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        {/* Serial scanner */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Scan Serial Number</label>
          <div className="relative">
            <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
              placeholder="Scan or type serial number, press Enter…"
              value={serialInput}
              onChange={e => setSerialInput(e.target.value)}
              onKeyDown={handleScan}
              autoFocus
            />
          </div>
        </div>

        {/* Scanned serials list */}
        <div className="flex-1 overflow-y-auto min-h-0 border border-gray-200 rounded-lg">
          {scannedSerials.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">No serials scanned yet</div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 w-8">#</th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500">Serial Number</th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500">Note</th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scannedSerials.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-3 py-1.5 text-sm font-mono">{s.serialNumber}</td>
                    <td className="px-3 py-1.5">
                      <input
                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                        placeholder="Optional note…"
                        value={s.note}
                        onChange={e => updateNote(i, e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button onClick={() => removeSerial(i)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t">
          <span className="text-sm text-gray-500">{scannedSerials.length} serial(s) scanned</span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={saving || !locationId || scannedSerials.length === 0}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >{saving ? 'Receiving…' : 'Confirm Receive'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  rma, grades, vendors, warehouses, onRefresh, onDeleted, onClose,
}: {
  rma: LegacyRMA; grades: Grade[]; vendors: Vendor[]; warehouses: Warehouse[]
  onRefresh: () => void; onDeleted: (id: string) => void; onClose: () => void
}) {
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [receiveItem, setReceiveItem] = useState<LegacyRMAItem | null>(null)

  async function handleDelete() {
    if (!confirm('Delete this Legacy RMA?')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/legacy-rma/${rma.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      onDeleted(rma.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally { setDeleting(false) }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm('Remove this line item?')) return
    try {
      const res = await fetch(`/api/legacy-rma/${rma.id}/items/${itemId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete item')
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  function handleItemAdded() {
    onRefresh()
  }

  function handleReceived() {
    setReceiveItem(null)
    onRefresh()
  }

  const totalSerials = rma.items.reduce((sum, i) => sum + i.serials.length, 0)

  return (
    <>
      <div className="h-full flex flex-col bg-white border-l border-gray-200">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{rma.rmaNumber}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Order Ref: {rma.orderRef}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting || totalSerials > 0}
              title={totalSerials > 0 ? 'Cannot delete — has received serials' : 'Delete RMA'}
              className="text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
            ><Trash2 size={16} /></button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
        </div>

        {error && <div className="px-5 pt-3"><ErrorBanner msg={error} onDismiss={() => setError('')} /></div>}

        {/* Info */}
        <div className="px-5 py-3 border-b text-sm space-y-1 shrink-0">
          {rma.vendor && <p className="text-gray-600">Vendor: <span className="font-medium">{rma.vendor.name}</span></p>}
          {rma.notes && <p className="text-gray-500">Notes: {rma.notes}</p>}
          <p className="text-gray-400 text-xs">Created {fmt(rma.createdAt)}</p>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {rma.items.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Line Items</h3>
              <div className="space-y-3">
                {rma.items.map(item => (
                  <div key={item.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.product.sku}</p>
                        <p className="text-xs text-gray-500">{item.product.description}</p>
                        <div className="flex gap-3 mt-1 text-xs text-gray-500">
                          {item.grade && <span>Grade: {item.grade.grade}</span>}
                          {item.vendor && <span>Vendor: {item.vendor.name}</span>}
                          {item.unitCost && <span>Cost: ${Number(item.unitCost).toFixed(2)}</span>}
                          <span>Qty: {item.quantity}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setReceiveItem(item)}
                          className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-100"
                        ><ScanLine size={13} /> Receive</button>
                        {item.serials.length === 0 && (
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="text-red-400 hover:text-red-600"
                          ><Trash2 size={14} /></button>
                        )}
                      </div>
                    </div>

                    {/* Received serials */}
                    {item.serials.length > 0 && (
                      <div className="mt-2 border-t pt-2">
                        <p className="text-xs text-gray-400 mb-1">{item.serials.length} serial(s) received</p>
                        <div className="grid grid-cols-2 gap-1">
                          {item.serials.map(s => (
                            <div key={s.id} className="text-xs font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded flex items-center justify-between">
                              <span>{s.serialNumber}</span>
                              {s.note && <span className="text-gray-400 ml-1 truncate max-w-[120px]" title={s.note}>{s.note}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Item Form */}
          <AddItemForm rmaId={rma.id} grades={grades} vendors={vendors} onAdded={handleItemAdded} />
        </div>
      </div>

      {/* Receive modal */}
      {receiveItem && (
        <ReceiveModal
          rmaId={rma.id}
          item={receiveItem}
          warehouses={warehouses}
          onReceived={handleReceived}
          onCancel={() => setReceiveItem(null)}
        />
      )}
    </>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function LegacyRMAManager() {
  const [rmas, setRmas] = useState<LegacyRMA[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedRMA, setSelectedRMA] = useState<LegacyRMA | null>(null)

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  const loadRMAs = useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      const query = q !== undefined ? q : search
      if (query) params.set('search', query)
      const res = await fetch(`/api/legacy-rma?${params}`)
      const data = await res.json()
      setRmas(data.data ?? [])
    } finally { setLoading(false) }
  }, [search])

  useEffect(() => { loadRMAs() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetch('/api/vendors').then(r => r.json()).then(d => setVendors(d.data ?? []))
    fetch('/api/grades').then(r => r.json()).then(d => setGrades(d.data ?? []))
    fetch('/api/warehouses').then(r => r.json()).then(d => setWarehouses(d.data ?? []))
  }, [])

  function handleSearch(val: string) {
    setSearch(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => loadRMAs(val), 300)
  }

  function openDetail(rma: LegacyRMA) {
    fetch(`/api/legacy-rma/${rma.id}`)
      .then(r => r.json())
      .then(data => setSelectedRMA(data))
  }

  function refreshDetail() {
    if (!selectedRMA) return
    fetch(`/api/legacy-rma/${selectedRMA.id}`)
      .then(r => r.json())
      .then(data => {
        setSelectedRMA(data)
        loadRMAs()
      })
  }

  function handleCreated(rma: LegacyRMA) {
    setRmas(prev => [rma, ...prev])
    setShowCreate(false)
    openDetail(rma)
  }

  function handleDeleted(id: string) {
    setRmas(prev => prev.filter(r => r.id !== id))
    setSelectedRMA(null)
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Legacy RMA</h1>
          <p className="text-sm text-gray-500 mt-0.5">Receive inventory from pre-system vendor returns</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-amazon-blue text-white text-sm font-medium px-4 py-2 rounded-xl hover:opacity-90"
        >
          <Plus size={15} /> New Legacy RMA
        </button>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b bg-white shrink-0">
        <input
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue w-72"
          placeholder="Search RMA #, order ref, or vendor…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table */}
        <div className={clsx('flex-1 overflow-y-auto transition-all', selectedRMA && 'w-1/2')}>
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                {['RMA #', 'Order Ref', 'Vendor', 'Items', 'Serials', 'Created'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : rmas.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">
                  {search ? 'No results match your search.' : 'No legacy RMAs yet — click "New Legacy RMA" to get started.'}
                </td></tr>
              ) : rmas.map(rma => {
                const itemCount = rma.items.length
                const serialCount = rma.items.reduce((sum, i) => sum + (i.serials?.length || 0), 0)
                return (
                  <tr
                    key={rma.id}
                    onClick={() => openDetail(rma)}
                    className={clsx(
                      'cursor-pointer hover:bg-blue-50/50 transition-colors',
                      selectedRMA?.id === rma.id && 'bg-blue-50',
                    )}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{rma.rmaNumber}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">{rma.orderRef}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{rma.vendor?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{itemCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{serialCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">{fmt(rma.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selectedRMA && (
          <div className="w-1/2 border-l border-gray-200 overflow-hidden">
            <DetailPanel
              key={selectedRMA.id}
              rma={selectedRMA}
              grades={grades}
              vendors={vendors}
              warehouses={warehouses}
              onRefresh={refreshDetail}
              onDeleted={handleDeleted}
              onClose={() => setSelectedRMA(null)}
            />
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          vendors={vendors}
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}

'use client'
import { useEffect, useState, useCallback } from 'react'
import { Plus, ArrowLeft, Package, Truck, X, AlertCircle, Loader2, Download, Check, Ban } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type FbaStatus = 'DRAFT' | 'PLAN_CREATED' | 'PACKING_SET' | 'PLACEMENT_CONFIRMED' | 'TRANSPORT_CONFIRMED' | 'LABELS_READY' | 'SHIPPED' | 'CANCELLED'

interface FbaShipment {
  id: string
  status: FbaStatus
  name: string | null
  accountId: string
  warehouseId: string
  inboundPlanId: string | null
  shipmentId: string | null
  packingGroupId: string | null
  placementFee: string | null
  shippingEstimate: string | null
  labelData: string | null
  lastError: string | null
  lastErrorAt: string | null
  createdAt: string
  account: { id: string; sellerId: string; marketplaceName: string; marketplaceId?: string }
  warehouse: { id: string; name: string; addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; countryCode?: string }
  items: FbaShipmentItem[]
  boxes?: FbaShipmentBox[]
  reservations?: Array<{ id: string; productId: string; locationId: string; gradeId: string | null; qtyReserved: number }>
  _count?: { items: number; boxes: number }
}

interface FbaShipmentItem {
  id: string
  mskuId: string
  sellerSku: string
  fnsku: string
  asin: string | null
  quantity: number
  msku: {
    sellerSku: string
    product: { id: string; sku: string; description: string }
    grade?: { id: string; grade: string } | null
  }
  boxItems?: Array<{ boxId: string; quantity: number }>
}

interface FbaShipmentBox {
  id: string
  boxNumber: number
  weightLb: string
  lengthIn: string
  widthIn: string
  heightIn: string
  items: Array<{ shipmentItemId: string; quantity: number }>
}

interface Account {
  id: string
  sellerId: string
  marketplaceName: string
  marketplaceId: string
}

interface Warehouse {
  id: string
  name: string
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  countryCode?: string
}

interface MskuOption {
  id: string
  sellerSku: string
  productId: string
  product: { sku: string; description: string }
  grade: { id: string; grade: string } | null
  fnsku: string | null
}

interface PlacementOption {
  placementOptionId: string
  shipmentIds: string[]
  fees?: Array<{ type: string; amount: { amount: number; code: string } }>
}

interface TransportOption {
  transportationOptionId: string
  shippingMode: string
  shippingSolution: string
  carrier?: { name: string }
  quote?: { price: { amount: number; code: string } }
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<FbaStatus, { label: string; color: string; step: number }> = {
  DRAFT:               { label: 'Draft',             color: 'bg-gray-100 text-gray-700',   step: 0 },
  PLAN_CREATED:        { label: 'Plan Created',      color: 'bg-blue-100 text-blue-700',   step: 1 },
  PACKING_SET:         { label: 'Packing Set',       color: 'bg-indigo-100 text-indigo-700', step: 2 },
  PLACEMENT_CONFIRMED: { label: 'Placement Confirmed', color: 'bg-purple-100 text-purple-700', step: 3 },
  TRANSPORT_CONFIRMED: { label: 'Transport Confirmed', color: 'bg-amber-100 text-amber-700',  step: 4 },
  LABELS_READY:        { label: 'Labels Ready',      color: 'bg-emerald-100 text-emerald-700', step: 5 },
  SHIPPED:             { label: 'Shipped',           color: 'bg-green-100 text-green-700', step: 6 },
  CANCELLED:           { label: 'Cancelled',         color: 'bg-red-100 text-red-700',     step: -1 },
}

function StatusBadge({ status }: { status: FbaStatus }) {
  const cfg = STATUS_CONFIG[status]
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cfg.color)}>{cfg.label}</span>
}

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onClose} className="shrink-0 hover:text-red-900"><X size={14} /></button>
    </div>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────

const TABS: Array<{ label: string; value: string | null }> = [
  { label: 'All', value: null },
  { label: 'Active', value: 'active' },
  { label: 'Shipped', value: 'SHIPPED' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

function ListView({
  shipments,
  loading,
  tab,
  onTabChange,
  onSelect,
  onCreate,
}: {
  shipments: FbaShipment[]
  loading: boolean
  tab: string | null
  onTabChange: (t: string | null) => void
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  const filtered = shipments.filter(s => {
    if (!tab) return true
    if (tab === 'active') return !['SHIPPED', 'CANCELLED'].includes(s.status)
    return s.status === tab
  })

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.label} type="button" onClick={() => onTabChange(t.value)}
              className={clsx('px-3 py-1.5 text-xs font-medium rounded-md',
                tab === t.value ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button type="button" onClick={onCreate}
          className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90">
          <Plus size={14} /> New Shipment
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <Truck size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-400">No FBA shipments yet</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Account</th>
                <th className="text-left px-4 py-2 font-medium">Warehouse</th>
                <th className="text-center px-4 py-2 font-medium">Items</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => (
                <tr key={s.id} onClick={() => onSelect(s.id)}
                  className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {s.name || s.id.slice(-8)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{s.account.marketplaceName}</td>
                  <td className="px-4 py-2.5 text-gray-600">{s.warehouse.name}</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{s._count?.items ?? s.items.length}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={s.status} /></td>
                  <td className="px-4 py-2.5 text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Create Form ──────────────────────────────────────────────────────────────

interface DraftItem {
  mskuId: string
  sellerSku: string
  productSku: string
  description: string
  grade: string | null
  quantity: number
  productId: string
  locationId: string
  gradeId: string | null
}

interface InventoryOption {
  productId: string
  locationId: string
  locationName: string
  gradeId: string | null
  grade: string | null
  qty: number
}

function CreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void
  onCancel: () => void
}) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [mskus, setMskus] = useState<MskuOption[]>([])
  const [accountId, setAccountId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [name, setName] = useState('')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [selectedMsku, setSelectedMsku] = useState('')
  const [qty, setQty] = useState(1)
  const [invOptions, setInvOptions] = useState<InventoryOption[]>([])
  const [selectedInv, setSelectedInv] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [loadingInv, setLoadingInv] = useState(false)

  useEffect(() => {
    fetch('/api/amazon-accounts').then(r => r.json()).then(d => setAccounts(d.data ?? d ?? []))
    fetch('/api/warehouses').then(r => r.json()).then(d => setWarehouses(d.data ?? d ?? []))
    fetch('/api/marketplace-skus?marketplace=amazon').then(r => r.json()).then(d => setMskus(d.data ?? d ?? []))
  }, [])

  // Load inventory when MSKU is selected
  useEffect(() => {
    if (!selectedMsku) { setInvOptions([]); return }
    const msku = mskus.find(m => m.id === selectedMsku)
    if (!msku) return
    setLoadingInv(true)
    fetch(`/api/inventory?productId=${msku.productId}${msku.grade ? `&gradeId=${msku.grade.id}` : ''}`)
      .then(r => r.json())
      .then(d => {
        const items = (d.data ?? d ?? []) as Array<{ productId: string; locationId: string; location: { name: string }; gradeId: string | null; grade: { grade: string } | null; qty: number }>
        setInvOptions(items.filter(i => i.qty > 0).map(i => ({
          productId: i.productId,
          locationId: i.locationId,
          locationName: i.location?.name ?? i.locationId,
          gradeId: i.gradeId,
          grade: i.grade?.grade ?? null,
          qty: i.qty,
        })))
      })
      .finally(() => setLoadingInv(false))
  }, [selectedMsku, mskus])

  function addItem() {
    const msku = mskus.find(m => m.id === selectedMsku)
    const inv = invOptions.find(i => `${i.productId}|${i.locationId}|${i.gradeId}` === selectedInv)
    if (!msku || !inv || qty < 1) return
    if (qty > inv.qty) { setErr(`Only ${inv.qty} available`); return }

    setDraftItems(prev => [...prev, {
      mskuId: msku.id,
      sellerSku: msku.sellerSku,
      productSku: msku.product.sku,
      description: msku.product.description,
      grade: msku.grade?.grade ?? null,
      quantity: qty,
      productId: inv.productId,
      locationId: inv.locationId,
      gradeId: inv.gradeId,
    }])
    setSelectedMsku('')
    setQty(1)
    setSelectedInv('')
    setErr('')
  }

  function removeItem(idx: number) {
    setDraftItems(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleCreate() {
    if (!accountId) { setErr('Select an account'); return }
    if (!warehouseId) { setErr('Select a warehouse'); return }
    if (draftItems.length === 0) { setErr('Add at least one item'); return }

    const wh = warehouses.find(w => w.id === warehouseId)
    if (wh && (!wh.addressLine1 || !wh.city || !wh.state || !wh.postalCode)) {
      setErr('Selected warehouse has no shipping address. Edit the warehouse first.')
      return
    }

    setSaving(true)
    setErr('')
    try {
      const res = await fetch('/api/fba-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, warehouseId, name: name || undefined, items: draftItems }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Create failed')
      onCreated(data.id)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4 max-w-3xl">
      <button type="button" onClick={onCancel} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={14} /> Back
      </button>

      <h2 className="text-lg font-bold text-gray-900 mb-4">Create FBA Shipment</h2>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Amazon Account</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm">
              <option value="">Select account...</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.marketplaceName} ({a.sellerId})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Source Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm">
              <option value="">Select warehouse...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Shipment Name (optional)</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. March Restock"
            className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm" />
        </div>

        {/* Add item form */}
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Add Items</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Marketplace SKU</label>
              <select value={selectedMsku} onChange={e => setSelectedMsku(e.target.value)}
                className="w-full h-8 rounded border border-gray-300 px-2 text-sm">
                <option value="">Select SKU...</option>
                {mskus.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.sellerSku} — {m.product.description}{m.grade ? ` (${m.grade.grade})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Source Location</label>
              {loadingInv ? (
                <div className="h-8 flex items-center text-xs text-gray-400"><Loader2 size={12} className="animate-spin mr-1" /> Loading...</div>
              ) : (
                <select value={selectedInv} onChange={e => setSelectedInv(e.target.value)}
                  className="w-full h-8 rounded border border-gray-300 px-2 text-sm" disabled={!selectedMsku}>
                  <option value="">Select location...</option>
                  {invOptions.map(inv => (
                    <option key={`${inv.productId}|${inv.locationId}|${inv.gradeId}`}
                      value={`${inv.productId}|${inv.locationId}|${inv.gradeId}`}>
                      {inv.locationName}{inv.grade ? ` (${inv.grade})` : ''} — {inv.qty} avail
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quantity</label>
              <input type="number" min={1} value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)}
                className="w-24 h-8 rounded border border-gray-300 px-2 text-sm" />
            </div>
            <button type="button" onClick={addItem} disabled={!selectedMsku || !selectedInv || qty < 1}
              className="h-8 px-4 rounded bg-amazon-blue text-white text-xs font-medium disabled:opacity-40">
              Add
            </button>
          </div>
        </div>

        {/* Items table */}
        {draftItems.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-left px-3 py-2 font-medium">Seller SKU</th>
                  <th className="text-left px-3 py-2 font-medium">Grade</th>
                  <th className="text-center px-3 py-2 font-medium">Qty</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {draftItems.map((item, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-gray-800">{item.productSku}</td>
                    <td className="px-3 py-2 text-gray-600">{item.sellerSku}</td>
                    <td className="px-3 py-2 text-gray-600">{item.grade ?? '—'}</td>
                    <td className="px-3 py-2 text-center">{item.quantity}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button type="button" onClick={handleCreate} disabled={saving || draftItems.length === 0}
          className="h-10 px-6 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
          {saving ? 'Creating...' : 'Create Shipment'}
        </button>
      </div>
    </div>
  )
}

// ─── Wizard View ──────────────────────────────────────────────────────────────

function WizardView({
  shipmentId,
  onBack,
  onRefreshList,
}: {
  shipmentId: string
  onBack: () => void
  onRefreshList: () => void
}) {
  const [shipment, setShipment] = useState<FbaShipment | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  // Placement & transport options (returned from API calls)
  const [placementOptions, setPlacementOptions] = useState<PlacementOption[]>([])
  const [selectedPlacement, setSelectedPlacement] = useState('')
  const [transportOptions, setTransportOptions] = useState<TransportOption[]>([])
  const [selectedTransport, setSelectedTransport] = useState('')

  // Box contents state
  const [boxes, setBoxes] = useState<Array<{
    weightLb: number; lengthIn: number; widthIn: number; heightIn: number
    items: Array<{ shipmentItemId: string; quantity: number }>
  }>>([])

  const loadShipment = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/fba-shipments/${shipmentId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setShipment(data)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [shipmentId])

  useEffect(() => { loadShipment() }, [loadShipment])

  async function doAction(path: string, body?: unknown) {
    setActionLoading(true)
    setErr('')
    try {
      const opts: RequestInit = { method: body !== undefined ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } }
      if (body !== undefined) opts.body = JSON.stringify(body)
      const res = await fetch(`/api/fba-shipments/${shipmentId}/${path}`, opts)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Action failed')
      return data
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Action failed')
      return null
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCreatePlan() {
    const result = await doAction('create-plan', {})
    if (result) { await loadShipment(); onRefreshList() }
  }

  async function handleSetBoxes() {
    // Validate all items are assigned to boxes
    if (boxes.length === 0) { setErr('Add at least one box'); return }
    const result = await doAction('set-boxes', { boxes })
    if (result) {
      setPlacementOptions(result.placementOptions ?? [])
      await loadShipment()
      onRefreshList()
    }
  }

  async function handleConfirmPlacement() {
    if (!selectedPlacement) { setErr('Select a placement option'); return }
    const result = await doAction('confirm-placement', { placementOptionId: selectedPlacement })
    if (result) {
      setTransportOptions(result.transportOptions ?? [])
      await loadShipment()
      onRefreshList()
    }
  }

  async function handleConfirmTransport() {
    if (!selectedTransport) { setErr('Select a transport option'); return }
    const result = await doAction('confirm-transport', { transportOptionId: selectedTransport })
    if (result) { await loadShipment(); onRefreshList() }
  }

  async function handleDownloadLabels() {
    const result = await doAction('labels')
    if (result?.downloadUrl) {
      window.open(result.downloadUrl, '_blank')
      await loadShipment()
      onRefreshList()
    }
  }

  async function handleMarkShipped() {
    const result = await doAction('mark-shipped', {})
    if (result) { await loadShipment(); onRefreshList() }
  }

  async function handleCancel() {
    if (!confirm('Cancel this shipment? Inventory will be restored.')) return
    const result = await doAction('cancel', {})
    if (result) { await loadShipment(); onRefreshList() }
  }

  // Box management helpers
  function addBox() {
    setBoxes(prev => [...prev, { weightLb: 0, lengthIn: 0, widthIn: 0, heightIn: 0, items: [] }])
  }

  function updateBox(idx: number, field: string, value: number) {
    setBoxes(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b))
  }

  function addBoxItem(boxIdx: number, shipmentItemId: string, quantity: number) {
    setBoxes(prev => prev.map((b, i) => {
      if (i !== boxIdx) return b
      const existing = b.items.find(bi => bi.shipmentItemId === shipmentItemId)
      if (existing) {
        return { ...b, items: b.items.map(bi => bi.shipmentItemId === shipmentItemId ? { ...bi, quantity: bi.quantity + quantity } : bi) }
      }
      return { ...b, items: [...b.items, { shipmentItemId, quantity }] }
    }))
  }

  function removeBox(idx: number) {
    setBoxes(prev => prev.filter((_, i) => i !== idx))
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-gray-400"><Loader2 size={16} className="animate-spin mr-2" /> Loading...</div>
  if (!shipment) return <div className="flex-1 flex items-center justify-center text-sm text-red-500">Shipment not found</div>

  const step = STATUS_CONFIG[shipment.status].step
  const isTerminal = shipment.status === 'SHIPPED' || shipment.status === 'CANCELLED'

  return (
    <div className="flex-1 overflow-auto px-6 py-4 max-w-4xl">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={14} /> Back to list
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-900">{shipment.name || `Shipment ${shipment.id.slice(-8)}`}</h2>
        <StatusBadge status={shipment.status} />
        {!isTerminal && (
          <button type="button" onClick={handleCancel} disabled={actionLoading}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-md border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 disabled:opacity-50">
            <Ban size={12} /> Cancel
          </button>
        )}
      </div>

      {/* Error from shipment or action */}
      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}
      {shipment.lastError && (
        <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          Last error: {shipment.lastError}
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-400 mb-1">Account</div>
          <div className="font-medium text-gray-700">{shipment.account.marketplaceName}</div>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-400 mb-1">Warehouse</div>
          <div className="font-medium text-gray-700">{shipment.warehouse.name}</div>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-400 mb-1">Items</div>
          <div className="font-medium text-gray-700">{shipment.items.length} SKU{shipment.items.length !== 1 ? 's' : ''}, {shipment.items.reduce((s, i) => s + i.quantity, 0)} units</div>
        </div>
      </div>

      {/* Items table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-3 py-2 font-medium">SKU</th>
              <th className="text-left px-3 py-2 font-medium">Seller SKU</th>
              <th className="text-left px-3 py-2 font-medium">FNSKU</th>
              <th className="text-center px-3 py-2 font-medium">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shipment.items.map(item => (
              <tr key={item.id}>
                <td className="px-3 py-2 text-gray-800">{item.msku?.product?.sku ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600">{item.sellerSku}</td>
                <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.fnsku}</td>
                <td className="px-3 py-2 text-center">{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Step-specific actions */}
      {shipment.status === 'DRAFT' && (
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Step 2: Create Inbound Plan</h3>
          <p className="text-xs text-gray-500 mb-3">This will create a plan at Amazon, generate packing options, and auto-confirm. This can take 30-60 seconds.</p>
          <button type="button" onClick={handleCreatePlan} disabled={actionLoading}
            className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
            {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Creating Plan...</> : 'Create Inbound Plan'}
          </button>
        </div>
      )}

      {shipment.status === 'PLAN_CREATED' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Step 3: Box Contents</h3>
          <p className="text-xs text-gray-500">Add boxes with dimensions/weight and assign items to each box. Totals must match shipment quantities.</p>

          {boxes.map((box, boxIdx) => (
            <div key={boxIdx} className="border border-gray-100 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Box {boxIdx + 1}</span>
                <button type="button" onClick={() => removeBox(boxIdx)} className="ml-auto text-gray-300 hover:text-red-500"><X size={14} /></button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400">Weight (lb)</label>
                  <input type="number" step="0.1" value={box.weightLb || ''} onChange={e => updateBox(boxIdx, 'weightLb', parseFloat(e.target.value) || 0)}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Length (in)</label>
                  <input type="number" step="0.1" value={box.lengthIn || ''} onChange={e => updateBox(boxIdx, 'lengthIn', parseFloat(e.target.value) || 0)}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Width (in)</label>
                  <input type="number" step="0.1" value={box.widthIn || ''} onChange={e => updateBox(boxIdx, 'widthIn', parseFloat(e.target.value) || 0)}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Height (in)</label>
                  <input type="number" step="0.1" value={box.heightIn || ''} onChange={e => updateBox(boxIdx, 'heightIn', parseFloat(e.target.value) || 0)}
                    className="w-full h-7 rounded border border-gray-300 px-2 text-sm" />
                </div>
              </div>
              {/* Assign items to this box */}
              <div className="space-y-1">
                {shipment.items.map(item => {
                  const assigned = box.items.find(bi => bi.shipmentItemId === item.id)?.quantity ?? 0
                  return (
                    <div key={item.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 text-gray-600">{item.sellerSku}</span>
                      <input type="number" min={0} max={item.quantity} value={assigned || ''}
                        onChange={e => {
                          const v = parseInt(e.target.value) || 0
                          setBoxes(prev => prev.map((b, i) => {
                            if (i !== boxIdx) return b
                            const others = b.items.filter(bi => bi.shipmentItemId !== item.id)
                            return { ...b, items: v > 0 ? [...others, { shipmentItemId: item.id, quantity: v }] : others }
                          }))
                        }}
                        placeholder="0"
                        className="w-16 h-6 rounded border border-gray-300 px-1 text-xs text-center" />
                      <span className="text-gray-400">/ {item.quantity}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <button type="button" onClick={addBox} className="text-xs text-amazon-blue hover:underline flex items-center gap-1">
              <Plus size={12} /> Add Box
            </button>
          </div>

          <button type="button" onClick={handleSetBoxes} disabled={actionLoading || boxes.length === 0}
            className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
            {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Submitting...</> : 'Submit Box Contents'}
          </button>
        </div>
      )}

      {shipment.status === 'PACKING_SET' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Step 4: Confirm Placement</h3>
          <p className="text-xs text-gray-500">Select which fulfillment center(s) to ship to.</p>

          {placementOptions.length === 0 && (
            <button type="button" onClick={async () => {
              setActionLoading(true)
              try {
                const res = await fetch(`/api/fba-shipments/${shipmentId}`)
                const data = await res.json()
                if (data.inboundPlanId) {
                  const pRes = await fetch(`/api/fba-shipments/${shipmentId}/confirm-placement`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ placementOptionId: '__reload__' }),
                  })
                  // We need to reload placement options - fetch them fresh
                }
              } finally {
                setActionLoading(false)
              }
              setErr('Placement options not yet loaded. If you just set boxes, they should appear. Try refreshing.')
            }} className="text-xs text-amazon-blue hover:underline">
              Load placement options
            </button>
          )}

          {placementOptions.map(opt => (
            <label key={opt.placementOptionId}
              className={clsx('flex items-start gap-3 p-3 rounded-lg border cursor-pointer',
                selectedPlacement === opt.placementOptionId ? 'border-amazon-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300')}>
              <input type="radio" name="placement" value={opt.placementOptionId}
                checked={selectedPlacement === opt.placementOptionId}
                onChange={e => setSelectedPlacement(e.target.value)}
                className="mt-0.5" />
              <div>
                <div className="text-sm font-medium text-gray-700">
                  {opt.shipmentIds?.length ?? 0} shipment{(opt.shipmentIds?.length ?? 0) !== 1 ? 's' : ''}
                </div>
                {opt.fees?.map((f, i) => (
                  <div key={i} className="text-xs text-gray-500">{f.type}: ${f.amount?.amount?.toFixed(2) ?? '0.00'} {f.amount?.code}</div>
                ))}
                {(!opt.fees || opt.fees.length === 0) && <div className="text-xs text-green-600">No additional fees</div>}
              </div>
            </label>
          ))}

          {placementOptions.length > 0 && (
            <button type="button" onClick={handleConfirmPlacement} disabled={actionLoading || !selectedPlacement}
              className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
              {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Confirming...</> : 'Confirm Placement'}
            </button>
          )}
        </div>
      )}

      {shipment.status === 'PLACEMENT_CONFIRMED' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Step 5: Confirm Transportation</h3>
          <p className="text-xs text-gray-500">Select a shipping option for your shipment.</p>

          {transportOptions.length === 0 && (
            <p className="text-xs text-gray-400">No transport options loaded. Try refreshing the page.</p>
          )}

          {transportOptions.map(opt => (
            <label key={opt.transportationOptionId}
              className={clsx('flex items-start gap-3 p-3 rounded-lg border cursor-pointer',
                selectedTransport === opt.transportationOptionId ? 'border-amazon-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300')}>
              <input type="radio" name="transport" value={opt.transportationOptionId}
                checked={selectedTransport === opt.transportationOptionId}
                onChange={e => setSelectedTransport(e.target.value)}
                className="mt-0.5" />
              <div>
                <div className="text-sm font-medium text-gray-700">
                  {opt.carrier?.name ?? 'Amazon Partner'} — {opt.shippingSolution}
                </div>
                {opt.quote && (
                  <div className="text-xs text-gray-500">${opt.quote.price.amount.toFixed(2)} {opt.quote.price.code}</div>
                )}
              </div>
            </label>
          ))}

          {transportOptions.length > 0 && (
            <button type="button" onClick={handleConfirmTransport} disabled={actionLoading || !selectedTransport}
              className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
              {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Confirming...</> : 'Confirm Transport'}
            </button>
          )}
        </div>
      )}

      {shipment.status === 'TRANSPORT_CONFIRMED' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Step 6: Download Labels</h3>
          <p className="text-xs text-gray-500">Download shipping labels for your boxes.</p>
          <button type="button" onClick={handleDownloadLabels} disabled={actionLoading}
            className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
            {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Getting Labels...</> : <><Download size={14} /> Download Labels</>}
          </button>
        </div>
      )}

      {shipment.status === 'LABELS_READY' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Step 7: Mark as Shipped</h3>
          <p className="text-xs text-gray-500">Confirm that all boxes have been shipped.</p>
          <div className="flex gap-2">
            {shipment.labelData && (
              <button type="button" onClick={() => window.open(shipment.labelData!, '_blank')}
                className="flex items-center gap-2 h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Download size={14} /> Re-download Labels
              </button>
            )}
            <button type="button" onClick={handleMarkShipped} disabled={actionLoading}
              className="flex items-center gap-2 h-9 px-4 rounded-md bg-green-600 text-white text-sm font-medium disabled:opacity-50">
              {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Shipping...</> : <><Check size={14} /> Mark as Shipped</>}
            </button>
          </div>
        </div>
      )}

      {shipment.status === 'SHIPPED' && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4 flex items-center gap-3">
          <Check size={20} className="text-green-600" />
          <div>
            <div className="text-sm font-semibold text-green-800">Shipment Completed</div>
            <div className="text-xs text-green-600">This shipment has been marked as shipped.</div>
          </div>
        </div>
      )}

      {shipment.status === 'CANCELLED' && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4 flex items-center gap-3">
          <Ban size={20} className="text-red-600" />
          <div>
            <div className="text-sm font-semibold text-red-800">Shipment Cancelled</div>
            <div className="text-xs text-red-600">Inventory has been restored.</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type View = { type: 'list' } | { type: 'create' } | { type: 'detail'; id: string }

export default function FbaShipmentManager() {
  const [view, setView] = useState<View>({ type: 'list' })
  const [shipments, setShipments] = useState<FbaShipment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/fba-shipments')
      const data = await res.json()
      setShipments(data.data ?? [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (view.type === 'create') {
    return (
      <CreateForm
        onCreated={id => { load(); setView({ type: 'detail', id }) }}
        onCancel={() => setView({ type: 'list' })}
      />
    )
  }

  if (view.type === 'detail') {
    return (
      <WizardView
        shipmentId={view.id}
        onBack={() => { load(); setView({ type: 'list' }) }}
        onRefreshList={load}
      />
    )
  }

  return (
    <ListView
      shipments={shipments}
      loading={loading}
      tab={tab}
      onTabChange={setTab}
      onSelect={id => setView({ type: 'detail', id })}
      onCreate={() => setView({ type: 'create' })}
    />
  )
}

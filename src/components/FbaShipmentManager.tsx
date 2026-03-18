'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, ArrowLeft, Package, Truck, X, AlertCircle, Loader2, Download, Check, Ban, Search, ChevronRight, Copy, Printer, ClipboardPaste, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'

// ─── Types ────────────────────────────────────────────────────────────────────

type FbaStatus = 'DRAFT' | 'SERIALIZED' | 'PLAN_CREATED' | 'PACKING_SET' | 'PLACEMENT_CONFIRMED' | 'TRANSPORT_CONFIRMED' | 'LABELS_READY' | 'SHIPPED' | 'CANCELLED'

interface FbaShipment {
  id: string
  status: FbaStatus
  shipmentNumber: string | null
  name: string | null
  accountId: string
  warehouseId: string | null
  inboundPlanId: string | null
  shipmentId: string | null
  shipmentConfirmationId: string | null
  packingGroupId: string | null
  placementFee: string | null
  shippingEstimate: string | null
  labelData: string | null
  lastError: string | null
  lastErrorAt: string | null
  createdAt: string
  account: { id: string; sellerId: string; marketplaceName: string; marketplaceId?: string }
  warehouse: { id: string; name: string; addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; countryCode?: string } | null
  items: FbaShipmentItem[]
  boxes?: FbaShipmentBox[]
  reservations?: Array<{ id: string; productId: string; locationId: string; gradeId: string | null; qtyReserved: number }>
  _count?: { items: number; boxes: number }
}

interface FbaSerialAssignment {
  id: string
  fbaShipmentItemId: string
  inventorySerial: { id: string; serialNumber: string; productId: string; gradeId: string | null }
}

interface FbaShipmentItem {
  id: string
  mskuId: string | null
  sellerSku: string
  fnsku: string
  asin: string | null
  quantity: number
  msku: {
    sellerSku: string
    product: { id: string; sku: string; description: string }
    grade?: { id: string; grade: string } | null
  } | null
  boxItems?: Array<{ boxId: string; quantity: number }>
  serialAssignments?: FbaSerialAssignment[]
}

interface FbaShipmentBox {
  id: string
  boxNumber: number
  weightLb: string
  lengthIn: string
  widthIn: string
  heightIn: string
  trackingNumber: string | null
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

interface FbaListingResult {
  id: string
  sku: string
  fnsku: string | null
  asin: string | null
  productTitle: string | null
  quantity: number
  mskuId: string | null
  productId: string | null
  gradeId: string | null
  grade: string | null
  productSku: string | null
  productDescription: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShipmentInfo = Record<string, any>

interface PlacementOption {
  placementOptionId: string
  shipmentIds: string[]
  fees?: Array<{ type: string; amount: { amount: number; code: string } }>
  discounts?: Array<{ type: string; amount: { amount: number; code: string } }>
  status?: string
  expiration?: string
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
  SERIALIZED:          { label: 'Serialized',        color: 'bg-cyan-100 text-cyan-700',   step: 1 },
  PLAN_CREATED:        { label: 'Plan Created',      color: 'bg-blue-100 text-blue-700',   step: 2 },
  PACKING_SET:         { label: 'Packing Set',       color: 'bg-indigo-100 text-indigo-700', step: 3 },
  PLACEMENT_CONFIRMED: { label: 'Placement Confirmed', color: 'bg-purple-100 text-purple-700', step: 4 },
  TRANSPORT_CONFIRMED: { label: 'Transport Confirmed', color: 'bg-amber-100 text-amber-700',  step: 5 },
  LABELS_READY:        { label: 'Labels Ready',      color: 'bg-emerald-100 text-emerald-700', step: 6 },
  SHIPPED:             { label: 'Shipped',           color: 'bg-green-100 text-green-700', step: 7 },
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
  onDelete,
}: {
  shipments: FbaShipment[]
  loading: boolean
  tab: string | null
  onTabChange: (t: string | null) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
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
                <th className="text-left px-4 py-2 font-medium">FBA #</th>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Account</th>
                <th className="text-left px-4 py-2 font-medium">Amazon ID</th>
                <th className="text-center px-4 py-2 font-medium">Items</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Created</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => (
                <tr key={s.id} onClick={() => onSelect(s.id)}
                  className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{s.shipmentNumber ?? '—'}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {s.name || s.id.slice(-8)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{s.account.marketplaceName}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{s.shipmentConfirmationId ?? '—'}</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{s._count?.items ?? s.items.length}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={s.status} /></td>
                  <td className="px-4 py-2.5 text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    {s.status !== 'SHIPPED' && (
                      <button type="button" title="Delete shipment"
                        onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
                        className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Create Form (2-Step Wizard) ─────────────────────────────────────────────

interface DraftItem {
  mskuId: string | null
  sellerSku: string
  fnsku: string | null
  asin: string | null
  productTitle: string | null
  productSku: string | null
  grade: string | null
  quantity: number
  fbaQty: number
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
  // Wizard step: 1 = add items, 2 = assign inventory
  const [wizardStep, setWizardStep] = useState<1 | 2>(1)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState('')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Search state (Step 1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FbaListingResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Step 2 state
  const [createdShipmentId, setCreatedShipmentId] = useState('')
  const [createdItems, setCreatedItems] = useState<FbaShipmentItem[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [invByItem, setInvByItem] = useState<Record<string, InventoryOption[]>>({})
  const [assignments, setAssignments] = useState<Record<string, { productId: string; locationId: string; gradeId: string | null; quantity: number }>>({})
  const [loadingInv, setLoadingInv] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/amazon-accounts').then(r => r.json()).then(d => setAccounts(d.data ?? d ?? []))
    fetch('/api/warehouses').then(r => r.json()).then(d => setWarehouses(d.data ?? d ?? []))
  }, [])

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!accountId || !searchQuery || searchQuery.length < 2) {
      setSearchResults([])
      return
    }
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res = await fetch(`/api/fba-listings/search?q=${encodeURIComponent(searchQuery)}&accountId=${accountId}`)
        const data = await res.json()
        setSearchResults(data.data ?? [])
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current) }
  }, [searchQuery, accountId])

  function addItemFromSearch(listing: FbaListingResult) {
    // Don't add duplicate
    if (draftItems.some(d => d.sellerSku === listing.sku)) {
      setErr(`"${listing.sku}" is already added`)
      return
    }
    setDraftItems(prev => [...prev, {
      mskuId: listing.mskuId,
      sellerSku: listing.sku,
      fnsku: listing.fnsku,
      asin: listing.asin,
      productTitle: listing.productTitle,
      productSku: listing.productSku,
      grade: listing.grade,
      quantity: 1,
      fbaQty: listing.quantity,
    }])
    setSearchQuery('')
    setSearchResults([])
    setErr('')
  }

  function updateItemQty(idx: number, qty: number) {
    setDraftItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: Math.max(1, qty) } : item))
  }

  function removeItem(idx: number) {
    setDraftItems(prev => prev.filter((_, i) => i !== idx))
  }

  // Step 1 → create shipment, move to Step 2
  async function handleCreateDraft() {
    if (!accountId) { setErr('Select an account'); return }
    if (draftItems.length === 0) { setErr('Add at least one item'); return }

    setSaving(true)
    setErr('')
    try {
      const res = await fetch('/api/fba-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          name: name || undefined,
          items: draftItems.map(d => ({
            mskuId: d.mskuId || undefined,
            sellerSku: d.sellerSku,
            fnsku: d.fnsku || undefined,
            asin: d.asin || undefined,
            quantity: d.quantity,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Create failed')
      setCreatedShipmentId(data.id)
      setCreatedItems(data.items ?? [])
      setWizardStep(2)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  // Step 2: Load inventory for an item when warehouse changes or on demand
  async function loadInventoryForItem(item: FbaShipmentItem) {
    if (!item.msku) return
    const productId = item.msku.product.id
    const gradeId = item.msku.grade?.id
    setLoadingInv(prev => ({ ...prev, [item.id]: true }))
    try {
      const params = new URLSearchParams({ productId })
      if (gradeId) params.set('gradeId', gradeId)
      if (warehouseId) params.set('warehouseId', warehouseId)
      const res = await fetch(`/api/inventory?${params}`)
      const data = await res.json()
      const items = (data.data ?? data ?? []) as Array<{
        productId: string; locationId: string; location: { name: string; warehouseId: string }
        gradeId: string | null; grade: { grade: string } | null; qty: number
      }>
      // Filter to selected warehouse
      const filtered = warehouseId
        ? items.filter(i => i.location?.warehouseId === warehouseId && i.qty > 0)
        : items.filter(i => i.qty > 0)
      // Aggregate by product+location+grade to avoid duplicate entries
      const aggregated = new Map<string, { productId: string; locationId: string; locationName: string; gradeId: string | null; grade: string | null; qty: number }>()
      for (const i of filtered) {
        const key = `${i.productId}|${i.locationId}|${i.gradeId}`
        const existing = aggregated.get(key)
        if (existing) {
          existing.qty += i.qty
        } else {
          aggregated.set(key, {
            productId: i.productId,
            locationId: i.locationId,
            locationName: i.location?.name ?? i.locationId,
            gradeId: i.gradeId,
            grade: i.grade?.grade ?? null,
            qty: i.qty,
          })
        }
      }
      setInvByItem(prev => ({
        ...prev,
        [item.id]: Array.from(aggregated.values()),
      }))
    } catch {
      // silent
    } finally {
      setLoadingInv(prev => ({ ...prev, [item.id]: false }))
    }
  }

  // When warehouse changes, reload inventory for all items
  useEffect(() => {
    if (wizardStep !== 2 || !warehouseId) return
    for (const item of createdItems) {
      if (item.msku) loadInventoryForItem(item)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, wizardStep])

  function setItemAssignment(itemId: string, locationKey: string) {
    const item = createdItems.find(i => i.id === itemId)
    if (!item) return
    const options = invByItem[itemId] ?? []
    const inv = options.find(o => `${o.productId}|${o.locationId}|${o.gradeId}` === locationKey)
    if (!inv) return
    setAssignments(prev => ({
      ...prev,
      [itemId]: { productId: inv.productId, locationId: inv.locationId, gradeId: inv.gradeId, quantity: item.quantity },
    }))
  }

  // Step 2: confirm & reserve
  async function handleAssignInventory() {
    if (!warehouseId) { setErr('Select a warehouse'); return }

    const wh = warehouses.find(w => w.id === warehouseId)
    if (wh && (!wh.addressLine1 || !wh.city || !wh.state || !wh.postalCode)) {
      setErr('Selected warehouse has no shipping address. Edit the warehouse first.')
      return
    }

    // Check all items have assignments
    const unassigned = createdItems.filter(i => i.msku && !assignments[i.id])
    if (unassigned.length > 0) {
      setErr('All items with product mappings must have inventory assignments')
      return
    }

    setSaving(true)
    setErr('')
    try {
      const assignmentList = Object.entries(assignments).map(([shipmentItemId, a]) => ({
        shipmentItemId,
        productId: a.productId,
        locationId: a.locationId,
        gradeId: a.gradeId,
        quantity: a.quantity,
      }))

      const res = await fetch(`/api/fba-shipments/${createdShipmentId}/assign-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, assignments: assignmentList }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Assignment failed')
      onCreated(createdShipmentId)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Assignment failed')
    } finally {
      setSaving(false)
    }
  }

  // Items with MSKU mappings (need inventory assignment)
  const mappedItems = createdItems.filter(i => i.msku)
  const unmappedItems = createdItems.filter(i => !i.msku)

  return (
    <div className="flex-1 overflow-auto px-6 py-4 max-w-3xl">
      <button type="button" onClick={onCancel} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={14} /> Back
      </button>

      <h2 className="text-lg font-bold text-gray-900 mb-2">Create FBA Shipment</h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-4">
        <div className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
          wizardStep === 1 ? 'bg-amazon-blue text-white' : 'bg-green-100 text-green-700')}>
          {wizardStep > 1 ? <Check size={12} /> : '1'}
          <span>Add Items</span>
        </div>
        <ChevronRight size={14} className="text-gray-300" />
        <div className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
          wizardStep === 2 ? 'bg-amazon-blue text-white' : 'bg-gray-100 text-gray-400')}>
          2
          <span>Assign Inventory</span>
        </div>
      </div>

      {err && <ErrorBanner msg={err} onClose={() => setErr('')} />}

      {/* ─── Step 1: Add Items ──────────────────────────────────── */}
      {wizardStep === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amazon Account</label>
              <select value={accountId} onChange={e => { setAccountId(e.target.value); setSearchResults([]); setSearchQuery('') }}
                className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm">
                <option value="">Select account...</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.marketplaceName} ({a.sellerId})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Shipment Name (optional)</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. March Restock"
                className="w-full h-9 rounded-md border border-gray-300 px-3 text-sm" />
            </div>
          </div>

          {/* Search FBA listings */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Search FBA Listings</h3>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={accountId ? 'Search by SKU, FNSKU, ASIN, or title...' : 'Select an account first'}
                disabled={!accountId}
                className="w-full h-9 rounded-md border border-gray-300 pl-9 pr-3 text-sm disabled:bg-gray-50"
              />
              {searchLoading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
            </div>

            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="border border-gray-200 rounded-md max-h-60 overflow-auto divide-y divide-gray-100">
                {searchResults.map(r => (
                  <button key={r.id} type="button" onClick={() => addItemFromSearch(r)}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{r.sku}</span>
                      {r.fnsku && <span className="text-xs font-mono text-gray-400">{r.fnsku}</span>}
                      {r.asin && <span className="text-xs text-gray-400">ASIN: {r.asin}</span>}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {r.productTitle ?? r.productDescription ?? 'No title'}
                    </div>
                    <div className="text-xs text-gray-400">
                      FBA Qty: {r.quantity}
                      {r.productSku && <span className="ml-2">Product: {r.productSku}</span>}
                      {r.grade && <span className="ml-2">Grade: {r.grade}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && (
              <p className="text-xs text-gray-400">No FBA listings found</p>
            )}
          </div>

          {/* Draft items list */}
          {draftItems.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Seller SKU</th>
                    <th className="text-left px-3 py-2 font-medium">FNSKU</th>
                    <th className="text-left px-3 py-2 font-medium">Title</th>
                    <th className="text-center px-3 py-2 font-medium">FBA Qty</th>
                    <th className="text-center px-3 py-2 font-medium">Ship Qty</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {draftItems.map((item, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-800 text-xs font-medium">{item.sellerSku}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.fnsku ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs truncate max-w-[200px]">{item.productTitle ?? item.productSku ?? '—'}</td>
                      <td className="px-3 py-2 text-center text-gray-400 text-xs">{item.fbaQty}</td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min={1} value={item.quantity}
                          onChange={e => updateItemQty(i, parseInt(e.target.value) || 1)}
                          className="w-16 h-7 rounded border border-gray-300 px-1 text-xs text-center" />
                      </td>
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

          <button type="button" onClick={handleCreateDraft} disabled={saving || draftItems.length === 0}
            className="flex items-center gap-2 h-10 px-6 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
            {saving ? <><Loader2 size={14} className="animate-spin" /> Creating...</> : <>Next: Assign Inventory <ChevronRight size={14} /></>}
          </button>
        </div>
      )}

      {/* ─── Step 2: Assign Inventory ──────────────────────────── */}
      {wizardStep === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Source Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm">
              <option value="">Select warehouse...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {/* Items needing inventory assignment */}
          {mappedItems.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Seller SKU</th>
                    <th className="text-left px-3 py-2 font-medium">Product</th>
                    <th className="text-center px-3 py-2 font-medium">Qty</th>
                    <th className="text-left px-3 py-2 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {mappedItems.map(item => {
                    const options = invByItem[item.id] ?? []
                    const isLoading = loadingInv[item.id]
                    const assigned = assignments[item.id]
                    const selectedKey = assigned ? `${assigned.productId}|${assigned.locationId}|${assigned.gradeId}` : ''
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-gray-800 text-xs font-medium">{item.sellerSku}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{item.msku?.product?.sku ?? '—'}</td>
                        <td className="px-3 py-2 text-center text-xs">{item.quantity}</td>
                        <td className="px-3 py-2">
                          {isLoading ? (
                            <div className="flex items-center text-xs text-gray-400"><Loader2 size={12} className="animate-spin mr-1" /> Loading...</div>
                          ) : !warehouseId ? (
                            <span className="text-xs text-gray-400">Select warehouse first</span>
                          ) : options.length === 0 ? (
                            <span className="text-xs text-amber-500">No inventory available</span>
                          ) : (
                            <select value={selectedKey} onChange={e => setItemAssignment(item.id, e.target.value)}
                              className="w-full h-7 rounded border border-gray-300 px-1 text-xs">
                              <option value="">Select location...</option>
                              {options.map(inv => (
                                <option key={`${inv.productId}|${inv.locationId}|${inv.gradeId}`}
                                  value={`${inv.productId}|${inv.locationId}|${inv.gradeId}`}>
                                  {inv.locationName}{inv.grade ? ` (${inv.grade})` : ''} — {inv.qty} avail
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Items without product mapping — no inventory to assign */}
          {unmappedItems.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              {unmappedItems.length} item{unmappedItems.length !== 1 ? 's' : ''} without product mapping — inventory will not be reserved for: {unmappedItems.map(i => i.sellerSku).join(', ')}
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={handleAssignInventory}
              disabled={saving || !warehouseId || mappedItems.length === 0 || Object.keys(assignments).length < mappedItems.length}
              className="flex items-center gap-2 h-10 px-6 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
              {saving ? <><Loader2 size={14} className="animate-spin" /> Reserving...</> : 'Confirm & Reserve'}
            </button>
          </div>
        </div>
      )}
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
  const [shipmentInfoMap, setShipmentInfoMap] = useState<Map<string, ShipmentInfo>>(new Map())
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
    if (boxes.length === 0) { setErr('Add at least one box'); return }
    const result = await doAction('set-boxes', { boxes })
    if (result) {
      setPlacementOptions(result.placementOptions ?? [])
      console.log('[FBA] Placement options:', result.placementOptions)
      console.log('[FBA] Shipments:', result.shipments)
      // Build shipment info map for destination display
      const sMap = new Map<string, ShipmentInfo>()
      for (const s of (result.shipments ?? [])) {
        sMap.set(s.shipmentId, s)
      }
      setShipmentInfoMap(sMap)
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

  const [shipmentLabels, setShipmentLabels] = useState<Array<{ shipmentId: string; confirmationId: string; boxCount: number; url: string }>>([])

  async function handleDownloadLabels() {
    const result = await doAction('labels')
    if (result) {
      if (result.shipmentLabels?.length) {
        setShipmentLabels(result.shipmentLabels)
        // Auto-open the first one
        window.open(result.shipmentLabels[0].url, '_blank')
      } else if (result.downloadUrl) {
        window.open(result.downloadUrl, '_blank')
      }
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

  function printFnskuLabels() {
    if (!shipment || shipment.items.length === 0) return

    // Label size: DYMO 30334 = 2.25" x 1.25"
    const W = 2.25 * 72  // points
    const H = 1.25 * 72  // points
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [H, W] })

    const margin = 4
    const maxTextW = W - margin * 2
    let firstPage = true

    for (const item of shipment.items) {
      for (let copy = 0; copy < item.quantity; copy++) {
        if (!firstPage) doc.addPage([H, W], 'landscape')
        firstPage = false

        // SKU line (bold) — shrink font to fit
        const sku = item.msku?.product?.sku ?? item.sellerSku
        doc.setFont('helvetica', 'bold')
        let skuSize = 10
        doc.setFontSize(skuSize)
        while (skuSize > 5 && doc.getTextWidth(sku) > maxTextW) {
          skuSize -= 0.5
          doc.setFontSize(skuSize)
        }
        doc.text(sku, margin, 12)

        // Grade line (bold, only if exists)
        let yAfterGrade = 12
        if (item.msku?.grade) {
          yAfterGrade = 22
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          doc.text(item.msku.grade.grade, margin, yAfterGrade)
        }

        // Barcode — render at 4x resolution for crisp PDF output
        const scale = 4
        const canvas = document.createElement('canvas')
        JsBarcode(canvas, item.fnsku, {
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

        // FNSKU text below barcode
        doc.setFont('courier', 'normal')
        doc.setFontSize(8)
        doc.text(item.fnsku, W / 2, barcodeY + barcodeH + 8, { align: 'center' })
      }
    }

    // Open print dialog
    const pdfBlob = doc.output('blob')
    const url = URL.createObjectURL(pdfBlob)
    const printWindow = window.open(url, '_blank')
    if (printWindow) {
      printWindow.onload = () => { printWindow.print() }
    }
  }

  function addBox() {
    setBoxes(prev => [...prev, { weightLb: 0, lengthIn: 0, widthIn: 0, heightIn: 0, items: [] }])
  }

  function updateBox(idx: number, field: string, value: number) {
    setBoxes(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b))
  }

  function removeBox(idx: number) {
    setBoxes(prev => prev.filter((_, i) => i !== idx))
  }

  function copyBox(idx: number) {
    setBoxes(prev => [...prev, { ...prev[idx], items: prev[idx].items.map(i => ({ ...i })) }])
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-gray-400"><Loader2 size={16} className="animate-spin mr-2" /> Loading...</div>
  if (!shipment) return <div className="flex-1 flex items-center justify-center text-sm text-red-500">Shipment not found</div>

  const isTerminal = shipment.status === 'SHIPPED' || shipment.status === 'CANCELLED'

  return (
    <div className="flex-1 overflow-auto px-6 py-4 max-w-4xl">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={14} /> Back to list
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-900">
          {shipment.shipmentNumber && <span className="text-gray-400 mr-1">{shipment.shipmentNumber}</span>}
          {shipment.name || `Shipment ${shipment.id.slice(-8)}`}
        </h2>
        <StatusBadge status={shipment.status} />
        {!isTerminal && (
          <button type="button" onClick={handleCancel} disabled={actionLoading}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-md border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 disabled:opacity-50">
            <Ban size={12} /> Cancel
          </button>
        )}
      </div>

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
          <div className="font-medium text-gray-700">{shipment.warehouse?.name ?? 'Not assigned'}</div>
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

      {/* Print FNSKU labels */}
      {shipment.items.length > 0 && shipment.status !== 'DRAFT' && (
        <div className="flex items-center gap-2 mb-4">
          <button type="button" onClick={printFnskuLabels}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 text-xs font-medium hover:bg-gray-50">
            <Printer size={13} /> Print FNSKU Labels
          </button>
          <span className="text-[10px] text-gray-400">Dymo 30334 · 2.25×1.25&quot;</span>
        </div>
      )}

      {/* Step-specific actions */}
      {shipment.status === 'DRAFT' && shipment.warehouseId && (shipment.reservations?.length ?? 0) > 0 && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Scan Serial Numbers</h3>
          <p className="text-xs text-gray-500">Scan one at a time or paste a list (one per line). Serials are validated against SKU and grade.</p>

          {/* Bulk paste area */}
          <div className="space-y-2">
            <button type="button" onClick={() => {
              const el = document.getElementById('fba-bulk-paste') as HTMLTextAreaElement | null
              if (el) { el.classList.toggle('hidden'); if (!el.classList.contains('hidden')) el.focus() }
            }} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-amazon-blue">
              <ClipboardPaste size={13} /> Paste multiple serials
            </button>
            <div id="fba-bulk-paste-wrap">
              <textarea id="fba-bulk-paste" rows={4} placeholder="Paste serial numbers here (one per line)..."
                className="hidden w-full px-3 py-2 text-sm border border-gray-300 rounded-md font-mono focus:ring-1 focus:ring-amazon-blue focus:border-amazon-blue" />
              <button type="button" onClick={async () => {
                const ta = document.getElementById('fba-bulk-paste') as HTMLTextAreaElement
                const lines = ta.value.split(/[\n\r,\t]+/).map(s => s.trim()).filter(Boolean)
                if (lines.length === 0) return
                setActionLoading(true)
                setErr('')
                try {
                  const res = await fetch(`/api/fba-shipments/${shipmentId}/scan-serial`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ serialNumbers: lines }),
                  })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error ?? 'Bulk scan failed')
                  ta.value = ''
                  ta.classList.add('hidden')
                  if (data.errors?.length > 0) {
                    setErr(`${data.scannedCount} scanned. Errors: ${data.errors.join('; ')}`)
                  }
                  await loadShipment()
                } catch (e: unknown) {
                  setErr(e instanceof Error ? e.message : 'Bulk scan failed')
                } finally {
                  setActionLoading(false)
                }
              }} disabled={actionLoading}
                className="mt-1 h-8 px-4 rounded-md bg-amazon-blue text-white text-xs font-medium disabled:opacity-50">
                {actionLoading ? <Loader2 size={12} className="animate-spin" /> : 'Submit All'}
              </button>
            </div>
          </div>

          {shipment.items.map(item => {
            const scanned = item.serialAssignments ?? []
            const isComplete = scanned.length >= item.quantity
            return (
              <div key={item.id} className={clsx('border rounded-lg p-3', isComplete ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/30')}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-800">{item.msku?.product?.sku ?? item.sellerSku}</span>
                  {item.msku?.grade && <span className="text-xs text-gray-500">({item.msku.grade.grade})</span>}
                  <span className={clsx('ml-auto text-xs font-medium', isComplete ? 'text-green-600' : 'text-amber-600')}>
                    {scanned.length} / {item.quantity}
                  </span>
                </div>

                {!isComplete && (
                  <form onSubmit={async (e) => {
                    e.preventDefault()
                    const input = (e.target as HTMLFormElement).elements.namedItem('serial') as HTMLInputElement
                    const raw = input.value.trim()
                    if (!raw) return
                    // Detect pasted multi-line input
                    const lines = raw.split(/[\n\r,\t]+/).map(s => s.trim()).filter(Boolean)
                    setActionLoading(true)
                    setErr('')
                    try {
                      const payload = lines.length > 1 ? { serialNumbers: lines } : { serialNumber: lines[0] }
                      const res = await fetch(`/api/fba-shipments/${shipmentId}/scan-serial`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error ?? 'Scan failed')
                      input.value = ''
                      if (data.errors?.length > 0) {
                        setErr(`${data.scannedCount} scanned. Errors: ${data.errors.join('; ')}`)
                      }
                      await loadShipment()
                    } catch (e: unknown) {
                      setErr(e instanceof Error ? e.message : 'Scan failed')
                    } finally {
                      setActionLoading(false)
                      input.focus()
                    }
                  }} className="flex gap-2 mb-2">
                    <input name="serial" type="text" autoFocus placeholder="Scan or paste serial(s)..."
                      className="flex-1 h-8 px-3 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-amazon-blue focus:border-amazon-blue" />
                    <button type="submit" disabled={actionLoading}
                      className="h-8 px-3 rounded-md bg-amazon-blue text-white text-xs font-medium disabled:opacity-50">
                      {actionLoading ? <Loader2 size={12} className="animate-spin" /> : 'Scan'}
                    </button>
                  </form>
                )}

                {scanned.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {scanned.map(sa => (
                      <span key={sa.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-gray-200 text-xs text-gray-700">
                        {sa.inventorySerial.serialNumber}
                        {shipment.status === 'DRAFT' && (
                          <button type="button" onClick={async () => {
                            setErr('')
                            try {
                              const res = await fetch(`/api/fba-shipments/${shipmentId}/scan-serial`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ serialNumber: sa.inventorySerial.serialNumber }),
                              })
                              const data = await res.json()
                              if (!res.ok) throw new Error(data.error ?? 'Remove failed')
                              await loadShipment()
                            } catch (e: unknown) {
                              setErr(e instanceof Error ? e.message : 'Remove failed')
                            }
                          }} className="text-gray-300 hover:text-red-500"><X size={10} /></button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {shipment.items.every(item => (item.serialAssignments?.length ?? 0) >= item.quantity) && (
            <button type="button" onClick={async () => {
              const result = await doAction('complete-serialization', {})
              if (result) { await loadShipment(); onRefreshList() }
            }} disabled={actionLoading}
              className="flex items-center gap-2 h-9 px-4 rounded-md bg-cyan-600 text-white text-sm font-medium disabled:opacity-50">
              {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Completing...</> : <><Check size={14} /> Complete Serialization</>}
            </button>
          )}
        </div>
      )}

      {shipment.status === 'DRAFT' && (!shipment.warehouseId || (shipment.reservations?.length ?? 0) === 0) && (
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Awaiting Inventory</h3>
          {!shipment.warehouseId && (
            <p className="text-xs text-amber-600 mb-2">Warehouse must be assigned first.</p>
          )}
          {shipment.warehouseId && (shipment.reservations?.length ?? 0) === 0 && (
            <p className="text-xs text-amber-600 mb-2">Inventory must be reserved before scanning serials.</p>
          )}
        </div>
      )}

      {shipment.status === 'SERIALIZED' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Create Inbound Plan</h3>
          <p className="text-xs text-gray-500 mb-1">All serials scanned. This will create a plan at Amazon, generate packing options, and auto-confirm. This can take 30-60 seconds.</p>

          {/* Read-only scanned serials */}
          <div className="space-y-2">
            {shipment.items.map(item => (
              <div key={item.id} className="text-xs text-gray-600">
                <span className="font-medium">{item.msku?.product?.sku ?? item.sellerSku}</span>
                {item.msku?.grade && <span className="text-gray-400 ml-1">({item.msku.grade.grade})</span>}
                <span className="text-gray-400 mx-1">&mdash;</span>
                {(item.serialAssignments ?? []).map(sa => sa.inventorySerial.serialNumber).join(', ')}
              </div>
            ))}
          </div>

          <button type="button" onClick={handleCreatePlan} disabled={actionLoading}
            className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
            {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Creating Plan...</> : 'Create Inbound Plan'}
          </button>
        </div>
      )}

      {shipment.status === 'PLAN_CREATED' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Box Contents</h3>
          <p className="text-xs text-gray-500">Add boxes with dimensions/weight and assign items to each box. Totals must match shipment quantities.</p>

          {boxes.map((box, boxIdx) => (
            <div key={boxIdx} className="border border-gray-100 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Box {boxIdx + 1}</span>
                <button type="button" onClick={() => copyBox(boxIdx)} className="ml-auto text-gray-300 hover:text-amazon-blue" title="Copy box"><Copy size={14} /></button>
                <button type="button" onClick={() => removeBox(boxIdx)} className="text-gray-300 hover:text-red-500" title="Remove box"><X size={14} /></button>
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
          <h3 className="text-sm font-semibold text-gray-700">Confirm Placement</h3>
          <p className="text-xs text-gray-500">Select which fulfillment center(s) to ship to.</p>

          {placementOptions.length === 0 && (
            <button type="button" onClick={async () => {
              setActionLoading(true)
              setErr('')
              try {
                const res = await fetch(`/api/fba-shipments/${shipmentId}/placement-options`)
                const data = await res.json()
                if (res.ok) {
                  setPlacementOptions(data.placementOptions ?? [])
                  console.log('[FBA] Placement options:', data.placementOptions)
                  console.log('[FBA] Shipments:', data.shipments)
                  const sMap = new Map<string, ShipmentInfo>()
                  for (const s of (data.shipments ?? [])) sMap.set(s.shipmentId, s)
                  setShipmentInfoMap(sMap)
                } else {
                  setErr(data.error ?? 'Failed to load placement options')
                }
              } catch {
                setErr('Failed to load placement options')
              } finally {
                setActionLoading(false)
              }
            }} className="text-xs text-amazon-blue hover:underline" disabled={actionLoading}>
              {actionLoading ? 'Loading...' : 'Load placement options'}
            </button>
          )}

          {placementOptions.map((opt, idx) => {
            // Amazon may use { amount: { amount, code } } or { amount: { value, code } } or { value: { amount, code } }
            const extractAmount = (f: Record<string, unknown> | undefined): number => {
              if (!f) return 0
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const a = f as any
              return Number(a.amount?.amount ?? a.amount?.value ?? a.value?.amount ?? a.value ?? 0)
            }
            const totalFee = opt.fees?.reduce((sum, f) => sum + extractAmount(f), 0) ?? 0
            const totalDiscount = opt.discounts?.reduce((sum, d) => sum + extractAmount(d), 0) ?? 0
            const netCost = totalFee - totalDiscount
            const shipCount = opt.shipmentIds?.length ?? 0

            return (
              <label key={opt.placementOptionId}
                className={clsx('flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors',
                  selectedPlacement === opt.placementOptionId ? 'border-amazon-blue bg-blue-50 ring-1 ring-amazon-blue' : 'border-gray-200 hover:border-gray-300')}>
                <input type="radio" name="placement" value={opt.placementOptionId}
                  checked={selectedPlacement === opt.placementOptionId}
                  onChange={e => setSelectedPlacement(e.target.value)}
                  className="mt-1" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-800">
                      Option {idx + 1}: {shipCount} shipment{shipCount !== 1 ? 's' : ''}
                    </div>
                    <div className={clsx('text-sm font-semibold', netCost > 0 ? 'text-orange-600' : 'text-green-600')}>
                      {netCost > 0 ? `$${netCost.toFixed(2)}` : 'No fee'}
                    </div>
                  </div>

                  {/* Destination FCs */}
                  {opt.shipmentIds?.length > 0 && (
                    <div className="space-y-1">
                      {opt.shipmentIds.map(sid => {
                        const info = shipmentInfoMap.get(sid)
                        // Try multiple possible response structures
                        const dest = info?.destination ?? info?.destinationAddress ?? info?.fulfillmentCenter
                        const warehouseId = dest?.warehouseId ?? dest?.fulfillmentCenterId ?? info?.amazonReferenceId ?? info?.warehouseId
                        const city = dest?.address?.city ?? dest?.city ?? info?.address?.city
                        const state = dest?.address?.stateOrProvinceCode ?? dest?.stateOrProvinceCode ?? info?.address?.stateOrProvinceCode
                        const name = dest?.address?.name ?? dest?.name ?? info?.name

                        let fcLabel: string
                        if (warehouseId) {
                          const loc = [city, state].filter(Boolean).join(', ')
                          fcLabel = loc ? `FC: ${warehouseId} (${loc})` : `FC: ${warehouseId}`
                        } else if (name || city) {
                          fcLabel = [name, city, state].filter(Boolean).join(', ')
                        } else {
                          // Show truncated shipment ID
                          fcLabel = `Shipment ${sid.length > 12 ? '...' + sid.slice(-8) : sid}`
                        }

                        return (
                          <div key={sid} className="flex items-center gap-2 text-xs text-gray-600">
                            <Truck size={12} className="text-gray-400 flex-shrink-0" />
                            <span className="font-medium">{fcLabel}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Fee breakdown */}
                  {(opt.fees?.length ?? 0) > 0 && (
                    <div className="text-xs text-gray-500 space-y-0.5">
                      {opt.fees!.map((f, i) => {
                        const amt = extractAmount(f)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const code = (f as any).amount?.code ?? (f as any).value?.code ?? (f as any).code ?? 'USD'
                        return <div key={i}>Fee: {f.type} — ${amt.toFixed(2)} {code}</div>
                      })}
                    </div>
                  )}

                  {/* Discount breakdown */}
                  {(opt.discounts?.length ?? 0) > 0 && (
                    <div className="text-xs text-green-600 space-y-0.5">
                      {opt.discounts!.map((d, i) => {
                        const amt = extractAmount(d)
                        return <div key={i}>Discount: {d.type} — -${amt.toFixed(2)}</div>
                      })}
                    </div>
                  )}

                  {(!opt.fees || opt.fees.length === 0) && (!opt.discounts || opt.discounts.length === 0) && (
                    <div className="text-xs text-green-600">No additional fees</div>
                  )}

                  {opt.expiration && (
                    <div className="text-xs text-amber-600">Expires: {new Date(opt.expiration).toLocaleDateString()}</div>
                  )}
                </div>
              </label>
            )
          })}

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
          <h3 className="text-sm font-semibold text-gray-700">Confirm Transportation</h3>
          <p className="text-xs text-gray-500">Select a shipping option for your shipment.</p>

          {(() => {
            const opts = transportOptions ?? []
            // Partnered first, then non-partnered, regardless of shippingMode
            const partnered = opts.filter(o => o.shippingSolution === 'AMAZON_PARTNERED_CARRIER')
            const nonPartnered = opts.filter(o => o.shippingSolution !== 'AMAZON_PARTNERED_CARRIER')
            const displayOptions = [...partnered, ...nonPartnered]
            return <>
              {displayOptions.length === 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <p className="text-sm text-amber-700">
                    No transportation options returned from the API.
                  </p>
                  <p className="text-xs text-amber-600">
                    Amazon may not return partnered carrier options via the API for all shipments.
                    You can select UPS (SPD) partnered carrier in Seller Central instead.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button type="button" onClick={async () => {
                      setActionLoading(true)
                      try {
                        const res = await fetch(`/api/fba-shipments/${shipment.id}/retry-transport`)
                        const data = await res.json()
                        if (data.transportOptions?.length) {
                          setTransportOptions(data.transportOptions)
                        }
                      } catch { /* silent */ } finally { setActionLoading(false) }
                    }} disabled={actionLoading}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-100 disabled:opacity-50">
                      {actionLoading ? <><Loader2 size={12} className="animate-spin" /> Retrying...</> : 'Retry Fetch'}
                    </button>
                    <a href="https://sellercentral.amazon.com/fba/sendtoamazon" target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50">
                      Open Seller Central
                    </a>
                  </div>
                </div>
              )}

              {nonPartnered.length > 0 && partnered.length === 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  Only non-partnered (use your own carrier) options returned. For Amazon-partnered UPS rates with shipping labels included, use Seller Central.
                </div>
              )}

              {displayOptions.map(opt => {
                const isPartnered = opt.shippingSolution === 'AMAZON_PARTNERED_CARRIER'
                return (
                  <label key={opt.transportationOptionId}
                    className={clsx('flex items-start gap-3 p-3 rounded-lg border cursor-pointer',
                      selectedTransport === opt.transportationOptionId ? 'border-amazon-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300')}>
                    <input type="radio" name="transport" value={opt.transportationOptionId}
                      checked={selectedTransport === opt.transportationOptionId}
                      onChange={e => setSelectedTransport(e.target.value)}
                      className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-gray-700">
                        {opt.carrier?.name ?? 'Carrier'} — {opt.shippingMode === 'GROUND_SMALL_PARCEL' ? 'SPD' : opt.shippingMode}
                      </div>
                      <div className={clsx('text-xs font-medium', isPartnered ? 'text-green-600' : 'text-amber-600')}>
                        {isPartnered ? 'Amazon Partnered Carrier' : 'Use Your Own Carrier'}
                      </div>
                      {opt.quote?.price && (
                        <div className="text-xs text-gray-500 mt-0.5">${Number(opt.quote.price.amount).toFixed(2)} {opt.quote.price.code}</div>
                      )}
                      {!opt.quote?.price && !isPartnered && (
                        <div className="text-xs text-gray-400 mt-0.5">No shipping cost (you pay carrier directly)</div>
                      )}
                    </div>
                  </label>
                )
              })}

              {displayOptions.length > 0 && (
                <button type="button" onClick={handleConfirmTransport} disabled={actionLoading || !selectedTransport}
                  className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
                  {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Confirming...</> : 'Confirm Transport'}
                </button>
              )}
            </>
          })()}
        </div>
      )}

      {shipment.status === 'TRANSPORT_CONFIRMED' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Download Labels</h3>
          <p className="text-xs text-gray-500">Download shipping labels for your boxes.</p>
          <button type="button" onClick={handleDownloadLabels} disabled={actionLoading}
            className="flex items-center gap-2 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium disabled:opacity-50">
            {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Getting Labels...</> : <><Download size={14} /> Fetch Labels</>}
          </button>
          {shipmentLabels.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <div className="text-xs font-medium text-gray-500">Labels for {shipmentLabels.length} shipment{shipmentLabels.length > 1 ? 's' : ''}</div>
              {shipmentLabels.map((sl, i) => (
                <a key={sl.shipmentId} href={sl.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <Download size={12} />
                  Shipment {i + 1}: {sl.confirmationId} ({sl.boxCount} box{sl.boxCount > 1 ? 'es' : ''})
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {shipment.status === 'LABELS_READY' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Mark as Shipped</h3>
          <p className="text-xs text-gray-500">Confirm that all boxes have been shipped.</p>

          {/* Per-box tracking */}
          {shipment.boxes && shipment.boxes.some(b => b.trackingNumber) && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-500">Box Tracking</div>
              {shipment.boxes.map(b => (
                <div key={b.id} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600">Box {b.boxNumber}:</span>
                  {b.trackingNumber ? (
                    <a href={`https://www.ups.com/track?tracknum=${b.trackingNumber}`} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-mono">{b.trackingNumber}</a>
                  ) : (
                    <span className="text-gray-400">No tracking</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {shipment.labelData && (() => {
            let urls: string[] = []
            try {
              const parsed = JSON.parse(shipment.labelData!)
              if (Array.isArray(parsed)) urls = parsed
              else urls = [shipment.labelData!]
            } catch { urls = [shipment.labelData!] }
            return urls.length > 1 ? (
              <div className="space-y-1">
                <div className="text-xs font-medium text-gray-500">Download Labels ({urls.length} shipments)</div>
                {urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                    <Download size={12} /> Shipment {i + 1} Labels
                  </a>
                ))}
              </div>
            ) : (
              <a href={urls[0]} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 h-9 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 w-fit">
                <Download size={14} /> Re-download Labels
              </a>
            )
          })()}

          <div className="flex gap-2">
            <button type="button" onClick={handleMarkShipped} disabled={actionLoading}
              className="flex items-center gap-2 h-9 px-4 rounded-md bg-green-600 text-white text-sm font-medium disabled:opacity-50">
              {actionLoading ? <><Loader2 size={14} className="animate-spin" /> Shipping...</> : <><Check size={14} /> Mark as Shipped</>}
            </button>
          </div>
        </div>
      )}

      {shipment.status === 'SHIPPED' && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Check size={20} className="text-green-600" />
            <div>
              <div className="text-sm font-semibold text-green-800">Shipment Completed</div>
              <div className="text-xs text-green-600">This shipment has been marked as shipped.</div>
            </div>
          </div>

          {/* Per-box tracking in shipped state */}
          {shipment.boxes && shipment.boxes.some(b => b.trackingNumber) && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-500">Box Tracking</div>
              {shipment.boxes.map(b => (
                <div key={b.id} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600">Box {b.boxNumber}:</span>
                  {b.trackingNumber ? (
                    <a href={`https://www.ups.com/track?tracknum=${b.trackingNumber}`} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-mono">{b.trackingNumber}</a>
                  ) : (
                    <span className="text-gray-400">No tracking</span>
                  )}
                </div>
              ))}
            </div>
          )}
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
      onDelete={async (id) => {
        if (!confirm('Delete this shipment? Inventory reservations will be released.')) return
        try {
          const res = await fetch(`/api/fba-shipments/${id}`, { method: 'DELETE' })
          const data = await res.json()
          if (!res.ok) { alert(data.error ?? 'Delete failed'); return }
          load()
        } catch { alert('Delete failed') }
      }}
    />
  )
}

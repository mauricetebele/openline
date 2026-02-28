'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, X, ChevronDown, ChevronUp, AlertCircle, Search } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

type RMAStatus = 'PENDING' | 'RECEIVED' | 'INSPECTED' | 'REFUNDED' | 'REJECTED'

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
  reason: string
  notes: string | null
  creditAmount: string | null
  createdAt: string
  customer: { id: string; companyName: string }
  items: RMAItem[]
}

interface Customer { id: string; companyName: string }
interface Product  { id: string; sku: string; description: string }

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
  PENDING:   'RECEIVED',
  RECEIVED:  'INSPECTED',
  INSPECTED: 'REFUNDED',
  REFUNDED:  null,
  REJECTED:  null,
}
const NEXT_LABEL: Record<RMAStatus, string> = {
  PENDING:   'Mark Received',
  RECEIVED:  'Mark Inspected',
  INSPECTED: 'Mark Refunded',
  REFUNDED:  '',
  REJECTED:  '',
}
const REASONS = [
  'Defective / Not Working',
  'Wrong Item Sent',
  'Item Not as Described',
  'Damaged in Transit',
  'Customer No Longer Needs',
  'Duplicate Order',
  'Other',
]
const CONDITIONS = ['Like New', 'Good', 'Fair', 'Poor', 'Defective']
const ALL_STATUSES = Object.keys(STATUS_LABEL) as RMAStatus[]

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

// ─── Create Panel ─────────────────────────────────────────────────────────────

interface DraftItem { productId: string; quantity: number; unitPrice: string; condition: string; notes: string }

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products,  setProducts]  = useState<Product[]>([])
  const [custSearch, setCustSearch] = useState('')
  const [prodSearch, setProdSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [customerId, setCustomerId] = useState('')
  const [reason, setReason]         = useState('')
  const [notes,  setNotes]          = useState('')
  const [items,  setItems]          = useState<DraftItem[]>([
    { productId: '', quantity: 1, unitPrice: '', condition: '', notes: '' },
  ])

  useEffect(() => {
    fetch('/api/wholesale/customers')
      .then(r => r.json()).then(d => setCustomers(d.data ?? []))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      const url = prodSearch.trim()
        ? `/api/products?search=${encodeURIComponent(prodSearch.trim())}`
        : '/api/products'
      fetch(url).then(r => r.json()).then(d => setProducts(d.data ?? []))
    }, 200)
    return () => clearTimeout(t)
  }, [prodSearch])

  const filteredCusts = customers.filter(c =>
    c.companyName.toLowerCase().includes(custSearch.toLowerCase()),
  )

  function setItem(i: number, field: keyof DraftItem, value: string | number) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it))
  }

  function addItem() {
    setItems(prev => [...prev, { productId: '', quantity: 1, unitPrice: '', condition: '', notes: '' }])
  }

  function removeItem(i: number) {
    setItems(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    setErr('')
    if (!customerId) { setErr('Select a customer'); return }
    if (!reason.trim()) { setErr('Reason is required'); return }
    for (const it of items) {
      if (!it.productId) { setErr('All items must have a product selected'); return }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/wholesale/customer-rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          reason: reason.trim(),
          notes: notes.trim() || null,
          items: items.map(it => ({
            productId: it.productId,
            quantity:  Number(it.quantity),
            unitPrice: it.unitPrice ? Number(it.unitPrice) : null,
            condition: it.condition || null,
            notes:     it.notes.trim() || null,
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
      <div className="w-[540px] bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">New Customer RMA</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {err && <ErrBanner msg={err} onClose={() => setErr('')} />}

          {/* Customer */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Customer <span className="text-red-500">*</span></label>
            <div className="relative mb-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={custSearch}
                onChange={e => setCustSearch(e.target.value)}
                placeholder="Search customers…"
                className="w-full h-8 rounded-md border border-gray-300 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              />
            </div>
            <select
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue"
            >
              <option value="">Select customer…</option>
              {filteredCusts.map(c => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Return Reason <span className="text-red-500">*</span></label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue"
            >
              <option value="">Select reason…</option>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Items <span className="text-red-500">*</span></label>
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-amazon-blue hover:underline">
                <Plus size={12} /> Add Item
              </button>
            </div>

            {/* Product search */}
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={prodSearch}
                onChange={e => setProdSearch(e.target.value)}
                placeholder="Search products…"
                className="w-full h-8 rounded-md border border-gray-300 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
              />
            </div>

            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">Item {i + 1}</span>
                    {items.length > 1 && (
                      <button onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500">
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  <select
                    value={it.productId}
                    onChange={e => setItem(i, 'productId', e.target.value)}
                    className="w-full h-8 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                  >
                    <option value="">Select product…</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.sku} — {p.description}</option>
                    ))}
                  </select>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Qty</label>
                      <input
                        type="number" min={1}
                        value={it.quantity}
                        onChange={e => setItem(i, 'quantity', e.target.value)}
                        className="w-full h-7 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Unit Price ($)</label>
                      <input
                        type="number" min={0} step="0.01" placeholder="0.00"
                        value={it.unitPrice}
                        onChange={e => setItem(i, 'unitPrice', e.target.value)}
                        className="w-full h-7 rounded border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Condition</label>
                      <select
                        value={it.condition}
                        onChange={e => setItem(i, 'condition', e.target.value)}
                        className="w-full h-7 rounded border border-gray-300 px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amazon-blue"
                      >
                        <option value="">—</option>
                        {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amazon-blue resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t shrink-0">
          <button onClick={onClose}
            className="h-9 px-4 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90 disabled:opacity-60">
            {saving ? 'Creating…' : 'Create RMA'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── RMA Row ──────────────────────────────────────────────────────────────────

function RMARow({ rma, onUpdated }: { rma: CustomerRMA; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const next = NEXT_STATUS[rma.status]

  async function advance() {
    if (!next) return
    setAdvancing(true)
    try {
      await fetch(`/api/wholesale/customer-rma/${rma.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      onUpdated()
    } finally {
      setAdvancing(false)
    }
  }

  async function reject() {
    setRejecting(true)
    try {
      await fetch(`/api/wholesale/customer-rma/${rma.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED' }),
      })
      onUpdated()
    } finally {
      setRejecting(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 shrink-0">
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        <span className="font-mono text-xs font-bold text-gray-800 shrink-0 w-28">{rma.rmaNumber}</span>
        <span className="text-sm font-medium text-gray-700 flex-1 truncate">{rma.customer.companyName}</span>
        <span className="text-xs text-gray-400 shrink-0 hidden sm:block">{fmt(rma.createdAt)}</span>

        <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0', STATUS_COLOR[rma.status])}>
          {STATUS_LABEL[rma.status]}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {next && (
            <button
              onClick={advance}
              disabled={advancing}
              className="h-7 px-2.5 rounded-md bg-amazon-blue text-white text-xs font-medium hover:bg-amazon-blue/90 disabled:opacity-60"
            >
              {advancing ? '…' : NEXT_LABEL[rma.status]}
            </button>
          )}
          {rma.status !== 'REJECTED' && rma.status !== 'REFUNDED' && (
            <button
              onClick={reject}
              disabled={rejecting}
              className="h-7 px-2.5 rounded-md border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 disabled:opacity-60"
            >
              {rejecting ? '…' : 'Reject'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <div><span className="text-gray-400">Reason: </span><span className="text-gray-700">{rma.reason}</span></div>
            {rma.creditAmount && (
              <div><span className="text-gray-400">Credit: </span><span className="text-gray-700 font-medium">${parseFloat(rma.creditAmount).toFixed(2)}</span></div>
            )}
            {rma.notes && (
              <div className="col-span-2"><span className="text-gray-400">Notes: </span><span className="text-gray-700">{rma.notes}</span></div>
            )}
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] font-semibold text-gray-400 uppercase">
                <th className="text-left pb-1 pr-3">SKU</th>
                <th className="text-left pb-1 pr-3">Description</th>
                <th className="text-right pb-1 pr-3 w-10">Qty</th>
                <th className="text-right pb-1 pr-3 w-20">Unit Price</th>
                <th className="text-left pb-1 w-24">Condition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rma.items.map(item => (
                <tr key={item.id}>
                  <td className="py-1.5 pr-3 font-mono text-gray-700">{item.product.sku}</td>
                  <td className="py-1.5 pr-3 text-gray-600 truncate max-w-[200px]">{item.product.description}</td>
                  <td className="py-1.5 pr-3 text-right text-gray-700">{item.quantity}</td>
                  <td className="py-1.5 pr-3 text-right text-gray-700">
                    {item.unitPrice ? `$${parseFloat(item.unitPrice).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-1.5 text-gray-500">{item.condition ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value) }}
            placeholder="Search RMA #, customer, reason…"
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
        <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
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
            <RMARow key={rma.id} rma={rma} onUpdated={load} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePanel
          onClose={() => setCreate(false)}
          onCreated={() => { setCreate(false); load() }}
        />
      )}
    </div>
  )
}

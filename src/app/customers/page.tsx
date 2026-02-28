'use client'
import { useEffect, useState, useCallback } from 'react'
import { Search, Users, ExternalLink, X, ChevronRight, Package, ShoppingBag } from 'lucide-react'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import { clsx } from 'clsx'

interface Customer {
  id: string
  type: string
  firstName: string | null
  lastName:  string | null
  companyName: string | null
  city:    string | null
  state:   string | null
  zip:     string | null
  phone:   string | null
  email:   string | null
  ordersCount: number
  sourceId:  string
  createdAt: string | null
  lookupKey: string
}

// ── Order history types ──────────────────────────────────────────────────────

interface WholesaleOrderItem {
  id: string; sku: string | null; title: string
  quantity: number; unitPrice: number; total: number
}
interface WholesaleOrder {
  id: string; orderNumber: string; orderDate: string; dueDate: string | null
  status: string; subtotal: number; total: number; balance: number
  paymentTerms: string | null; items: WholesaleOrderItem[]
}
interface WholesaleHistory {
  type: 'wholesale'
  customer: { id: string; companyName: string | null; contactName: string | null; email: string | null; phone: string | null; paymentTerms: string | null }
  orders: WholesaleOrder[]
}

interface AmazonOrderItem {
  id: string; amazonOrderItemId: string | null; sellerSku: string | null; title: string | null
  quantityOrdered: number; itemPrice: number | null
}
interface AmazonOrder {
  id: string; amazonOrderId: string; purchaseDate: string | null; orderStatus: string | null
  workflowStatus: string; orderTotal: number | null; marketplace: string; shipToCity: string | null; shipToState: string | null
  items: AmazonOrderItem[]
}
interface AmazonHistory {
  type: 'amazon'
  customer: { name: string; city: string | null; state: string | null; zip: string | null; phone: string | null }
  orders: AmazonOrder[]
}

type OrderHistory = WholesaleHistory | AmazonHistory

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  Wholesale:    'bg-purple-100 text-purple-700',
  'Amazon.com': 'bg-amazon-orange/10 text-amazon-orange',
}
function typeColor(type: string) {
  return TYPE_COLOR[type] ?? 'bg-blue-100 text-blue-700'
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const WS_STATUS_COLOR: Record<string, string> = {
  DRAFT:     'bg-gray-100 text-gray-500',
  OPEN:      'bg-blue-100 text-blue-700',
  SHIPPED:   'bg-green-100 text-green-700',
  PAID:      'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-600',
}

// ── Customer Detail Drawer ───────────────────────────────────────────────────

function CustomerDrawer({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [history, setHistory]   = useState<OrderHistory | null>(null)
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setHistory(null)
    setExpanded(null)
    fetch(`/api/customers/orders?key=${encodeURIComponent(customer.lookupKey)}`)
      .then(r => r.json())
      .then(d => setHistory(d))
      .finally(() => setLoading(false))
  }, [customer.lookupKey])

  const displayName = customer.companyName
    ?? [customer.firstName, customer.lastName].filter(Boolean).join(' ')
    ?? customer.lookupKey

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', typeColor(customer.type))}>
                {customer.type}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{displayName}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {[customer.city, customer.state, customer.zip].filter(Boolean).join(', ') || '—'}
              {customer.phone ? ` · ${customer.phone}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-20 text-center text-sm text-gray-400">Loading order history…</div>
          ) : !history ? (
            <div className="py-20 text-center text-sm text-gray-400">No history found.</div>
          ) : history.type === 'wholesale' ? (
            <WholesaleHistory history={history} expanded={expanded} setExpanded={setExpanded} />
          ) : (
            <AmazonHistory history={history} expanded={expanded} setExpanded={setExpanded} />
          )}
        </div>
      </div>
    </>
  )
}

// ── Wholesale history ────────────────────────────────────────────────────────

function WholesaleHistory({
  history, expanded, setExpanded,
}: {
  history: WholesaleHistory
  expanded: string | null
  setExpanded: (id: string | null) => void
}) {
  const { orders } = history
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0)
  const totalBalance = orders.reduce((s, o) => s + o.balance, 0)

  return (
    <div className="space-y-4">
      {/* Aging summary placeholder */}
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-5 py-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Aging Summary</p>
        <p className="text-sm text-gray-400 italic">Aging report coming soon.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Orders', value: orders.length },
          { label: 'Total Revenue', value: fmt(totalRevenue) },
          { label: 'Outstanding Balance', value: fmt(totalBalance) },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-center">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className="text-sm font-semibold text-gray-800">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Orders list */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Sales Orders</p>
        {orders.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No sales orders found.</p>
        ) : (
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
            {orders.map(o => (
              <div key={o.id}>
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      size={14}
                      className={clsx('text-gray-400 transition-transform shrink-0', expanded === o.id && 'rotate-90')}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{o.orderNumber}</p>
                      <p className="text-xs text-gray-400">{fmtDate(o.orderDate)}{o.dueDate ? ` · Due ${fmtDate(o.dueDate)}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-medium', WS_STATUS_COLOR[o.status] ?? 'bg-gray-100 text-gray-500')}>
                      {o.status}
                    </span>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-800">{fmt(o.total)}</p>
                      {o.balance > 0 && (
                        <p className="text-xs text-red-500">{fmt(o.balance)} due</p>
                      )}
                    </div>
                  </div>
                </button>

                {expanded === o.id && (
                  <div className="px-4 pb-3 bg-gray-50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-200">
                          <th className="text-left py-1.5 font-medium">SKU</th>
                          <th className="text-left py-1.5 font-medium">Description</th>
                          <th className="text-right py-1.5 font-medium">Qty</th>
                          <th className="text-right py-1.5 font-medium">Unit Price</th>
                          <th className="text-right py-1.5 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {o.items.map(item => (
                          <tr key={item.id} className="text-gray-700">
                            <td className="py-1.5 font-mono">{item.sku ?? '—'}</td>
                            <td className="py-1.5 max-w-[160px] truncate">{item.title}</td>
                            <td className="py-1.5 text-right">{item.quantity}</td>
                            <td className="py-1.5 text-right">{fmt(item.unitPrice)}</td>
                            <td className="py-1.5 text-right font-medium">{fmt(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Amazon history ───────────────────────────────────────────────────────────

function AmazonHistory({
  history, expanded, setExpanded,
}: {
  history: AmazonHistory
  expanded: string | null
  setExpanded: (id: string | null) => void
}) {
  const { orders } = history
  const totalSpent = orders.reduce((s, o) => s + (o.orderTotal ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Total Orders', value: orders.length },
          { label: 'Total Spent', value: fmt(totalSpent) },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-center">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className="text-sm font-semibold text-gray-800">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Orders list */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Order History</p>
        {orders.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No orders found.</p>
        ) : (
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
            {orders.map(o => (
              <div key={o.id}>
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      size={14}
                      className={clsx('text-gray-400 transition-transform shrink-0', expanded === o.id && 'rotate-90')}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800 font-mono">{o.amazonOrderId}</p>
                      <p className="text-xs text-gray-400">
                        {fmtDate(o.purchaseDate)}
                        {o.shipToCity ? ` · ${[o.shipToCity, o.shipToState].filter(Boolean).join(', ')}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-[10px] font-medium">
                      {o.orderStatus ?? o.workflowStatus}
                    </span>
                    <p className="text-sm font-semibold text-gray-800">{fmt(o.orderTotal)}</p>
                  </div>
                </button>

                {expanded === o.id && (
                  <div className="px-4 pb-3 bg-gray-50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-200">
                          <th className="text-left py-1.5 font-medium">SKU</th>
                          <th className="text-left py-1.5 font-medium">Title</th>
                          <th className="text-right py-1.5 font-medium">Qty</th>
                          <th className="text-right py-1.5 font-medium">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {o.items.map(item => (
                          <tr key={item.id} className="text-gray-700">
                            <td className="py-1.5 font-mono">{item.sellerSku ?? '—'}</td>
                            <td className="py-1.5 max-w-[180px] truncate">{item.title ?? '—'}</td>
                            <td className="py-1.5 text-right">{item.quantityOrdered}</td>
                            <td className="py-1.5 text-right">{fmt(item.itemPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

const LIMIT = 100

export default function CustomersPage() {
  const [customers, setCustomers]         = useState<Customer[]>([])
  const [total, setTotal]                 = useState(0)
  const [page, setPage]                   = useState(1)
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')
  const [typeFilter, setType]             = useState('')
  const [selectedCustomer, setSelected]   = useState<Customer | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (search.trim()) params.set('search', search.trim())
      if (typeFilter)    params.set('type', typeFilter)
      const res  = await fetch(`/api/customers?${params}`)
      const data = await res.json()
      setCustomers(data.data ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [page, search, typeFilter])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <AppShell>
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search name, city, state, zip…"
              className="h-9 w-72 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
            />
          </div>

          <select
            value={typeFilter}
            onChange={e => { setType(e.target.value); setPage(1) }}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          >
            <option value="">All Types</option>
            <option value="wholesale">Wholesale</option>
            <option value="amazon">Amazon</option>
          </select>

          <div className="flex-1" />
          <span className="text-xs text-gray-400">{total.toLocaleString()} customer{total !== 1 ? 's' : ''}</span>

          <Link
            href="/wholesale/customers?new=1"
            className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-amazon-blue text-white text-sm font-medium hover:bg-amazon-blue/90"
          >
            Add Customer
          </Link>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="py-20 text-center">
            <Users size={36} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {search || typeFilter ? 'No customers match your filters' : 'No customers found'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">First Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">City</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">State</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">ZIP</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Orders</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Created</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {customers.map(c => (
                    <tr
                      key={c.id}
                      className={clsx(
                        'hover:bg-gray-50 cursor-pointer',
                        selectedCustomer?.id === c.id && 'bg-blue-50',
                      )}
                      onClick={() => setSelected(prev => prev?.id === c.id ? null : c)}
                    >
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', typeColor(c.type))}>
                          {c.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-800">{c.firstName ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium">{c.lastName ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">{c.companyName ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600">{c.city ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600">{c.state ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.zip ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.phone ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-right text-gray-700 font-medium">{c.ordersCount}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        {c.type === 'Wholesale' && (
                          <Link
                            href={`/wholesale/customers/${c.sourceId}`}
                            className="text-gray-300 hover:text-amazon-blue"
                            title="View customer"
                          >
                            <ExternalLink size={13} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
                <span>{(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="h-8 px-3 rounded border border-gray-300 text-xs hover:bg-gray-50 disabled:opacity-40">
                    Previous
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="h-8 px-3 rounded border border-gray-300 text-xs hover:bg-gray-50 disabled:opacity-40">
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Customer detail drawer */}
      {selectedCustomer && (
        <CustomerDrawer
          customer={selectedCustomer}
          onClose={() => setSelected(null)}
        />
      )}
    </AppShell>
  )
}

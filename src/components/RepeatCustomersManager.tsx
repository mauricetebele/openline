'use client'
import { useEffect, useState, useCallback, Fragment } from 'react'
import { clsx } from 'clsx'
import { Loader2, Search, ChevronRight, ExternalLink } from 'lucide-react'

interface CustomerOrder {
  amazonOrderId: string
  olmNumber: number | null
  orderSource: string
  purchaseDate: string
  orderTotal: number | null
  currency: string | null
  workflowStatus: string
}
interface RepeatCustomer {
  name: string | null
  postal: string | null
  address: string
  orderCount: number
  lastOrderDate: string | null
  orders: CustomerOrder[]
}

const SOURCE_COLOR: Record<string, string> = {
  amazon: 'bg-orange-100 text-orange-700',
  backmarket: 'bg-blue-100 text-blue-700',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
function money(n: number | null, cur: string | null) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: cur ?? 'USD' })
}
function bmReturnUrl(orderId: string) {
  return `https://www.backmarket.com/bo-seller/customer-care/all-requests?orderId=${encodeURIComponent(orderId)}`
}
function orderUrl(o: CustomerOrder) {
  return o.orderSource === 'backmarket'
    ? `https://www.backmarket.com/dashboard/sales/orders/${o.amazonOrderId}`
    : `https://sellercentral.amazon.com/orders-v3/order/${o.amazonOrderId}`
}

export default function RepeatCustomersManager() {
  const [customers, setCustomers] = useState<RepeatCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback((q: string) => {
    setLoading(true)
    fetch(`/api/repeat-customers${q ? `?search=${encodeURIComponent(q)}` : ''}`)
      .then(r => r.json())
      .then(d => setCustomers(d.customers ?? []))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load('') }, [load])
  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search, load])

  const toggle = (k: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  const [sortCol, setSortCol] = useState<'orderCount' | 'lastOrderDate'>('lastOrderDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  function sortByCol(col: 'orderCount' | 'lastOrderDate') {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('desc') }
  }
  const sorted = [...customers].sort((a, b) => {
    const d = sortCol === 'orderCount'
      ? a.orderCount - b.orderCount
      : new Date(a.lastOrderDate ?? 0).getTime() - new Date(b.lastOrderDate ?? 0).getTime()
    return sortDir === 'asc' ? d : -d
  })
  const arrow = (col: 'orderCount' | 'lastOrderDate') => (
    <span className={clsx('text-[10px]', sortCol === col ? 'text-indigo-500' : 'text-gray-300')}>
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer name…"
            className="h-9 w-72 pl-8 pr-3 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-amazon-blue"
          />
        </div>
        {!loading && <span className="text-xs text-gray-500">{customers.length} repeat customer{customers.length === 1 ? '' : 's'}</span>}
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="w-6 px-2 py-2.5" />
              <th className="text-left px-3 py-2.5 font-semibold">Customer Name</th>
              <th className="text-left px-3 py-2.5 font-semibold">Customer Address</th>
              <th className="text-right px-3 py-2.5 font-semibold cursor-pointer select-none hover:text-gray-700" onClick={() => sortByCol('orderCount')}>
                <span className="inline-flex items-center gap-1"># of Orders {arrow('orderCount')}</span>
              </th>
              <th className="text-left px-3 py-2.5 font-semibold cursor-pointer select-none hover:text-gray-700" onClick={() => sortByCol('lastOrderDate')}>
                <span className="inline-flex items-center gap-1">Date of Last Order {arrow('lastOrderDate')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-400">No repeat customers found.</td></tr>
            ) : sorted.map((c) => {
              const k = `${c.name}|${c.postal}`
              const isOpen = expanded.has(k)
              return (
                <Fragment key={k}>
                  <tr onClick={() => toggle(k)} className={clsx('cursor-pointer', isOpen ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60')}>
                    <td className="px-2 py-2 text-center text-gray-400">
                      <ChevronRight size={14} className={clsx('inline transition-transform', isOpen && 'rotate-90')} />
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{c.name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{c.address}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">{c.orderCount}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{fmtDate(c.lastOrderDate)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50/70 dark:bg-gray-800/40">
                      <td />
                      <td colSpan={4} className="px-3 py-2">
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-100/70 dark:bg-gray-800 text-gray-500">
                              <tr>
                                <th className="text-left px-3 py-1.5 font-medium">Order #</th>
                                <th className="text-left px-3 py-1.5 font-medium">Source</th>
                                <th className="text-left px-3 py-1.5 font-medium">Date</th>
                                <th className="text-right px-3 py-1.5 font-medium">Total</th>
                                <th className="text-left px-3 py-1.5 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {c.orders.map(o => (
                                <tr key={o.amazonOrderId}>
                                  <td className="px-3 py-1.5 font-mono">
                                    <span className="inline-flex items-center gap-1.5">
                                      <a href={orderUrl(o)} target="_blank" rel="noopener noreferrer" className="text-amazon-blue hover:underline">
                                        {o.olmNumber != null ? `OLM-${o.olmNumber}` : o.amazonOrderId}
                                      </a>
                                      {o.orderSource === 'backmarket' && (
                                        <a href={bmReturnUrl(o.amazonOrderId)} target="_blank" rel="noopener noreferrer" title="BackMarket return request" className="text-blue-600 hover:text-blue-700"><ExternalLink size={11} /></a>
                                      )}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium capitalize', SOURCE_COLOR[o.orderSource] ?? 'bg-gray-100 text-gray-600')}>{o.orderSource}</span>
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{fmtDate(o.purchaseDate)}</td>
                                  <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">{money(o.orderTotal, o.currency)}</td>
                                  <td className="px-3 py-1.5 text-gray-500">{o.workflowStatus}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

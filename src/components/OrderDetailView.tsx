'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Package, MapPin, Truck, Hash, FileText, Printer,
  CheckCircle2, AlertCircle, Loader2, RotateCcw, Crown,
} from 'lucide-react'
import { clsx } from 'clsx'
import { generateOrderInvoicePDF } from '@/lib/generate-order-invoice'
import CreateReturnModal from './CreateMarketplaceReturnModal'
import type { OrderSearchResult } from './CreateMarketplaceReturnModal'

// ─── Badge maps ────────────────────────────────────────────────────────────────

const WORKFLOW_BADGE: Record<string, string> = {
  PENDING:               'bg-yellow-100 text-yellow-800 border border-yellow-200',
  PROCESSING:            'bg-blue-100 text-blue-800 border border-blue-200',
  AWAITING_VERIFICATION: 'bg-purple-100 text-purple-800 border border-purple-200',
  SHIPPED:               'bg-green-100 text-green-800 border border-green-200',
  CANCELLED:             'bg-red-100 text-red-800 border border-red-200',
}
const WORKFLOW_LABEL: Record<string, string> = {
  PENDING: 'Pending', PROCESSING: 'Unshipped', AWAITING_VERIFICATION: 'Awaiting Verification',
  SHIPPED: 'Shipped', CANCELLED: 'Cancelled',
}
const SOURCE_COLOR: Record<string, string> = {
  amazon:     'bg-orange-100 text-orange-800 border border-orange-200',
  backmarket: 'bg-blue-100 text-blue-800 border border-blue-200',
  wholesale:  'bg-emerald-100 text-emerald-800 border border-emerald-200',
}
const FULFILLMENT_LABEL: Record<string, string> = {
  MFN: 'Merchant (MFN)', AFN: 'Amazon FBA',
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string; orderItemId: string; asin: string | null; sellerSku: string | null
  title: string | null; quantityOrdered: number; quantityShipped: number
  itemPrice: string | null; itemTax: string | null; shippingPrice: string | null
  bmSerials?: string[]
}
interface Label {
  trackingNumber: string; carrier: string | null; serviceCode: string | null
  shipmentCost: string | null; createdAt: string; isTest: boolean
}
interface SerialAssignment {
  id: string; orderItemId: string
  inventorySerial: { serialNumber: string; product: { sku: string } | null }
  orderItem: { sellerSku: string | null }
}
interface RMASerial {
  id: string; serialNumber: string; receivedAt: string | null; note: string | null
  location: { name: string; warehouse: { name: string } } | null
  grade: { grade: string } | null
}
interface RMAItem {
  id: string; sellerSku: string | null; title: string | null
  quantityReturned: number; returnReason: string | null
  serials: RMASerial[]
}
interface RMA {
  id: string; rmaNumber: string; status: string; notes: string | null; createdAt: string
  items: RMAItem[]
}
interface FullOrder {
  id: string; olmNumber: number | null; amazonOrderId: string; orderSource: string
  orderStatus: string; workflowStatus: string; purchaseDate: string; lastUpdateDate: string
  orderTotal: string | null; currency: string | null; fulfillmentChannel: string | null
  shipmentServiceLevel: string | null; isPrime: boolean
  shipToName: string | null; shipToAddress1: string | null; shipToAddress2: string | null
  shipToCity: string | null; shipToState: string | null; shipToPostal: string | null
  shipToCountry: string | null; shipToPhone: string | null
  items: OrderItem[]; label: Label | null; serialAssignments: SerialAssignment[]
  marketplaceRMAs: RMA[]
  customerPo?: string | null; shippedAt?: string | null; shipCarrier?: string | null; shipTracking?: string | null
}

// ─── Section card helper ───────────────────────────────────────────────────────

function Section({ title, icon, children }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
        <h3 className="text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          {icon}{title}
        </h3>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-xs py-1">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 dark:text-white font-medium text-right">{value ?? '—'}</span>
    </div>
  )
}

function fmt(amount: string | null | undefined): string {
  if (!amount) return '$0.00'
  const n = parseFloat(amount)
  return isNaN(n) ? '$0.00' : `$${n.toFixed(2)}`
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function OrderDetailView({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [order, setOrder] = useState<FullOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [returnModalOrder, setReturnModalOrder] = useState<OrderSearchResult | null>(null)
  const [returnLoading, setReturnLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/orders/${orderId}`)
      .then(r => { if (!r.ok) throw new Error(r.status === 404 ? 'Order not found' : 'Failed to load order'); return r.json() })
      .then(j => setOrder(j.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [orderId])

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-2 text-gray-500">
      <Loader2 size={20} className="animate-spin" /> Loading order...
    </div>
  )
  if (error || !order) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <AlertCircle size={32} className="text-red-400" />
      <p className="text-sm text-gray-600 dark:text-gray-400">{error ?? 'Order not found'}</p>
      <button onClick={() => router.back()} className="text-sm text-amazon-blue hover:underline">Go back</button>
    </div>
  )

  const isShipped = order.workflowStatus === 'SHIPPED'
  const itemsSubtotal = order.items.reduce((s, i) => s + (i.itemPrice ? parseFloat(i.itemPrice) * i.quantityOrdered : 0), 0)
  const taxTotal = order.items.reduce((s, i) => s + (i.itemTax ? parseFloat(i.itemTax) : 0), 0)
  const shippingSubtotal = order.items.reduce((s, i) => s + (i.shippingPrice ? parseFloat(i.shippingPrice) : 0), 0)
  const orderTotalNum = order.orderTotal ? parseFloat(order.orderTotal) : itemsSubtotal + taxTotal + shippingSubtotal

  async function handlePrintInvoice() {
    if (!order) return
    await generateOrderInvoicePDF({
      amazonOrderId: order.amazonOrderId,
      olmNumber: order.olmNumber,
      purchaseDate: order.purchaseDate,
      orderTotal: order.orderTotal,
      currency: order.currency,
      shipToName: order.shipToName,
      shipToAddress1: order.shipToAddress1,
      shipToAddress2: order.shipToAddress2,
      shipToCity: order.shipToCity,
      shipToState: order.shipToState,
      shipToPostal: order.shipToPostal,
      shipToCountry: order.shipToCountry,
      items: order.items.map(i => ({
        id: i.id, orderItemId: i.orderItemId, sellerSku: i.sellerSku,
        title: i.title, quantityOrdered: i.quantityOrdered, itemPrice: i.itemPrice, itemTax: i.itemTax, shippingPrice: i.shippingPrice,
      })),
      serialAssignments: order.serialAssignments.map(sa => ({
        orderItemId: sa.orderItemId,
        inventorySerial: { serialNumber: sa.inventorySerial.serialNumber },
      })),
      label: order.label ? {
        trackingNumber: order.label.trackingNumber,
        carrier: order.label.carrier,
        serviceCode: order.label.serviceCode,
        shipmentCost: order.label.shipmentCost,
      } : null,
      customerPo: order.customerPo,
      shippedAt: order.shippedAt,
      shipCarrier: order.shipCarrier,
      shipTracking: order.shipTracking,
      orderSource: order.orderSource,
    })
  }

  async function handleOpenReturnModal() {
    if (!order) return
    setReturnLoading(true)
    try {
      const res = await fetch(`/api/marketplace-rma/order-search?q=${encodeURIComponent(order.amazonOrderId)}`)
      const json = await res.json()
      const match = (json.data ?? []).find((o: OrderSearchResult) => o.id === order.id)
      if (!match) throw new Error('Order not found in search results')
      setReturnModalOrder(match)
    } catch {
      alert('Failed to load order details for return')
    }
    setReturnLoading(false)
  }

  function handleReturnCreated() {
    setReturnModalOrder(null)
    // Re-fetch order to refresh Returns section
    fetch(`/api/orders/${orderId}`)
      .then(r => r.json())
      .then(j => setOrder(j.data))
      .catch(() => {})
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors shrink-0">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {order.olmNumber && (
              <span className="text-sm font-bold bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white px-2 py-0.5 rounded">
                OLM-{order.olmNumber}
              </span>
            )}
            <span className="text-sm font-mono text-gray-500">{order.amazonOrderId}</span>
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium capitalize', SOURCE_COLOR[order.orderSource] ?? 'bg-gray-100 text-gray-600')}>
              {order.orderSource}
            </span>
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', WORKFLOW_BADGE[order.workflowStatus] ?? 'bg-gray-100 text-gray-600')}>
              {WORKFLOW_LABEL[order.workflowStatus] ?? order.workflowStatus}
            </span>
            {order.isPrime && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-600 text-white flex items-center gap-0.5">
                <Crown size={10} /> Prime
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isShipped && (
            <button
              onClick={handleOpenReturnModal}
              disabled={returnLoading}
              className="flex items-center gap-1.5 text-xs font-medium bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/40 px-3 py-1.5 rounded-md transition-colors"
            >
              <RotateCcw size={14} /> {returnLoading ? 'Loading...' : 'Create Return'}
            </button>
          )}
          <button
            onClick={handlePrintInvoice}
            className="flex items-center gap-1.5 text-xs font-medium bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-md transition-colors"
          >
            <Printer size={14} /> Print Invoice
          </button>
        </div>
      </div>

      {/* Banner for non-shipped orders */}
      {!isShipped && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40">
          <AlertCircle size={16} className="text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            This order has not shipped yet. Some details (tracking, serials) may not be available.
            Edits can be made from the <button onClick={() => router.push('/unshipped-orders')} className="underline font-medium">Fulfillment</button> page.
          </p>
        </div>
      )}

      {/* ── Two-column layout ───────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-6">

        {/* Sidebar */}
        <div className="lg:w-56 shrink-0 space-y-4">
          <Section title="Order Info" icon={<FileText size={12} />}>
            <div className="space-y-0.5">
              <KV label="Order Date" value={new Date(order.purchaseDate).toLocaleDateString()} />
              <KV label="Last Updated" value={new Date(order.lastUpdateDate).toLocaleDateString()} />
              {order.fulfillmentChannel && (
                <KV label="Fulfillment" value={FULFILLMENT_LABEL[order.fulfillmentChannel] ?? order.fulfillmentChannel} />
              )}
              {order.shipmentServiceLevel && (
                <KV label="Service Level" value={order.shipmentServiceLevel} />
              )}
            </div>
            <div className="border-t border-gray-200 dark:border-white/10 mt-2 pt-2 space-y-0.5">
              <KV label="Items Subtotal" value={fmt(String(itemsSubtotal))} />
              {taxTotal > 0 && <KV label="Tax" value={fmt(String(taxTotal))} />}
              {shippingSubtotal > 0 && <KV label="Shipping" value={fmt(String(shippingSubtotal))} />}
              <div className="flex justify-between text-xs py-1 font-bold">
                <span className="text-gray-700 dark:text-gray-300">Order Total</span>
                <span className="text-gray-900 dark:text-white">{fmt(String(orderTotalNum))}</span>
              </div>
            </div>
          </Section>
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-4">

          {/* Ship To */}
          <Section title="Ship To" icon={<MapPin size={12} />}>
            {order.shipToName ? (
              <div className="text-sm space-y-0.5">
                <p className="font-semibold text-gray-900 dark:text-white">{order.shipToName}</p>
                {order.shipToAddress1 && <p className="text-gray-600 dark:text-gray-400">{order.shipToAddress1}</p>}
                {order.shipToAddress2 && <p className="text-gray-600 dark:text-gray-400">{order.shipToAddress2}</p>}
                <p className="text-gray-600 dark:text-gray-400">
                  {[order.shipToCity, order.shipToState ? `${order.shipToState} ${order.shipToPostal ?? ''}`.trim() : order.shipToPostal].filter(Boolean).join(', ')}
                </p>
                {order.shipToCountry && order.shipToCountry !== 'US' && (
                  <p className="text-gray-600 dark:text-gray-400">{order.shipToCountry}</p>
                )}
                {order.shipToPhone && <p className="text-gray-500 text-xs mt-1">{order.shipToPhone}</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No address on file</p>
            )}
          </Section>

          {/* Items Ordered */}
          <Section title="Items Ordered" icon={<Package size={12} />}>
            <div className="overflow-x-auto -mx-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                    <th className="px-4 py-2">SKU</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">ASIN</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Ext Price</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map(item => {
                    const extPrice = item.itemPrice ? parseFloat(item.itemPrice) * item.quantityOrdered : 0
                    return (
                      <tr key={item.id} className="border-b border-gray-100 dark:border-white/5">
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">{item.sellerSku ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400 max-w-[250px] truncate">{item.title ?? '—'}</td>
                        <td className="px-4 py-2 font-mono text-gray-500">{item.asin ?? '—'}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{item.quantityOrdered}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(item.itemPrice)}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-white">{fmt(String(extPrice))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Shipment */}
          {order.label ? (
            <Section title="Shipment" icon={<Truck size={12} />}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-gray-500 mb-0.5">Carrier</p>
                  <p className="font-medium text-gray-900 dark:text-white">{order.label.carrier ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-0.5">Service</p>
                  <p className="font-medium text-gray-900 dark:text-white">{order.label.serviceCode ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-0.5">Cost</p>
                  <p className="font-medium text-gray-900 dark:text-white">{fmt(order.label.shipmentCost)}</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-0.5">Tracking</p>
                  <p className="font-mono font-medium text-gray-900 dark:text-white break-all">{order.label.trackingNumber}</p>
                </div>
              </div>
              {order.label.isTest && (
                <span className="inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Test Label</span>
              )}
            </Section>
          ) : order.shipTracking ? (
            <Section title="Shipment" icon={<Truck size={12} />}>
              <div className="grid grid-cols-2 gap-4 text-xs">
                {order.shipCarrier && (
                  <div>
                    <p className="text-gray-500 mb-0.5">Carrier</p>
                    <p className="font-medium text-gray-900 dark:text-white">{order.shipCarrier}</p>
                  </div>
                )}
                <div>
                  <p className="text-gray-500 mb-0.5">Tracking</p>
                  <p className="font-mono font-medium text-gray-900 dark:text-white break-all">{order.shipTracking}</p>
                </div>
              </div>
            </Section>
          ) : null}

          {/* Serialized Units */}
          {order.serialAssignments.length > 0 && (
            <Section title="Serialized Units" icon={<Hash size={12} />}>
              <div className="overflow-x-auto -mx-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Serial Number</th>
                      <th className="px-4 py-2">SKU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.serialAssignments.map((sa, i) => (
                      <tr key={sa.id} className="border-b border-gray-100 dark:border-white/5">
                        <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2 font-mono font-medium text-gray-900 dark:text-white">{sa.inventorySerial.serialNumber}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{sa.orderItem.sellerSku ?? sa.inventorySerial.product?.sku ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Back Market Serials */}
          {order.orderSource === 'backmarket' && order.items.some(i => (i.bmSerials?.length ?? 0) > 0) && (
            <Section title="Serial / IMEI Numbers" icon={<Hash size={12} />}>
              <div className="overflow-x-auto -mx-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-white/10">
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Serial / IMEI</th>
                      <th className="px-4 py-2">SKU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let counter = 0
                      return order.items.flatMap(item =>
                        (item.bmSerials ?? []).map(serial => {
                          counter++
                          return (
                            <tr key={`${item.id}-${serial}`} className="border-b border-gray-100 dark:border-white/5">
                              <td className="px-4 py-2 text-gray-400">{counter}</td>
                              <td className="px-4 py-2 font-mono font-medium text-gray-900 dark:text-white">{serial}</td>
                              <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{item.sellerSku ?? '—'}</td>
                            </tr>
                          )
                        })
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Returns (Marketplace RMAs) */}
          {order.marketplaceRMAs.length > 0 && (
            <Section title="Returns" icon={<RotateCcw size={12} />}>
              <div className="space-y-4">
                {order.marketplaceRMAs.map(rma => (
                  <div key={rma.id} className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
                    {/* RMA header */}
                    <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">{rma.rmaNumber}</span>
                      <span className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        rma.status === 'RECEIVED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800',
                      )}>
                        {rma.status}
                      </span>
                      <span className="text-[11px] text-gray-500">{new Date(rma.createdAt).toLocaleDateString()}</span>
                      {rma.notes && (
                        <span className="text-[11px] text-gray-500 italic ml-auto">— {rma.notes}</span>
                      )}
                    </div>

                    {/* RMA items table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-white/5">
                            <th className="px-3 py-1.5">SKU</th>
                            <th className="px-3 py-1.5">Title</th>
                            <th className="px-3 py-1.5">Serial #</th>
                            <th className="px-3 py-1.5">Return Reason</th>
                            <th className="px-3 py-1.5">Received</th>
                            <th className="px-3 py-1.5">Location</th>
                            <th className="px-3 py-1.5">Grade</th>
                            <th className="px-3 py-1.5">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rma.items.flatMap(item =>
                            item.serials.length > 0
                              ? item.serials.map(s => (
                                <tr key={s.id} className="border-b border-gray-50 dark:border-white/5">
                                  <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">{item.sellerSku ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">{item.title ?? '—'}</td>
                                  <td className="px-3 py-1.5 font-mono text-gray-900 dark:text-white">{s.serialNumber}</td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{item.returnReason ?? '—'}</td>
                                  <td className="px-3 py-1.5">
                                    {s.receivedAt ? (
                                      <span className="flex items-center gap-1 text-green-700"><CheckCircle2 size={12} />{new Date(s.receivedAt).toLocaleDateString()}</span>
                                    ) : (
                                      <span className="text-yellow-600">Pending</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">
                                    {s.location ? `${s.location.warehouse.name} / ${s.location.name}` : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{s.grade?.grade ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-500">{s.note ?? '—'}</td>
                                </tr>
                              ))
                              : [(
                                <tr key={item.id} className="border-b border-gray-50 dark:border-white/5">
                                  <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">{item.sellerSku ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">{item.title ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                  <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{item.returnReason ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-500">Qty: {item.quantityReturned}</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                  <td className="px-3 py-1.5 text-gray-400">—</td>
                                </tr>
                              )]
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

        </div>
      </div>

      {/* Create Return Modal */}
      {returnModalOrder && (
        <CreateReturnModal
          order={returnModalOrder}
          onClose={() => setReturnModalOrder(null)}
          onCreated={handleReturnCreated}
        />
      )}
    </div>
  )
}

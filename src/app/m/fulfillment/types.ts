// Shared types + helpers for the mobile Order Fulfillment page. Mirrors the fields
// the desktop grid (src/components/UnshippedOrders.tsx) uses, scoped to mobile needs.

export interface OrderItem {
  id: string; orderItemId: string; asin: string | null; sellerSku: string | null
  title: string | null; quantityOrdered: number; quantityShipped: number
  itemPrice: string | null; isSerializable?: boolean
  gradeId?: string | null; internalSku?: string | null; mappedGradeName?: string | null
}

export interface OrderLabelSummary {
  trackingNumber: string; labelFormat: string; carrier: string | null
  serviceCode: string | null; shipmentCost: string | null
  createdAt: string; isTest: boolean; ssShipmentId: string | null
}

export interface Order {
  id: string; olmNumber: number | null; amazonOrderId: string
  orderStatus: string; workflowStatus: string
  purchaseDate: string; orderTotal: string | null; currency: string | null; isPrime: boolean
  shipmentServiceLevel: string | null
  shipToName: string | null; shipToCity: string | null; shipToState: string | null
  items: OrderItem[]
  label?: OrderLabelSummary | null
  serialAssignments?: { id: string; orderItemId: string; inventorySerial: { serialNumber: string } }[]
  isBuyerRequestedCancel: boolean; buyerCancelReason: string | null
  latestShipDate: string | null; latestDeliveryDate: string | null
  presetRateAmount: string | null; presetRateCarrier: string | null; presetRateService: string | null; presetRateId: string | null; presetRateError: string | null
  appliedPackagePreset: { id: string; name: string } | null
  ssOrderId: number | null
  orderSource?: 'amazon' | 'backmarket' | 'wholesale'
  isReplacement?: boolean | null
  wholesaleOrderNumber?: string | null; wholesaleCustomerName?: string | null
  shipCarrier?: string | null; shipTracking?: string | null; shippedAt?: string | null
  actualShippingCost?: number | null; hasShippingLabel?: boolean
}

export interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

export interface InventoryLocation {
  locationId: string; locationName: string; warehouseName: string; qty: number
  gradeId: string | null; gradeName: string | null; isFinishedGoods: boolean
}
export interface OrderItemInventory {
  orderItemId: string; sellerSku: string | null; title: string | null
  quantityOrdered: number; productId: string | null; productDescription: string | null
  totalQtyAvailable: number; gradeId: string | null; gradeName: string | null
  locations: InventoryLocation[]
}
export interface OrderInventoryData { orderId: string; items: OrderItemInventory[] }

export interface VerificationItem {
  orderItemId: string; sellerSku: string | null; title: string | null
  quantityOrdered: number; isSerializable: boolean; assignedSerials: string[]
  gradeId: string | null; gradeName: string | null; internalSku?: string | null
}
export interface VerificationStatus {
  orderId: string; amazonOrderId: string; trackingNumber: string | null
  hasLabel: boolean; items: VerificationItem[]
}

export type Tab = 'pending' | 'unshipped' | 'awaiting' | 'shipped' | 'cancelled'

export const TAB_LABEL: Record<Tab, string> = {
  pending: 'Pending', unshipped: 'Unshipped', awaiting: 'Awaiting', shipped: 'Shipped', cancelled: 'Cancelled',
}

// Amazon workflowStatus per tab (wholesale mapped separately).
export const TAB_WORKFLOW: Record<Tab, string> = {
  pending: 'PENDING', unshipped: 'PROCESSING', awaiting: 'AWAITING_VERIFICATION', shipped: 'SHIPPED', cancelled: 'CANCELLED',
}

// Human labels for workflowStatus (PROCESSING = "Unshipped" in this app's vocabulary).
export const WORKFLOW_DISPLAY: Record<string, string> = {
  PENDING: 'Pending', PROCESSING: 'Unshipped', AWAITING_VERIFICATION: 'Awaiting', SHIPPED: 'Shipped', CANCELLED: 'Cancelled',
}

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function fmtMoney(v: string | number | null | undefined): string {
  if (v == null) return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? usd.format(n) : '—'
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export async function apiPost<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  let data: unknown
  try { data = text ? JSON.parse(text) : {} } catch { throw new Error(text || `Request failed (${res.status})`) }
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status})`)
  return data as T
}

/** Open a saved label (ZPL downloads, PDF/PNG opens in a new tab). */
export function openLabelData(labelData: string, labelFormat: string, name: string) {
  if (labelFormat === 'zpl') {
    const blob = new Blob([labelData], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${name}.zpl`; a.click()
    URL.revokeObjectURL(url)
    return
  }
  const mime = labelFormat === 'pdf' ? 'application/pdf' : 'image/png'
  const blob = new Blob([Uint8Array.from(atob(labelData), c => c.charCodeAt(0))], { type: mime })
  window.open(URL.createObjectURL(blob), '_blank')
}

/** Carrier logo path from carrier code / service name (mirrors the desktop grid). */
export function carrierLogo(carrierCode: string | null | undefined, serviceName?: string | null): string | null {
  const candidates = [carrierCode, serviceName].filter(Boolean).map(s => s!.toLowerCase())
  for (const key of candidates) {
    if (key.includes('usps') || key.includes('stamps')) return '/logos/usps.svg'
    if (key.includes('ups')) return '/logos/ups.svg'
    if (key.includes('fedex')) return '/logos/fedex.svg'
    if (key.includes('dhl')) return '/logos/dhl.svg'
  }
  return null
}

export function orderNumber(o: Order): string {
  if (o.orderSource === 'wholesale') return o.wholesaleOrderNumber ?? o.amazonOrderId
  return o.olmNumber ? `OLM-${o.olmNumber}` : o.amazonOrderId
}

/** Days until ship-by (negative = overdue), or null. */
export function shipByDays(o: Order): number | null {
  if (!o.latestShipDate) return null
  const now = new Date(); const due = new Date(o.latestShipDate)
  return Math.floor((due.getTime() - now.getTime()) / 86400000)
}

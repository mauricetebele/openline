// Shared TypeScript types for the mobile app

export interface AuthUser {
  uid: string
  email: string
  dbId: string
  role: string
  name: string
}

export interface Account {
  id: string
  sellerId: string
  marketplaceId: string
  marketplaceName: string
  region: string
  isActive: boolean
  createdAt: string
}

export interface OrderItem {
  id: string
  orderId: string
  asin: string
  sku: string
  title: string
  quantity: number
  itemPrice: number
  grade?: string | null
}

export interface Order {
  id: string
  amazonOrderId: string
  olmNumber: string
  buyerName: string
  purchaseDate: string
  latestShipDate: string | null
  latestDeliveryDate: string | null
  orderTotal: number
  currencyCode: string
  orderStatus: string
  workflowStatus: WorkflowStatus
  fulfillmentChannel: string
  shipmentServiceLevel: string | null
  source: string
  accountId: string
  items: OrderItem[]
  shippingAddress?: ShippingAddress | null
  appliedPresetId?: string | null
  presetRateId?: string | null
  presetRateAmount?: number | null
  presetRateCarrier?: string | null
  presetRateService?: string | null
}

export interface ShippingAddress {
  name: string
  line1: string
  line2?: string | null
  city: string
  state: string
  postalCode: string
  countryCode: string
}

export type WorkflowStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'AWAITING_VERIFICATION'
  | 'SHIPPED'
  | 'CANCELLED'

export type TabFilter = 'pending' | 'unshipped' | 'awaiting' | 'shipped'

export interface OrderCounts {
  pending: number
  unshipped: number
  awaiting: number
  shipped: number
}

export interface PackagePreset {
  id: string
  name: string
  packageCode: string | null
  weightValue: number
  weightUnit: string
  dimLength: number | null
  dimWidth: number | null
  dimHeight: number | null
  dimUnit: string
  confirmation: string | null
  isDefault: boolean
}

export interface RateEvent {
  type: 'rate'
  orderId: string
  amazonOrderId: string
  olmNumber: string
  rateAmount: number | null
  rateCarrier: string | null
  rateService: string | null
  rateId: string | null
  presetName?: string
  error?: string | null
}

export interface DoneEvent {
  type: 'done'
  applied: number
  total: number
  skipped?: number
  errors: string[]
}

export interface ErrorEvent {
  type: 'error'
  error: string
}

export type SSEEvent = RateEvent | DoneEvent | ErrorEvent

export interface LabelResult {
  orderId: string
  olmNumber: string
  success: boolean
  error?: string
  trackingNumber?: string
  carrier?: string
}

export interface WholesaleOrder {
  id: string
  orderNumber: string
  status: string
  customerId: string
  customer: { companyName: string }
  customerPoNumber: string | null
  orderDate: string
  dueDate: string | null
  notes: string | null
  items: WholesaleOrderItem[]
  subtotal?: number
  total?: number
}

export interface WholesaleOrderItem {
  id: string
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  discount: number
}

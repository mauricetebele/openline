// ─── Shared Types ─────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'REVIEWER'
export type FulfillmentType = 'FBA' | 'MFN' | 'UNKNOWN'
export type ReviewStatus = 'UNREVIEWED' | 'VALID' | 'INVALID'
export type ImportJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export type InvalidReason =
  | 'DIFFERENT_ITEM_RETURNED'
  | 'RETURN_NEVER_RECEIVED'
  | 'OUTSIDE_POLICY_WINDOW'
  | 'WRONG_SKU_ASIN'
  | 'DUPLICATE_REFUND'
  | 'SHIPPING_NOT_RETURNED'
  | 'CHARGEBACK_RELATED'
  | 'OTHER'

export const INVALID_REASON_LABELS: Record<InvalidReason, string> = {
  DIFFERENT_ITEM_RETURNED: 'Customer returned different item',
  RETURN_NEVER_RECEIVED: 'Return never received',
  OUTSIDE_POLICY_WINDOW: 'Refund issued outside policy window',
  WRONG_SKU_ASIN: 'Wrong SKU/ASIN — mismatch',
  DUPLICATE_REFUND: 'Duplicate refund',
  SHIPPING_NOT_RETURNED: 'Shipping not returned / no tracking',
  CHARGEBACK_RELATED: 'Chargeback related — handle elsewhere',
  OTHER: 'Other (requires explanation)',
}

// ─── API Response shapes ──────────────────────────────────────────────────────

export interface AmazonAccountDTO {
  id: string
  sellerId: string
  marketplaceId: string
  marketplaceName: string
  region: string
  isActive: boolean
  createdAt: string
}

export interface RefundDTO {
  id: string
  accountId: string
  orderId: string
  adjustmentId: string
  postedDate: string
  amount: string
  currency: string
  fulfillmentType: FulfillmentType
  marketplaceId: string
  sku: string | null
  asin: string | null
  reasonCode: string | null
  importedAt: string
  review: ReviewDTO | null
  account: { marketplaceName: string; sellerId: string }
}

export interface ReviewDTO {
  id: string
  refundId: string
  status: ReviewStatus
  invalidReason: InvalidReason | null
  customReason: string | null
  notes: string | null
  reviewedBy: { name: string; email: string } | null
  reviewedAt: string | null
}

export interface AuditEventDTO {
  id: string
  entityType: string
  entityId: string
  action: string
  before: unknown
  after: unknown
  actorLabel: string
  timestamp: string
  refundId: string | null
}

export interface ImportJobDTO {
  id: string
  accountId: string
  startDate: string
  endDate: string
  status: ImportJobStatus
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

// ─── SP-API types ─────────────────────────────────────────────────────────────

export interface LwaTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface SpApiFinancialEvents {
  RefundEventList?: SpApiShipmentEvent[]
  ShipmentEventList?: SpApiShipmentEvent[]
  AdjustmentEventList?: SpApiAdjustmentEvent[]
}

export interface SpApiShipmentEvent {
  AmazonOrderId: string
  SellerOrderId?: string
  MarketplaceName: string
  PostedDate: string
  ShipmentItemAdjustmentList?: SpApiShipmentItemAdjustment[]
}

export interface SpApiShipmentItemAdjustment {
  OrderAdjustmentItemId?: string
  SellerSKU?: string
  ASIN?: string
  QuantityShipped?: number
  ItemChargeAdjustmentList?: SpApiChargeComponent[]
  ItemFeeAdjustmentList?: SpApiFeeComponent[]
  PromotionAdjustmentList?: SpApiPromotionComponent[]
}

export interface SpApiChargeComponent {
  ChargeType: string
  ChargeAmount: SpApiCurrencyAmount
}

export interface SpApiFeeComponent {
  FeeType: string
  FeeAmount: SpApiCurrencyAmount
}

export interface SpApiPromotionComponent {
  PromotionType: string
  PromotionId: string
  PromotionAmount: SpApiCurrencyAmount
}

export interface SpApiCurrencyAmount {
  CurrencyCode: string
  CurrencyAmount: number
}

export interface SpApiAdjustmentEvent {
  AdjustmentType: string
  PostedDate: string
  AdjustmentAmount: SpApiCurrencyAmount
  AdjustmentItemList?: SpApiAdjustmentItem[]
}

export interface SpApiAdjustmentItem {
  Quantity: string
  PerUnitAmount: SpApiCurrencyAmount
  TotalAmount: SpApiCurrencyAmount
  SellerSKU?: string
  FnSKU?: string
  ProductDescription?: string
  ASIN?: string
}

export interface SpApiOrder {
  AmazonOrderId: string
  FulfillmentChannel: 'AFN' | 'MFN' // AFN = FBA
  MarketplaceId: string
  OrderStatus: string
}

// ─── Shipping Template Manager ────────────────────────────────────────────────

export type ListingSyncJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface SellerListingDTO {
  id: string
  accountId: string
  sku: string
  asin: string | null
  productTitle: string | null
  fulfillmentChannel: string
  shippingTemplate: string | null
  listingStatus: string | null
  groupName: string | null
  quantity: number
  price: string | null
  minPrice: string | null
  maxPrice: string | null
  lastSyncedAt: string
  createdAt: string
  updatedAt: string
  account: { sellerId: string; marketplaceName: string }
}

export interface ListingSyncJobDTO {
  id: string
  accountId: string
  status: ListingSyncJobStatus
  totalFound: number
  totalUpserted: number
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

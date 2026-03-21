/**
 * Sync free replacement orders from Amazon SP-API.
 *
 * Fetches shipped MFN orders, filters by IsReplacementOrder,
 * cross-references MFNReturn for return tracking, and
 * refreshes stale carrier tracking statuses.
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'
import { getCarrierStatus } from '@/lib/ups-tracking'

interface SpApiOrder {
  AmazonOrderId: string
  IsReplacementOrder?: boolean
  ReplacedOrderId?: string
  PurchaseDate?: string
  OrderStatus?: string
  FulfillmentChannel?: string
  [key: string]: unknown
}

interface SpApiOrderItem {
  ASIN?: string
  Title?: string
  QuantityOrdered?: number
}

interface OrderItemsResponse {
  payload?: { OrderItems?: SpApiOrderItem[] }
}

const STALE_HOURS = 4

export interface SyncResult {
  created: number
  updated: number
  trackingRefreshed: number
  debug?: {
    totalOrdersFetched: number
    replacementsFound: number
    lookbackDays: number
    sampleOrderKeys?: string[]
    knownTestOrder?: Record<string, unknown> | null
    error?: string
  }
}

/**
 * Probe a single known order to see what fields SP-API returns.
 * This is a lightweight debug call (1 request) to verify IsReplacementOrder is present.
 */
export async function probeOrder(accountId: string, orderId: string): Promise<Record<string, unknown> | null> {
  const sp = new SpApiClient(accountId)
  try {
    const res = await sp.get<{ payload?: SpApiOrder }>(`/orders/v0/orders/${orderId}`)
    return (res.payload ?? null) as Record<string, unknown> | null
  } catch (err) {
    console.error(`[sync-replacements] probeOrder failed for ${orderId}:`, err)
    return null
  }
}

export async function syncReplacementOrders(accountId: string): Promise<SyncResult> {
  const sp = new SpApiClient(accountId)
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })

  // Check if there are existing records to decide lookback window
  const existingCount = await prisma.freeReplacement.count({ where: { accountId } })
  const lookbackDays = existingCount === 0 ? 90 : 14

  const createdAfter = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  // Fetch shipped MFN orders only (to avoid quota issues with all channels)
  const orders = await sp.fetchAllPages<SpApiOrder>(
    '/orders/v0/orders',
    'Orders',
    {
      MarketplaceIds: account.marketplaceId,
      FulfillmentChannels: 'MFN',
      OrderStatuses: 'Shipped',
      CreatedAfter: createdAfter,
    },
  )

  console.log(`[sync-replacements] Fetched ${orders.length} shipped MFN orders for account ${accountId}`)

  // SP-API may return IsReplacementOrder as boolean or string
  const replacements = orders.filter(o => {
    const val = o.IsReplacementOrder
    return (val === true || val as unknown === 'true') && o.ReplacedOrderId
  })

  console.log(`[sync-replacements] Found ${replacements.length} replacement orders`)

  if (orders.length > 0 && replacements.length === 0) {
    const sample = orders[0]
    console.log(`[sync-replacements] Sample order keys:`, Object.keys(sample))
    console.log(`[sync-replacements] Sample IsReplacementOrder:`, sample.IsReplacementOrder, typeof sample.IsReplacementOrder)
  }

  let created = 0
  let updated = 0

  for (const order of replacements) {
    let asin = ''
    let title = ''
    try {
      const itemsRes = await sp.get<OrderItemsResponse>(
        `/orders/v0/orders/${order.AmazonOrderId}/orderItems`,
      )
      const firstItem = itemsRes.payload?.OrderItems?.[0]
      asin = firstItem?.ASIN ?? ''
      title = firstItem?.Title ?? ''
    } catch (err) {
      console.warn(`[sync-replacements] Failed to fetch items for ${order.AmazonOrderId}:`, err)
    }

    const mfnReturn = await prisma.mFNReturn.findFirst({
      where: { accountId, orderId: order.ReplacedOrderId! },
      select: { trackingNumber: true },
    })

    const existing = await prisma.freeReplacement.findUnique({
      where: { replacementOrderId: order.AmazonOrderId },
    })

    if (existing) {
      await prisma.freeReplacement.update({
        where: { replacementOrderId: order.AmazonOrderId },
        data: {
          asin: asin || existing.asin,
          title: title || existing.title,
          shippedAt: order.PurchaseDate ? new Date(order.PurchaseDate) : existing.shippedAt,
          returnTrackingNumber: mfnReturn?.trackingNumber ?? existing.returnTrackingNumber,
        },
      })
      updated++
    } else {
      await prisma.freeReplacement.create({
        data: {
          accountId,
          replacementOrderId: order.AmazonOrderId,
          originalOrderId: order.ReplacedOrderId!,
          asin,
          title,
          shippedAt: order.PurchaseDate ? new Date(order.PurchaseDate) : null,
          returnTrackingNumber: mfnReturn?.trackingNumber ?? null,
        },
      })
      created++
    }

    await new Promise(r => setTimeout(r, 1100))
  }

  const trackingRefreshed = await refreshStaleTracking(accountId)

  const sampleOrderKeys = orders.length > 0 ? Object.keys(orders[0]) : undefined
  const knownTestOrder = orders.find(o => o.AmazonOrderId === '113-1141718-0565010') as Record<string, unknown> | undefined

  return {
    created,
    updated,
    trackingRefreshed,
    debug: {
      totalOrdersFetched: orders.length,
      replacementsFound: replacements.length,
      lookbackDays,
      sampleOrderKeys,
      knownTestOrder: knownTestOrder ?? null,
    },
  }
}

export async function refreshStaleTracking(accountId?: string): Promise<number> {
  const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000)

  const records = await prisma.freeReplacement.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      returnTrackingNumber: { not: null },
      OR: [
        { trackingUpdatedAt: null },
        { trackingUpdatedAt: { lt: staleThreshold } },
      ],
    },
  })

  let refreshed = 0
  for (const rec of records) {
    if (!rec.returnTrackingNumber) continue
    try {
      const result = await getCarrierStatus(rec.returnTrackingNumber)
      await prisma.freeReplacement.update({
        where: { id: rec.id },
        data: {
          returnCarrierStatus: result.status,
          returnDeliveredAt: result.deliveredAt,
          trackingUpdatedAt: new Date(),
        },
      })
      refreshed++
    } catch (err) {
      console.warn(`[sync-replacements] Tracking refresh failed for ${rec.returnTrackingNumber}:`, err)
    }
  }

  return refreshed
}

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

export async function syncReplacementOrders(accountId: string): Promise<{ created: number; updated: number; trackingRefreshed: number }> {
  const sp = new SpApiClient(accountId)

  // Check if there are existing records to decide lookback window
  const existingCount = await prisma.freeReplacement.count({ where: { accountId } })
  const lookbackDays = existingCount === 0 ? 90 : 14

  const createdAfter = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  // Fetch shipped MFN orders
  const orders = await sp.fetchAllPages<SpApiOrder>(
    '/orders/v0/orders',
    'Orders',
    {
      FulfillmentChannels: 'MFN',
      OrderStatuses: 'Shipped',
      CreatedAfter: createdAfter,
    },
  )

  const replacements = orders.filter(o => o.IsReplacementOrder === true && o.ReplacedOrderId)

  let created = 0
  let updated = 0

  for (const order of replacements) {
    // Fetch order items to get ASIN + title
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

    // Look up return tracking from MFNReturn table using original order ID
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

    // Rate limit: ~1 req/s for order items calls
    await new Promise(r => setTimeout(r, 1100))
  }

  // Refresh stale tracking
  const trackingRefreshed = await refreshStaleTracking(accountId)

  return { created, updated, trackingRefreshed }
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

/**
 * Sync free replacement orders from Amazon SP-API.
 *
 * Uses custom pagination with rate-limit-aware delays for the Orders API
 * (burst: 20 requests, then 1 per ~60s). Cross-references MFNReturn for
 * return tracking and refreshes stale carrier statuses.
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

interface OrdersPageResponse {
  payload?: {
    Orders?: SpApiOrder[]
    NextToken?: string
  }
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
    pagesFetched: number
    sampleOrderKeys?: string[]
    error?: string
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Fetch orders with rate-limit-aware pagination.
 * Orders API: burst 20, then ~1 req/60s.
 * Uses 3s delays for burst pages, 65s delays after burst.
 */
async function fetchOrdersWithRateLimit(
  sp: SpApiClient,
  params: Record<string, string>,
  maxPages = 25,
): Promise<{ orders: SpApiOrder[]; pagesFetched: number }> {
  const allOrders: SpApiOrder[] = []
  let nextToken: string | undefined
  let page = 0
  const BURST_LIMIT = 18 // stay under 20 burst to leave headroom

  do {
    const queryParams: Record<string, string> = { ...params }
    if (nextToken) queryParams['NextToken'] = nextToken

    let response: OrdersPageResponse
    try {
      response = await sp.get<OrdersPageResponse>('/orders/v0/orders', queryParams)
    } catch (err) {
      const errStr = String(err)
      // If quota exceeded, wait 65s and retry once
      if (errStr.includes('429') || errStr.includes('QuotaExceeded')) {
        console.log(`[sync-replacements] Rate limited on page ${page + 1}, waiting 65s...`)
        await sleep(65_000)
        try {
          response = await sp.get<OrdersPageResponse>('/orders/v0/orders', queryParams)
        } catch (retryErr) {
          console.error(`[sync-replacements] Retry also failed on page ${page + 1}:`, retryErr)
          break // Return what we have so far
        }
      } else {
        throw err
      }
    }

    const orders = response!.payload?.Orders ?? []
    allOrders.push(...orders)
    nextToken = response!.payload?.NextToken
    page++

    console.log(`[sync-replacements] Page ${page}: ${orders.length} orders (total: ${allOrders.length})`)

    if (nextToken && page < maxPages) {
      // Use longer delays after burst to respect rate limits
      const delay = page < BURST_LIMIT ? 3_000 : 65_000
      await sleep(delay)
    }
  } while (nextToken && page < maxPages)

  return { orders: allOrders, pagesFetched: page }
}

/**
 * Probe a single known order to see what fields SP-API returns.
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
  const lookbackDays = existingCount === 0 ? 30 : 14

  const createdAfter = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  // Fetch MFN orders in all active statuses — replacements start as Unshipped
  // Cap at 20 pages to stay within Vercel's 300s function timeout
  const { orders, pagesFetched } = await fetchOrdersWithRateLimit(sp, {
    MarketplaceIds: account.marketplaceId,
    FulfillmentChannels: 'MFN',
    OrderStatuses: 'Unshipped,PartiallyShipped,Shipped',
    CreatedAfter: createdAfter,
  }, 20)

  console.log(`[sync-replacements] Fetched ${orders.length} shipped MFN orders across ${pagesFetched} pages`)

  // Filter for replacement orders
  const replacements = orders.filter(o => {
    const val = o.IsReplacementOrder
    return (val === true || val as unknown === 'true') && o.ReplacedOrderId
  })

  console.log(`[sync-replacements] Found ${replacements.length} replacement orders`)

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

    await sleep(1100)
  }

  const trackingRefreshed = await refreshStaleTracking(accountId)

  const sampleOrderKeys = orders.length > 0 ? Object.keys(orders[0]) : undefined

  return {
    created,
    updated,
    trackingRefreshed,
    debug: {
      totalOrdersFetched: orders.length,
      replacementsFound: replacements.length,
      lookbackDays,
      pagesFetched,
      sampleOrderKeys,
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

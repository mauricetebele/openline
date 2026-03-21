/**
 * Sync free replacement orders.
 *
 * Queries our own orders table for replacement candidates (isReplacement=true
 * or $0 orderTotal), then creates FreeReplacement records. No SP-API
 * pagination needed — the regular order sync captures the replacement flag.
 * Also refreshes stale return tracking statuses.
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
  const existingCount = await prisma.freeReplacement.count({ where: { accountId } })
  const lookbackDays = existingCount === 0 ? 180 : 14
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  // ── Backfill: probe SP-API for orders missing the isReplacement flag ──────
  const unscanned = await prisma.order.findMany({
    where: {
      accountId,
      orderSource: 'amazon',
      fulfillmentChannel: 'MFN',
      purchaseDate: { gte: cutoff },
      isReplacement: null,
    },
    select: { id: true, amazonOrderId: true },
    orderBy: { purchaseDate: 'desc' },
  })

  if (unscanned.length > 0) {
    // Process up to 150 per sync call (~165s) to stay within Vercel timeout.
    // Remaining orders will be backfilled on subsequent syncs.
    const batch = unscanned.slice(0, 150)
    console.log(`[sync-replacements] Backfilling isReplacement flag: ${batch.length} of ${unscanned.length} remaining`)
    const sp = new SpApiClient(accountId)
    let probed = 0
    for (const o of batch) {
      try {
        const data = await sp.get<{ payload?: SpApiOrder }>(`/orders/v0/orders/${o.amazonOrderId}`)
        const isRepl = data.payload?.IsReplacementOrder === true || (data.payload?.IsReplacementOrder as unknown) === 'true'
        await prisma.order.update({
          where: { id: o.id },
          data: {
            isReplacement: isRepl,
            replacedOrderId: data.payload?.ReplacedOrderId ?? null,
          },
        })
        probed++
        // SP-API rate limit: ~1 req/s for getOrder
        if (probed < batch.length) await sleep(1100)
      } catch (err) {
        console.warn(`[sync-replacements] Failed to probe ${o.amazonOrderId}:`, err)
        // Mark as false so we don't retry endlessly
        await prisma.order.update({ where: { id: o.id }, data: { isReplacement: false } }).catch(() => {})
      }
    }
    console.log(`[sync-replacements] Backfill complete: probed ${probed}/${batch.length} (${unscanned.length - batch.length} remaining)`)
  }

  // ── Now query DB for all replacement candidates ───────────────────────────
  const candidates = await prisma.order.findMany({
    where: {
      accountId,
      orderSource: 'amazon',
      fulfillmentChannel: 'MFN',
      purchaseDate: { gte: cutoff },
      OR: [
        { isReplacement: true },
        { orderTotal: null },
        { orderTotal: 0 },
      ],
    },
    include: { items: { take: 1, select: { asin: true, title: true } } },
    orderBy: { purchaseDate: 'desc' },
  })

  console.log(`[sync-replacements] Found ${candidates.length} replacement candidates in DB (${lookbackDays}d lookback)`)

  let created = 0
  let updated = 0

  for (const order of candidates) {
    const asin = order.items[0]?.asin ?? ''
    const title = order.items[0]?.title ?? ''

    // Determine original order ID:
    // 1. Use replacedOrderId if stored from SP-API
    // 2. Otherwise, try to find a matching MFN return by ASIN
    let originalOrderId = order.replacedOrderId ?? null
    let returnTracking: string | null = null

    if (originalOrderId) {
      const mfnReturn = await prisma.mFNReturn.findFirst({
        where: { accountId, orderId: originalOrderId },
        select: { trackingNumber: true },
      })
      returnTracking = mfnReturn?.trackingNumber ?? null
    }

    if (!originalOrderId) originalOrderId = 'UNKNOWN'

    const existing = await prisma.freeReplacement.findUnique({
      where: { replacementOrderId: order.amazonOrderId },
    })

    if (existing) {
      await prisma.freeReplacement.update({
        where: { replacementOrderId: order.amazonOrderId },
        data: {
          asin: asin || existing.asin,
          title: title || existing.title,
          originalOrderId: existing.originalOrderId === 'UNKNOWN' && originalOrderId !== 'UNKNOWN'
            ? originalOrderId : existing.originalOrderId,
          shippedAt: order.purchaseDate ?? existing.shippedAt,
          returnTrackingNumber: returnTracking ?? existing.returnTrackingNumber,
        },
      })
      updated++
    } else {
      await prisma.freeReplacement.create({
        data: {
          accountId,
          replacementOrderId: order.amazonOrderId,
          originalOrderId,
          asin,
          title,
          shippedAt: order.purchaseDate ?? null,
          returnTrackingNumber: returnTracking,
        },
      })
      created++
    }
  }

  const trackingRefreshed = await refreshStaleTracking(accountId)

  return {
    created,
    updated,
    trackingRefreshed,
    debug: {
      totalOrdersFetched: candidates.length,
      replacementsFound: candidates.length,
      lookbackDays,
      pagesFetched: 0,
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

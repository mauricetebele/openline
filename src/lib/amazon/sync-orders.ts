/**
 * Orders sync — fetches Pending, Unshipped, and PartiallyShipped MFN orders
 * from SP-API and upserts them (with line items) into the DB.
 *
 * Orders API:      GET /orders/v0/orders              — burst 20, then 0.0167 req/s
 * Order detail:    GET /orders/v0/orders/{id}         — burst 30, then 1 req/s
 * Items API:       GET /orders/v0/orders/{id}/orderItems — burst 30, then 0.5 req/s
 *
 * Rate-limit strategy:
 *  - Pages 1–20:  no inter-page sleep (within burst)
 *  - Pages 21+:   65 s sleep between pages
 *  - Order detail calls 1–30: no sleep (within burst)
 *  - Order detail calls 31+:  1 100 ms sleep
 *  - Items calls 1–30:  no sleep (within burst)
 *  - Items calls 31+:   2 100 ms sleep
 *
 * Performance optimisations (re-sync):
 *  - Detail API call is SKIPPED for orders already in the DB (they already
 *    have address data from a prior sync or SS enrichment).
 *  - Items API call is SKIPPED for orders that already have line items in the
 *    DB (items don't change after an order is placed).
 *  - OLM numbers are pre-allocated in one aggregate query instead of one
 *    per new order.
 *  - Progress writes are batched every 5 orders instead of every order.
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

const ORDERS_PAGE_BURST  = 20   // free burst calls for GetOrders
const ORDER_DETAIL_BURST = 30   // free burst calls for GetOrder
const ITEMS_BURST        = 30   // free burst calls for GetOrderItems
const PAGE_SLEEP_MS      = 65_000  // after burst: 0.0167 req/s
const DETAIL_SLEEP_MS    = 1_100   // after burst: ~1 req/s
const ITEMS_DELAY_MS     = 2_100   // after burst: 0.5 req/s

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── SP-API types ─────────────────────────────────────────────────────────────

interface OrderAddress {
  Name?: string; AddressLine1?: string; AddressLine2?: string; City?: string
  StateOrRegion?: string; PostalCode?: string; CountryCode?: string; Phone?: string
}
interface AmazonOrder {
  AmazonOrderId?: string; OrderStatus?: string; PurchaseDate?: string
  LastUpdateDate?: string; LatestShipDate?: string
  OrderTotal?: { Amount?: string; CurrencyCode?: string }
  FulfillmentChannel?: string; ShipmentServiceLevelCategory?: string
  NumberOfItemsUnshipped?: number; ShippingAddress?: OrderAddress
  IsPrime?: boolean
  IsBuyerRequestedCancel?: boolean
  BuyerRequestedCancelReason?: string
}
interface GetOrdersResponse {
  payload?: { Orders?: AmazonOrder[]; NextToken?: string }
  errors?: { code: string; message: string; details?: string }[]
}
interface GetOrderResponse {
  payload?: AmazonOrder
  errors?: { code: string; message: string }[]
}
interface AmazonOrderItem {
  OrderItemId?: string; ASIN?: string; SellerSKU?: string; Title?: string
  QuantityOrdered?: number; QuantityShipped?: number
  ItemPrice?: { Amount?: string }; ShippingPrice?: { Amount?: string }
  IsTransparency?: boolean
}
interface GetOrderItemsResponse {
  payload?: { OrderItems?: AmazonOrderItem[]; NextToken?: string }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function syncUnshippedOrders(
  accountId: string,
  jobId: string,
): Promise<void> {
  console.log(`[SyncOrders] Starting sync — accountId=${accountId} jobId=${jobId}`)
  await prisma.orderSyncJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } })

  try {
    const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })
    console.log(`[SyncOrders] Account: sellerId=${account.sellerId} marketplace=${account.marketplaceId}`)
    const client = new SpApiClient(accountId)

    // ── Incremental sync: use LastUpdatedAfter from last successful sync ──
    // This drastically reduces pages on re-syncs (only recently changed orders).
    // Fall back to 60-day CreatedAfter window if no prior sync exists.
    const lastSuccessfulSync = await prisma.orderSyncJob.findFirst({
      where: { accountId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    })

    const isIncremental = !!lastSuccessfulSync?.completedAt
    const allOrders: AmazonOrder[] = []
    let nextToken: string | undefined
    let pagesFetched = 0

    if (isIncremental) {
      // Incremental: fetch only orders updated since last sync (minus 5 min buffer)
      const lastUpdatedAfter = new Date(lastSuccessfulSync.completedAt!.getTime() - 5 * 60 * 1000).toISOString()
      console.log(`[SyncOrders] Incremental sync — LastUpdatedAfter=${lastUpdatedAfter}`)
      do {
        const params: Record<string, string> = {
          MarketplaceIds:      account.marketplaceId,
          OrderStatuses:       'Unshipped,PartiallyShipped',
          FulfillmentChannels: 'MFN',
          LastUpdatedAfter:    lastUpdatedAfter,
          MaxResultsPerPage:   '100',
        }
        if (nextToken) params.NextToken = nextToken

        console.log(`[SyncOrders] Calling SP-API /orders/v0/orders (incremental page ${pagesFetched + 1})`)
        const resp = await client.get<GetOrdersResponse>('/orders/v0/orders', params)
        pagesFetched++
        if (resp?.errors?.length) {
          const errMsg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
          throw new Error(`SP-API returned errors: ${errMsg}`)
        }
        const ordersOnPage = resp?.payload?.Orders ?? []
        console.log(`[SyncOrders] Incremental page ${pagesFetched} returned ${ordersOnPage.length} orders`)
        allOrders.push(...ordersOnPage)
        nextToken = resp?.payload?.NextToken
        if (nextToken && pagesFetched >= ORDERS_PAGE_BURST) await sleep(PAGE_SLEEP_MS)
      } while (nextToken)
    } else {
      // Full sync: 60-day window for first-time or fallback
      const createdAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      console.log(`[SyncOrders] Full sync — CreatedAfter=${createdAfter}`)
      do {
        const params: Record<string, string> = {
          MarketplaceIds:      account.marketplaceId,
          OrderStatuses:       'Unshipped,PartiallyShipped',
          FulfillmentChannels: 'MFN',
          CreatedAfter:        createdAfter,
          MaxResultsPerPage:   '100',
        }
        if (nextToken) params.NextToken = nextToken

        console.log(`[SyncOrders] Calling SP-API /orders/v0/orders (page ${pagesFetched + 1})`)
        const resp = await client.get<GetOrdersResponse>('/orders/v0/orders', params)
        pagesFetched++
        if (resp?.errors?.length) {
          const errMsg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
          throw new Error(`SP-API returned errors: ${errMsg}`)
        }
        const ordersOnPage = resp?.payload?.Orders ?? []
        console.log(`[SyncOrders] Page ${pagesFetched} returned ${ordersOnPage.length} orders`)
        allOrders.push(...ordersOnPage)
        nextToken = resp?.payload?.NextToken
        if (nextToken && pagesFetched >= ORDERS_PAGE_BURST) await sleep(PAGE_SLEEP_MS)
      } while (nextToken)
    }

    console.log(`[SyncOrders] Total orders fetched: ${allOrders.length} (${isIncremental ? 'incremental' : 'full'} sync, ${pagesFetched} pages)`)
    await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalFound: allOrders.length } })

    // ── Pre-load existing orders to avoid per-order DB lookups and skip ──────
    // unnecessary SP-API calls for orders we already know about.
    const existingRows = await prisma.order.findMany({
      where: { accountId },
      select: {
        amazonOrderId: true,
        olmNumber:     true,
        orderStatus:   true,
        _count: { select: { items: true } },
      },
    })
    const existingMap = new Map(existingRows.map(r => [r.amazonOrderId, r]))
    console.log(`[SyncOrders] ${existingMap.size} orders already in DB (detail/items calls will be skipped for these)`)

    // Pre-allocate OLM numbers for new orders in a single aggregate query
    const newAmazonIds = allOrders
      .map(o => o.AmazonOrderId!)
      .filter(id => id && !existingMap.has(id))
    const olmMap = new Map<string, number>()
    if (newAmazonIds.length > 0) {
      const agg = await prisma.order.aggregate({ _max: { olmNumber: true } })
      let nextOlm = (agg._max.olmNumber ?? 999) + 1
      for (const id of newAmazonIds) olmMap.set(id, nextOlm++)
      console.log(`[SyncOrders] ${newAmazonIds.length} new orders — OLM numbers pre-allocated`)
    }

    let synced = 0
    let detailCallCount = 0  // tracks only new-order detail API calls
    let itemsCallCount  = 0  // tracks only new/no-items items API calls

    for (let i = 0; i < allOrders.length; i++) {
      const o = allOrders[i]
      if (!o.AmazonOrderId) continue

      const existing        = existingMap.get(o.AmazonOrderId)
      const isNew           = !existing
      const existingHasItems = (existing?._count?.items ?? 0) > 0
      // Re-fetch items if order transitioned from Unshipped → PartiallyShipped
      const statusChanged   = existing && o.OrderStatus !== existing.orderStatus

      // ── Detail call: only for NEW orders ──────────────────────────────────
      // Existing orders already have their shipping address from a previous
      // sync (or SS enrichment). Skipping this call is the biggest time-saver
      // on re-syncs since it removes up to N × 1100 ms of throttle sleeps.
      let fullOrder: AmazonOrder = o
      if (isNew) {
        try {
          // Sleep BEFORE the call once burst budget is spent
          if (detailCallCount >= ORDER_DETAIL_BURST) await sleep(DETAIL_SLEEP_MS)
          const detail = await client.get<GetOrderResponse>(`/orders/v0/orders/${o.AmazonOrderId}`, {})
          detailCallCount++
          if (detail?.errors?.length) throw new Error(detail.errors.map(e => e.message).join('; '))
          if (detail?.payload) fullOrder = { ...o, ...detail.payload }
        } catch {
          // Fall back to list data if single-order fetch fails
        }
      }

      const addr = fullOrder.ShippingAddress

      const orderRecord = await prisma.order.upsert({
        where: { accountId_amazonOrderId_orderSource: { accountId, amazonOrderId: o.AmazonOrderId, orderSource: 'amazon' } },
        create: {
          accountId,
          amazonOrderId: o.AmazonOrderId,
          olmNumber: olmMap.get(o.AmazonOrderId),
          orderStatus:             fullOrder.OrderStatus ?? 'Unknown',
          workflowStatus:          'PENDING',
          purchaseDate:            new Date(fullOrder.PurchaseDate ?? Date.now()),
          lastUpdateDate:          new Date(fullOrder.LastUpdateDate ?? Date.now()),
          orderTotal:              fullOrder.OrderTotal?.Amount ? parseFloat(fullOrder.OrderTotal.Amount) : null,
          currency:                fullOrder.OrderTotal?.CurrencyCode ?? 'USD',
          fulfillmentChannel:      fullOrder.FulfillmentChannel ?? null,
          shipmentServiceLevel:    fullOrder.ShipmentServiceLevelCategory ?? null,
          numberOfItemsUnshipped:  fullOrder.NumberOfItemsUnshipped ?? 0,
          shipToName:              addr?.Name            ?? null,
          shipToAddress1:          addr?.AddressLine1    ?? null,
          shipToAddress2:          addr?.AddressLine2    ?? null,
          shipToCity:              addr?.City            ?? null,
          shipToState:             addr?.StateOrRegion   ?? null,
          shipToPostal:            addr?.PostalCode      ?? null,
          shipToCountry:           addr?.CountryCode     ?? null,
          shipToPhone:             addr?.Phone           ?? null,
          isPrime:                 fullOrder.IsPrime ?? false,
          isBuyerRequestedCancel:  fullOrder.IsBuyerRequestedCancel ?? false,
          buyerCancelReason:       fullOrder.BuyerRequestedCancelReason ?? null,
          latestShipDate:          fullOrder.LatestShipDate ? new Date(fullOrder.LatestShipDate) : null,
          lastSyncedAt:            new Date(),
        },
        update: {
          orderStatus:             fullOrder.OrderStatus ?? 'Unknown',
          lastUpdateDate:          new Date(fullOrder.LastUpdateDate ?? Date.now()),
          numberOfItemsUnshipped:  fullOrder.NumberOfItemsUnshipped ?? 0,
          isPrime:                 fullOrder.IsPrime ?? false,
          isBuyerRequestedCancel:  fullOrder.IsBuyerRequestedCancel ?? false,
          buyerCancelReason:       fullOrder.BuyerRequestedCancelReason ?? null,
          latestShipDate:          fullOrder.LatestShipDate ? new Date(fullOrder.LatestShipDate) : null,
          lastSyncedAt:            new Date(),
          // Only update address for new orders — existing orders already have
          // a clean address (possibly enriched by ShipStation). Overwriting
          // with the masked SP-API list-endpoint data would destroy that.
          ...(isNew && addr ? {
            shipToName:     addr.Name         ?? null,
            shipToAddress1: addr.AddressLine1 ?? null,
            shipToAddress2: addr.AddressLine2 ?? null,
            shipToCity:     addr.City         ?? null,
            shipToState:    addr.StateOrRegion ?? null,
            shipToPostal:   addr.PostalCode   ?? null,
            shipToCountry:  addr.CountryCode  ?? null,
            shipToPhone:    addr.Phone        ?? null,
          } : {}),
        },
      })

      // ── Items call: only for new orders or those missing/changed items ─────
      if (isNew || !existingHasItems || statusChanged) {
        try {
          if (itemsCallCount >= ITEMS_BURST) await sleep(ITEMS_DELAY_MS)
          const itemResp = await client.get<GetOrderItemsResponse>(
            `/orders/v0/orders/${o.AmazonOrderId}/orderItems`, {},
          )
          itemsCallCount++
          const items = (itemResp?.payload?.OrderItems ?? []).filter(it => it.OrderItemId)
          if (items.length > 0) {
            // Batch all item upserts in a single transaction
            await prisma.$transaction(
              items.map(item => prisma.orderItem.upsert({
                where: { orderId_orderItemId: { orderId: orderRecord.id, orderItemId: item.OrderItemId! } },
                create: {
                  orderId: orderRecord.id, orderItemId: item.OrderItemId!,
                  asin: item.ASIN ?? null, sellerSku: item.SellerSKU ?? null,
                  title: item.Title ?? null,
                  quantityOrdered: item.QuantityOrdered ?? 1,
                  quantityShipped: item.QuantityShipped ?? 0,
                  itemPrice: item.ItemPrice?.Amount ? parseFloat(item.ItemPrice.Amount) : null,
                  shippingPrice: item.ShippingPrice?.Amount ? parseFloat(item.ShippingPrice.Amount) : null,
                  isTransparency: item.IsTransparency === true,
                },
                update: {
                  quantityOrdered: item.QuantityOrdered ?? 1,
                  quantityShipped: item.QuantityShipped ?? 0,
                  sellerSku: item.SellerSKU ?? null,
                  isTransparency: item.IsTransparency === true,
                },
              })),
            )
          }
        } catch (e) {
          console.error(`[SyncOrders] items fetch failed for ${o.AmazonOrderId}:`, e)
        }
      }

      synced++
      // Batch progress updates — write every 25 orders to reduce DB round-trips
      if (synced % 25 === 0 || i === allOrders.length - 1) {
        await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalSynced: synced } })
      }
    }

    console.log(`[SyncOrders] SP-API calls made — detail: ${detailCallCount}, items: ${itemsCallCount} (of ${allOrders.length} total orders)`)

    // NOTE: ShipStation enrichment (ssOrderId + address backfill) is now a
    // separate step triggered by the frontend AFTER sync completes.
    // See /api/orders/enrich-shipstation

    // Remove orders that are no longer Unshipped/PartiallyShipped on Amazon
    // (shipped, cancelled, or reverted to Pending). Only touch PENDING internal
    // status — orders already being processed stay in the system.
    // Skip cleanup on incremental syncs since we only fetched a subset of orders.
    if (!isIncremental) {
      const fetched = allOrders.map(o => o.AmazonOrderId!).filter(Boolean)
      await prisma.order.deleteMany({
        where: {
          accountId,
          orderSource: 'amazon',
          fulfillmentChannel: 'MFN',
          workflowStatus: 'PENDING',
          amazonOrderId: { notIn: fetched },
          purchaseDate: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
        },
      })
    }

    console.log(`[SyncOrders] Sync complete — ${synced} orders upserted`)
    await prisma.orderSyncJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[SyncOrders] Fatal error:', msg)
    try {
      await prisma.orderSyncJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: msg, completedAt: new Date() },
      })
    } catch (dbErr) {
      console.error('[SyncOrders] Could not mark job as FAILED:', dbErr)
    }
  }
}

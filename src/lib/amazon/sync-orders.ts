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
import { decrypt } from '@/lib/crypto'
import { ShipStationClient } from '@/lib/shipstation/client'

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

    const createdAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    console.log(`[SyncOrders] Fetching orders created after ${createdAfter}`)
    const allOrders: AmazonOrder[] = []
    let nextToken: string | undefined
    let pagesFetched = 0

    // Fetch all order statuses in one pass
    do {
      const params: Record<string, string> = {
        MarketplaceIds:     account.marketplaceId,
        OrderStatuses:      'Unshipped,PartiallyShipped',  // MFN shippable only (no Pending)
        FulfillmentChannels: 'MFN',                                // exclude FBA
        CreatedAfter:       createdAfter,
        MaxResultsPerPage:  '100',
      }
      if (nextToken) params.NextToken = nextToken

      console.log(`[SyncOrders] Calling SP-API /orders/v0/orders (page ${pagesFetched + 1})`)
      const resp = await client.get<GetOrdersResponse>('/orders/v0/orders', params)
      pagesFetched++

      // SP-API can return 200 with an errors array instead of a payload
      if (resp?.errors?.length) {
        const errMsg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
        throw new Error(`SP-API returned errors: ${errMsg}`)
      }

      const ordersOnPage = resp?.payload?.Orders ?? []
      console.log(`[SyncOrders] Page ${pagesFetched} returned ${ordersOnPage.length} orders`)
      allOrders.push(...ordersOnPage)
      nextToken = resp?.payload?.NextToken
      // Use burst capacity for the first ORDERS_PAGE_BURST pages (no sleep needed).
      // After that, throttle to stay within the 0.0167 req/s sustained rate.
      if (nextToken && pagesFetched >= ORDERS_PAGE_BURST) await sleep(PAGE_SLEEP_MS)
    } while (nextToken)

    console.log(`[SyncOrders] Total orders fetched: ${allOrders.length}`)
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
        where: { accountId_amazonOrderId: { accountId, amazonOrderId: o.AmazonOrderId } },
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
          for (const item of itemResp?.payload?.OrderItems ?? []) {
            if (!item.OrderItemId) continue
            await prisma.orderItem.upsert({
              where: { orderId_orderItemId: { orderId: orderRecord.id, orderItemId: item.OrderItemId } },
              create: {
                orderId: orderRecord.id, orderItemId: item.OrderItemId,
                asin: item.ASIN ?? null, sellerSku: item.SellerSKU ?? null,
                title: item.Title ?? null,
                quantityOrdered: item.QuantityOrdered ?? 1,
                quantityShipped: item.QuantityShipped ?? 0,
                itemPrice: item.ItemPrice?.Amount ? parseFloat(item.ItemPrice.Amount) : null,
                shippingPrice: item.ShippingPrice?.Amount ? parseFloat(item.ShippingPrice.Amount) : null,
              },
              update: {
                quantityOrdered: item.QuantityOrdered ?? 1,
                quantityShipped: item.QuantityShipped ?? 0,
                sellerSku: item.SellerSKU ?? null,
              },
            })
          }
        } catch (e) {
          console.error(`[SyncOrders] items fetch failed for ${o.AmazonOrderId}:`, e)
        }
      }

      synced++
      // Batch progress updates — write every 5 orders to reduce DB round-trips
      if (synced % 5 === 0 || i === allOrders.length - 1) {
        await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalSynced: synced } })
      }
    }

    console.log(`[SyncOrders] SP-API calls made — detail: ${detailCallCount}, items: ${itemsCallCount} (of ${allOrders.length} total orders)`)

    // ── ShipStation address enrichment ──────────────────────────────────────
    // Amazon masks shipping addresses on unshipped orders — city, state, and
    // postal often come back null from the SP-API.  ShipStation has the real
    // (unmasked) address, so after the Amazon pass we back-fill any orders
    // that are still missing address fields.
    try {
      const ssAccount = await prisma.shipStationAccount.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { apiKeyEnc: true, apiSecretEnc: true },
      })
      if (ssAccount) {
        const ssClient = new ShipStationClient(
          decrypt(ssAccount.apiKeyEnc),
          decrypt(ssAccount.apiSecretEnc),
        )
        const needsAddress = await prisma.order.findMany({
          where: { accountId, OR: [{ shipToPostal: null }, { shipToCity: null }] },
          select: { id: true, amazonOrderId: true },
        })
        console.log(`[SyncOrders] ShipStation address enrichment: ${needsAddress.length} orders need address lookup`)
        for (let j = 0; j < needsAddress.length; j++) {
          const o = needsAddress[j]
          try {
            const ssOrder = await ssClient.findOrderByNumber(o.amazonOrderId)
            if (ssOrder?.shipTo) {
              const st = ssOrder.shipTo
              await prisma.order.update({
                where: { id: o.id },
                data: {
                  shipToName:     st.name       || null,
                  shipToAddress1: st.street1    || null,
                  shipToAddress2: st.street2    || null,
                  shipToCity:     st.city       || null,
                  shipToState:    st.state      || null,
                  shipToPostal:   st.postalCode || null,
                  shipToCountry:  st.country    || null,
                  shipToPhone:    st.phone      || null,
                },
              })
              console.log(`[SyncOrders] Enriched address for ${o.amazonOrderId}: ${st.city}, ${st.state} ${st.postalCode}`)
            }
          } catch (e) {
            console.warn(`[SyncOrders] Address enrichment failed for ${o.amazonOrderId}:`, e instanceof Error ? e.message : String(e))
          }
          // ShipStation V1 allows 40 req/min — 700 ms gap keeps us well under
          if (j < needsAddress.length - 1) await sleep(700)
        }
      } else {
        console.log('[SyncOrders] No ShipStation account configured — skipping address enrichment')
      }
    } catch (enrichErr) {
      // Don't fail the whole sync if enrichment errors out
      console.warn('[SyncOrders] Address enrichment error:', enrichErr instanceof Error ? enrichErr.message : String(enrichErr))
    }

    // Remove orders that are no longer Unshipped/PartiallyShipped on Amazon
    // (shipped, cancelled, or reverted to Pending). Only touch PENDING internal
    // status — orders already being processed stay in the system.
    const fetched = allOrders.map(o => o.AmazonOrderId!).filter(Boolean)
    await prisma.order.deleteMany({
      where: {
        accountId,
        fulfillmentChannel: 'MFN',
        workflowStatus: 'PENDING',
        amazonOrderId: { notIn: fetched },
        purchaseDate: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
      },
    })

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

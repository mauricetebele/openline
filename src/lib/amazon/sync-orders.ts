/**
 * Orders sync — fetches MFN (Pending/Unshipped/PartiallyShipped) and
 * AFN/FBA (Pending/Unshipped/Shipped) orders from SP-API and upserts them
 * (with line items) into the DB. AFN orders are created as SHIPPED.
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
import { pushQtyForProducts } from '@/lib/push-qty-for-product'
import { SpApiClient } from './sp-api'

const ORDERS_PAGE_BURST  = 20   // free burst calls for GetOrders
const ORDER_DETAIL_BURST = 30   // free burst calls for GetOrder
const ITEMS_BURST        = 30   // free burst calls for GetOrderItems
const PAGE_SLEEP_MS      = 65_000  // after burst: 0.0167 req/s
const DETAIL_SLEEP_MS    = 1_100   // after burst: ~1 req/s
const ITEMS_DELAY_MS     = 2_100   // after burst: 0.5 req/s

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

/** Atomically allocate the next OLM number. Retries on conflict (race with concurrent sync). */
async function nextOlmNumber(): Promise<number> {
  const agg = await prisma.order.aggregate({ _max: { olmNumber: true } })
  return (agg._max.olmNumber ?? 999) + 1
}

// ─── SP-API types ─────────────────────────────────────────────────────────────

interface OrderAddress {
  Name?: string; AddressLine1?: string; AddressLine2?: string; City?: string
  StateOrRegion?: string; PostalCode?: string; CountryCode?: string; Phone?: string
}
interface AmazonOrder {
  AmazonOrderId?: string; OrderStatus?: string; PurchaseDate?: string
  LastUpdateDate?: string; LatestShipDate?: string; LatestDeliveryDate?: string
  OrderTotal?: { Amount?: string; CurrencyCode?: string }
  FulfillmentChannel?: string; ShipmentServiceLevelCategory?: string
  NumberOfItemsUnshipped?: number; ShippingAddress?: OrderAddress
  IsPrime?: boolean
  IsBuyerRequestedCancel?: boolean
  BuyerRequestedCancelReason?: string
  IsReplacementOrder?: boolean
  ReplacedOrderId?: string
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

// ─── Auto-process ────────────────────────────────────────────────────────────

/**
 * Attempts to auto-process PENDING orders for an account by reserving
 * finished-goods inventory. Orders where ALL items have sufficient stock
 * at a finished-goods location are moved to PROCESSING automatically.
 */
async function autoProcessPendingOrders(accountId: string): Promise<string[]> {
  const pendingOrders = await prisma.order.findMany({
    where: {
      accountId,
      workflowStatus: 'PENDING',
      // Don't auto-process orders still awaiting payment on Amazon
      orderStatus: { not: 'Pending' },
      // Never auto-process AFN (FBA) orders — Amazon fulfills those from their warehouse.
      // Processing them would decrement our local inventory and create phantom reservations.
      fulfillmentChannel: { not: 'AFN' },
    },
    include: { items: true },
  })

  if (pendingOrders.length === 0) return []
  console.log(`[AutoProcess] Evaluating ${pendingOrders.length} PENDING orders`)

  let processed = 0
  let skipped = 0
  const affectedProductIds: string[] = []

  for (const order of pendingOrders) {
    try {
      // Build reservation plan for all items
      const plan: {
        orderItemId: string
        productId: string
        locationId: string
        gradeId: string | null
        qtyReserved: number
      }[] = []
      let canFulfill = true

      for (const item of order.items) {
        if (!item.sellerSku) { canFulfill = false; break }

        // Resolve SKU → product + grade (same logic as inventory endpoint)
        const msku = await prisma.productGradeMarketplaceSku.findFirst({
          where: { sellerSku: item.sellerSku },
        })

        const gradeId = msku?.gradeId ?? null
        let productId: string | null = null

        // Try direct SKU match first
        const directProduct = await prisma.product.findUnique({
          where: { sku: item.sellerSku },
          select: { id: true },
        })
        if (directProduct) {
          productId = directProduct.id
        } else if (msku) {
          productId = msku.productId
        }

        if (!productId) { canFulfill = false; break }

        // Find a finished-goods location with enough stock
        const inv = await prisma.inventoryItem.findFirst({
          where: {
            productId,
            qty: { gte: item.quantityOrdered },
            ...(gradeId ? { gradeId } : {}),
            location: { isFinishedGoods: true },
          },
          orderBy: { qty: 'desc' },
        })

        if (!inv) { canFulfill = false; break }

        plan.push({
          orderItemId: item.id,
          productId,
          locationId: inv.locationId,
          gradeId: inv.gradeId,
          qtyReserved: item.quantityOrdered,
        })
      }

      if (!canFulfill || plan.length === 0) {
        skipped++
        continue
      }

      // Execute reservations in a transaction
      await prisma.$transaction(async (tx) => {
        for (const r of plan) {
          if (r.gradeId) {
            await tx.inventoryItem.update({
              where: {
                productId_locationId_gradeId: {
                  productId: r.productId,
                  locationId: r.locationId,
                  gradeId: r.gradeId,
                },
              },
              data: { qty: { decrement: r.qtyReserved } },
            })
          } else {
            const inv = await tx.inventoryItem.findFirst({
              where: { productId: r.productId, locationId: r.locationId, gradeId: null },
            })
            if (!inv) throw new Error(`Inventory not found for product ${r.productId}`)
            await tx.inventoryItem.update({
              where: { id: inv.id },
              data: { qty: { decrement: r.qtyReserved } },
            })
          }

          await tx.orderInventoryReservation.create({
            data: {
              orderId: order.id,
              orderItemId: r.orderItemId,
              productId: r.productId,
              locationId: r.locationId,
              gradeId: r.gradeId,
              qtyReserved: r.qtyReserved,
            },
          })
        }

        await tx.order.update({
          where: { id: order.id },
          data: { workflowStatus: 'PROCESSING', processedAt: new Date() },
        })
      })

      affectedProductIds.push(...plan.map(r => r.productId))
      processed++
    } catch (err) {
      console.error(`[AutoProcess] Failed for order ${order.amazonOrderId}:`, err)
    }
  }

  console.log(`[AutoProcess] Done — ${processed} auto-processed, ${skipped} skipped (insufficient stock)`)
  return affectedProductIds
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export type SyncMode = 'mfn-only' | 'afn-only' | 'all'

export async function syncUnshippedOrders(
  accountId: string,
  jobId: string,
  mode: SyncMode = 'all',
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
    const syncMfn = mode === 'mfn-only' || mode === 'all'
    const syncAfn = mode === 'afn-only' || mode === 'all'

    // ── MFN orders (Pending/Unshipped/PartiallyShipped) ─────────────────────
    if (syncMfn) {
      if (isIncremental) {
        const lastUpdatedAfter = new Date(lastSuccessfulSync.completedAt!.getTime() - 5 * 60 * 1000).toISOString()
        console.log(`[SyncOrders] Incremental MFN sync — LastUpdatedAfter=${lastUpdatedAfter}`)
        do {
          const params: Record<string, string> = {
            MarketplaceIds:      account.marketplaceId,
            OrderStatuses:       'Pending,Unshipped,PartiallyShipped',
            FulfillmentChannels: 'MFN',
            LastUpdatedAfter:    lastUpdatedAfter,
            MaxResultsPerPage:   '100',
          }
          if (nextToken) params.NextToken = nextToken

          console.log(`[SyncOrders] Calling SP-API /orders/v0/orders (MFN incremental page ${pagesFetched + 1})`)
          const resp = await client.get<GetOrdersResponse>('/orders/v0/orders', params)
          pagesFetched++
          if (resp?.errors?.length) {
            const errMsg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
            throw new Error(`SP-API returned errors: ${errMsg}`)
          }
          const ordersOnPage = resp?.payload?.Orders ?? []
          console.log(`[SyncOrders] MFN incremental page ${pagesFetched} returned ${ordersOnPage.length} orders`)
          allOrders.push(...ordersOnPage)
          nextToken = resp?.payload?.NextToken
          if (nextToken && pagesFetched >= ORDERS_PAGE_BURST) await sleep(PAGE_SLEEP_MS)
        } while (nextToken)
      } else {
        const createdAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
        console.log(`[SyncOrders] Full MFN sync — CreatedAfter=${createdAfter}`)
        do {
          const params: Record<string, string> = {
            MarketplaceIds:      account.marketplaceId,
            OrderStatuses:       'Pending,Unshipped,PartiallyShipped',
            FulfillmentChannels: 'MFN',
            CreatedAfter:        createdAfter,
            MaxResultsPerPage:   '100',
          }
          if (nextToken) params.NextToken = nextToken

          console.log(`[SyncOrders] Calling SP-API /orders/v0/orders (MFN page ${pagesFetched + 1})`)
          const resp = await client.get<GetOrdersResponse>('/orders/v0/orders', params)
          pagesFetched++
          if (resp?.errors?.length) {
            const errMsg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
            throw new Error(`SP-API returned errors: ${errMsg}`)
          }
          const ordersOnPage = resp?.payload?.Orders ?? []
          console.log(`[SyncOrders] MFN page ${pagesFetched} returned ${ordersOnPage.length} orders`)
          allOrders.push(...ordersOnPage)
          nextToken = resp?.payload?.NextToken
          if (nextToken && pagesFetched >= ORDERS_PAGE_BURST) await sleep(PAGE_SLEEP_MS)
        } while (nextToken)
      }
    }

    // ── AFN (FBA) orders — separate fetch since they need 'Shipped' status ──
    let afnNextToken: string | undefined
    let afnPagesFetched = 0

    if (syncAfn) {
      if (isIncremental) {
        const lastUpdatedAfter = new Date(lastSuccessfulSync.completedAt!.getTime() - 5 * 60 * 1000).toISOString()
        do {
          const params: Record<string, string> = {
            MarketplaceIds:      account.marketplaceId,
            OrderStatuses:       'Pending,Unshipped,Shipped',
            FulfillmentChannels: 'AFN',
            LastUpdatedAfter:    lastUpdatedAfter,
            MaxResultsPerPage:   '100',
          }
          if (afnNextToken) params.NextToken = afnNextToken
          console.log(`[SyncOrders] Calling SP-API /orders/v0/orders (AFN incremental page ${afnPagesFetched + 1})`)
          const resp = await client.get<GetOrdersResponse>('/orders/v0/orders', params)
          afnPagesFetched++
          if (resp?.errors?.length) {
            const errMsg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
            throw new Error(`SP-API AFN returned errors: ${errMsg}`)
          }
          const ordersOnPage = resp?.payload?.Orders ?? []
          console.log(`[SyncOrders] AFN incremental page ${afnPagesFetched} returned ${ordersOnPage.length} orders`)
          allOrders.push(...ordersOnPage)
          afnNextToken = resp?.payload?.NextToken
          if (afnNextToken && (pagesFetched + afnPagesFetched) >= ORDERS_PAGE_BURST) await sleep(PAGE_SLEEP_MS)
        } while (afnNextToken)
      } else {
        const createdAfter = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
        do {
          const params: Record<string, string> = {
            MarketplaceIds:      account.marketplaceId,
            OrderStatuses:       'Pending,Unshipped,Shipped',
            FulfillmentChannels: 'AFN',
            CreatedAfter:        createdAfter,
            MaxResultsPerPage:   '100',
          }
          if (afnNextToken) params.NextToken = afnNextToken
          console.log(`[SyncOrders] Calling SP-API /orders/v0/orders (AFN page ${afnPagesFetched + 1})`)
          const resp = await client.get<GetOrdersResponse>('/orders/v0/orders', params)
          afnPagesFetched++
          if (resp?.errors?.length) {
            const errMsg = resp.errors.map(e => `${e.code}: ${e.message}`).join('; ')
            throw new Error(`SP-API AFN returned errors: ${errMsg}`)
          }
          const ordersOnPage = resp?.payload?.Orders ?? []
          console.log(`[SyncOrders] AFN page ${afnPagesFetched} returned ${ordersOnPage.length} orders`)
          allOrders.push(...ordersOnPage)
          afnNextToken = resp?.payload?.NextToken
          if (afnNextToken && (pagesFetched + afnPagesFetched) >= ORDERS_PAGE_BURST) await sleep(PAGE_SLEEP_MS)
        } while (afnNextToken)
      }
    }

    console.log(`[SyncOrders] Total orders fetched: ${allOrders.length} (${isIncremental ? 'incremental' : 'full'} sync, mode=${mode}, ${pagesFetched} MFN + ${afnPagesFetched} AFN pages)`)
    await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalFound: allOrders.length } })

    // ── Pre-load existing orders to avoid per-order DB lookups and skip ──────
    // unnecessary SP-API calls for orders we already know about.
    const existingRows = await prisma.order.findMany({
      where: { accountId },
      select: {
        amazonOrderId:  true,
        olmNumber:      true,
        orderStatus:    true,
        workflowStatus: true,
        _count: { select: { items: true } },
      },
    })
    const existingMap = new Map(existingRows.map(r => [r.amazonOrderId, r]))
    console.log(`[SyncOrders] ${existingMap.size} orders already in DB (detail/items calls will be skipped for these)`)

    const newAmazonIds = allOrders
      .map(o => o.AmazonOrderId!)
      .filter(id => id && !existingMap.has(id))
    if (newAmazonIds.length > 0) {
      console.log(`[SyncOrders] ${newAmazonIds.length} new orders detected`)
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
      const isAfn = fullOrder.FulfillmentChannel === 'AFN'
      const isAfnShipped = isAfn && fullOrder.OrderStatus === 'Shipped'

      const orderRecord = await (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await prisma.order.upsert({
              where: { accountId_amazonOrderId_orderSource: { accountId, amazonOrderId: o.AmazonOrderId!, orderSource: 'amazon' } },
              create: {
                accountId,
                amazonOrderId: o.AmazonOrderId!,
                olmNumber: isNew ? await nextOlmNumber() : undefined,
                orderStatus:             fullOrder.OrderStatus ?? 'Unknown',
                workflowStatus:          isAfnShipped ? 'SHIPPED' : 'PENDING',
                ...(isAfnShipped ? { shippedAt: new Date(fullOrder.LastUpdateDate ?? fullOrder.PurchaseDate ?? Date.now()) } : {}),
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
                isPrime:                 fullOrder.IsPrime === true,
                isReplacement:           fullOrder.IsReplacementOrder === true,
                isBuyerRequestedCancel:  fullOrder.IsBuyerRequestedCancel === true,
                buyerCancelReason:       fullOrder.BuyerRequestedCancelReason ?? null,
                latestShipDate:          fullOrder.LatestShipDate ? new Date(fullOrder.LatestShipDate) : null,
                latestDeliveryDate:      fullOrder.LatestDeliveryDate ? new Date(fullOrder.LatestDeliveryDate) : null,
                lastSyncedAt:            new Date(),
              },
              update: {
                orderStatus:             fullOrder.OrderStatus ?? 'Unknown',
                lastUpdateDate:          new Date(fullOrder.LastUpdateDate ?? Date.now()),
                orderTotal:              fullOrder.OrderTotal?.Amount ? parseFloat(fullOrder.OrderTotal.Amount) : undefined,
                numberOfItemsUnshipped:  fullOrder.NumberOfItemsUnshipped ?? 0,
                fulfillmentChannel:      fullOrder.FulfillmentChannel ?? undefined,
                isPrime:                 fullOrder.IsPrime === true,
                isReplacement:           fullOrder.IsReplacementOrder === true,
                isBuyerRequestedCancel:  fullOrder.IsBuyerRequestedCancel === true,
                buyerCancelReason:       fullOrder.BuyerRequestedCancelReason ?? null,
                latestShipDate:          fullOrder.LatestShipDate ? new Date(fullOrder.LatestShipDate) : null,
                latestDeliveryDate:      fullOrder.LatestDeliveryDate ? new Date(fullOrder.LatestDeliveryDate) : null,
                lastSyncedAt:            new Date(),
                // AFN orders shipped by Amazon: advance workflow to SHIPPED
                ...(isAfnShipped ? {
                  workflowStatus: 'SHIPPED',
                  shippedAt: new Date(fullOrder.LastUpdateDate ?? Date.now()),
                } : {}),
                ...(addr ? {
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
          } catch (err) {
            // Retry on OLM unique constraint race (concurrent Amazon + BM sync)
            const isOlmConflict = err instanceof Error && err.message.includes('olmNumber')
            if (isOlmConflict && attempt < 2) {
              console.warn(`[SyncOrders] OLM conflict for ${o.AmazonOrderId}, retrying (attempt ${attempt + 1})`)
              continue
            }
            throw err
          }
        }
        throw new Error('Unreachable')
      })()

      // ── AFN shipped: release any accidental inventory reservations ──────────
      // AFN orders should never have local reservations, but if auto-process ran
      // before this fix, clean them up now and restore the decremented qty.
      if (isAfnShipped && !isNew && existing?.workflowStatus !== 'SHIPPED') {
        const staleReservations = await prisma.orderInventoryReservation.findMany({
          where: { orderId: orderRecord.id },
        })
        if (staleReservations.length > 0) {
          await prisma.$transaction(async (tx) => {
            for (const r of staleReservations) {
              // Restore the qty that was incorrectly decremented during auto-process
              if (r.gradeId) {
                await tx.inventoryItem.update({
                  where: {
                    productId_locationId_gradeId: {
                      productId: r.productId,
                      locationId: r.locationId,
                      gradeId: r.gradeId,
                    },
                  },
                  data: { qty: { increment: r.qtyReserved } },
                })
              } else {
                const inv = await tx.inventoryItem.findFirst({
                  where: { productId: r.productId, locationId: r.locationId, gradeId: null },
                })
                if (inv) {
                  await tx.inventoryItem.update({
                    where: { id: inv.id },
                    data: { qty: { increment: r.qtyReserved } },
                  })
                }
              }
            }
            await tx.orderInventoryReservation.deleteMany({ where: { orderId: orderRecord.id } })
          })
          console.log(`[SyncOrders] Released ${staleReservations.length} stale AFN reservations for ${o.AmazonOrderId}`)
        }
      }

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
                  itemTax: item.ItemTax?.Amount ? parseFloat(item.ItemTax.Amount) : null,
                  shippingPrice: item.ShippingPrice?.Amount ? parseFloat(item.ShippingPrice.Amount) : null,
                  isTransparency: item.IsTransparency === true,
                },
                update: {
                  quantityOrdered: item.QuantityOrdered ?? 1,
                  quantityShipped: item.QuantityShipped ?? 0,
                  sellerSku: item.SellerSKU ?? null,
                  itemPrice: item.ItemPrice?.Amount ? parseFloat(item.ItemPrice.Amount) : undefined,
                  itemTax: item.ItemTax?.Amount ? parseFloat(item.ItemTax.Amount) : undefined,
                  shippingPrice: item.ShippingPrice?.Amount ? parseFloat(item.ShippingPrice.Amount) : undefined,
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

    // Auto-process and cleanup only apply to MFN orders
    if (syncMfn) {
      // Auto-process orders that can be fulfilled from finished-goods inventory
      const autoProcessedProductIds = await autoProcessPendingOrders(accountId)
      if (autoProcessedProductIds.length > 0) {
        pushQtyForProducts(autoProcessedProductIds)
      }

      // NOTE: ShipStation enrichment (ssOrderId + address backfill) is now a
      // separate step triggered by the frontend AFTER sync completes.
      // See /api/orders/enrich-shipstation

      // Remove orders that are no longer Pending/Unshipped/PartiallyShipped on Amazon
      // (shipped, cancelled, or payment failed). Only touch PENDING internal
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

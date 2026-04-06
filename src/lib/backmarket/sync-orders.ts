/**
 * BackMarket order sync — fetches orders with state 1 (new/awaiting validation)
 * and state 3 (accepted/shipped) from the BackMarket API and upserts
 * them into the same orders table alongside Amazon orders.
 *
 * Field mapping:
 *   BM order_id       → amazonOrderId  (reused field for external order ID)
 *   BM state 1        → "Unshipped"    (orderStatus)
 *   BM state 2        → "Pending"      (orderStatus)
 *   BM date_creation  → purchaseDate
 *   BM date_modification → lastUpdateDate
 *   BM price          → orderTotal
 *   BM currency       → currency
 *   BM shipping_address.* → shipTo* fields
 *   fulfillmentChannel  = "BACKMARKET"
 *   orderSource         = "backmarket"
 */
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from './client'

// ─── BackMarket API types ───────────────────────────────────────────────────

interface BMShippingAddress {
  first_name?: string
  last_name?: string
  street?: string
  street2?: string
  city?: string
  state?: string
  zipcode?: string
  country?: string
  phone?: string
}

interface BMOrderLine {
  id?: number | string
  listing?: string
  product?: string
  quantity?: number
  price?: string | number
  shipping_price?: string | number
  orderline_fee?: string | number
  sales_taxes?: string | number
  image?: string
  product_image?: string
  imei?: string
}

interface BMOrder {
  order_id?: number | string
  state?: number
  date_creation?: string
  date_modification?: string
  expected_dispatch_date?: string
  price?: string | number
  currency?: string
  shipping_address?: BMShippingAddress
  orderlines?: BMOrderLine[]
}

// BackMarket valid states: 0, 1, 3, 8, 9, 10
// Map BM state numbers to readable order statuses
function mapBMState(state?: number): string {
  switch (state) {
    case 0:  return 'Pending'     // pending
    case 1:  return 'Unshipped'   // new / awaiting validation
    case 3:  return 'Unshipped'   // accepted — ready to ship
    case 8:  return 'Refunded'    // refunded
    case 9:  return 'Cancelled'   // cancelled
    case 10: return 'Pending'     // pending payment
    default: return 'Unknown'
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function syncBackMarketOrders(
  accountId: string,
  jobId: string,
): Promise<void> {
  console.log(`[SyncBMOrders] Starting sync — accountId=${accountId} jobId=${jobId}`)
  await prisma.orderSyncJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } })

  try {
    // Load active BackMarket credential and decrypt API key
    const credential = await prisma.backMarketCredential.findFirst({
      where: { isActive: true },
      select: { apiKeyEnc: true },
    })
    if (!credential) throw new Error('No active BackMarket credential found')
    const apiKey = decrypt(credential.apiKeyEnc)

    const client = new BackMarketClient(apiKey)

    // Fetch orders with state 1 (new/awaiting validation) and state 3 (accepted/shipped)
    console.log('[SyncBMOrders] Fetching state=1 (new) orders…')
    const state1Orders = await client.fetchAllPages<BMOrder>('/orders', { state: 1 })
    console.log(`[SyncBMOrders] Fetched ${state1Orders.length} state=1 orders`)

    console.log('[SyncBMOrders] Fetching state=3 (accepted) orders…')
    const state3Orders = await client.fetchAllPages<BMOrder>('/orders', { state: 3 })
    console.log(`[SyncBMOrders] Fetched ${state3Orders.length} state=3 orders`)

    const allOrders = [...state1Orders, ...state3Orders]
    console.log(`[SyncBMOrders] Total orders fetched: ${allOrders.length}`)
    await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalFound: allOrders.length } })

    // Pre-load existing BackMarket orders to skip redundant work
    const existingRows = await prisma.order.findMany({
      where: { accountId, orderSource: 'backmarket' },
      select: {
        amazonOrderId: true,
        olmNumber: true,
        orderStatus: true,
        _count: { select: { items: true } },
      },
    })
    const existingMap = new Map(existingRows.map(r => [r.amazonOrderId, r]))
    console.log(`[SyncBMOrders] ${existingMap.size} BM orders already in DB`)

    let synced = 0

    /** Atomically allocate next OLM number. */
    const nextOlmNumber = async (): Promise<number> => {
      const agg = await prisma.order.aggregate({ _max: { olmNumber: true } })
      return (agg._max.olmNumber ?? 999) + 1
    }

    for (let i = 0; i < allOrders.length; i++) {
      const o = allOrders[i]
      const orderId = String(o.order_id ?? '')
      if (!orderId) continue

      const existing = existingMap.get(orderId)
      const isNew = !existing
      const addr = o.shipping_address

      const shipToName = [addr?.first_name, addr?.last_name].filter(Boolean).join(' ') || null

      // Sum orderline_fee from all orderlines for actual commission
      const totalFee = o.orderlines?.reduce((sum, line) => {
        const fee = line.orderline_fee != null ? parseFloat(String(line.orderline_fee)) : 0
        return sum + (isNaN(fee) ? 0 : fee)
      }, 0) ?? 0
      const hasRealCommission = totalFee > 0

      const orderRecord = await (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await prisma.order.upsert({
              where: {
                accountId_amazonOrderId_orderSource: {
                  accountId,
                  amazonOrderId: orderId,
                  orderSource: 'backmarket',
                },
              },
              create: {
                accountId,
                amazonOrderId: orderId,
                olmNumber: isNew ? await nextOlmNumber() : undefined,
                orderSource: 'backmarket',
                orderStatus: mapBMState(o.state),
                workflowStatus: 'PENDING',
                purchaseDate: new Date(o.date_creation ?? Date.now()),
                lastUpdateDate: new Date(o.date_modification ?? Date.now()),
                orderTotal: o.price != null ? parseFloat(String(o.price)) : null,
                currency: o.currency ?? 'EUR',
                fulfillmentChannel: 'BACKMARKET',
                shipmentServiceLevel: null,
                numberOfItemsUnshipped: o.orderlines?.reduce((sum, l) => sum + (l.quantity ?? 1), 0) ?? 0,
                shipToName,
                shipToAddress1: addr?.street ?? null,
                shipToAddress2: addr?.street2 ?? null,
                shipToCity: addr?.city ?? null,
                shipToState: addr?.state ?? null,
                shipToPostal: addr?.zipcode ?? null,
                shipToCountry: addr?.country ?? null,
                shipToPhone: addr?.phone ?? null,
                isPrime: false,
                latestDeliveryDate: o.expected_dispatch_date ? new Date(o.expected_dispatch_date) : null,
                lastSyncedAt: new Date(),
                ...(hasRealCommission ? {
                  marketplaceCommission: Math.round(totalFee * 100) / 100,
                  commissionSyncedAt: new Date(),
                } : {}),
              },
              update: {
                orderStatus: mapBMState(o.state),
                lastUpdateDate: new Date(o.date_modification ?? Date.now()),
                numberOfItemsUnshipped: o.orderlines?.reduce((sum, l) => sum + (l.quantity ?? 1), 0) ?? 0,
                latestDeliveryDate: o.expected_dispatch_date ? new Date(o.expected_dispatch_date) : undefined,
                lastSyncedAt: new Date(),
                ...(addr ? {
                  shipToName,
                  shipToAddress1: addr.street ?? null,
                  shipToAddress2: addr.street2 ?? null,
                  shipToCity: addr.city ?? null,
                  shipToState: addr.state ?? null,
                  shipToPostal: addr.zipcode ?? null,
                  shipToCountry: addr.country ?? null,
                  shipToPhone: addr.phone ?? null,
                } : {}),
                ...(hasRealCommission ? {
                  marketplaceCommission: Math.round(totalFee * 100) / 100,
                  commissionSyncedAt: new Date(),
                } : {}),
              },
            })
          } catch (err) {
            const isOlmConflict = err instanceof Error && err.message.includes('olmNumber')
            if (isOlmConflict && attempt < 2) {
              console.warn(`[SyncBMOrders] OLM conflict for ${orderId}, retrying (attempt ${attempt + 1})`)
              continue
            }
            throw err
          }
        }
        throw new Error('Unreachable')
      })()

      // Upsert order items from orderlines
      if (o.orderlines?.length) {
        for (const line of o.orderlines) {
          const lineId = String(line.id ?? '')
          if (!lineId) continue
          const lineImageUrl = line.image || line.product_image || null
          await prisma.orderItem.upsert({
            where: { orderId_orderItemId: { orderId: orderRecord.id, orderItemId: lineId } },
            create: {
              orderId: orderRecord.id,
              orderItemId: lineId,
              sellerSku: line.listing ?? null,
              title: line.product ?? null,
              quantityOrdered: line.quantity ?? 1,
              quantityShipped: 0,
              itemPrice: line.price != null ? parseFloat(String(line.price)) : null,
              shippingPrice: line.shipping_price != null ? parseFloat(String(line.shipping_price)) : null,
              imageUrl: lineImageUrl,
            },
            update: {
              sellerSku: line.listing ?? null,
              title: line.product ?? null,
              quantityOrdered: line.quantity ?? 1,
              itemPrice: line.price != null ? parseFloat(String(line.price)) : null,
              shippingPrice: line.shipping_price != null ? parseFloat(String(line.shipping_price)) : null,
              imageUrl: lineImageUrl,
            },
          })
        }
      }

      synced++
      // Batch progress updates every 5 orders
      if (synced % 5 === 0 || i === allOrders.length - 1) {
        await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalSynced: synced } })
      }
    }

    // Cleanup: delete PENDING BackMarket orders no longer returned by the API
    const fetchedIds = allOrders.map(o => String(o.order_id ?? '')).filter(Boolean)
    await prisma.order.deleteMany({
      where: {
        accountId,
        orderSource: 'backmarket',
        workflowStatus: 'PENDING',
        amazonOrderId: { notIn: fetchedIds },
      },
    })

    console.log(`[SyncBMOrders] Sync complete — ${synced} orders upserted`)
    await prisma.orderSyncJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[SyncBMOrders] Fatal error:', msg)
    try {
      await prisma.orderSyncJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: msg, completedAt: new Date() },
      })
    } catch (dbErr) {
      console.error('[SyncBMOrders] Could not mark job as FAILED:', dbErr)
    }
  }
}

/**
 * FBA Refunds sync — fetches refund data from SP-API Finances API,
 * filters to FBA-only items, enriches with FNSKU and original order date.
 *
 * Uses the same /finances/v0/financialEvents endpoint as finances.ts,
 * but stores results in the separate FbaRefund model (no review workflow).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'
import type {
  SpApiShipmentEvent,
  SpApiShipmentItemAdjustment,
} from '@/types'

function sumCharges(item: SpApiShipmentItemAdjustment): number {
  if (!item.ItemChargeAdjustmentList) return 0
  const total = item.ItemChargeAdjustmentList.reduce(
    (sum, c) => sum + (c.ChargeAmount?.CurrencyAmount ?? 0),
    0,
  )
  return Math.abs(total)
}

const MAX_CHUNK_DAYS = 180

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export interface FbaRefundSyncResult {
  totalFound: number
  totalUpserted: number
}

export async function syncFbaRefunds(
  accountId: string,
  startDate: Date,
  endDate: Date,
  jobId: string,
): Promise<FbaRefundSyncResult> {
  const client = new SpApiClient(accountId)
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })

  // ── Step 1: Fetch all financial event pages in range (chunked to 180 days) ──
  const chunks: { start: Date; end: Date }[] = []
  let cursor = new Date(startDate)
  while (cursor < endDate) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + MAX_CHUNK_DAYS * 86_400_000, endDate.getTime()))
    chunks.push({ start: new Date(cursor), end: chunkEnd })
    cursor = chunkEnd
  }
  console.log(`[FbaRefunds] ${chunks.length} chunk(s) for ${startDate.toISOString()} → ${endDate.toISOString()}`)

  let allRefundEvents: SpApiShipmentEvent[] = []
  let pageCount = 0

  for (const chunk of chunks) {
    let nextToken: string | undefined
    do {
      const params: Record<string, string> = {
        PostedAfter: chunk.start.toISOString(),
        PostedBefore: chunk.end.toISOString(),
        MaxResultsPerPage: '100',
      }
      if (nextToken) params['NextToken'] = nextToken

      const resp = await client.get<{
        payload: { FinancialEvents: { RefundEventList?: SpApiShipmentEvent[] }; NextToken?: string }
      }>('/finances/v0/financialEvents', params)

      const events = resp.payload?.FinancialEvents?.RefundEventList ?? []
      allRefundEvents.push(...events)
      nextToken = resp.payload?.NextToken
      pageCount++

      console.log(`[FbaRefunds] Page ${pageCount}: ${events.length} events (total so far: ${allRefundEvents.length})`)

      if (nextToken) await sleep(1_100) // ~1 req/s — within Finances API burst limit
    } while (nextToken)
  }

  // ── Step 2: Resolve fulfillment channel + FNSKU from local SellerListing ──
  const uniqueSkus = Array.from(new Set(
    allRefundEvents.flatMap(e => e.ShipmentItemAdjustmentList ?? [])
      .map(i => i.SellerSKU).filter((s): s is string => !!s),
  ))

  const listingMap = new Map<string, { fulfillmentChannel: string; fnsku: string | null; asin: string | null }>()
  if (uniqueSkus.length > 0) {
    const listings = await prisma.sellerListing.findMany({
      where: { accountId, sku: { in: uniqueSkus } },
      select: { sku: true, fulfillmentChannel: true, fnsku: true, asin: true },
    })
    for (const listing of listings) {
      listingMap.set(listing.sku, {
        fulfillmentChannel: listing.fulfillmentChannel,
        fnsku: listing.fnsku,
        asin: listing.asin,
      })
    }
    console.log(`[FbaRefunds] Resolved ${listingMap.size}/${uniqueSkus.length} SKUs from local DB`)
  }

  // Filter to FBA-only items
  const fbaItems: { event: SpApiShipmentEvent; item: SpApiShipmentItemAdjustment }[] = []
  for (const event of allRefundEvents) {
    for (const item of event.ShipmentItemAdjustmentList ?? []) {
      if (!item.OrderAdjustmentItemId) continue
      const listing = item.SellerSKU ? listingMap.get(item.SellerSKU) : undefined
      // Include if fulfillmentChannel is FBA and amount > 0
      const amt = sumCharges(item)
      if (listing?.fulfillmentChannel === 'FBA' && amt > 0) {
        fbaItems.push({ event, item })
      }
    }
  }

  const totalFound = fbaItems.length
  await prisma.importJob.update({ where: { id: jobId }, data: { totalFound } })
  console.log(`[FbaRefunds] Found ${totalFound} FBA refund items out of ${allRefundEvents.length} events`)

  if (totalFound === 0) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', totalFound: 0, totalUpserted: 0, completedAt: new Date() },
    })
    return { totalFound: 0, totalUpserted: 0 }
  }

  // ── Step 3: Batch-lookup fnsku + title from FbaReturn (most reliable source for FBA) ──
  const uniqueOrderIds = Array.from(new Set(fbaItems.map(f => f.event.AmazonOrderId).filter(Boolean)))

  const returnInfoMap = new Map<string, { fnsku: string | null; title: string | null }>()
  if (uniqueOrderIds.length > 0) {
    const returnRows = await prisma.fbaReturn.findMany({
      where: { orderId: { in: uniqueOrderIds } },
      select: { orderId: true, sku: true, fnsku: true, title: true },
    })
    for (const ret of returnRows) {
      if (ret.sku) {
        returnInfoMap.set(`${ret.orderId}|${ret.sku}`, { fnsku: ret.fnsku, title: ret.title })
      }
    }
    console.log(`[FbaRefunds] Resolved ${returnInfoMap.size} fnsku/title entries from FBA returns`)
  }

  // ── Batch-lookup original order dates from Orders table ────────────────
  const orderDateMap = new Map<string, Date>()
  if (uniqueOrderIds.length > 0) {
    const orders = await prisma.order.findMany({
      where: { amazonOrderId: { in: uniqueOrderIds } },
      select: { amazonOrderId: true, purchaseDate: true },
    })
    for (const order of orders) {
      orderDateMap.set(order.amazonOrderId, order.purchaseDate)
    }
    console.log(`[FbaRefunds] Resolved ${orderDateMap.size}/${uniqueOrderIds.length} order dates from local DB`)
  }

  // ── Step 5: Upsert FbaRefund rows ────────────────────────────────────────
  let totalUpserted = 0

  for (const { event, item } of fbaItems) {
    const adjustmentId = item.OrderAdjustmentItemId!
    const amount = sumCharges(item)
    const currency = item.ItemChargeAdjustmentList?.[0]?.ChargeAmount?.CurrencyCode ?? 'USD'
    const listing = item.SellerSKU ? listingMap.get(item.SellerSKU) : undefined
    const resolvedAsin = item.ASIN ?? listing?.asin ?? null
    const retInfo = item.SellerSKU ? returnInfoMap.get(`${event.AmazonOrderId}|${item.SellerSKU}`) : undefined
    const title = retInfo?.title ?? null
    const fnsku = listing?.fnsku ?? retInfo?.fnsku ?? null
    const originalOrderDate = orderDateMap.get(event.AmazonOrderId) ?? null

    await prisma.fbaRefund.upsert({
      where: {
        accountId_orderId_adjustmentId: {
          accountId,
          orderId: event.AmazonOrderId,
          adjustmentId,
        },
      },
      create: {
        accountId,
        orderId: event.AmazonOrderId,
        adjustmentId,
        sku: item.SellerSKU ?? null,
        fnsku,
        asin: resolvedAsin,
        title,
        refundAmount: amount,
        currency,
        refundQty: item.QuantityShipped ?? 1,
        refundDate: new Date(event.PostedDate),
        originalOrderDate,
        marketplaceId: account.marketplaceId,
        rawPayload: JSON.parse(JSON.stringify({ event, item })) as Prisma.InputJsonValue,
      },
      update: {
        sku: item.SellerSKU ?? null,
        fnsku,
        asin: resolvedAsin,
        title,
        refundAmount: amount,
        currency,
        refundQty: item.QuantityShipped ?? 1,
        refundDate: new Date(event.PostedDate),
        originalOrderDate,
        rawPayload: JSON.parse(JSON.stringify({ event, item })) as Prisma.InputJsonValue,
      },
    })

    totalUpserted++

    // Flush progress every 10 items
    if (totalUpserted % 10 === 0) {
      await prisma.importJob.update({ where: { id: jobId }, data: { totalUpserted } })
    }
  }

  // ── Step 6: Mark job complete ────────────────────────────────────────────
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })

  return { totalFound, totalUpserted }
}

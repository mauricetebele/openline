/**
 * SP-API Finances API v0 + Orders API integration.
 *
 * ─── Endpoints used ───────────────────────────────────────────────────────────
 *
 * 1. GET /finances/v0/financialEvents
 *    Role required: "Selling partner insights"  (sellingpartnerapi:finances)
 *    Rate limit: 0.5 req/s, burst 30
 *    Params: PostedAfter (ISO-8601), PostedBefore (ISO-8601), MaxResultsPerPage (up to 100)
 *
 *    We read: payload.FinancialEvents.RefundEventList[]
 *    Each RefundEvent represents one order's refund transaction.
 *    Inside each event: ShipmentItemAdjustmentList[] — one entry per line item.
 *    The AdjustmentId on each ShipmentItemAdjustment is our idempotency key.
 *
 *    Refund amount = sum of all ItemChargeAdjustmentList[].ChargeAmount.CurrencyAmount
 *    (typically just "Principal" but may include "Shipping", "Tax" adjustments)
 *
 * 2. GET /orders/v0/orders/{orderId}
 *    Role required: "Direct-to-consumer shipping" (orders:read)
 *    Rate limit: 0.5 req/s, burst 30
 *    Used to resolve FulfillmentChannel: "AFN" → FBA, "MFN" → merchant
 *
 *    We batch-fetch one order per unique orderId from the refund set,
 *    with a 2-second gap between calls to stay within rate limits.
 *
 * ─── Fallback / alternative ───────────────────────────────────────────────────
 *    If SP-API access cannot be obtained, sellers can export:
 *      Reports > "Returns" > date-range CSV  (manual export from Seller Central)
 *    and upload to POST /api/refunds/upload-csv (not yet implemented in MVP).
 *
 * ─── Deduplication policy ─────────────────────────────────────────────────────
 *    Unique key: (accountId, orderId, adjustmentId)
 *    On re-import of the same timeframe:
 *      - If a refund row already exists AND has no user review → overwrite all fields.
 *      - If a refund row already exists AND has been reviewed → overwrite non-material
 *        fields (amount, sku, asin) but preserve review status. If the amount changes
 *        by ≥ $0.01 we add an AuditEvent("REFUND_AMOUNT_CHANGED") so reviewers are aware.
 */

import { FulfillmentType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAuditEvent } from '@/lib/audit'
import { SpApiClient } from './sp-api'
import type {
  SpApiShipmentEvent,
  SpApiShipmentItemAdjustment,
} from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sumCharges(item: SpApiShipmentItemAdjustment): number {
  if (!item.ItemChargeAdjustmentList) return 0
  // Amounts are negative (credits back to buyer) — take absolute value for storage
  const total = item.ItemChargeAdjustmentList.reduce(
    (sum, c) => sum + (c.ChargeAmount?.CurrencyAmount ?? 0),
    0,
  )
  return Math.abs(total)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Main import function ─────────────────────────────────────────────────────

export interface ImportResult {
  totalFound: number
  totalUpserted: number
}

export async function importRefunds(
  accountId: string,
  startDate: Date,
  endDate: Date,
  jobId: string,
): Promise<ImportResult> {
  const client = new SpApiClient(accountId)
  const account = await prisma.amazonAccount.findUniqueOrThrow({ where: { id: accountId } })

  // ── Step 1: Fetch all financial event pages in range ──────────────────────
  let allRefundEvents: SpApiShipmentEvent[] = []
  let nextToken: string | undefined

  do {
    const params: Record<string, string> = {
      PostedAfter: startDate.toISOString(),
      PostedBefore: endDate.toISOString(),
      MaxResultsPerPage: '100',
    }
    if (nextToken) params['NextToken'] = nextToken

    const resp = await client.get<{
      payload: { FinancialEvents: { RefundEventList?: SpApiShipmentEvent[] }; NextToken?: string }
    }>('/finances/v0/financialEvents', params)

    const fe = resp.payload?.FinancialEvents ?? {}
    const summary: Record<string, number> = {}
    for (const [k, v] of Object.entries(fe)) {
      if (Array.isArray(v)) summary[k] = v.length
    }
    console.log('[Finances] Event counts by type:', JSON.stringify(summary))
    const events = resp.payload?.FinancialEvents?.RefundEventList ?? []
    allRefundEvents.push(...events)
    nextToken = resp.payload?.NextToken

    if (nextToken) await sleep(2_100) // 0.5 req/s limit
  } while (nextToken)

  // ── Step 2: Resolve fulfillment + catalog info ────────────────────────────
  // Catalog API: fire in parallel (separate rate limit bucket, typically < 20 SKUs).
  const uniqueSkus = [...new Set(
    allRefundEvents.flatMap(e => e.ShipmentItemAdjustmentList ?? [])
      .map(i => i.SellerSKU).filter((s): s is string => !!s)
  )]

  // Write totalFound now so the progress banner shows a real count immediately
  const totalFound = allRefundEvents.reduce(
    (sum, e) => sum + (e.ShipmentItemAdjustmentList?.length ?? 0), 0,
  )
  await prisma.importJob.update({ where: { id: jobId }, data: { totalFound } })

  // Resolve fulfillment channel from local SellerListing DB instead of the Orders API.
  // The Orders API approach was correct but required ~2s per unique order ID which made
  // imports with 50+ orders take several minutes before upserts even began.
  // SellerListing already has fulfillmentChannel from the catalog sync — look up by SKU.
  const fulfillmentMap = new Map<string, FulfillmentType>()
  if (uniqueSkus.length > 0) {
    const listings = await prisma.sellerListing.findMany({
      where: { accountId, sku: { in: uniqueSkus } },
      select: { sku: true, fulfillmentChannel: true },
    })
    for (const listing of listings) {
      if (listing.fulfillmentChannel === 'FBA') {
        fulfillmentMap.set(listing.sku, FulfillmentType.FBA)
      } else if (listing.fulfillmentChannel === 'MFN') {
        fulfillmentMap.set(listing.sku, FulfillmentType.MFN)
      }
    }
    console.log(`[Finances] Resolved fulfillment for ${fulfillmentMap.size}/${uniqueSkus.length} SKUs from local DB`)
  }

  // Catalog Items API — parallel (separate rate limit bucket)
  const catalogResults = await Promise.allSettled(
    uniqueSkus.map(sku =>
      client.get<{ items?: { asin: string; summaries?: { itemName?: string }[] }[] }>(
        '/catalog/2022-04-01/items',
        { identifiers: sku, identifiersType: 'SKU', marketplaceIds: account.marketplaceId, sellerId: account.sellerId, includedData: 'summaries' }
      ).then(resp => ({ sku, item: resp.items?.[0] }))
    )
  )

  const catalogMap = new Map<string, { asin: string; title: string }>()
  for (const r of catalogResults) {
    if (r.status === 'fulfilled' && r.value.item?.asin) {
      catalogMap.set(r.value.sku, {
        asin: r.value.item.asin,
        title: r.value.item.summaries?.[0]?.itemName ?? '',
      })
    }
  }

  // ── Step 3: Upsert refund rows ─────────────────────────────────────────────
  let totalUpserted = 0

  // Log first event to inspect structure
  if (allRefundEvents.length > 0) {
    console.log('[Finances] First refund event sample:', JSON.stringify(allRefundEvents[0], null, 2))
  }

  for (const event of allRefundEvents) {
    const items = event.ShipmentItemAdjustmentList ?? []
    for (const item of items) {
      // Amazon uses OrderAdjustmentItemId as the unique key per line item
      const adjustmentId = item.OrderAdjustmentItemId
      if (!adjustmentId) continue

      const amount = sumCharges(item)
      const currency = item.ItemChargeAdjustmentList?.[0]?.ChargeAmount?.CurrencyCode ?? 'USD'
      const fulfillmentType = (item.SellerSKU ? fulfillmentMap.get(item.SellerSKU) : undefined) ?? FulfillmentType.UNKNOWN
      const catalogInfo = item.SellerSKU ? catalogMap.get(item.SellerSKU) : undefined
      const resolvedAsin = item.ASIN ?? catalogInfo?.asin ?? null
      const productTitle = catalogInfo?.title || null
      const rawPayload = { event, item }

      // Check if a row already exists
      const existing = await prisma.refund.findUnique({
        where: {
          accountId_orderId_adjustmentId: {
            accountId,
            orderId: event.AmazonOrderId,
            adjustmentId,
          },
        },
        include: { review: true },
      })

      if (!existing) {
        // New refund — create + auto-create Review row
        const created = await prisma.refund.create({
          data: {
            accountId,
            orderId: event.AmazonOrderId,
            adjustmentId,
            postedDate: new Date(event.PostedDate),
            amount,
            currency,
            fulfillmentType,
            marketplaceId: account.marketplaceId,
            sku: item.SellerSKU ?? null,
            asin: resolvedAsin,
            productTitle,
            reasonCode: null,
            rawPayload,
          },
        })
        await prisma.review.create({ data: { refundId: created.id } })
        totalUpserted++
      } else {
        // Existing refund — check if amount changed materially
        const prevAmount = Number(existing.amount)
        if (Math.abs(prevAmount - amount) >= 0.01) {
          await logAuditEvent({
            entityType: 'Refund',
            entityId: existing.id,
            action: 'REFUND_AMOUNT_CHANGED',
            before: { amount: prevAmount },
            after: { amount },
            actorLabel: 'system',
            refundId: existing.id,
          })
        }

        // Always update raw data + computed fields; never touch review state
        await prisma.refund.update({
          where: { id: existing.id },
          data: {
            postedDate: new Date(event.PostedDate),
            amount,
            currency,
            fulfillmentType,
            sku: item.SellerSKU ?? null,
            asin: resolvedAsin,
            productTitle,
            rawPayload,
          },
        })

        // Ensure Review row exists (idempotent)
        if (!existing.review) {
          await prisma.review.create({ data: { refundId: existing.id } })
        }
        totalUpserted++

        // Flush progress to DB every 10 items so the frontend bar moves
        if (totalUpserted % 10 === 0) {
          await prisma.importJob.update({ where: { id: jobId }, data: { totalUpserted } })
        }
      }
    }
  }

  // ── Step 4: Mark job complete ──────────────────────────────────────────────
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', totalFound, totalUpserted, completedAt: new Date() },
  })


  return { totalFound, totalUpserted }
}

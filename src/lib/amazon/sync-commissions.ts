/**
 * Sync marketplace commissions from Amazon SP-API Finances v2 endpoint.
 *
 * Uses /finances/2024-06-19/transactions which returns DEFERRED transactions
 * immediately (same day as shipment), unlike the v0 API which only shows them
 * after release (days later under DD+7 disbursement).
 *
 * Extracts AmazonFees from Shipment transaction breakdowns per ORDER_ID
 * → updates Order.marketplaceCommission.
 *
 * BackMarket commissions are computed as a flat 12% of orderTotal.
 */

import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── SP-API types (Finances v2024-06-19) ─────────────────────────────────────

interface CurrencyAmount {
  currencyCode?: string
  currencyAmount?: number
}

interface Breakdown {
  breakdownType?: string
  breakdownAmount?: CurrencyAmount
  breakdowns?: Breakdown[] | null
}

interface RelatedIdentifier {
  relatedIdentifierName?: string
  relatedIdentifierValue?: string
}

interface V2Transaction {
  transactionType?: string
  transactionStatus?: string
  postedDate?: string
  totalAmount?: CurrencyAmount
  description?: string
  relatedIdentifiers?: RelatedIdentifier[]
  breakdowns?: Breakdown[]
}

interface V2Response {
  payload: {
    transactions?: V2Transaction[]
    nextToken?: string
  }
}

// ─── Amazon commission sync (Finances v2) ────────────────────────────────────

export async function syncAmazonCommissions(
  accountId: string,
  startDate: Date,
  endDate: Date,
  filterOrderIds?: Set<string | null>,
): Promise<{ updated: number }> {
  const client = new SpApiClient(accountId)

  // Fetch all Shipment transactions from Finances v2
  const allTransactions: V2Transaction[] = []
  let nextToken: string | undefined

  do {
    const params: Record<string, string> = {
      postedAfter: startDate.toISOString(),
      postedBefore: endDate.toISOString(),
      marketplaceId: 'ATVPDKIKX0DER',
    }
    if (nextToken) params['nextToken'] = nextToken

    const resp = await client.get<V2Response>(
      '/finances/2024-06-19/transactions',
      params,
    )

    const txns = resp.payload?.transactions ?? []
    allTransactions.push(...txns)
    nextToken = resp.payload?.nextToken

    if (nextToken) await sleep(2_100) // 0.5 req/s burst 10
  } while (nextToken)

  // Aggregate fees per ORDER_ID (Shipment transactions only)
  // Split into referral commission vs FBA fulfillment fee
  const FBA_FEE_TYPES = new Set(['FBAPerUnitFulfillmentFee', 'FBAPerOrderFulfillmentFee', 'FBAWeightBasedFee'])
  const feesByOrderId = new Map<string, { commission: number; fbaFee: number }>()

  for (const txn of allTransactions) {
    if (txn.transactionType !== 'Shipment') continue

    const orderId = txn.relatedIdentifiers?.find(
      (r) => r.relatedIdentifierName === 'ORDER_ID',
    )?.relatedIdentifierValue
    if (!orderId) continue

    const expenses = txn.breakdowns?.find((b) => b.breakdownType === 'Expenses')
    const amazonFees = expenses?.breakdowns?.find((b) => b.breakdownType === 'AmazonFees')
    if (!amazonFees) continue

    const existing = feesByOrderId.get(orderId) ?? { commission: 0, fbaFee: 0 }

    // If sub-breakdowns exist, split commission vs FBA fulfillment
    const subBreakdowns = amazonFees.breakdowns
    if (subBreakdowns?.length) {
      for (const sub of subBreakdowns) {
        const amount = Math.abs(sub.breakdownAmount?.currencyAmount ?? 0)
        if (amount === 0) continue
        if (FBA_FEE_TYPES.has(sub.breakdownType ?? '')) {
          existing.fbaFee += amount
        } else {
          // Commission, VariableClosingFee, etc. → referral commission
          existing.commission += amount
        }
      }
    } else {
      // No sub-breakdowns: store total as commission (legacy/MFN behavior)
      existing.commission += Math.abs(amazonFees.breakdownAmount?.currencyAmount ?? 0)
    }

    feesByOrderId.set(orderId, existing)
  }

  // Update matching orders in DB
  let updated = 0
  for (const [amazonOrderId, fees] of Array.from(feesByOrderId.entries())) {
    if (filterOrderIds && !filterOrderIds.has(amazonOrderId)) continue
    const result = await prisma.order.updateMany({
      where: {
        accountId,
        amazonOrderId,
        orderSource: 'amazon',
      },
      data: {
        marketplaceCommission: fees.commission,
        fbaFulfillmentFee: fees.fbaFee > 0 ? fees.fbaFee : null,
        commissionSyncedAt: new Date(),
      },
    })
    if (result.count > 0) updated++
  }

  console.log(`[sync-commissions] Amazon account=${accountId}: ${allTransactions.length} transactions, ${feesByOrderId.size} orders, ${updated} updated`)
  return { updated }
}

// ─── BackMarket commission sync ──────────────────────────────────────────────
// Real commission comes from orderline_fee during order sync.
// This fallback only covers shipped orders where the API didn't provide fee data
// (e.g. orders synced before this feature, or missing orderline_fee).

export async function syncBackMarketCommissions(): Promise<{ updated: number }> {
  const BACKMARKET_FALLBACK_RATE = 0.12

  const orders = await prisma.order.findMany({
    where: {
      orderSource: 'backmarket',
      workflowStatus: 'SHIPPED',
      commissionSyncedAt: null,
      orderTotal: { not: null },
    },
    select: { id: true, orderTotal: true },
  })

  let updated = 0
  for (const order of orders) {
    const total = Number(order.orderTotal ?? 0)
    const commission = Math.round(total * BACKMARKET_FALLBACK_RATE * 100) / 100

    await prisma.order.update({
      where: { id: order.id },
      data: {
        marketplaceCommission: commission,
        commissionSyncedAt: new Date(),
      },
    })
    updated++
  }

  console.log(`[sync-commissions] BackMarket fallback: ${updated} orders updated (no API fee data)`)
  return { updated }
}

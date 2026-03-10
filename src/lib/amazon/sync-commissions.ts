/**
 * Sync marketplace commissions from Amazon SP-API Finances endpoint.
 *
 * Reads ShipmentEventList from /finances/v0/financialEvents and sums
 * ItemFeeList fees per AmazonOrderId → updates Order.marketplaceCommission.
 *
 * BackMarket commissions are computed as a flat 12% of orderTotal.
 */

import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── SP-API types (Finances v0) ─────────────────────────────────────────────

interface MoneyType {
  CurrencyCode?: string
  CurrencyAmount?: number
}

interface FeeComponent {
  FeeType?: string
  FeeAmount?: MoneyType
}

interface ChargeComponent {
  ChargeType?: string
  ChargeAmount?: MoneyType
}

interface ShipmentItem {
  SellerSKU?: string
  OrderItemId?: string
  ItemFeeList?: FeeComponent[]
  ItemChargeList?: ChargeComponent[]
}

interface ShipmentEvent {
  AmazonOrderId: string
  PostedDate: string
  ShipmentItemList?: ShipmentItem[]
}

// ─── Amazon commission sync ─────────────────────────────────────────────────

export async function syncAmazonCommissions(
  accountId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ updated: number }> {
  const client = new SpApiClient(accountId)

  // Fetch all ShipmentEventList pages
  const allShipmentEvents: ShipmentEvent[] = []
  let nextToken: string | undefined

  do {
    const params: Record<string, string> = {
      PostedAfter: startDate.toISOString(),
      PostedBefore: endDate.toISOString(),
      MaxResultsPerPage: '100',
    }
    if (nextToken) params['NextToken'] = nextToken

    const resp = await client.get<{
      payload: {
        FinancialEvents: { ShipmentEventList?: ShipmentEvent[] }
        NextToken?: string
      }
    }>('/finances/v0/financialEvents', params)

    const events = resp.payload?.FinancialEvents?.ShipmentEventList ?? []
    allShipmentEvents.push(...events)
    nextToken = resp.payload?.NextToken

    if (nextToken) await sleep(2_100) // 0.5 req/s rate limit
  } while (nextToken)

  // Aggregate total fees per AmazonOrderId
  const commissionByOrderId = new Map<string, number>()

  for (const event of allShipmentEvents) {
    const orderId = event.AmazonOrderId
    if (!orderId) continue

    let orderFees = commissionByOrderId.get(orderId) ?? 0

    for (const item of event.ShipmentItemList ?? []) {
      for (const fee of item.ItemFeeList ?? []) {
        // Amazon fee amounts are negative (deductions). We store the absolute value.
        const amount = fee.FeeAmount?.CurrencyAmount ?? 0
        orderFees += Math.abs(amount)
      }
    }

    commissionByOrderId.set(orderId, orderFees)
  }

  // Update matching orders in DB
  let updated = 0
  const entries = Array.from(commissionByOrderId.entries())
  for (const [amazonOrderId, commission] of entries) {
    const result = await prisma.order.updateMany({
      where: {
        accountId,
        amazonOrderId,
        orderSource: 'amazon',
      },
      data: {
        marketplaceCommission: commission,
        commissionSyncedAt: new Date(),
      },
    })
    if (result.count > 0) updated++
  }

  console.log(`[sync-commissions] Amazon account=${accountId}: ${allShipmentEvents.length} events, ${commissionByOrderId.size} orders, ${updated} updated`)
  return { updated }
}

// ─── BackMarket commission sync (flat 12%) ──────────────────────────────────

export async function syncBackMarketCommissions(): Promise<{ updated: number }> {
  const BACKMARKET_RATE = 0.12

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
    const commission = Math.round(total * BACKMARKET_RATE * 100) / 100

    await prisma.order.update({
      where: { id: order.id },
      data: {
        marketplaceCommission: commission,
        commissionSyncedAt: new Date(),
      },
    })
    updated++
  }

  console.log(`[sync-commissions] BackMarket: ${updated} orders updated`)
  return { updated }
}

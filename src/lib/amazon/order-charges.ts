/**
 * Resolve an Amazon order's refundable PRINCIPAL from locally-synced transaction
 * data (AmazonTransaction.breakdowns, from the 2024-06-19 Transactions API).
 *
 * Why not the Orders API: its `ItemPrice` bundles Principal + RegulatoryFee, which
 * over-states what's seller-refundable (e.g. ItemPrice 710.45 = Principal 699.95 +
 * RegulatoryFee 10.50 — refunding 710.45 is rejected with error 18010). The
 * Transactions "Sales → ProductCharges" value is the true principal (699.95).
 *
 * This reads our DB (no SP-API call) — instant and reliable. Tax is omitted on
 * purpose: Amazon refunds marketplace-facilitated tax automatically.
 */
import { prisma } from '@/lib/prisma'

export interface OrderCharges {
  found: boolean
  currency: string
  principal: number
}

interface Breakdown {
  breakdownType?: string
  breakdownAmount?: { currencyCode?: string; currencyAmount?: number }
}

export async function getOrderCharges(amazonOrderId: string): Promise<OrderCharges> {
  const txns = await prisma.amazonTransaction.findMany({
    where: { orderId: amazonOrderId, transactionType: 'Shipment' },
    select: { breakdowns: true },
  })

  let principal = 0
  let currency = 'USD'
  let found = false

  for (const t of txns) {
    const bds = (Array.isArray(t.breakdowns) ? t.breakdowns : []) as unknown as Breakdown[]
    for (const b of bds) {
      if (b?.breakdownType === 'Sales') {
        const amt = Number(b?.breakdownAmount?.currencyAmount ?? 0)
        if (b?.breakdownAmount?.currencyCode) currency = b.breakdownAmount.currencyCode
        // Deferred + released versions of the same shipment are duplicated here,
        // so take the max (not the sum) to avoid double-counting.
        if (amt > principal) principal = amt
        found = true
      }
    }
  }

  return { found, currency, principal: Math.round(principal * 100) / 100 }
}

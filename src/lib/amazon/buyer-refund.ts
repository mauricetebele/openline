/**
 * Buyer-facing refund amount for a Review Amazon Refunds row.
 *
 * The review row's `amount` is the Finances (2024-06-19) transaction total — our
 * net cost: refunded sales minus the commission Amazon hands back. It excludes
 * sales tax, which Amazon collects/remits as marketplace facilitator. Amazon's
 * refund notification email shows what the BUYER got back (incl. tax), so we
 * pull the order's v0 financial events, where each RefundEvent itemizes
 * Principal / Tax / Shipping / ShippingTax charges and promotions.
 *
 *   buyer refund = −(Σ ItemChargeAdjustmentList + Σ PromotionAdjustmentList)
 */
import { prisma } from '@/lib/prisma'
import { SpApiClient } from './sp-api'
import type { SpApiShipmentEvent } from '@/types'

interface Breakdown { breakdownType?: string; breakdownAmount?: { currencyAmount?: number }; breakdowns?: Breakdown[] | null }

const round2 = (n: number) => Math.round(n * 100) / 100

/** "Refunded Sales" total from a Finances transaction's breakdowns (e.g. −5.00), or null. */
function refundedSalesOf(breakdowns: unknown): number | null {
  const list = Array.isArray(breakdowns) ? (breakdowns as Breakdown[]) : []
  const b = list.find(x => x.breakdownType === 'Refunded Sales')
  const v = b?.breakdownAmount?.currencyAmount
  return typeof v === 'number' ? v : null
}

function eventTotals(ev: SpApiShipmentEvent): { nonTaxCharges: number; buyerRefund: number } {
  let charges = 0, nonTax = 0, promos = 0
  for (const item of ev.ShipmentItemAdjustmentList ?? []) {
    for (const c of item.ItemChargeAdjustmentList ?? []) {
      const amt = Number(c.ChargeAmount?.CurrencyAmount ?? 0)
      charges += amt
      if (!/tax/i.test(c.ChargeType)) nonTax += amt
    }
    for (const p of item.PromotionAdjustmentList ?? []) {
      promos += Number(p.PromotionAmount?.CurrencyAmount ?? 0)
    }
  }
  return { nonTaxCharges: round2(nonTax + promos), buyerRefund: round2(-(charges + promos)) }
}

/**
 * Find the buyer refund for one review row. Picks the order's RefundEvent whose
 * non-tax charges match the transaction's "Refunded Sales" (handles orders with
 * several refunds), falling back to the event posted closest in time.
 */
export async function fetchBuyerRefundAmount(
  client: SpApiClient,
  orderId: string,
  postedDate: Date,
  refundedSales: number | null,
): Promise<number | null> {
  const resp = await client.get<{ payload?: { FinancialEvents?: { RefundEventList?: SpApiShipmentEvent[] } } }>(
    `/finances/v0/orders/${encodeURIComponent(orderId)}/financialEvents`,
    { MaxResultsPerPage: '100' },
  )
  const events = resp.payload?.FinancialEvents?.RefundEventList ?? []
  if (events.length === 0) return null

  const scored = events.map(ev => ({
    ...eventTotals(ev),
    dt: Math.abs(new Date(ev.PostedDate).getTime() - postedDate.getTime()),
  }))
  const byAmount = refundedSales != null
    ? scored.filter(s => Math.abs(s.nonTaxCharges - round2(refundedSales)) < 0.01)
    : []
  const pool = byAmount.length > 0 ? byAmount : scored
  pool.sort((a, b) => a.dt - b.dt)
  // Without an amount match, only trust a time match within 3 days.
  if (byAmount.length === 0 && pool[0].dt > 3 * 86_400_000) return null
  return pool[0].buyerRefund
}

/**
 * Fill buyerRefundAmount on review rows that don't have it yet (newest first).
 * Not-yet-available events are retried every 6h for 45 days. Capped per run to
 * respect the v0 order-financial-events rate limit (0.5 req/s).
 */
export async function backfillBuyerRefundAmounts(limit = 40): Promise<{ checked: number; filled: number }> {
  const now = Date.now()
  const rows = await prisma.amazonRefundReview.findMany({
    where: {
      buyerRefundAmount: null,
      orderId: { not: null },
      accountId: { not: null },
      OR: [
        { buyerRefundCheckedAt: null },
        { buyerRefundCheckedAt: { lt: new Date(now - 6 * 3_600_000) }, postedDate: { gte: new Date(now - 45 * 86_400_000) } },
      ],
    },
    orderBy: { postedDate: 'desc' },
    take: limit,
    select: { id: true, accountId: true, orderId: true, postedDate: true, transactionId: true },
  })
  if (rows.length === 0) return { checked: 0, filled: 0 }

  const txns = await prisma.amazonTransaction.findMany({
    where: { id: { in: rows.map(r => r.transactionId) } },
    select: { id: true, breakdowns: true },
  })
  const salesByTxn = new Map(txns.map(t => [t.id, refundedSalesOf(t.breakdowns)]))

  const clients = new Map<string, SpApiClient>()
  let filled = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (i > 0) await new Promise(res => setTimeout(res, 2_100)) // 0.5 req/s
    const accountId = r.accountId!
    if (!clients.has(accountId)) clients.set(accountId, new SpApiClient(accountId))
    let amount: number | null = null
    try {
      amount = await fetchBuyerRefundAmount(clients.get(accountId)!, r.orderId!, r.postedDate, salesByTxn.get(r.transactionId) ?? null)
    } catch (err) {
      console.error(`[buyer-refund] ${r.orderId}:`, err instanceof Error ? err.message : err)
    }
    await prisma.amazonRefundReview.update({
      where: { id: r.id },
      data: { buyerRefundCheckedAt: new Date(), ...(amount != null ? { buyerRefundAmount: amount } : {}) },
    })
    if (amount != null) filled++
  }
  return { checked: rows.length, filled }
}

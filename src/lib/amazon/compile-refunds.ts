import { prisma } from '@/lib/prisma'

/**
 * Review Amazon Refunds starts from the beginning of September 2026 — earlier
 * refunds are intentionally excluded from this review queue.
 */
export const REFUND_REVIEW_START = new Date('2026-09-01T00:00:00.000Z')

/**
 * Materialize every Amazon "Refund"-type transaction (Refund, ChargebackRefund,
 * GuaranteeClaimRefund) since the start date into the review queue, creating a
 * NOT_REVIEWED row for any that isn't already there. Idempotent — safe to run
 * daily. Never mutates the source transactions.
 */
export async function compileAmazonRefunds(): Promise<{ created: number; total: number }> {
  const refunds = await prisma.amazonTransaction.findMany({
    where: {
      transactionType: { contains: 'Refund' }, // Refund, ChargebackRefund, GuaranteeClaimRefund
      postedDate: { gte: REFUND_REVIEW_START },
    },
    select: {
      id: true, accountId: true, postedDate: true, totalAmount: true,
      currency: true, orderId: true, transactionType: true, description: true,
    },
  })
  if (refunds.length === 0) return { created: 0, total: 0 }

  const existing = await prisma.amazonRefundReview.findMany({
    where: { transactionId: { in: refunds.map(r => r.id) } },
    select: { transactionId: true },
  })
  const have = new Set(existing.map(e => e.transactionId))
  const toCreate = refunds.filter(r => !have.has(r.id))

  if (toCreate.length > 0) {
    await prisma.amazonRefundReview.createMany({
      data: toCreate.map(r => ({
        transactionId: r.id,
        accountId: r.accountId,
        postedDate: r.postedDate,
        amount: r.totalAmount,
        currency: r.currency,
        orderId: r.orderId,
        transactionType: r.transactionType,
        description: r.description,
      })),
      skipDuplicates: true,
    })
  }

  return { created: toCreate.length, total: refunds.length }
}

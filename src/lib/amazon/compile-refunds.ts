import { prisma } from '@/lib/prisma'

/**
 * Review Amazon Refunds starts from the beginning of September 2026 — earlier
 * refunds are intentionally excluded from this review queue.
 */
export const REFUND_REVIEW_START = new Date('2026-09-01T00:00:00.000Z')

// A refund's status advances Deferred → Deferred-Released → Released, and Amazon
// emits a transaction for each. Rank them so we snapshot the most-settled one.
const STATUS_RANK: Record<string, number> = { RELEASED: 3, DEFERRED_RELEASED: 2, DEFERRED: 1 }

interface RelId { relatedIdentifierName?: string; relatedIdentifierValue?: string }

/** Stable per-refund identity: Amazon REFUND_ID, falling back to the txn id. */
function refundKeyOf(relatedIdentifiers: unknown, txnId: string): string {
  const rel = Array.isArray(relatedIdentifiers) ? (relatedIdentifiers as RelId[]) : []
  const rid = rel.find(r => r?.relatedIdentifierName === 'REFUND_ID')?.relatedIdentifierValue
  return rid || txnId
}

/**
 * Materialize every Amazon "Refund"-type transaction since the start date into
 * the review queue as ONE row per refund (deduped by REFUND_ID — the same
 * refund appears across the Deferred → Released statuses). Idempotent; never
 * mutates the source transactions.
 */
export async function compileAmazonRefunds(): Promise<{ created: number; total: number }> {
  const txns = await prisma.amazonTransaction.findMany({
    where: {
      transactionType: { contains: 'Refund' }, // Refund, ChargebackRefund, GuaranteeClaimRefund
      postedDate: { gte: REFUND_REVIEW_START },
    },
    select: {
      id: true, accountId: true, postedDate: true, totalAmount: true, currency: true,
      orderId: true, transactionType: true, description: true, transactionStatus: true,
      relatedIdentifiers: true,
    },
  })
  if (txns.length === 0) return { created: 0, total: 0 }

  // Collapse to one canonical transaction per refund (most-settled status wins).
  const byRefund = new Map<string, typeof txns[number]>()
  for (const t of txns) {
    const key = refundKeyOf(t.relatedIdentifiers, t.id)
    const prev = byRefund.get(key)
    if (!prev) { byRefund.set(key, t); continue }
    const better = (STATUS_RANK[t.transactionStatus] ?? 0) > (STATUS_RANK[prev.transactionStatus] ?? 0)
      || ((STATUS_RANK[t.transactionStatus] ?? 0) === (STATUS_RANK[prev.transactionStatus] ?? 0) && t.postedDate > prev.postedDate)
    if (better) byRefund.set(key, t)
  }

  const keys = Array.from(byRefund.keys())
  const existing = await prisma.amazonRefundReview.findMany({
    where: { refundKey: { in: keys } },
    select: { refundKey: true },
  })
  const have = new Set(existing.map(e => e.refundKey))

  const toCreate = Array.from(byRefund.entries())
    .filter(([key]) => !have.has(key))
    .map(([key, t]) => ({
      transactionId: t.id,
      refundKey: key,
      accountId: t.accountId,
      postedDate: t.postedDate,
      amount: t.totalAmount,
      currency: t.currency,
      orderId: t.orderId,
      transactionType: t.transactionType,
      description: t.description,
    }))

  if (toCreate.length > 0) {
    await prisma.amazonRefundReview.createMany({ data: toCreate, skipDuplicates: true })
  }

  return { created: toCreate.length, total: byRefund.size }
}

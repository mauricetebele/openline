/**
 * POST /api/amazon-refunds/backfill?part=buyer|fba
 *
 * Manual backfill for Review Amazon Refunds (the "Backfill" button fires both
 * parts as separate requests so each gets its own 300 s budget):
 *   part=buyer → fill "Refunded to Buyer" for rows missing it, ~4 min per call
 *                (v0 order financial events are rate-limited to 0.5 req/s).
 *                Returns how many are still pending — click again until 0.
 *   part=fba   → re-pull the FBA customer returns report from the review start
 *                date so FBA rows get their return reason.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { backfillBuyerRefundAmounts, pendingBuyerRefundWhere } from '@/lib/amazon/buyer-refund'
import { syncFbaReturns } from '@/lib/amazon/fba-returns'
import { REFUND_REVIEW_START } from '@/lib/amazon/compile-refunds'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const part = req.nextUrl.searchParams.get('part')

  if (part === 'buyer') {
    const r = await backfillBuyerRefundAmounts(1000, 240_000)
    const remaining = await prisma.amazonRefundReview.count({ where: pendingBuyerRefundWhere() })
    return NextResponse.json({ ...r, remaining })
  }

  if (part === 'fba') {
    const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true }, select: { id: true } })
    const end = new Date(Date.now() - 5 * 60 * 1000)
    let upserted = 0
    const errors: string[] = []
    for (const a of accounts) {
      const job = await prisma.importJob.create({
        data: { accountId: a.id, startDate: REFUND_REVIEW_START, endDate: end, status: 'RUNNING' },
      })
      try {
        const res = await syncFbaReturns(a.id, job.id, REFUND_REVIEW_START, end)
        upserted += res.totalUpserted
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(message)
        await prisma.importJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
        }).catch(() => {})
      }
    }
    return NextResponse.json({ upserted, errors })
  }

  return NextResponse.json({ error: 'part must be "buyer" or "fba"' }, { status: 400 })
}

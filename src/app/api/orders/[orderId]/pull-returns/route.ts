/**
 * POST /api/orders/[orderId]/pull-returns
 *
 * Ad-hoc return refresh for ONE Amazon order (Order view "Pull Return Data"):
 *   1. Pulls the Amazon MFN returns flat-file report over a window covering this
 *      order (purchase date → now, capped at 60 days back) and upserts the rows.
 *   2. Scans the returns Gmail mailbox for this order's "Return authorization
 *      notification" emails only, and parses the buyer comment onto its returns.
 *
 * Runs synchronously (report generation usually takes ~30–90 s) so the caller
 * can re-fetch the order when it finishes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { syncMfnReturns } from '@/lib/amazon/mfn-returns'
import { syncReturnBuyerNotes } from '@/lib/amazon/sync-return-buyer-notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_LOOKBACK_MS = 60 * 86_400_000

export async function POST(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: { amazonOrderId: true, accountId: true, orderSource: true, purchaseDate: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.orderSource !== 'amazon') {
    return NextResponse.json({ error: 'Return data pull is only available for Amazon orders' }, { status: 400 })
  }

  // ── 1. Amazon MFN returns report ───────────────────────────────────────────
  const endDate = new Date()
  const startDate = new Date(Math.max(order.purchaseDate.getTime() - 86_400_000, endDate.getTime() - MAX_LOOKBACK_MS))
  const job = await prisma.mFNReturnSyncJob.create({
    data: { accountId: order.accountId, startDate, endDate, status: 'IN_PROGRESS' },
  })

  let reportError: string | null = null
  try {
    await syncMfnReturns(order.accountId, job.id, startDate, endDate, { skipBuyerNotes: true })
  } catch (err) {
    reportError = err instanceof Error ? err.message : String(err)
    console.error('[pull-returns] report failed:', reportError)
    await prisma.mFNReturnSyncJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorMessage: reportError, completedAt: new Date() },
    }).catch(() => {})
  }

  // ── 2. Buyer comment from this order's Gmail notification(s) ───────────────
  let notesError: string | null = null
  let commentsUpdated = 0
  try {
    const notes = await syncReturnBuyerNotes({
      orderIds: [order.amazonOrderId],
      search: `"${order.amazonOrderId}"`,
      maxEmails: 25,
    })
    if (notes.ok) commentsUpdated = notes.returnsUpdated
    else notesError = notes.reason ?? 'Buyer-comment sync failed'
  } catch (err) {
    notesError = err instanceof Error ? err.message : String(err)
    console.error('[pull-returns] buyer notes failed:', notesError)
  }

  const returnsForOrder = await prisma.mFNReturn.count({
    where: { orderId: order.amazonOrderId, accountId: order.accountId },
  })

  return NextResponse.json({
    ok: !reportError && !notesError,
    returnsForOrder,
    commentsUpdated,
    reportError,
    notesError,
  })
}

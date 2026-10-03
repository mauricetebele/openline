/**
 * POST /api/orders/[orderId]/refund
 *   Issue a refund to Amazon for a seller-fulfilled (MFN/FBM) order via the
 *   OrderAdjustment / POST_PAYMENT_ADJUSTMENT_DATA feed. IRREVERSIBLE once Amazon
 *   processes it — the UI gates this behind a confirmation dialog.
 *   Body: { mode: 'full' | 'custom', customAmount?: number, reason?: AdjustmentReason, force?: boolean }
 *
 * GET /api/orders/[orderId]/refund
 *   Return the refunds already issued for this order and refresh the latest
 *   feed's processing status from Amazon.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { issueOrderRefund, getRefundFeedStatus, ADJUSTMENT_REASONS, type AdjustmentReason } from '@/lib/amazon/issue-refund'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orderId } = await params

  const body = await req.json().catch(() => ({}))
  const mode = body?.mode === 'custom' ? 'custom' : 'full'
  const customAmount = typeof body?.customAmount === 'number' ? body.customAmount : parseFloat(String(body?.customAmount ?? ''))
  const reason: AdjustmentReason = ADJUSTMENT_REASONS.includes(body?.reason) ? body.reason : 'CustomerReturn'
  const force = body?.force === true

  if (mode === 'custom' && !(Number.isFinite(customAmount) && customAmount > 0)) {
    return NextResponse.json({ error: 'A positive custom refund amount is required' }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, amazonOrderId: true, accountId: true, orderSource: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.orderSource !== 'amazon') {
    return NextResponse.json({ error: 'Amazon refunds only apply to Amazon orders' }, { status: 400 })
  }

  // Double-refund guard: block if a refund was already issued and not failed.
  const prior = await prisma.amazonRefundIssued.findFirst({
    where: { orderId, feedStatus: { notIn: ['FATAL', 'CANCELLED'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (prior && !force) {
    return NextResponse.json(
      { error: `A refund of $${Number(prior.amount).toFixed(2)} was already issued for this order on ${prior.createdAt.toISOString().slice(0, 10)} (feed ${prior.feedId}). Pass force to issue another.`, alreadyIssued: true, prior: { id: prior.id, amount: Number(prior.amount), feedId: prior.feedId, feedStatus: prior.feedStatus } },
      { status: 409 },
    )
  }

  let result
  try {
    result = await issueOrderRefund(orderId, { reason, mode, customAmount })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to issue refund' }, { status: 502 })
  }

  const rec = await prisma.amazonRefundIssued.create({
    data: {
      accountId: order.accountId,
      orderId: order.id,
      amazonOrderId: order.amazonOrderId,
      amount: result.amount,
      currency: result.currency,
      reason,
      feedId: result.feedId,
      feedStatus: 'IN_QUEUE',
      issuedById: user.dbId,
      issuedByEmail: user.email,
    },
  })

  return NextResponse.json({ ok: true, id: rec.id, feedId: result.feedId, amount: result.amount, currency: result.currency })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { orderId } = await params

  const refunds = await prisma.amazonRefundIssued.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  })

  // Refresh the latest refund's feed status from Amazon if still in flight.
  const latest = refunds[0]
  if (latest?.feedId && (latest.feedStatus === 'IN_QUEUE' || latest.feedStatus === 'IN_PROGRESS')) {
    try {
      const status = await getRefundFeedStatus(latest.accountId, latest.feedId)
      await prisma.amazonRefundIssued.update({
        where: { id: latest.id },
        data: { feedStatus: status.processingStatus, feedResult: status.result ?? undefined },
      })
      latest.feedStatus = status.processingStatus
    } catch { /* status refresh best-effort */ }
  }

  return NextResponse.json({
    refunds: refunds.map(r => ({ ...r, amount: Number(r.amount) })),
  })
}

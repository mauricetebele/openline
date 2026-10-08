/**
 * GET /api/amazon-refunds?tab=not_reviewed|flagged|validated
 * Returns the refund-review rows for a tab plus per-tab counts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const TAB_STATUS: Record<string, string> = {
  not_reviewed: 'NOT_REVIEWED',
  flagged: 'FLAGGED',
  validated: 'VALIDATED',
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tab = req.nextUrl.searchParams.get('tab')?.toLowerCase() ?? 'not_reviewed'
  const status = TAB_STATUS[tab] ?? 'NOT_REVIEWED'

  const [rows, counts] = await Promise.all([
    prisma.amazonRefundReview.findMany({
      where: { status },
      // Validated tab: most-recently-validated first. Other tabs: newest posted.
      orderBy: status === 'VALIDATED'
        ? [{ validatedAt: { sort: 'desc', nulls: 'last' } }, { postedDate: 'desc' }]
        : { postedDate: 'desc' },
      take: 2000,
    }),
    prisma.amazonRefundReview.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const countMap: Record<string, number> = { NOT_REVIEWED: 0, FLAGGED: 0, VALIDATED: 0 }
  for (const c of counts) countMap[c.status] = c._count._all

  // Resolve FBA vs MFN + per-order return/refund stats.
  const orderIds = Array.from(new Set(rows.map(r => r.orderId).filter((o): o is string => !!o)))
  const orders = orderIds.length > 0
    ? await prisma.order.findMany({
        where: { amazonOrderId: { in: orderIds }, orderSource: 'amazon' },
        select: {
          amazonOrderId: true, fulfillmentChannel: true,
          items: { select: { quantityOrdered: true } },
          marketplaceRMAs: { select: { status: true, items: { select: { quantityReturned: true } } } },
        },
      })
    : []

  // Seller-initiated refunds issued via our system, summed per Amazon order
  // (exclude rejected ones so the total reflects refunds that actually went out).
  const issued = orderIds.length > 0
    ? await prisma.amazonRefundIssued.groupBy({
        by: ['amazonOrderId'],
        where: { amazonOrderId: { in: orderIds }, feedStatus: { notIn: ['ERROR', 'FATAL', 'CANCELLED'] } },
        _sum: { amount: true },
      })
    : []
  const sellerRefundByOrder = new Map(issued.map(i => [i.amazonOrderId, Number(i._sum.amount ?? 0)]))

  interface OrderStat { channel: 'MFN' | 'FBA' | null; unitsSold: number; unitsReceived: number }
  const statByOrder = new Map<string, OrderStat>()
  for (const o of orders) {
    const channel = o.fulfillmentChannel === 'AFN' ? 'FBA' : o.fulfillmentChannel === 'MFN' ? 'MFN' : null
    const unitsSold = o.items.reduce((s, it) => s + (it.quantityOrdered ?? 0), 0)
    const unitsReceived = o.marketplaceRMAs
      .filter(rma => rma.status === 'RECEIVED')
      .reduce((s, rma) => s + rma.items.reduce((a, it) => a + Number(it.quantityReturned ?? 0), 0), 0)
    statByOrder.set(o.amazonOrderId, { channel, unitsSold, unitsReceived })
  }

  return NextResponse.json({
    rows: rows.map(r => {
      const stat = r.orderId ? statByOrder.get(r.orderId) : undefined
      const channel = stat?.channel ?? null
      const isMfn = channel === 'MFN'
      return {
        ...r,
        amount: Number(r.amount),
        channel,
        // MFN only: total of our seller-initiated refunds on this order.
        sellerRefundTotal: isMfn ? (sellerRefundByOrder.get(r.orderId ?? '') ?? 0) : null,
        // MFN only: units received back on a return vs units sold.
        merchReturn: isMfn && stat && stat.unitsSold > 0
          ? { received: stat.unitsReceived, sold: stat.unitsSold }
          : null,
      }
    }),
    counts: { notReviewed: countMap.NOT_REVIEWED, flagged: countMap.FLAGGED, validated: countMap.VALIDATED },
  })
}

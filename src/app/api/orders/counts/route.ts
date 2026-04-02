/**
 * GET /api/orders/counts?accountId=
 * Returns order counts for the pending / unshipped / awaiting tabs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('accountId')?.trim()
  if (!accountId) return NextResponse.json({ pending: 0, unshipped: 0, awaiting: 0 })

  // End of today in Pacific time: get today's date string in PT, then add 1 day
  // latestShipDate from Amazon is typically a full timestamp, so we compare < tomorrow midnight UTC
  // (Amazon ship-by dates are UTC-based, so UTC comparison is correct here)
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const [y, m, d] = todayStr.split('-').map(Number)
  const tomorrowMidnight = new Date(Date.UTC(y, m - 1, d + 1))

  // Start of today in Pacific time (midnight PT → UTC)
  const todayMidnight = new Date(Date.UTC(y, m - 1, d))

  // Base filter matching the orders list API: exclude Amazon Pending-payment
  // orders and FBA/AFN orders (Amazon fulfills those, not us)
  const baseWhere = { accountId, orderStatus: { not: 'Pending' } as const, fulfillmentChannel: { not: 'AFN' } as const }

  const [pending, unshipped, awaiting, dueOutToday, shippedToday,
         wsPending, wsUnshipped, wsShippedToday] = await Promise.all([
    prisma.order.count({ where: { ...baseWhere, workflowStatus: 'PENDING' } }),
    prisma.order.count({ where: { ...baseWhere, workflowStatus: 'PROCESSING' } }),
    prisma.order.count({ where: { ...baseWhere, workflowStatus: 'AWAITING_VERIFICATION' } }),
    prisma.order.count({
      where: {
        ...baseWhere,
        workflowStatus: { in: ['PENDING', 'PROCESSING', 'AWAITING_VERIFICATION'] },
        latestShipDate: { lt: tomorrowMidnight },
      },
    }),
    prisma.order.count({
      where: {
        ...baseWhere,
        workflowStatus: 'SHIPPED',
        shippedAt: { gte: todayMidnight, lt: tomorrowMidnight },
      },
    }),
    // Wholesale counts (not account-scoped)
    prisma.salesOrder.count({
      where: { status: { notIn: ['PENDING_APPROVAL', 'VOID'] }, fulfillmentStatus: 'PENDING' },
    }),
    prisma.salesOrder.count({
      where: { status: { notIn: ['PENDING_APPROVAL', 'VOID'] }, fulfillmentStatus: 'PROCESSING' },
    }),
    prisma.salesOrder.count({
      where: { fulfillmentStatus: 'SHIPPED', shippedAt: { gte: todayMidnight, lt: tomorrowMidnight } },
    }),
  ])

  return NextResponse.json({
    pending,
    unshipped,
    awaiting,
    dueOutToday,
    shippedToday,
    wsPending,
    wsUnshipped,
    wsShippedToday,
  })
}

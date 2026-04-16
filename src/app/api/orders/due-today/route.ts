/**
 * GET /api/orders/due-today
 * Returns count of all unfulfilled orders (PENDING + PROCESSING + AWAITING_VERIFICATION) for TopNav badge.
 * Uses the first active Amazon account automatically.
 */
import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ count: 0 })

  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) return NextResponse.json({ count: 0 })

  // Count unfulfilled orders (PENDING + PROCESSING + AWAITING_VERIFICATION)
  // Exclude FBA (AFN) orders and Amazon pending-payment orders
  const count = await prisma.order.count({
    where: {
      accountId: account.id,
      orderStatus: { not: 'Pending' },
      fulfillmentChannel: { not: 'AFN' },
      workflowStatus: { in: ['PENDING', 'PROCESSING', 'AWAITING_VERIFICATION'] },
    },
  })

  return NextResponse.json({ count })
}

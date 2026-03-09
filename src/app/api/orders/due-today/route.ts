/**
 * GET /api/orders/due-today
 * Returns count of orders due out today (for TopNav badge).
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

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const [y, m, d] = todayStr.split('-').map(Number)
  const tomorrowMidnight = new Date(Date.UTC(y, m - 1, d + 1))

  const count = await prisma.order.count({
    where: {
      accountId: account.id,
      workflowStatus: { in: ['PENDING', 'PROCESSING', 'AWAITING_VERIFICATION'] },
      latestShipDate: { lt: tomorrowMidnight },
    },
  })

  return NextResponse.json({ count })
}

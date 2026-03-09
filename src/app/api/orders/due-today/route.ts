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

  // Count orders due today or earlier (overdue) in Pacific time.
  // Amazon latestShipDate includes a time component in UTC, so we need
  // "end of today Pacific" as the cutoff (= tomorrow midnight Pacific in UTC).
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const [y, m, d] = todayStr.split('-').map(Number)

  // Compute Pacific→UTC offset (handles DST automatically)
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' })
  const pacStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  const offsetMs = new Date(utcStr).getTime() - new Date(pacStr).getTime()

  // Tomorrow midnight Pacific expressed in UTC
  const cutoff = new Date(Date.UTC(y, m - 1, d + 1) + offsetMs)

  const count = await prisma.order.count({
    where: {
      accountId: account.id,
      workflowStatus: { in: ['PENDING', 'PROCESSING', 'AWAITING_VERIFICATION'] },
      latestShipDate: { lt: cutoff },
    },
  })

  return NextResponse.json({ count })
}

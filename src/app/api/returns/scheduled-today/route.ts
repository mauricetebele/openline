import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const [scheduledCount, deliveredCount] = await Promise.all([
    prisma.mFNReturn.count({
      where: {
        estimatedDelivery: { gte: todayStart, lte: todayEnd },
        deliveredAt: null,
      },
    }),
    prisma.mFNReturn.count({
      where: {
        deliveredAt: { gte: todayStart, lte: todayEnd },
      },
    }),
  ])

  return NextResponse.json({ count: scheduledCount, deliveredToday: deliveredCount })
}

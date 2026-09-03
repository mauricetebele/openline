/**
 * GET /api/amazon-refunds/unreviewed-count
 * Lightweight count of refunds still awaiting review — for the nav badge.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = await prisma.amazonRefundReview.count({ where: { status: 'NOT_REVIEWED' } })
  return NextResponse.json({ count })
}

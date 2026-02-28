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

  const [pending, unshipped, awaiting] = await Promise.all([
    prisma.order.count({ where: { accountId, workflowStatus: 'PENDING' } }),
    prisma.order.count({ where: { accountId, workflowStatus: 'PROCESSING' } }),
    prisma.order.count({ where: { accountId, workflowStatus: 'AWAITING_VERIFICATION' } }),
  ])

  return NextResponse.json({ pending, unshipped, awaiting })
}

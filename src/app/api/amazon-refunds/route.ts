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
      orderBy: { postedDate: 'desc' },
      take: 2000,
    }),
    prisma.amazonRefundReview.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const countMap: Record<string, number> = { NOT_REVIEWED: 0, FLAGGED: 0, VALIDATED: 0 }
  for (const c of counts) countMap[c.status] = c._count._all

  return NextResponse.json({
    rows: rows.map(r => ({ ...r, amount: Number(r.amount) })),
    counts: { notReviewed: countMap.NOT_REVIEWED, flagged: countMap.FLAGGED, validated: countMap.VALIDATED },
  })
}

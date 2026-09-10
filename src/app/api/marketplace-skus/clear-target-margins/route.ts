/**
 * POST /api/marketplace-skus/clear-target-margins
 * Clear every queued (unpushed) target margin. Pushing a target-margin price clears
 * it, so anything still set is unpushed.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const res = await prisma.productGradeMarketplaceSku.updateMany({
    where: { targetMarginPct: { not: null } },
    data: { targetMarginPct: null, targetMarginSetAt: null },
  })
  return NextResponse.json({ cleared: res.count })
}

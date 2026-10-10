/**
 * PUT /api/repricing/strategy — set an ASIN + condition group's strategy.
 * Body: { accountId, asin, itemCondition, strategy: CONSERVATIVE | STANDARD | AGGRESSIVE }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { STRATEGIES } from '@/lib/repricing/engine'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { accountId?: string; asin?: string; itemCondition?: string; strategy?: string }
  if (!b.accountId || !b.asin || !b.itemCondition || !b.strategy || !(b.strategy in STRATEGIES)) {
    return NextResponse.json({ error: 'accountId, asin, itemCondition and a valid strategy are required' }, { status: 400 })
  }
  await prisma.repricingGroupSetting.upsert({
    where: { accountId_asin_itemCondition: { accountId: b.accountId, asin: b.asin, itemCondition: b.itemCondition } },
    create: { accountId: b.accountId, asin: b.asin, itemCondition: b.itemCondition, strategy: b.strategy },
    update: { strategy: b.strategy },
  })
  return NextResponse.json({ ok: true })
}

/**
 * POST /api/marketplace-skus/bulk-suspend
 * Body: { ids: string[], suspended: boolean }
 *
 * Suspend / resume many marketplace listings at once. Only Amazon + Back Market
 * rows (the ones that push qty) are affected. Suspended SKUs force-push 0; the
 * affected products are re-pushed in the background so the marketplaces reflect
 * the change (0 on suspend, the real split qty on resume).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { pushSingleQuantity } from '@/app/api/marketplace-skus/push-qty/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : []
  const suspended = body?.suspended === true
  if (ids.length === 0) return NextResponse.json({ error: 'No SKUs selected' }, { status: 400 })

  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { id: { in: ids }, marketplace: { in: ['amazon', 'backmarket'] } },
    select: { id: true, productId: true, gradeId: true },
  })
  if (mskus.length === 0) {
    return NextResponse.json({ error: 'No Amazon / Back Market SKUs in the selection' }, { status: 400 })
  }

  await prisma.productGradeMarketplaceSku.updateMany({
    where: { id: { in: mskus.map(m => m.id) } },
    data: { suspended },
  })

  // Push qty NOW (awaited) so the marketplace reflects the change immediately —
  // suspended → 0, siblings re-split; resume → real qty restored. pushSingleQuantity
  // pushes the whole (product, grade) group, so one driver per group covers it.
  const driverByGroup = new Map<string, string>()
  for (const m of mskus) {
    const key = `${m.productId}::${m.gradeId ?? ''}`
    if (!driverByGroup.has(key)) driverByGroup.set(key, m.id)
  }
  const pushes = await Promise.allSettled(Array.from(driverByGroup.values()).map(id => pushSingleQuantity(id)))
  const pushErrors = pushes.filter(p => p.status === 'rejected').length

  return NextResponse.json({ updated: mskus.length, suspended, groupsPushed: driverByGroup.size, pushErrors })
}

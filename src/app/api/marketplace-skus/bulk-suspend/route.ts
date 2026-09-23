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
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : []
  const suspended = body?.suspended === true
  if (ids.length === 0) return NextResponse.json({ error: 'No SKUs selected' }, { status: 400 })

  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { id: { in: ids }, marketplace: { in: ['amazon', 'backmarket'] } },
    select: { id: true, productId: true },
  })
  if (mskus.length === 0) {
    return NextResponse.json({ error: 'No Amazon / Back Market SKUs in the selection' }, { status: 400 })
  }

  // Flip the flag (fast), then push in the BACKGROUND (waitUntil) so the request
  // returns immediately instead of blocking on many marketplace API calls (which
  // was causing FUNCTION_INVOCATION_TIMEOUT). The background push starts right
  // away — suspended → 0, siblings re-split; resume → real qty — and the 10-min
  // cron reconciles anything the background run doesn't finish.
  await prisma.productGradeMarketplaceSku.updateMany({
    where: { id: { in: mskus.map(m => m.id) } },
    data: { suspended },
  })
  pushQtyForProducts(Array.from(new Set(mskus.map(m => m.productId))))

  return NextResponse.json({ updated: mskus.length, suspended })
}

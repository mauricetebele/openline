/**
 * POST /api/marketplace-skus/set-sync
 * Enable/disable qty sync (syncQty) for a marketplace SKU by its sellerSku +
 * marketplace — used by the Bulk Listing creator to turn on the qty push for a
 * just-created listing without visiting the Marketplace SKUs page.
 * Body: { sellerSku, marketplace, syncQty, accountId? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const sellerSku = typeof b?.sellerSku === 'string' ? b.sellerSku.trim() : ''
  const marketplace = typeof b?.marketplace === 'string' ? b.marketplace : ''
  const syncQty = b?.syncQty === true
  if (!sellerSku || !marketplace) {
    return NextResponse.json({ error: 'sellerSku and marketplace are required' }, { status: 400 })
  }

  const result = await prisma.productGradeMarketplaceSku.updateMany({
    where: {
      sellerSku,
      marketplace,
      ...(typeof b?.accountId === 'string' && b.accountId ? { accountId: b.accountId } : {}),
    },
    data: { syncQty },
  })

  if (result.count === 0) {
    return NextResponse.json({ ok: false, error: 'No marketplace SKU found for that listing yet' }, { status: 200 })
  }
  return NextResponse.json({ ok: true, count: result.count, syncQty })
}

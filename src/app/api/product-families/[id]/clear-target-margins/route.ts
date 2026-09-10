/**
 * POST /api/product-families/[id]/clear-target-margins
 * Clear every queued (unpushed) target margin for this family's SKUs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const products = await prisma.product.findMany({ where: { familyId: params.id }, select: { id: true } })
  const productIds = products.map(p => p.id)
  if (productIds.length === 0) return NextResponse.json({ cleared: 0 })

  const res = await prisma.productGradeMarketplaceSku.updateMany({
    where: { productId: { in: productIds }, targetMarginPct: { not: null } },
    data: { targetMarginPct: null, targetMarginSetAt: null },
  })
  return NextResponse.json({ cleared: res.count })
}

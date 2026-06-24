/**
 * GET /api/removal-shipments/:id/product-lookup?sellerSku=X
 * Maps an Amazon seller SKU to internal Product + Grade via ProductGradeMarketplaceSku
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sellerSku = req.nextUrl.searchParams.get('sellerSku')?.trim()
  if (!sellerSku) return NextResponse.json({ suggestions: [] })

  const mappings = await prisma.productGradeMarketplaceSku.findMany({
    where: {
      sellerSku,
      marketplace: 'amazon',
    },
    include: {
      product: { select: { id: true, sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
    },
  })

  const suggestions = mappings.map(m => ({
    productId: m.product.id,
    sku: m.product.sku,
    description: m.product.description,
    gradeId: m.grade?.id ?? null,
    grade: m.grade?.grade ?? null,
  }))

  return NextResponse.json({ suggestions })
}

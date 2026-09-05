/**
 * GET /api/product-families/search-products?q= — product search for the add-to-family
 * picker. Returns sku, description, and current family (if any).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  const products = await prisma.product.findMany({
    where: {
      archivedAt: null,
      ...(q ? { OR: [{ sku: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { description: 'asc' },
    take: 50,
    select: { id: true, sku: true, description: true, familyId: true, family: { select: { name: true } } },
  })
  return NextResponse.json({
    products: products.map(p => ({ id: p.id, sku: p.sku, description: p.description, familyId: p.familyId, familyName: p.family?.name ?? null })),
  })
}

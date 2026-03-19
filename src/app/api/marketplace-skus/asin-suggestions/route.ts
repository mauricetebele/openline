/**
 * GET /api/marketplace-skus/asin-suggestions?productIds=id1,id2,...
 *
 * For each product, find if any Amazon marketplace SKU (any grade) already has
 * an ASIN mapped. Returns { [productId]: asin } for products that have one.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('productIds')
  if (!raw) return NextResponse.json({ data: {} })

  const productIds = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (productIds.length === 0) return NextResponse.json({ data: {} })

  // Find Amazon marketplace SKUs for these products
  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: {
      productId: { in: productIds },
      marketplace: 'amazon',
    },
    select: { productId: true, sellerSku: true },
  })

  if (mskus.length === 0) return NextResponse.json({ data: {} })

  // Look up ASINs from SellerListing
  const sellerSkus = mskus.map(m => m.sellerSku)
  const listings = await prisma.sellerListing.findMany({
    where: { sku: { in: sellerSkus }, asin: { not: null } },
    select: { sku: true, asin: true },
    distinct: ['sku'],
  })
  const skuToAsin = new Map(listings.map(l => [l.sku, l.asin]))

  // Build productId → asin map (first match wins)
  const result: Record<string, string> = {}
  for (const m of mskus) {
    if (result[m.productId]) continue
    const asin = skuToAsin.get(m.sellerSku)
    if (asin) result[m.productId] = asin
  }

  return NextResponse.json({ data: result })
}

/**
 * GET /api/product-families/[id]/pricing
 * One row per marketplace SKU for every product in the family, stitched with the
 * live listing price (Amazon SellerListing / Back Market MarketplaceListing).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const products = await prisma.product.findMany({
    where: { familyId: params.id },
    select: { id: true, sku: true, description: true },
  })
  if (products.length === 0) return NextResponse.json({ rows: [] })
  const productIds = products.map(p => p.id)
  const productMap = new Map(products.map(p => [p.id, p]))

  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, productId: true, marketplace: true, sellerSku: true, grade: { select: { grade: true } } },
    orderBy: [{ marketplace: 'asc' }, { sellerSku: 'asc' }],
  })

  const amazonSkus = mskus.filter(s => s.marketplace === 'amazon').map(s => s.sellerSku)
  const bmSkus = mskus.filter(s => s.marketplace === 'backmarket').map(s => s.sellerSku)

  const sellerListings = amazonSkus.length
    ? await prisma.sellerListing.findMany({
        where: { sku: { in: amazonSkus } },
        select: { sku: true, accountId: true, asin: true, price: true, minPrice: true, maxPrice: true, listingStatus: true },
      })
    : []
  const slMap = new Map(sellerListings.map(l => [l.sku, l]))

  const bmListings = bmSkus.length
    ? await prisma.marketplaceListing.findMany({
        where: { marketplace: 'backmarket', sellerSku: { in: bmSkus } },
        select: { sellerSku: true, price: true, listingStatus: true },
      })
    : []
  const bmMap = new Map(bmListings.map(l => [l.sellerSku, l]))

  const rows = mskus.map(s => {
    const p = productMap.get(s.productId)!
    const sl = s.marketplace === 'amazon' ? slMap.get(s.sellerSku) : null
    const bm = s.marketplace === 'backmarket' ? bmMap.get(s.sellerSku) : null
    return {
      mskuId: s.id,
      productId: s.productId,
      productSku: p.sku,
      description: p.description,
      marketplace: s.marketplace,
      grade: s.grade?.grade ?? null,
      sellerSku: s.sellerSku,
      accountId: sl?.accountId ?? null,
      asin: sl?.asin ?? null,
      price: sl?.price != null ? Number(sl.price) : bm?.price != null ? Number(bm.price) : null,
      minPrice: sl?.minPrice != null ? Number(sl.minPrice) : null,
      maxPrice: sl?.maxPrice != null ? Number(sl.maxPrice) : null,
      listingStatus: sl?.listingStatus ?? bm?.listingStatus ?? null,
    }
  })

  return NextResponse.json({ rows })
}

/**
 * GET /api/fba-listings/search?q=<search>&accountId=<id>
 *
 * Searches FBA SellerListings by SKU, FNSKU, ASIN, or product title.
 * Also joins to ProductGradeMarketplaceSku to include MSKU mapping when available.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  const accountId = req.nextUrl.searchParams.get('accountId')

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
  }
  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] })
  }

  const listings = await prisma.sellerListing.findMany({
    where: {
      accountId,
      fulfillmentChannel: 'FBA',
      OR: [
        { sku: { contains: q, mode: 'insensitive' } },
        { fnsku: { contains: q, mode: 'insensitive' } },
        { asin: { contains: q, mode: 'insensitive' } },
        { productTitle: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      sku: true,
      fnsku: true,
      asin: true,
      productTitle: true,
      quantity: true,
    },
    take: 20,
    orderBy: { sku: 'asc' },
  })

  // Look up MSKU mappings for these SKUs
  const skus = listings.map(l => l.sku)
  const mskuMappings = await prisma.productGradeMarketplaceSku.findMany({
    where: {
      sellerSku: { in: skus },
      marketplace: 'amazon',
      accountId,
    },
    include: {
      product: { select: { id: true, sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
    },
  })

  const mskuBySku = new Map(mskuMappings.map(m => [m.sellerSku, m]))

  const data = listings.map(l => {
    const msku = mskuBySku.get(l.sku)
    return {
      id: l.id,
      sku: l.sku,
      fnsku: l.fnsku,
      asin: l.asin,
      productTitle: l.productTitle,
      quantity: l.quantity,
      mskuId: msku?.id ?? null,
      productId: msku?.productId ?? null,
      gradeId: msku?.gradeId ?? null,
      grade: msku?.grade?.grade ?? null,
      productSku: msku?.product?.sku ?? null,
      productDescription: msku?.product?.description ?? null,
    }
  })

  return NextResponse.json({ data })
}

/**
 * POST /api/marketplace-skus/map — map a synced marketplace listing to a product + optional grade
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { listingId, productId, gradeId } = body as {
    listingId: string
    productId: string
    gradeId?: string | null
  }

  if (!listingId) return NextResponse.json({ error: 'listingId is required' }, { status: 400 })
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })

  // Validate listing exists and is unmapped
  const listing = await prisma.marketplaceListing.findUnique({ where: { id: listingId } })
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.mskuId) return NextResponse.json({ error: 'Listing is already mapped' }, { status: 409 })

  // Validate product exists
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Validate grade belongs to product (if provided)
  if (gradeId) {
    const grade = await prisma.productGrade.findUnique({ where: { id: gradeId } })
    if (!grade || grade.productId !== productId) {
      return NextResponse.json({ error: 'Grade not found for this product' }, { status: 404 })
    }
  }

  // Create the MSKU mapping and link to listing in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const msku = await tx.productGradeMarketplaceSku.create({
      data: {
        productId,
        gradeId: gradeId || null,
        marketplace: listing.marketplace,
        accountId: listing.accountId,
        sellerSku: listing.sellerSku,
        isSynced: true,
      },
      include: {
        product: { select: { id: true, sku: true, description: true } },
        grade: { select: { id: true, grade: true } },
      },
    })

    await tx.marketplaceListing.update({
      where: { id: listingId },
      data: { mskuId: msku.id },
    })

    return msku
  })

  return NextResponse.json(result, { status: 201 })
}

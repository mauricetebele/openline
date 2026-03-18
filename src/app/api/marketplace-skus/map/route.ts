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

  // Validate grade exists (if provided)
  if (gradeId) {
    const grade = await prisma.grade.findUnique({ where: { id: gradeId } })
    if (!grade) {
      return NextResponse.json({ error: 'Grade not found' }, { status: 404 })
    }
  }

  // Check if a mapping already exists for this product+grade+marketplace+account
  const normalizedGradeId = gradeId || null
  const existing = await prisma.productGradeMarketplaceSku.findFirst({
    where: {
      productId,
      gradeId: normalizedGradeId,
      marketplace: listing.marketplace,
      accountId: listing.accountId,
    },
    include: {
      product: { select: { id: true, sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
    },
  })

  // If mapping already exists, just link the listing to it
  if (existing) {
    if (!listing.mskuId) {
      await prisma.marketplaceListing.update({
        where: { id: listingId },
        data: { mskuId: existing.id },
      })
    }
    return NextResponse.json(existing, { status: 201 })
  }

  // Create the MSKU mapping and link to listing in a transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      const msku = await tx.productGradeMarketplaceSku.create({
        data: {
          productId,
          gradeId: normalizedGradeId,
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
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json(
        { error: 'A marketplace SKU mapping already exists for this product/grade/marketplace/account combination' },
        { status: 409 },
      )
    }
    console.error('[POST /api/marketplace-skus/map] Error:', err)
    const message = err instanceof Error ? err.message : 'Failed to create mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

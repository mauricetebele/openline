/**
 * GET  /api/marketplace-skus         — list all marketplace SKUs with product + grade info
 * POST /api/marketplace-skus         — create a marketplace SKU (graded or ungraded)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const VALID_MARKETPLACES = ['amazon', 'backmarket', 'wholesale']

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const marketplace = req.nextUrl.searchParams.get('marketplace')?.toLowerCase()

    const skus = await prisma.productGradeMarketplaceSku.findMany({
      where: marketplace ? { marketplace } : undefined,
      include: {
        product: { select: { id: true, sku: true, description: true } },
        grade: { select: { id: true, grade: true } },
      },
      orderBy: [{ marketplace: 'asc' }, { sellerSku: 'asc' }],
    })

    // Enrich with ASIN from SellerListing + fulfillmentChannel from MarketplaceListing
    const sellerSkus = skus.map(s => s.sellerSku)
    const sellerListings = sellerSkus.length > 0
      ? await prisma.sellerListing.findMany({
          where: { sku: { in: sellerSkus } },
          select: { sku: true, asin: true, fnsku: true, fulfillmentChannel: true, condition: true },
          distinct: ['sku'],
        })
      : []
    const asinMap = new Map(sellerListings.map(l => [l.sku, l.asin]))
    const fnskuMap = new Map(sellerListings.filter(l => l.fnsku).map(l => [l.sku, l.fnsku]))
    const slFcMap = new Map(sellerListings.filter(l => l.fulfillmentChannel).map(l => [l.sku, l.fulfillmentChannel]))
    const conditionMap = new Map(sellerListings.filter(l => l.condition).map(l => [l.sku, l.condition]))

    const mskuIds = skus.map(s => s.id)
    const mpListings = mskuIds.length > 0
      ? await prisma.marketplaceListing.findMany({
          where: { mskuId: { in: mskuIds } },
          select: { mskuId: true, fulfillmentChannel: true, externalId: true },
        })
      : []
    const fcMap = new Map(mpListings.map(l => [l.mskuId, l.fulfillmentChannel]))
    const externalIdMap = new Map(mpListings.map(l => [l.mskuId, l.externalId]))

    const enriched = skus.map(s => ({
      ...s,
      asin: asinMap.get(s.sellerSku) ?? null,
      fnsku: s.fnsku || fnskuMap.get(s.sellerSku) || null,
      fulfillmentChannel: fcMap.get(s.id) ?? slFcMap.get(s.sellerSku) ?? null,
      itemCondition: conditionMap.get(s.sellerSku) ?? null,
      bmListingId: externalIdMap.get(s.id) ?? null,
    }))

    return NextResponse.json({ data: enriched })
  } catch (err) {
    console.error('[marketplace-skus GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load marketplace SKUs' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { productId, gradeId, marketplace, accountId, sellerSku } = body as {
    productId: string
    gradeId?: string | null
    marketplace: string
    accountId?: string | null
    sellerSku: string
  }

  if (!productId?.trim()) {
    return NextResponse.json({ error: 'Product is required' }, { status: 400 })
  }
  if (!marketplace?.trim()) {
    return NextResponse.json({ error: 'Marketplace is required' }, { status: 400 })
  }
  if (!sellerSku?.trim()) {
    return NextResponse.json({ error: 'Seller SKU is required' }, { status: 400 })
  }
  if (!VALID_MARKETPLACES.includes(marketplace.toLowerCase())) {
    return NextResponse.json(
      { error: `Marketplace must be one of: ${VALID_MARKETPLACES.join(', ')}` },
      { status: 400 },
    )
  }

  // Validate product exists
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  // Validate grade exists (if provided)
  if (gradeId) {
    const grade = await prisma.grade.findUnique({ where: { id: gradeId } })
    if (!grade) {
      return NextResponse.json({ error: 'Grade not found' }, { status: 404 })
    }
  }

  const normalizedAccountId = accountId?.trim() || null
  const normalizedMarketplace = marketplace.toLowerCase()

  try {
    const created = await prisma.$transaction(async (tx) => {
      const msku = await tx.productGradeMarketplaceSku.create({
        data: {
          productId,
          gradeId: gradeId || null,
          marketplace: normalizedMarketplace,
          accountId: normalizedAccountId,
          sellerSku: sellerSku.trim(),
        },
        include: {
          product: { select: { id: true, sku: true, description: true } },
          grade: { select: { id: true, grade: true } },
        },
      })

      // Auto-link to existing marketplace listing if one exists
      const listing = await tx.marketplaceListing.findFirst({
        where: {
          marketplace: normalizedMarketplace,
          sellerSku: sellerSku.trim(),
          mskuId: null,
        },
      })
      if (listing) {
        await tx.marketplaceListing.update({
          where: { id: listing.id },
          data: { mskuId: msku.id },
        })
      }

      return msku
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json(
        { error: 'This Seller SKU already exists for this marketplace/account combination' },
        { status: 409 },
      )
    }
    console.error('[POST /api/marketplace-skus] Error:', err)
    const message = err instanceof Error ? err.message : 'Failed to create marketplace SKU'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

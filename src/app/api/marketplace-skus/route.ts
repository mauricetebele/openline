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

    return NextResponse.json({ data: skus })
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

  // Validate grade belongs to product (if provided)
  if (gradeId) {
    const grade = await prisma.productGrade.findUnique({ where: { id: gradeId } })
    if (!grade || grade.productId !== productId) {
      return NextResponse.json({ error: 'Grade not found for this product' }, { status: 404 })
    }
  }

  const normalizedAccountId = accountId?.trim() || null
  const normalizedMarketplace = marketplace.toLowerCase()

  // For ungraded MSKUs, do application-level duplicate check (partial index handles DB level)
  if (!gradeId) {
    const existing = await prisma.productGradeMarketplaceSku.findFirst({
      where: {
        productId,
        gradeId: null,
        marketplace: normalizedMarketplace,
        accountId: normalizedAccountId,
      },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'A marketplace SKU already exists for this product/marketplace/account combination' },
        { status: 409 },
      )
    }
  }

  try {
    const created = await prisma.productGradeMarketplaceSku.create({
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
    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json(
        { error: 'A marketplace SKU already exists for this product/grade/marketplace/account combination' },
        { status: 409 },
      )
    }
    throw err
  }
}

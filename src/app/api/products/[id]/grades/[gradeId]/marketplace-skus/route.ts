/**
 * GET  /api/products/[id]/grades/[gradeId]/marketplace-skus  — list marketplace SKUs
 * POST /api/products/[id]/grades/[gradeId]/marketplace-skus  — create marketplace SKU
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; gradeId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const grade = await prisma.productGrade.findUnique({ where: { id: params.gradeId } })
  if (!grade || grade.productId !== params.id) {
    return NextResponse.json({ error: 'Grade not found' }, { status: 404 })
  }

  const skus = await prisma.productGradeMarketplaceSku.findMany({
    where: { gradeId: params.gradeId },
    orderBy: [{ marketplace: 'asc' }, { createdAt: 'asc' }],
  })

  return NextResponse.json({ data: skus })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; gradeId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const grade = await prisma.productGrade.findUnique({ where: { id: params.gradeId } })
  if (!grade || grade.productId !== params.id) {
    return NextResponse.json({ error: 'Grade not found' }, { status: 404 })
  }

  const body = await req.json()
  const { marketplace, accountId, sellerSku } = body as {
    marketplace: string
    accountId?: string | null
    sellerSku: string
  }

  if (!marketplace?.trim()) {
    return NextResponse.json({ error: 'Marketplace is required' }, { status: 400 })
  }
  if (!sellerSku?.trim()) {
    return NextResponse.json({ error: 'Seller SKU is required' }, { status: 400 })
  }

  const validMarketplaces = ['amazon', 'backmarket', 'wholesale']
  if (!validMarketplaces.includes(marketplace.toLowerCase())) {
    return NextResponse.json({ error: `Marketplace must be one of: ${validMarketplaces.join(', ')}` }, { status: 400 })
  }

  try {
    const created = await prisma.productGradeMarketplaceSku.create({
      data: {
        productId:   grade.productId,
        gradeId:     params.gradeId,
        marketplace: marketplace.toLowerCase(),
        accountId:   accountId?.trim() || null,
        sellerSku:   sellerSku.trim(),
      },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json(
        { error: 'A marketplace SKU already exists for this grade/marketplace/account combination' },
        { status: 409 },
      )
    }
    throw err
  }
}

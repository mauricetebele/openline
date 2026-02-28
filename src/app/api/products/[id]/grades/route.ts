/**
 * GET  /api/products/[id]/grades  — list all grades for a product
 * POST /api/products/[id]/grades  — create a new grade
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const grades = await prisma.productGrade.findMany({
    where: { productId: params.id },
    include: { marketplaceSkus: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ sortOrder: 'asc' }, { grade: 'asc' }],
  })

  return NextResponse.json({ data: grades })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { grade, description, sortOrder } = body as {
    grade: string
    description?: string
    sortOrder?: number
  }

  if (!grade?.trim()) {
    return NextResponse.json({ error: 'Grade is required' }, { status: 400 })
  }

  // Verify product exists
  const product = await prisma.product.findUnique({ where: { id: params.id } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  try {
    const created = await prisma.productGrade.create({
      data: {
        productId:   params.id,
        grade:       grade.trim().toUpperCase(),
        description: description?.trim() || null,
        sortOrder:   sortOrder ?? 0,
      },
      include: { marketplaceSkus: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'P2002') {
      return NextResponse.json({ error: `Grade "${grade.trim().toUpperCase()}" already exists for this product` }, { status: 409 })
    }
    throw err
  }
}

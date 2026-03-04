/**
 * PATCH  /api/marketplace-skus/[id] — update a marketplace SKU (e.g. toggle syncQty)
 * DELETE /api/marketplace-skus/[id] — delete a marketplace SKU by id
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { syncQty } = body as { syncQty?: boolean }

  if (typeof syncQty !== 'boolean') {
    return NextResponse.json({ error: 'syncQty (boolean) is required' }, { status: 400 })
  }

  const msku = await prisma.productGradeMarketplaceSku.findUnique({
    where: { id: params.id },
  })
  if (!msku) {
    return NextResponse.json({ error: 'Marketplace SKU not found' }, { status: 404 })
  }

  const updated = await prisma.productGradeMarketplaceSku.update({
    where: { id: params.id },
    data: { syncQty },
    include: {
      product: { select: { id: true, sku: true, description: true } },
      grade: { select: { id: true, grade: true } },
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const msku = await prisma.productGradeMarketplaceSku.findUnique({
    where: { id: params.id },
  })
  if (!msku) {
    return NextResponse.json({ error: 'Marketplace SKU not found' }, { status: 404 })
  }

  await prisma.productGradeMarketplaceSku.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}

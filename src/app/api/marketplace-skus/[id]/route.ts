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
  const { syncQty, maxQty } = body as { syncQty?: boolean; maxQty?: number | null }

  // At least one field must be provided
  if (typeof syncQty !== 'boolean' && maxQty === undefined) {
    return NextResponse.json({ error: 'syncQty (boolean) or maxQty (number|null) is required' }, { status: 400 })
  }

  const msku = await prisma.productGradeMarketplaceSku.findUnique({
    where: { id: params.id },
  })
  if (!msku) {
    return NextResponse.json({ error: 'Marketplace SKU not found' }, { status: 404 })
  }

  const data: { syncQty?: boolean; maxQty?: number | null } = {}
  if (typeof syncQty === 'boolean') data.syncQty = syncQty
  if (maxQty !== undefined) data.maxQty = maxQty

  const updated = await prisma.productGradeMarketplaceSku.update({
    where: { id: params.id },
    data,
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

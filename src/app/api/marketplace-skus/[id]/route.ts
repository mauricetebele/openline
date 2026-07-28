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
  const { syncQty, maxQty, isDefaultSku, seeSaw } = body as {
    syncQty?: boolean; maxQty?: number | null; isDefaultSku?: boolean; seeSaw?: boolean
  }

  // At least one field must be provided
  if (typeof syncQty !== 'boolean' && maxQty === undefined && typeof isDefaultSku !== 'boolean' && typeof seeSaw !== 'boolean') {
    return NextResponse.json({ error: 'syncQty, maxQty, isDefaultSku, or seeSaw is required' }, { status: 400 })
  }

  const msku = await prisma.productGradeMarketplaceSku.findUnique({
    where: { id: params.id },
  })
  if (!msku) {
    return NextResponse.json({ error: 'Marketplace SKU not found' }, { status: 404 })
  }

  const group = { productId: msku.productId, gradeId: msku.gradeId ?? null }

  // Last Unit Lean and SEE-SAW are mutually exclusive within a (productId, gradeId)
  // group. SEE-SAW is the default: setting a lean turns it off; clearing the lean
  // restores it. SEE-SAW is a group-level strategy, so it's applied group-wide.
  if (isDefaultSku === true) {
    // One lean per group; enabling it disables see-saw group-wide.
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group, id: { not: msku.id }, isDefaultSku: true },
      data: { isDefaultSku: false },
    })
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: false, seeSawActive: false, seeSawFlippedAt: null },
    })
  } else if (isDefaultSku === false) {
    // Clearing the lean restores the see-saw default for the group.
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: true, seeSawActive: false, seeSawFlippedAt: null },
    })
  }

  if (seeSaw === true) {
    // Enable see-saw group-wide, clear any lean, reset the rotation.
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: true, isDefaultSku: false, seeSawActive: false, seeSawFlippedAt: null },
    })
  } else if (seeSaw === false) {
    // Disable see-saw group-wide (falls back to the legacy last-unit default).
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: false, seeSawActive: false, seeSawFlippedAt: null },
    })
  }

  // Target-row fields (group-wide see-saw changes already applied above).
  const data: { syncQty?: boolean; maxQty?: number | null; isDefaultSku?: boolean } = {}
  if (typeof syncQty === 'boolean') data.syncQty = syncQty
  if (maxQty !== undefined) data.maxQty = maxQty
  if (typeof isDefaultSku === 'boolean') data.isDefaultSku = isDefaultSku

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

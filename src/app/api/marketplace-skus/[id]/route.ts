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
  const { syncQty, maxQty, isDefaultSku, seeSaw, simulList, targetMarginPct, calculationTemplateId } = body as {
    syncQty?: boolean; maxQty?: number | null; isDefaultSku?: boolean; seeSaw?: boolean; simulList?: boolean
    targetMarginPct?: number | null; calculationTemplateId?: string | null
  }

  // At least one field must be provided
  if (typeof syncQty !== 'boolean' && maxQty === undefined && typeof isDefaultSku !== 'boolean' && typeof seeSaw !== 'boolean' && typeof simulList !== 'boolean' && targetMarginPct === undefined && calculationTemplateId === undefined) {
    return NextResponse.json({ error: 'a settable field is required' }, { status: 400 })
  }

  const msku = await prisma.productGradeMarketplaceSku.findUnique({
    where: { id: params.id },
  })
  if (!msku) {
    return NextResponse.json({ error: 'Marketplace SKU not found' }, { status: 404 })
  }

  const group = { productId: msku.productId, gradeId: msku.gradeId ?? null }

  // Last Unit Lean, SEE-SAW, and SIMUL-LIST are mutually-exclusive last-unit strategies
  // within a (productId, gradeId) group. SEE-SAW is the default; enabling any one clears
  // the others group-wide. Group-level strategies are applied via updateMany.
  if (isDefaultSku === true) {
    // One lean per group; enabling it disables see-saw and simul-list group-wide.
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group, id: { not: msku.id }, isDefaultSku: true },
      data: { isDefaultSku: false },
    })
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: false, seeSawActive: false, seeSawFlippedAt: null, simulList: false },
    })
  } else if (isDefaultSku === false) {
    // Clearing the lean restores the see-saw default for the group.
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: true, seeSawActive: false, seeSawFlippedAt: null, simulList: false },
    })
  }

  if (seeSaw === true) {
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: true, isDefaultSku: false, simulList: false, seeSawActive: false, seeSawFlippedAt: null },
    })
  } else if (seeSaw === false) {
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { seeSaw: false, seeSawActive: false, seeSawFlippedAt: null },
    })
  }

  if (simulList === true) {
    // Enable simul-list group-wide; clear lean + see-saw.
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { simulList: true, isDefaultSku: false, seeSaw: false, seeSawActive: false, seeSawFlippedAt: null },
    })
  } else if (simulList === false) {
    // Disabling simul-list restores the see-saw default.
    await prisma.productGradeMarketplaceSku.updateMany({
      where: { ...group },
      data: { simulList: false, seeSaw: true, seeSawActive: false, seeSawFlippedAt: null },
    })
  }

  // Target-row fields (group-wide strategy changes already applied above).
  const data: { syncQty?: boolean; maxQty?: number | null; isDefaultSku?: boolean; targetMarginPct?: number | null; calculationTemplateId?: string | null } = {}
  if (typeof syncQty === 'boolean') data.syncQty = syncQty
  if (maxQty !== undefined) data.maxQty = maxQty
  if (typeof isDefaultSku === 'boolean') data.isDefaultSku = isDefaultSku
  if (targetMarginPct !== undefined) data.targetMarginPct = targetMarginPct
  if (calculationTemplateId !== undefined) data.calculationTemplateId = calculationTemplateId || null

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

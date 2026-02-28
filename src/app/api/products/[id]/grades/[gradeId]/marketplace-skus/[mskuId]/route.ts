/**
 * DELETE /api/products/[id]/grades/[gradeId]/marketplace-skus/[mskuId]
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; gradeId: string; mskuId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const msku = await prisma.productGradeMarketplaceSku.findUnique({ where: { id: params.mskuId } })
  if (!msku || msku.gradeId !== params.gradeId) {
    return NextResponse.json({ error: 'Marketplace SKU not found' }, { status: 404 })
  }

  await prisma.productGradeMarketplaceSku.delete({ where: { id: params.mskuId } })
  return NextResponse.json({ ok: true })
}

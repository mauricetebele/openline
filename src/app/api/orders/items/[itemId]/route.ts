/**
 * PATCH /api/orders/items/[itemId]
 * Body: { sellerSku: string }
 * Updates the sellerSku on a pending order's item.
 * Only allowed when the parent order is in PENDING status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { itemId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sellerSku, gradeId } = await req.json() as { sellerSku?: string; gradeId?: string | null }
  if (typeof sellerSku !== 'string') {
    return NextResponse.json({ error: 'sellerSku must be a string' }, { status: 400 })
  }

  // Verify item exists and its order is still PENDING
  const item = await prisma.orderItem.findUnique({
    where: { id: params.itemId },
    include: { order: { select: { workflowStatus: true } } },
  })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (item.order.workflowStatus !== 'PENDING') {
    return NextResponse.json({ error: 'SKU can only be edited on PENDING orders' }, { status: 409 })
  }

  const trimmedSku = sellerSku.trim() || null

  // Look up the product description for the new SKU (if any)
  const product = trimmedSku
    ? await prisma.product.findUnique({ where: { sku: trimmedSku }, select: { description: true } })
    : null

  const updated = await prisma.orderItem.update({
    where: { id: params.itemId },
    data: {
      sellerSku: trimmedSku,
      // Replace title with the product description if a matching product exists
      ...(product?.description ? { title: product.description } : {}),
      // Save grade selection (null clears the grade)
      ...(gradeId !== undefined ? { gradeId: gradeId || null } : {}),
    },
    select: { id: true, sellerSku: true, title: true, gradeId: true },
  })

  return NextResponse.json(updated)
}

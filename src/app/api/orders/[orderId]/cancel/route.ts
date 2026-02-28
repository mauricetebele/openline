/**
 * POST /api/orders/[orderId]/cancel
 * Cancels an order in PENDING, PROCESSING, or AWAITING_VERIFICATION.
 * If the order has inventory reservations (PROCESSING / AWAITING_VERIFICATION),
 * they are released and qty restored before marking the order CANCELLED.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CANCELLABLE = new Set(['PENDING', 'PROCESSING', 'AWAITING_VERIFICATION'])

export async function POST(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where:   { id: params.orderId },
    include: { reservations: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!CANCELLABLE.has(order.workflowStatus)) {
    return NextResponse.json(
      { error: `Order cannot be cancelled from status ${order.workflowStatus}` },
      { status: 409 },
    )
  }

  await prisma.$transaction(async tx => {
    // Restore inventory qty for any existing reservations
    for (const r of order.reservations) {
      await tx.inventoryItem.updateMany({
        where: { productId: r.productId, locationId: r.locationId, gradeId: r.gradeId ?? null },
        data:  { qty: { increment: r.qtyReserved } },
      })
    }

    // Remove reservations
    if (order.reservations.length > 0) {
      await tx.orderInventoryReservation.deleteMany({ where: { orderId: params.orderId } })
    }

    // Mark cancelled
    await tx.order.update({
      where: { id: params.orderId },
      data:  { workflowStatus: 'CANCELLED', processedAt: null },
    })
  })

  return NextResponse.json({ success: true })
}

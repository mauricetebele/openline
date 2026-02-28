/**
 * POST /api/orders/[orderId]/unprocess
 * Reverses inventory reservation and moves order back to PENDING.
 * Restores qty to each reserved InventoryItem and deletes reservation records.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

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
  if (order.workflowStatus !== 'PROCESSING') {
    return NextResponse.json({ error: 'Order is not in the Unshipped state' }, { status: 409 })
  }

  await prisma.$transaction(async tx => {
    // Restore inventory qty for each reservation
    for (const r of order.reservations) {
      await tx.inventoryItem.updateMany({
        where: { productId: r.productId, locationId: r.locationId, gradeId: r.gradeId ?? null },
        data:  { qty: { increment: r.qtyReserved } },
      })
    }

    // Delete all reservations for this order
    await tx.orderInventoryReservation.deleteMany({ where: { orderId: params.orderId } })

    // Move back to PENDING
    await tx.order.update({
      where: { id: params.orderId },
      data:  { workflowStatus: 'PENDING', processedAt: null },
    })
  })

  return NextResponse.json({ success: true })
}

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
    include: {
      reservations: true,
      serialAssignments: { include: { inventorySerial: { select: { id: true, status: true, locationId: true } } } },
      items: { select: { id: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.workflowStatus !== 'PROCESSING') {
    return NextResponse.json({ error: 'Order is not in the Unshipped state' }, { status: 409 })
  }

  await prisma.$transaction(async tx => {
    // ── De-serialize: remove serial assignments (serials stay IN_STOCK) ──
    for (const sa of order.serialAssignments) {
      // Safety: revert to IN_STOCK if somehow marked SOLD
      if (sa.inventorySerial.status !== 'IN_STOCK') {
        await tx.inventorySerial.update({
          where: { id: sa.inventorySerialId },
          data: { status: 'IN_STOCK' },
        })
      }
      await tx.serialHistory.create({
        data: {
          inventorySerialId: sa.inventorySerialId,
          eventType: 'UNASSIGNED',
          orderId: params.orderId,
          locationId: sa.inventorySerial.locationId,
          userId: user.dbId,
          notes: `Unprocessed order ${order.amazonOrderId}`,
        },
      })
    }
    if (order.serialAssignments.length > 0) {
      await tx.orderSerialAssignment.deleteMany({ where: { orderId: params.orderId } })
    }
    if (order.orderSource === 'backmarket') {
      for (const item of order.items) {
        await tx.orderItem.update({ where: { id: item.id }, data: { bmSerials: [] } })
      }
    }

    // ── Release inventory reservations ────────────────────────────────────
    for (const r of order.reservations) {
      await tx.inventoryItem.updateMany({
        where: { productId: r.productId, locationId: r.locationId, gradeId: r.gradeId ?? null },
        data:  { qty: { increment: r.qtyReserved } },
      })
    }
    await tx.orderInventoryReservation.deleteMany({ where: { orderId: params.orderId } })

    // Move back to PENDING
    await tx.order.update({
      where: { id: params.orderId },
      data:  { workflowStatus: 'PENDING', processedAt: null },
    })
  })

  return NextResponse.json({ success: true })
}

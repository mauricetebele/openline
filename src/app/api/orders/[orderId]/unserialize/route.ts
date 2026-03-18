/**
 * DELETE /api/orders/[orderId]/unserialize
 * Removes all serial assignments from an order and reverts serials to IN_STOCK.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: {
      serialAssignments: { include: { inventorySerial: { select: { id: true, status: true, locationId: true } } } },
      items: { select: { id: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (order.workflowStatus !== 'AWAITING_VERIFICATION' && order.workflowStatus !== 'PROCESSING') {
    return NextResponse.json({ error: 'Can only unserialize orders in PROCESSING or AWAITING_VERIFICATION' }, { status: 409 })
  }

  if (order.serialAssignments.length === 0) {
    return NextResponse.json({ error: 'Order has no serial assignments' }, { status: 400 })
  }

  await prisma.$transaction(async tx => {
    for (const sa of order.serialAssignments) {
      // Revert to IN_STOCK if somehow marked SOLD (shouldn't happen for unshipped orders)
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
          notes: `Unserialized from order ${order.amazonOrderId}`,
        },
      })
    }

    await tx.orderSerialAssignment.deleteMany({
      where: { orderId: params.orderId },
    })

    if (order.orderSource === 'backmarket') {
      for (const item of order.items) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { bmSerials: [] },
        })
      }
    }
  })

  return NextResponse.json({ success: true, removed: order.serialAssignments.length })
}

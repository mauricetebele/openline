/**
 * DELETE /api/wholesale/orders/[id]/unserialize
 * Removes all SalesOrderSerialAssignment records for the order.
 * Reverts any OUT_OF_STOCK serials back to IN_STOCK.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: {
      serialAssignments: {
        include: { inventorySerial: { select: { id: true, status: true } } },
      },
    },
  })
  if (!so) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (so.fulfillmentStatus !== 'PROCESSING') {
    return NextResponse.json(
      { error: `Order is ${so.fulfillmentStatus} — must be PROCESSING to unserialize` },
      { status: 409 },
    )
  }

  if (so.serialAssignments.length === 0) {
    return NextResponse.json({ error: 'Order has no serial assignments' }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    // Revert any serials that were marked OUT_OF_STOCK back to IN_STOCK
    for (const sa of so.serialAssignments) {
      if (sa.inventorySerial.status !== 'IN_STOCK') {
        await tx.inventorySerial.update({
          where: { id: sa.inventorySerial.id },
          data: { status: 'IN_STOCK' },
        })
      }
    }

    // Remove all assignments
    await tx.salesOrderSerialAssignment.deleteMany({
      where: { salesOrderId: params.id },
    })
  })

  return NextResponse.json({ ok: true, removed: so.serialAssignments.length })
}

/**
 * POST /api/wholesale/customer-rma/[id]/receive
 * Receive a single serial back into inventory from an RMA.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { pushQtyForProducts } from '@/lib/push-qty-for-product'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { serialNumber: string; locationId: string }

  if (!body.serialNumber?.trim()) {
    return NextResponse.json({ error: 'serialNumber is required' }, { status: 400 })
  }
  if (!body.locationId) {
    return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
  }

  // Find the CustomerRMASerial on this RMA
  const rmaSerial = await prisma.customerRMASerial.findFirst({
    where: {
      rmaId: params.id,
      serialNumber: body.serialNumber.trim(),
      receivedAt: null,
    },
    include: {
      rma: { select: { id: true, status: true } },
      inventorySerial: { select: { id: true, productId: true } },
    },
  })

  if (!rmaSerial) {
    return NextResponse.json(
      { error: 'Serial not found on this RMA or already received' },
      { status: 404 },
    )
  }

  const { inventorySerial } = rmaSerial
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    // 1. Mark CustomerRMASerial as received
    await tx.customerRMASerial.update({
      where: { id: rmaSerial.id },
      data: { receivedAt: now, receivedLocationId: body.locationId },
    })

    // 2. Update InventorySerial: back to IN_STOCK at receiving location
    await tx.inventorySerial.update({
      where: { id: inventorySerial.id },
      data: { status: 'IN_STOCK', locationId: body.locationId },
    })

    // 3. Upsert InventoryItem qty increment
    await tx.inventoryItem.upsert({
      where: {
        productId_locationId_gradeId: {
          productId: rmaSerial.productId,
          locationId: body.locationId,
          gradeId: rmaSerial.gradeId ?? '',
        },
      },
      create: {
        productId: rmaSerial.productId,
        locationId: body.locationId,
        gradeId: rmaSerial.gradeId,
        qty: 1,
      },
      update: { qty: { increment: 1 } },
    })

    // 4. Delete SalesOrderSerialAssignment to free the serial for re-sale
    if (rmaSerial.salesOrderId) {
      await tx.salesOrderSerialAssignment.deleteMany({
        where: { serialId: inventorySerial.id },
      })
    }

    // 5. Create SerialHistory entry
    await tx.serialHistory.create({
      data: {
        inventorySerialId: inventorySerial.id,
        eventType: 'WHOLESALE_RMA_RETURN',
        locationId: body.locationId,
        notes: `RMA return received (${rmaSerial.returnReason})`,
        userId: user.dbId,
      },
    })
  })

  // Check if all serials are now received → auto-transition to RECEIVED
  const unreceived = await prisma.customerRMASerial.count({
    where: { rmaId: params.id, receivedAt: null },
  })

  if (unreceived === 0) {
    await prisma.customerRMA.update({
      where: { id: params.id },
      data: { status: 'RECEIVED' },
    })
  }

  // Push qty for affected products (fire-and-forget)
  pushQtyForProducts([rmaSerial.productId])

  return NextResponse.json({ success: true, allReceived: unreceived === 0 })
}

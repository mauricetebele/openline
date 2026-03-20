/**
 * POST /api/fba-shipments/[id]/mark-shipped
 *
 * Marks shipment as shipped. Updates serials to OUT_OF_STOCK,
 * releases inventory reservations (qty already subtracted),
 * and creates history events.
 * Status: LABELS_READY → SHIPPED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id },
    include: {
      serialAssignments: {
        include: {
          inventorySerial: {
            select: { id: true, productId: true, locationId: true, gradeId: true, status: true },
          },
        },
      },
      reservations: true,
    },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status !== 'LABELS_READY') {
    return NextResponse.json({ error: 'Shipment must be in LABELS_READY status' }, { status: 409 })
  }

  const confirmationLabel = shipment.shipmentConfirmationId
    ? ` (${shipment.shipmentConfirmationId})`
    : ''
  const shipLabel = shipment.shipmentNumber ?? 'FBA shipment'

  await prisma.$transaction(async tx => {
    // Batch: mark all IN_STOCK serials as OUT_OF_STOCK
    const inStockSerialIds = shipment.serialAssignments
      .filter(sa => sa.inventorySerial.status === 'IN_STOCK')
      .map(sa => sa.inventorySerial.id)

    if (inStockSerialIds.length > 0) {
      await tx.inventorySerial.updateMany({
        where: { id: { in: inStockSerialIds } },
        data: { status: 'OUT_OF_STOCK' },
      })
    }

    // Batch: create all history records at once
    await tx.serialHistory.createMany({
      data: shipment.serialAssignments.map(sa => ({
        inventorySerialId: sa.inventorySerial.id,
        eventType: 'FBA_SHIPMENT',
        fbaShipmentId: id,
        locationId: sa.inventorySerial.locationId,
        userId: user.dbId,
        notes: `Shipped via ${shipLabel}${confirmationLabel}`,
      })),
    })

    // Release inventory reservations
    await tx.fbaInventoryReservation.deleteMany({
      where: { fbaShipmentId: id },
    })

    await tx.fbaShipment.update({
      where: { id },
      data: { status: 'SHIPPED' },
    })
  })

  return NextResponse.json({ success: true })
}

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
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
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
    // Mark serials as OUT_OF_STOCK + create history
    for (const sa of shipment.serialAssignments) {
      const serial = sa.inventorySerial

      if (serial.status === 'IN_STOCK') {
        await tx.inventorySerial.update({
          where: { id: serial.id },
          data: { status: 'OUT_OF_STOCK' },
        })
      }

      await tx.serialHistory.create({
        data: {
          inventorySerialId: serial.id,
          eventType: 'FBA_SHIPMENT',
          fbaShipmentId: params.id,
          locationId: serial.locationId,
          userId: user.dbId,
          notes: `Shipped via ${shipLabel}${confirmationLabel}`,
        },
      })
    }

    // Release inventory reservations.
    // InventoryItem.qty already has reservations subtracted, so deleting
    // the reservation is all that's needed — no qty decrement required.
    await tx.fbaInventoryReservation.deleteMany({
      where: { fbaShipmentId: params.id },
    })

    await tx.fbaShipment.update({
      where: { id: params.id },
      data: { status: 'SHIPPED' },
    })
  })

  return NextResponse.json({ success: true })
}

/**
 * POST /api/fba-shipments/[id]/mark-shipped
 *
 * Marks shipment as shipped. Updates serials to SOLD with history events.
 * Status: LABELS_READY → SHIPPED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: { serialAssignments: { include: { inventorySerial: { select: { id: true, locationId: true } } } } },
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
    // Update each serial to SOLD + create history
    for (const sa of shipment.serialAssignments) {
      await tx.inventorySerial.update({
        where: { id: sa.inventorySerialId },
        data: { status: 'SOLD' },
      })

      await tx.serialHistory.create({
        data: {
          inventorySerialId: sa.inventorySerialId,
          eventType: 'FBA_SHIPMENT',
          fbaShipmentId: params.id,
          locationId: sa.inventorySerial.locationId,
          notes: `Shipped via ${shipLabel}${confirmationLabel}`,
        },
      })
    }

    await tx.fbaShipment.update({
      where: { id: params.id },
      data: { status: 'SHIPPED' },
    })
  })

  return NextResponse.json({ success: true })
}

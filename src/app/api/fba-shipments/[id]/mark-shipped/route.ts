/**
 * POST /api/fba-shipments/[id]/mark-shipped
 *
 * Marks shipment as shipped. Updates serials to OUT_OF_STOCK,
 * decrements inventory qty, and creates history events.
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
    // Track inventory decrements to batch them
    const decrements = new Map<string, number>()

    for (const sa of shipment.serialAssignments) {
      const serial = sa.inventorySerial

      // Only update serials that are still IN_STOCK
      if (serial.status === 'IN_STOCK') {
        await tx.inventorySerial.update({
          where: { id: serial.id },
          data: { status: 'OUT_OF_STOCK' },
        })

        // Track inventory decrement by product+location+grade
        const key = `${serial.productId}|${serial.locationId}|${serial.gradeId ?? ''}`
        decrements.set(key, (decrements.get(key) ?? 0) + 1)
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

    // Decrement inventory quantities
    for (const [key, qty] of decrements) {
      const [productId, locationId, gradeId] = key.split('|')
      await tx.inventoryItem.updateMany({
        where: {
          productId,
          locationId,
          gradeId: gradeId || null,
        },
        data: { qty: { decrement: qty } },
      })
    }

    await tx.fbaShipment.update({
      where: { id: params.id },
      data: { status: 'SHIPPED' },
    })
  })

  return NextResponse.json({ success: true })
}

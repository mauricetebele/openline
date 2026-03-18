/**
 * GET    /api/fba-shipments/[id] — full detail of one FBA shipment
 * DELETE /api/fba-shipments/[id] — delete a non-shipped shipment (releases inventory)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: {
      account: { select: { id: true, sellerId: true, marketplaceId: true, marketplaceName: true } },
      warehouse: true,
      items: {
        include: {
          msku: {
            select: {
              id: true, sellerSku: true,
              product: { select: { id: true, sku: true, description: true } },
              grade: { select: { id: true, grade: true } },
            },
          },
          boxItems: { include: { box: true } },
          serialAssignments: {
            include: {
              inventorySerial: {
                select: { id: true, serialNumber: true, productId: true, gradeId: true },
              },
            },
          },
        },
      },
      boxes: {
        include: { items: true },
        orderBy: { boxNumber: 'asc' },
      },
      reservations: true,
    },
  })

  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })

  return NextResponse.json(shipment)
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: {
      reservations: true,
      serialAssignments: { include: { inventorySerial: { select: { id: true, locationId: true } } } },
    },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (shipment.status === 'SHIPPED') {
    return NextResponse.json({ error: 'Cannot delete a shipped shipment' }, { status: 409 })
  }

  await prisma.$transaction(async tx => {
    // Restore inventory for each reservation
    for (const r of shipment.reservations) {
      await tx.inventoryItem.updateMany({
        where: { productId: r.productId, locationId: r.locationId, gradeId: r.gradeId ?? null },
        data: { qty: { increment: r.qtyReserved } },
      })
    }

    // Clean up serial assignments + UNASSIGNED history
    for (const sa of shipment.serialAssignments) {
      await tx.serialHistory.create({
        data: {
          inventorySerialId: sa.inventorySerialId,
          eventType: 'UNASSIGNED',
          fbaShipmentId: params.id,
          locationId: sa.inventorySerial.locationId,
          userId: user.dbId,
          notes: `Deleted ${shipment.shipmentNumber ?? 'FBA shipment'}`,
        },
      })
    }

    // Cascade delete handles items, boxes, box items, reservations, serial assignments
    await tx.fbaShipment.delete({ where: { id: params.id } })
  })

  return NextResponse.json({ success: true })
}

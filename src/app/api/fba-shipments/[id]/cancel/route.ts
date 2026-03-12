/**
 * POST /api/fba-shipments/[id]/cancel
 *
 * Cancels an FBA shipment and releases reserved inventory.
 * Follows the same pattern as order cancellation.
 *
 * Status: any non-terminal → CANCELLED
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const TERMINAL = new Set(['SHIPPED', 'CANCELLED'])

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shipment = await prisma.fbaShipment.findUnique({
    where: { id: params.id },
    include: { reservations: true },
  })
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
  if (TERMINAL.has(shipment.status)) {
    return NextResponse.json(
      { error: `Shipment cannot be cancelled from status ${shipment.status}` },
      { status: 409 },
    )
  }

  await prisma.$transaction(async tx => {
    // Restore inventory for each reservation
    for (const r of shipment.reservations) {
      await tx.inventoryItem.updateMany({
        where: { productId: r.productId, locationId: r.locationId, gradeId: r.gradeId ?? null },
        data: { qty: { increment: r.qtyReserved } },
      })
    }

    // Remove reservations
    if (shipment.reservations.length > 0) {
      await tx.fbaInventoryReservation.deleteMany({ where: { fbaShipmentId: params.id } })
    }

    // Mark cancelled
    await tx.fbaShipment.update({
      where: { id: params.id },
      data: { status: 'CANCELLED' },
    })
  })

  return NextResponse.json({ success: true })
}

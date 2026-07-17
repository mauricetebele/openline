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
    const inStockAssignments = shipment.serialAssignments
      .filter(sa => sa.inventorySerial.status === 'IN_STOCK')
    const inStockSerialIds = inStockAssignments.map(sa => sa.inventorySerial.id)

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

    // ── Reconcile aggregate qty with the serials actually shipped ──────────
    // Normal path: assign-inventory already decremented InventoryItem.qty and
    // created reservations covering every unit, so the shortfall below is 0 and
    // this is a no-op. But if a shipment reached SHIPPED with scanned serials
    // that were never covered by a reservation (assign-inventory skipped, or the
    // reserved qty didn't match the scanned serials), the aggregate qty would
    // stay too high while the serials flip to OUT_OF_STOCK — leaving shipped
    // units still counted as in stock. Decrement qty for that shortfall so qty
    // always tracks the IN_STOCK serial count. Keyed by the serial's actual
    // product/location/grade and netted against reservations at the same key.
    const shippedByKey = new Map<string, { productId: string; locationId: string; gradeId: string | null; qty: number }>()
    for (const sa of inStockAssignments) {
      const s = sa.inventorySerial
      const key = `${s.productId}|${s.locationId}|${s.gradeId ?? ''}`
      const cur = shippedByKey.get(key)
      if (cur) cur.qty += 1
      else shippedByKey.set(key, { productId: s.productId, locationId: s.locationId, gradeId: s.gradeId, qty: 1 })
    }
    const reservedByKey = new Map<string, number>()
    for (const r of shipment.reservations) {
      const key = `${r.productId}|${r.locationId}|${r.gradeId ?? ''}`
      reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + r.qtyReserved)
    }
    for (const [key, g] of Array.from(shippedByKey)) {
      const shortfall = g.qty - (reservedByKey.get(key) ?? 0)
      if (shortfall > 0) {
        await tx.inventoryItem.updateMany({
          where: { productId: g.productId, locationId: g.locationId, gradeId: g.gradeId ?? null },
          data: { qty: { decrement: shortfall } },
        })
      }
    }

    // Release inventory reservations (qty for reserved units already subtracted)
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

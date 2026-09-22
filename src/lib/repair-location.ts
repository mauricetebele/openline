/**
 * Repair-order ↔ inventory wiring + repair activity history.
 *
 * recordRepairShipment() is called when a repair order ships out to its vendor or
 * comes back, and does two things:
 *   - OUTBOUND: move each unit's serial into the vendor's mapped repair location
 *     (RepairVendor.repairLocationId) so inventory shows it "In Repair" at that
 *     vendor, AND log a REPAIR_SHIPPED serial-history event.
 *   - INBOUND:  log a REPAIR_RETURNED serial-history event for each unit.
 * Both directions therefore leave a history trail of the repair activity.
 */
import { prisma } from '@/lib/prisma'
import { moveSerialsToLocation } from '@/lib/inventory-move'

export interface RepairShipmentResult { moved: number; logged: number; locationName: string | null }

export async function recordRepairShipment(
  orderId: string,
  direction: 'outbound' | 'inbound',
  userId: string | null,
): Promise<RepairShipmentResult> {
  const order = await prisma.repairOrder.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      outboundCarrier: true, outboundTracking: true,
      inboundCarrier: true, inboundTracking: true,
      vendor: { select: { companyName: true, repairLocationId: true, repairLocation: { select: { name: true } } } },
      items: { select: { inventorySerial: { select: { id: true, productId: true, locationId: true, gradeId: true } } } },
    },
  })
  if (!order) return { moved: 0, logged: 0, locationName: null }

  const serials = order.items.map(i => i.inventorySerial)
  const locationName = order.vendor.repairLocation?.name ?? null
  if (serials.length === 0) return { moved: 0, logged: 0, locationName }

  const tail = (carrier: string | null, tracking: string | null) =>
    carrier || tracking ? ` — ${[carrier, tracking].filter(Boolean).join(' ')}` : ''

  // ── Inbound: log the return, no location change (destination is decided at
  // receiving). ────────────────────────────────────────────────────────────────
  if (direction === 'inbound') {
    const notes = `Returned from repair vendor ${order.vendor.companyName} (RO-${order.orderNumber})${tail(order.inboundCarrier, order.inboundTracking)}`
    await prisma.serialHistory.createMany({
      data: serials.map(s => ({
        inventorySerialId: s.id,
        eventType: 'REPAIR_RETURNED' as const,
        locationId: s.locationId,
        ...(userId ? { userId } : {}),
        notes,
      })),
    })
    return { moved: 0, logged: serials.length, locationName }
  }

  // ── Outbound: move into the vendor's repair location (if mapped) + log. ───────
  const notes = `Shipped to repair vendor ${order.vendor.companyName} (RO-${order.orderNumber})${tail(order.outboundCarrier, order.outboundTracking)}`
  const destId = order.vendor.repairLocationId

  const { moved, logged } = await prisma.$transaction(async (tx) => {
    if (destId) {
      // moveSerialsToLocation moves + writes a REPAIR_SHIPPED event for each serial
      // that actually moved; serials already there are left alone (idempotent).
      const m = await moveSerialsToLocation(tx, serials, destId, userId, notes, 'REPAIR_SHIPPED')
      return { moved: m, logged: m }
    }
    // No mapped location — still record the repair shipment activity in place.
    await tx.serialHistory.createMany({
      data: serials.map(s => ({
        inventorySerialId: s.id,
        eventType: 'REPAIR_SHIPPED' as const,
        locationId: s.locationId,
        ...(userId ? { userId } : {}),
        notes,
      })),
    })
    return { moved: 0, logged: serials.length }
  }, { timeout: 60_000 })

  return { moved, logged, locationName }
}

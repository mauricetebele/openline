/**
 * Repair-order ↔ location wiring. When a repair order ships out to its vendor,
 * each unit's serial is moved into the location mapped to that vendor
 * (RepairVendor.repairLocationId) so inventory reflects that the unit is
 * physically "In Repair" at that vendor.
 */
import { prisma } from '@/lib/prisma'
import { moveSerialsToLocation } from '@/lib/inventory-move'

/**
 * Move every serial on a repair order into the vendor's mapped repair location.
 * No-op (moved: 0) when the vendor has no mapped location. Idempotent — serials
 * already at the destination are skipped, so it's safe to call more than once.
 */
export async function moveRepairOrderToVendorLocation(
  orderId: string,
  userId: string | null,
): Promise<{ moved: number; locationName: string | null }> {
  const order = await prisma.repairOrder.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      vendor: {
        select: {
          companyName: true,
          repairLocationId: true,
          repairLocation: { select: { name: true } },
        },
      },
      items: { select: { inventorySerial: { select: { id: true, productId: true, locationId: true, gradeId: true } } } },
    },
  })
  if (!order) return { moved: 0, locationName: null }

  const destId = order.vendor.repairLocationId
  if (!destId) return { moved: 0, locationName: null }

  const serials = order.items.map(i => i.inventorySerial)
  if (serials.length === 0) return { moved: 0, locationName: order.vendor.repairLocation?.name ?? null }

  const notes = `Shipped to repair vendor ${order.vendor.companyName} (RO-${order.orderNumber})`
  const moved = await prisma.$transaction(tx => moveSerialsToLocation(tx, serials, destId, userId, notes), { timeout: 30_000 })
  return { moved, locationName: order.vendor.repairLocation?.name ?? null }
}

/**
 * Shared serial-relocation mechanics — mirrors the manual move endpoint
 * (src/app/api/serials/move/route.ts): moves a set of serials to a destination
 * location, records a LOCATION_MOVE history event, and keeps the per-location
 * InventoryItem counts in sync. Designed to run inside a Prisma transaction so
 * callers (manual move, repair ship-out, …) share one correct implementation.
 */
import type { Prisma } from '@prisma/client'

export interface MovableSerial {
  id: string
  productId: string
  locationId: string
  gradeId: string | null
}

/**
 * Move `serials` to `destLocationId` within transaction `tx`. Serials already at
 * the destination are skipped by the caller (pass only ones that need moving).
 * Returns the number moved.
 */
export async function moveSerialsToLocation(
  tx: Prisma.TransactionClient,
  serials: MovableSerial[],
  destLocationId: string,
  userId: string | null,
  notes?: string,
  eventType: Prisma.SerialHistoryCreateManyInput['eventType'] = 'LOCATION_MOVE',
): Promise<number> {
  const toMove = serials.filter(s => s.locationId !== destLocationId)
  if (toMove.length === 0) return 0

  // 1. Point the serials at the new location.
  await tx.inventorySerial.updateMany({
    where: { id: { in: toMove.map(s => s.id) } },
    data: { locationId: destLocationId },
  })

  // 2. Record a history row per serial (from → to) with the given event type.
  await tx.serialHistory.createMany({
    data: toMove.map(s => ({
      inventorySerialId: s.id,
      eventType,
      locationId: destLocationId,
      fromLocationId: s.locationId,
      ...(userId ? { userId } : {}),
      ...(notes ? { notes } : {}),
    })),
  })

  // 3. Adjust InventoryItem counts per (product, fromLocation, grade) group.
  const groups = new Map<string, { productId: string; fromLocationId: string; gradeId: string | null; count: number }>()
  for (const s of toMove) {
    const key = `${s.productId}|${s.locationId}|${s.gradeId ?? 'NULL'}`
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { productId: s.productId, fromLocationId: s.locationId, gradeId: s.gradeId, count: 1 })
  }

  for (const g of groups.values()) {
    await tx.inventoryItem.updateMany({
      where: { productId: g.productId, locationId: g.fromLocationId, gradeId: g.gradeId, qty: { gt: 0 } },
      data: { qty: { decrement: g.count } },
    })
    if (g.gradeId) {
      await tx.inventoryItem.upsert({
        where: { productId_locationId_gradeId: { productId: g.productId, locationId: destLocationId, gradeId: g.gradeId } },
        create: { productId: g.productId, locationId: destLocationId, gradeId: g.gradeId, qty: g.count },
        update: { qty: { increment: g.count } },
      })
    } else {
      const existing = await tx.inventoryItem.findFirst({ where: { productId: g.productId, locationId: destLocationId, gradeId: null } })
      if (existing) await tx.inventoryItem.update({ where: { id: existing.id }, data: { qty: { increment: g.count } } })
      else await tx.inventoryItem.create({ data: { productId: g.productId, locationId: destLocationId, gradeId: null, qty: g.count } })
    }
  }

  return toMove.length
}

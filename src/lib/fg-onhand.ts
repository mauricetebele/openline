import { prisma } from '@/lib/prisma'

/**
 * Live, serial-truth finished-goods on-hand per `${productId}:${gradeId ?? ''}`.
 *
 * This is the value the availability calcs need as their base — the same thing
 * `InventoryItem.qty` is *supposed* to be, but computed from reality instead of a
 * counter that drifts high between nightly reconciles ("ghost inventory").
 *
 *   serializable    → Σ over finished-goods locations of
 *                       max(0, IN_STOCK serial count − active hard reservations)
 *   non-serializable → Σ InventoryItem.qty at finished-goods locations
 *
 * The result is "net of hard reservations" (marketplace decrements the counter on
 * reserve), so it's a drop-in for the old `inventoryItem.groupBy(FG)._sum.qty` maps.
 * Callers still subtract soft (wholesale/FBA) reservations + pending orders as before.
 */
const pgKey = (p: string, g: string | null | undefined) => `${p}:${g ?? ''}`
const plgKey = (p: string, g: string | null | undefined, l: string) => `${p}:${g ?? ''}:${l}`

// Order statuses whose hard reservations still hold inventory (mirrors reconcile).
const ACTIVE_ORDER_STATUSES = ['PROCESSING', 'AWAITING_VERIFICATION'] as const

export async function getReconciledFgOnHand(productIds?: string[]): Promise<Map<string, number>> {
  const prodFilter = productIds && productIds.length ? { productId: { in: productIds } } : {}

  const [serialProducts, invGroups, serialGroups, hardGroups] = await Promise.all([
    // Which of these products are serialized (serial-truth) vs counter-tracked.
    prisma.product.findMany({ where: { isSerializable: true, ...(productIds && productIds.length ? { id: { in: productIds } } : {}) }, select: { id: true } }),
    // Non-serializable baseline: the counter at finished-goods locations.
    prisma.inventoryItem.groupBy({ by: ['productId', 'gradeId'], where: { ...prodFilter, location: { isFinishedGoods: true } }, _sum: { qty: true } }),
    // Serializable: real IN_STOCK serials per product+grade+finished-goods location.
    prisma.inventorySerial.groupBy({ by: ['productId', 'gradeId', 'locationId'], where: { ...prodFilter, status: 'IN_STOCK', location: { isFinishedGoods: true } }, _count: { _all: true } }),
    // Active hard reservations per product+grade+finished-goods location.
    prisma.orderInventoryReservation.groupBy({ by: ['productId', 'gradeId', 'locationId'], where: { ...prodFilter, location: { isFinishedGoods: true }, order: { workflowStatus: { in: [...ACTIVE_ORDER_STATUSES] } } }, _sum: { qtyReserved: true } }),
  ])

  const serSet = new Set(serialProducts.map(p => p.id))
  const hardByLoc = new Map<string, number>()
  for (const g of hardGroups) hardByLoc.set(plgKey(g.productId, g.gradeId, g.locationId), g._sum.qtyReserved ?? 0)

  const result = new Map<string, number>()

  // Non-serializable → counter.
  for (const g of invGroups) {
    if (serSet.has(g.productId)) continue
    result.set(pgKey(g.productId, g.gradeId), g._sum.qty ?? 0)
  }

  // Serializable → serial count net of hard reserves, per location, summed.
  for (const g of serialGroups) {
    if (!serSet.has(g.productId)) continue
    const net = Math.max(0, g._count._all - (hardByLoc.get(plgKey(g.productId, g.gradeId, g.locationId)) ?? 0))
    const key = pgKey(g.productId, g.gradeId)
    result.set(key, (result.get(key) ?? 0) + net)
  }

  return result
}

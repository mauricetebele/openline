import { prisma } from '@/lib/prisma'

interface Mismatch {
  id: string | null            // inventory_items id (null when a missing row is created)
  productId: string
  locationId: string
  gradeId: string | null
  currentQty: number | null    // null when the row didn't exist yet
  expectedQty: number
  serialCount: number
  reserved: number
}

interface ReconcileResult {
  checked: number
  mismatches: Mismatch[]
  fixed: number
  created: number
  staleReservationsDeleted: number
  staleAssignmentsDeleted: number
}

/**
 * Reconciles inventory_items.qty against the IN_STOCK serial ledger — the source
 * of truth for serialized products — accounting for active hard reservations.
 *
 *   qty = MAX(0, COUNT(IN_STOCK serials) − SUM(active reservations))
 *
 * Only serializable products are touched (non-serializable qty is tracked
 * directly and has no serials to reconcile against). Uses a handful of grouped
 * queries instead of one-count-per-row so it completes well within the cron
 * time budget — the previous O(N) version timed out and silently left drift.
 */
export async function reconcileSerialQty(dryRun: boolean): Promise<ReconcileResult> {
  // ── Phase 0: clean up stale reservations & assignments from terminal orders ──
  let staleReservationsDeleted = 0
  let staleAssignmentsDeleted = 0

  if (!dryRun) {
    const delRes = await prisma.orderInventoryReservation.deleteMany({
      where: { order: { workflowStatus: { in: ['SHIPPED', 'CANCELLED'] } } },
    })
    staleReservationsDeleted = delRes.count
    if (delRes.count > 0) {
      console.log(`[reconcile-qty] Cleaned up ${delRes.count} stale reservation(s) from shipped/cancelled orders`)
    }

    const staleAssignments = await prisma.orderSerialAssignment.findMany({
      where: {
        order: { workflowStatus: { in: ['SHIPPED', 'CANCELLED'] } },
        inventorySerial: { status: 'IN_STOCK' },
      },
      select: { id: true },
    })
    if (staleAssignments.length > 0) {
      await prisma.orderSerialAssignment.deleteMany({ where: { id: { in: staleAssignments.map(a => a.id) } } })
      staleAssignmentsDeleted = staleAssignments.length
      console.log(`[reconcile-qty] Cleaned up ${staleAssignments.length} stale serial assignment(s)`)
    }
  }

  // ── Load everything with a few grouped queries ──────────────────────────────
  const serializable = new Set(
    (await prisma.product.findMany({ where: { isSerializable: true }, select: { id: true } })).map(p => p.id),
  )

  const key = (p: string, l: string, g: string | null) => `${p}:${l}:${g ?? ''}`

  const [items, serialGroups, reservations] = await Promise.all([
    prisma.inventoryItem.findMany({ select: { id: true, productId: true, locationId: true, gradeId: true, qty: true } }),
    // IN_STOCK serials per (product, location, grade) — one query
    prisma.inventorySerial.groupBy({
      by: ['productId', 'locationId', 'gradeId'],
      where: { status: 'IN_STOCK' },
      _count: { _all: true },
    }),
    prisma.orderInventoryReservation.findMany({
      where: { order: { workflowStatus: { in: ['PROCESSING', 'AWAITING_VERIFICATION'] } } },
      select: { productId: true, locationId: true, gradeId: true, qtyReserved: true },
    }),
  ])

  const serialMap = new Map<string, { productId: string; locationId: string; gradeId: string | null; count: number }>()
  for (const s of serialGroups) {
    if (!serializable.has(s.productId)) continue
    serialMap.set(key(s.productId, s.locationId, s.gradeId), {
      productId: s.productId, locationId: s.locationId, gradeId: s.gradeId, count: s._count._all,
    })
  }

  const reservedMap = new Map<string, number>()
  for (const r of reservations) {
    if (!serializable.has(r.productId)) continue
    const k = key(r.productId, r.locationId, r.gradeId)
    reservedMap.set(k, (reservedMap.get(k) ?? 0) + r.qtyReserved)
  }

  const mismatches: Mismatch[] = []
  let fixed = 0
  let created = 0
  let checked = 0

  const seen = new Set<string>()

  // 1. Fix existing inventory_items rows for serializable products
  for (const item of items) {
    if (!serializable.has(item.productId)) continue
    checked++
    const k = key(item.productId, item.locationId, item.gradeId)
    seen.add(k)
    const serialCount = serialMap.get(k)?.count ?? 0
    const reserved = reservedMap.get(k) ?? 0
    const expectedQty = Math.max(0, serialCount - reserved)
    if (item.qty !== expectedQty) {
      mismatches.push({ id: item.id, productId: item.productId, locationId: item.locationId, gradeId: item.gradeId, currentQty: item.qty, expectedQty, serialCount, reserved })
      if (!dryRun) {
        await prisma.inventoryItem.update({ where: { id: item.id }, data: { qty: expectedQty } })
        fixed++
      }
    }
  }

  // 2. Create missing rows for serial buckets that have no inventory_items row
  //    (a received serial whose counter row was never created).
  for (const [k, g] of serialMap) {
    if (seen.has(k)) continue
    const reserved = reservedMap.get(k) ?? 0
    const expectedQty = Math.max(0, g.count - reserved)
    if (expectedQty <= 0) continue
    mismatches.push({ id: null, productId: g.productId, locationId: g.locationId, gradeId: g.gradeId, currentQty: null, expectedQty, serialCount: g.count, reserved })
    if (!dryRun) {
      await prisma.inventoryItem.upsert({
        where: { productId_locationId_gradeId: { productId: g.productId, locationId: g.locationId, gradeId: g.gradeId } },
        create: { productId: g.productId, locationId: g.locationId, gradeId: g.gradeId, qty: expectedQty },
        update: { qty: expectedQty },
      })
      created++
    }
  }

  if (mismatches.length > 0) {
    console.log(`[reconcile-qty] ${mismatches.length} mismatch(es), ${fixed} fixed, ${created} created`)
    for (const m of mismatches) {
      console.log(`  product=${m.productId} location=${m.locationId} grade=${m.gradeId ?? 'null'} qty=${m.currentQty ?? '(none)'} → ${m.expectedQty} (serials=${m.serialCount} reserved=${m.reserved})`)
    }
  }

  return { checked, mismatches, fixed, created, staleReservationsDeleted, staleAssignmentsDeleted }
}

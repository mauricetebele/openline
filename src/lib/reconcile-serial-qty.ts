import { prisma } from '@/lib/prisma'

interface Mismatch {
  id: string
  productId: string
  locationId: string
  gradeId: string | null
  currentQty: number
  expectedQty: number
  serialCount: number
  reserved: number
}

interface ReconcileResult {
  checked: number
  mismatches: Mismatch[]
  fixed: number
  staleReservationsDeleted: number
  staleAssignmentsDeleted: number
}

/**
 * Reconciles inventory_items.qty against actual IN_STOCK serial counts,
 * accounting for active reservations (PROCESSING / AWAITING_VERIFICATION).
 *
 * Correct formula: qty = COUNT(IN_STOCK serials) - SUM(active reservations)
 */
export async function reconcileSerialQty(dryRun: boolean): Promise<ReconcileResult> {
  // ── Phase 0: Clean up stale reservations & assignments from terminal orders ──
  let staleReservationsDeleted = 0
  let staleAssignmentsDeleted = 0

  if (!dryRun) {
    // Delete reservations from SHIPPED/CANCELLED orders (should have been cleaned on ship)
    const delRes = await prisma.orderInventoryReservation.deleteMany({
      where: { order: { workflowStatus: { in: ['SHIPPED', 'CANCELLED'] } } },
    })
    staleReservationsDeleted = delRes.count
    if (delRes.count > 0) {
      console.log(`[reconcile-qty] Cleaned up ${delRes.count} stale reservation(s) from shipped/cancelled orders`)
    }

    // Delete serial assignments where the serial is IN_STOCK but order is SHIPPED/CANCELLED
    const staleAssignments = await prisma.orderSerialAssignment.findMany({
      where: {
        order: { workflowStatus: { in: ['SHIPPED', 'CANCELLED'] } },
        inventorySerial: { status: 'IN_STOCK' },
      },
      select: { id: true },
    })
    if (staleAssignments.length > 0) {
      await prisma.orderSerialAssignment.deleteMany({
        where: { id: { in: staleAssignments.map(a => a.id) } },
      })
      staleAssignmentsDeleted = staleAssignments.length
      console.log(`[reconcile-qty] Cleaned up ${staleAssignments.length} stale serial assignment(s)`)
    }
  }

  const items = await prisma.inventoryItem.findMany({
    select: { id: true, productId: true, locationId: true, gradeId: true, qty: true },
  })

  // Pre-load all active reservations grouped by product/location/grade
  const reservations = await prisma.orderInventoryReservation.findMany({
    where: {
      order: { workflowStatus: { in: ['PROCESSING', 'AWAITING_VERIFICATION'] } },
    },
    select: { productId: true, locationId: true, gradeId: true, qtyReserved: true },
  })

  const reservedMap = new Map<string, number>()
  for (const r of reservations) {
    const key = `${r.productId}:${r.locationId}:${r.gradeId ?? ''}`
    reservedMap.set(key, (reservedMap.get(key) ?? 0) + r.qtyReserved)
  }

  const mismatches: Mismatch[] = []
  let fixed = 0

  for (const item of items) {
    const serialCount = await prisma.inventorySerial.count({
      where: {
        productId: item.productId,
        locationId: item.locationId,
        gradeId: item.gradeId ?? null,
        status: 'IN_STOCK',
      },
    })

    const key = `${item.productId}:${item.locationId}:${item.gradeId ?? ''}`
    const reserved = reservedMap.get(key) ?? 0
    const expectedQty = serialCount - reserved

    if (item.qty !== expectedQty) {
      mismatches.push({
        id: item.id,
        productId: item.productId,
        locationId: item.locationId,
        gradeId: item.gradeId,
        currentQty: item.qty,
        expectedQty,
        serialCount,
        reserved,
      })

      if (!dryRun) {
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { qty: expectedQty },
        })
        fixed++
      }
    }
  }

  if (mismatches.length > 0) {
    console.log(`[reconcile-qty] ${mismatches.length} mismatch(es) found, ${fixed} fixed`)
    for (const m of mismatches) {
      console.log(
        `  item=${m.id} product=${m.productId} location=${m.locationId} grade=${m.gradeId ?? 'null'} qty=${m.currentQty} → expected=${m.expectedQty} (serials=${m.serialCount} reserved=${m.reserved})`,
      )
    }
  }

  return { checked: items.length, mismatches, fixed, staleReservationsDeleted, staleAssignmentsDeleted }
}

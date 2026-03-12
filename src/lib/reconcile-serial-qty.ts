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
}

/**
 * Reconciles inventory_items.qty against actual IN_STOCK serial counts,
 * accounting for active reservations (PROCESSING / AWAITING_VERIFICATION).
 *
 * Correct formula: qty = COUNT(IN_STOCK serials) - SUM(active reservations)
 */
export async function reconcileSerialQty(dryRun: boolean): Promise<ReconcileResult> {
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

  return { checked: items.length, mismatches, fixed }
}

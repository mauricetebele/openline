import { prisma } from '@/lib/prisma'

interface Mismatch {
  id: string
  productId: string
  locationId: string
  gradeId: string | null
  currentQty: number
  serialCount: number
}

interface ReconcileResult {
  checked: number
  mismatches: Mismatch[]
  fixed: number
}

export async function reconcileSerialQty(dryRun: boolean): Promise<ReconcileResult> {
  const items = await prisma.inventoryItem.findMany({
    select: { id: true, productId: true, locationId: true, gradeId: true, qty: true },
  })

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

    if (item.qty !== serialCount) {
      mismatches.push({
        id: item.id,
        productId: item.productId,
        locationId: item.locationId,
        gradeId: item.gradeId,
        currentQty: item.qty,
        serialCount,
      })

      if (!dryRun) {
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { qty: serialCount },
        })
        fixed++
      }
    }
  }

  if (mismatches.length > 0) {
    console.log(`[reconcile-qty] ${mismatches.length} mismatch(es) found, ${fixed} fixed`)
    for (const m of mismatches) {
      console.log(
        `  item=${m.id} product=${m.productId} location=${m.locationId} grade=${m.gradeId ?? 'null'} qty=${m.currentQty} → serials=${m.serialCount}`,
      )
    }
  }

  return { checked: items.length, mismatches, fixed }
}

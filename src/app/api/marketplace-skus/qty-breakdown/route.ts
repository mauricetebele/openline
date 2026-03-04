/**
 * GET /api/marketplace-skus/qty-breakdown
 *
 * Returns the quantity breakdown for all mapped MSKUs with syncQty enabled:
 *   - onHand: true on-hand (InventoryItem.qty + active reservations)
 *   - reserved: qty reserved for unshipped orders
 *   - pendingOrders: qty from Amazon Pending MFN orders (no reservation yet)
 *   - available: max(0, onHand - reserved - pendingOrders)
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export interface QtyBreakdown {
  mskuId: string
  onHand: number
  reserved: number
  pendingOrders: number
  available: number
}

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mskus = await prisma.productGradeMarketplaceSku.findMany({
    where: { syncQty: true },
    select: {
      id: true,
      productId: true,
      gradeId: true,
      marketplace: true,
      sellerSku: true,
    },
  })

  const results: QtyBreakdown[] = []

  for (const msku of mskus) {
    const inventoryWhere: { productId: string; gradeId?: string | null } = {
      productId: msku.productId,
    }
    const reservationWhere: { productId: string; gradeId?: string | null } = {
      productId: msku.productId,
    }
    if (msku.gradeId) {
      inventoryWhere.gradeId = msku.gradeId
      reservationWhere.gradeId = msku.gradeId
    }

    // InventoryItem.qty already has reservations subtracted
    const { _sum: invSum } = await prisma.inventoryItem.aggregate({
      where: inventoryWhere,
      _sum: { qty: true },
    })
    const availableInInventory = invSum.qty ?? 0

    // Sum active reservations to reconstruct true on-hand
    const { _sum: resSum } = await prisma.orderInventoryReservation.aggregate({
      where: reservationWhere,
      _sum: { qtyReserved: true },
    })
    const reserved = resSum.qtyReserved ?? 0

    // True on-hand = what's in inventory + what's reserved (since qty already subtracted)
    const onHand = availableInInventory + reserved

    // Pending Amazon MFN orders (not yet reserved)
    let pendingOrders = 0
    if (msku.marketplace === 'amazon') {
      const pendingItems = await prisma.orderItem.findMany({
        where: {
          sellerSku: msku.sellerSku,
          order: {
            orderStatus: 'Pending',
            fulfillmentChannel: 'MFN',
            orderSource: 'amazon',
          },
        },
        select: { quantityOrdered: true, quantityShipped: true },
      })
      pendingOrders = pendingItems.reduce(
        (sum, item) => sum + (item.quantityOrdered - item.quantityShipped),
        0,
      )
    }

    // Available = what we actually push to the marketplace
    // (InventoryItem.qty already has reservations out, so just subtract pending)
    const available = Math.max(0, availableInInventory - pendingOrders)
    results.push({ mskuId: msku.id, onHand, reserved, pendingOrders, available })
  }

  return NextResponse.json({ data: results })
}

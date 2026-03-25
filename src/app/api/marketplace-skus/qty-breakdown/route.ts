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
  maxQty: number | null
  pushing: number
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
      maxQty: true,
    },
  })

  if (mskus.length === 0) {
    return NextResponse.json({ data: [] })
  }

  // Batch: inventory qty grouped by productId + gradeId (finished-goods locations only)
  const invGroups = await prisma.inventoryItem.groupBy({
    by: ['productId', 'gradeId'],
    where: { location: { isFinishedGoods: true } },
    _sum: { qty: true },
  })
  const invMap = new Map<string, number>()
  for (const g of invGroups) {
    invMap.set(`${g.productId}:${g.gradeId ?? ''}`, g._sum.qty ?? 0)
  }

  // Batch: reservations grouped by productId + gradeId
  const resGroups = await prisma.orderInventoryReservation.groupBy({
    by: ['productId', 'gradeId'],
    _sum: { qtyReserved: true },
  })
  const resMap = new Map<string, number>()
  for (const g of resGroups) {
    resMap.set(`${g.productId}:${g.gradeId ?? ''}`, g._sum.qtyReserved ?? 0)
  }

  // Batch: wholesale soft reservations (qty NOT decremented in inventoryItem.qty)
  const wholesaleGroups = await prisma.salesOrderInventoryReservation.groupBy({
    by: ['productId', 'gradeId'],
    where: {
      location: { isFinishedGoods: true },
      salesOrder: { fulfillmentStatus: { in: ['PROCESSING'] } },
    },
    _sum: { qtyReserved: true },
  })
  const wholesaleMap = new Map<string, number>()
  for (const g of wholesaleGroups) {
    wholesaleMap.set(`${g.productId}:${g.gradeId ?? ''}`, g._sum.qtyReserved ?? 0)
  }

  // Batch: pending Amazon MFN order items
  const amazonSkus = mskus
    .filter(m => m.marketplace === 'amazon')
    .map(m => m.sellerSku)

  const pendingMap = new Map<string, number>()
  if (amazonSkus.length > 0) {
    const pendingItems = await prisma.orderItem.findMany({
      where: {
        sellerSku: { in: amazonSkus },
        order: {
          orderStatus: 'Pending',
          fulfillmentChannel: 'MFN',
          orderSource: 'amazon',
        },
      },
      select: { sellerSku: true, quantityOrdered: true, quantityShipped: true },
    })
    for (const item of pendingItems) {
      const pending = item.quantityOrdered - item.quantityShipped
      pendingMap.set(item.sellerSku, (pendingMap.get(item.sellerSku) ?? 0) + pending)
    }
  }

  // Assemble results
  const results: QtyBreakdown[] = mskus.map(msku => {
    const key = `${msku.productId}:${msku.gradeId ?? ''}`
    const availableInInventory = invMap.get(key) ?? 0
    const hardReserved = resMap.get(key) ?? 0
    const wholesaleReserved = wholesaleMap.get(key) ?? 0
    const onHand = availableInInventory + hardReserved
    const reserved = hardReserved + wholesaleReserved
    const pendingOrders = msku.marketplace === 'amazon' ? (pendingMap.get(msku.sellerSku) ?? 0) : 0
    const available = Math.max(0, availableInInventory - pendingOrders - wholesaleReserved)
    const pushing = msku.maxQty != null ? Math.min(available, msku.maxQty) : available
    return { mskuId: msku.id, onHand, reserved, pendingOrders, available, maxQty: msku.maxQty, pushing }
  })

  return NextResponse.json({ data: results })
}

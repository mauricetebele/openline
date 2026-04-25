/**
 * GET /api/marketplace-skus/qty-breakdown
 *
 * Returns the quantity breakdown for all mapped MSKUs with syncQty enabled:
 *   - onHand: true on-hand (InventoryItem.qty + active reservations)
 *   - reserved: qty reserved for unshipped orders
 *   - pendingOrders: qty from Amazon Pending MFN orders (no reservation yet)
 *   - available: max(0, onHand - reserved - pendingOrders)
 *   - groupSize: how many active-push SKUs share this product+grade
 *   - splitPct: this SKU's effective split percentage
 *   - pushing: qty after split + maxQty cap
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { splitQtyForGroup } from '@/app/api/marketplace-skus/push-qty/route'

export const dynamic = 'force-dynamic'

export interface QtyBreakdown {
  mskuId: string
  onHand: number
  reserved: number
  pendingOrders: number
  pendingPayment: number
  available: number
  maxQty: number | null
  pushing: number
  lowStockBuffer: boolean
  groupSize: number
  splitPct: number
  isDefaultSku: boolean
}

function pgKey(productId: string, gradeId: string | null | undefined): string {
  return `${productId}:${gradeId ?? ''}`
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
      isDefaultSku: true,
      createdAt: true,
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
    invMap.set(pgKey(g.productId, g.gradeId), g._sum.qty ?? 0)
  }

  // Batch: reservations grouped by productId + gradeId
  const resGroups = await prisma.orderInventoryReservation.groupBy({
    by: ['productId', 'gradeId'],
    _sum: { qtyReserved: true },
  })
  const resMap = new Map<string, number>()
  for (const g of resGroups) {
    resMap.set(pgKey(g.productId, g.gradeId), g._sum.qtyReserved ?? 0)
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
    wholesaleMap.set(pgKey(g.productId, g.gradeId), g._sum.qtyReserved ?? 0)
  }

  // Batch: pending Amazon MFN order items
  const amazonSkus = mskus
    .filter(m => m.marketplace === 'amazon')
    .map(m => m.sellerSku)

  const pendingMap = new Map<string, number>()
  const pendingPaymentMap = new Map<string, number>()
  if (amazonSkus.length > 0) {
    const pendingItems = await prisma.orderItem.findMany({
      where: {
        sellerSku: { in: amazonSkus },
        order: {
          fulfillmentChannel: 'MFN',
          orderSource: 'amazon',
          workflowStatus: 'PENDING',
        },
      },
      select: { sellerSku: true, quantityOrdered: true, quantityShipped: true, order: { select: { orderStatus: true } } },
    })
    for (const item of pendingItems) {
      const pending = item.quantityOrdered - item.quantityShipped
      if (!item.sellerSku) continue
      if (item.order.orderStatus === 'Pending') {
        pendingPaymentMap.set(item.sellerSku, (pendingPaymentMap.get(item.sellerSku) ?? 0) + pending)
      } else {
        pendingMap.set(item.sellerSku, (pendingMap.get(item.sellerSku) ?? 0) + pending)
      }
    }
  }

  // Group MSKUs by (productId, gradeId) for split calculation
  const groups = new Map<string, typeof mskus>()
  for (const msku of mskus) {
    const key = pgKey(msku.productId, msku.gradeId)
    const group = groups.get(key)
    if (group) group.push(msku)
    else groups.set(key, [msku])
  }

  // Compute available per group + pending sums per group
  const groupPendingMap = new Map<string, number>()
  groups.forEach((group, key) => {
    const totalPending = group.reduce((sum, m) => {
      return sum + (m.marketplace === 'amazon' ? (pendingMap.get(m.sellerSku) ?? 0) + (pendingPaymentMap.get(m.sellerSku) ?? 0) : 0)
    }, 0)
    groupPendingMap.set(key, totalPending)
  })

  // Assemble results with group-aware split
  const results: QtyBreakdown[] = mskus.map(msku => {
    const key = pgKey(msku.productId, msku.gradeId)
    const group = groups.get(key) ?? [msku]
    const groupSize = group.length

    const availableInInventory = invMap.get(key) ?? 0
    const hardReserved = resMap.get(key) ?? 0
    const wholesaleReserved = wholesaleMap.get(key) ?? 0
    const onHand = availableInInventory + hardReserved
    const reserved = hardReserved + wholesaleReserved
    const pendingOrders = msku.marketplace === 'amazon' ? (pendingMap.get(msku.sellerSku) ?? 0) : 0
    const pendingPayment = msku.marketplace === 'amazon' ? (pendingPaymentMap.get(msku.sellerSku) ?? 0) : 0

    // Group-level available: total pending across all group SKUs
    const groupPending = groupPendingMap.get(key) ?? 0
    const groupAvailable = Math.max(0, availableInInventory - groupPending - wholesaleReserved)

    // Per-SKU available (for display purposes)
    const available = Math.max(0, availableInInventory - pendingOrders - pendingPayment - wholesaleReserved)

    // Find default SKU index: explicit isDefaultSku flag, else earliest createdAt
    const defaultIdx = group.findIndex(m => m.isDefaultSku)
    const bufferIdx = defaultIdx >= 0 ? defaultIdx : group.reduce((best, m, i) =>
      m.createdAt < group[best].createdAt ? i : best, 0)
    const myIdx = group.indexOf(msku)

    // Group-level low-stock buffer
    const lowStockBuffer = groupAvailable > 0 && groupAvailable <= 3
    let pushing: number
    if (lowStockBuffer) {
      const allocated = myIdx === bufferIdx ? 1 : 0
      pushing = msku.maxQty != null ? Math.min(allocated, msku.maxQty) : allocated
    } else {
      const allocations = splitQtyForGroup(groupAvailable, groupSize)
      const allocated = allocations[myIdx] ?? 0
      pushing = msku.maxQty != null ? Math.min(allocated, msku.maxQty) : allocated
    }

    const splitPct = groupSize > 0 ? Math.round(100 / groupSize) : 100

    return {
      mskuId: msku.id, onHand, reserved, pendingOrders, pendingPayment,
      available, maxQty: msku.maxQty, pushing, lowStockBuffer,
      groupSize, splitPct, isDefaultSku: msku.isDefaultSku,
    }
  })

  return NextResponse.json({ data: results })
}

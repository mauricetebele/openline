/**
 * Fire-and-forget helper to push marketplace quantities for specific products.
 * Called after inventory-changing events (order processing, cancellation, FBA
 * reservations, etc.) to minimize the window where Amazon shows stale quantities.
 *
 * Groups MSKUs by (productId, gradeId) and applies the split logic so each SKU
 * in a shared-inventory group gets its correct share.
 *
 * Errors are logged but never thrown — this must never block the main operation.
 */
import { prisma } from '@/lib/prisma'
import {
  getBmContext,
  calculateGroupQuantities,
} from '@/app/api/marketplace-skus/push-qty/route'
import type { BulkQuantities } from '@/app/api/marketplace-skus/push-qty/route'
import { submitInventoryFeed } from '@/lib/amazon/listings'

function pgKey(productId: string, gradeId: string | null | undefined): string {
  return `${productId}::${gradeId ?? 'NULL'}`
}

export function pushQtyForProducts(productIds: string[]): void {
  if (productIds.length === 0) return

  const unique = Array.from(new Set(productIds))

  // Fire-and-forget — run in background, catch all errors
  ;(async () => {
    try {
      const mskus = await prisma.productGradeMarketplaceSku.findMany({
        where: { productId: { in: unique }, syncQty: true },
        include: {
          product: { select: { id: true, sku: true } },
          grade: { select: { id: true, grade: true } },
          marketplaceListing: { select: { fulfillmentChannel: true } },
        },
      })

      if (mskus.length === 0) return

      // Filter out FBA SKUs — Amazon manages FBA inventory
      const filtered = mskus.filter(
        (m) => m.marketplaceListing?.fulfillmentChannel !== 'FBA',
      )
      if (filtered.length === 0) return

      // Group by (productId, gradeId) for split calculation
      const groups = new Map<string, typeof filtered>()
      for (const msku of filtered) {
        const key = pgKey(msku.productId, msku.gradeId)
        const group = groups.get(key)
        if (group) group.push(msku)
        else groups.set(key, [msku])
      }

      // Bulk compute quantities
      const allProductIds = Array.from(new Set(filtered.map(m => m.productId)))
      const amazonSkus = Array.from(new Set(filtered.filter(m => m.marketplace === 'amazon').map(m => m.sellerSku)))

      const invGroups = await prisma.inventoryItem.groupBy({
        by: ['productId', 'gradeId'],
        where: { productId: { in: allProductIds }, location: { isFinishedGoods: true } },
        _sum: { qty: true },
      })
      const inventoryMap = new Map<string, number>()
      for (const g of invGroups) inventoryMap.set(pgKey(g.productId, g.gradeId), g._sum.qty ?? 0)

      const pendingMap = new Map<string, number>()
      if (amazonSkus.length > 0) {
        const pendingGroups = await prisma.orderItem.groupBy({
          by: ['sellerSku'],
          where: {
            sellerSku: { in: amazonSkus },
            order: { fulfillmentChannel: 'MFN', orderSource: 'amazon', workflowStatus: 'PENDING' },
          },
          _sum: { quantityOrdered: true, quantityShipped: true },
        })
        for (const g of pendingGroups) {
          if (g.sellerSku) pendingMap.set(g.sellerSku, (g._sum.quantityOrdered ?? 0) - (g._sum.quantityShipped ?? 0))
        }
      }

      const whGroups = await prisma.salesOrderInventoryReservation.groupBy({
        by: ['productId', 'gradeId'],
        where: {
          productId: { in: allProductIds },
          location: { isFinishedGoods: true },
          salesOrder: { fulfillmentStatus: { in: ['PROCESSING'] } },
        },
        _sum: { qtyReserved: true },
      })
      const wholesaleMap = new Map<string, number>()
      for (const g of whGroups) wholesaleMap.set(pgKey(g.productId, g.gradeId), g._sum.qtyReserved ?? 0)

      const bulk: BulkQuantities = { inventoryMap, pendingMap, wholesaleMap, listingQtyMap: new Map() }

      // Compute split quantities per group
      const qtyMap = new Map<string, number>()
      groups.forEach(group => {
        const groupQtys = calculateGroupQuantities(group, bulk)
        groupQtys.forEach((qty, id) => qtyMap.set(id, qty))
      })

      // Push each MSKU with its split quantity
      const { bmClient, bmListingsCache } = await getBmContext(filtered)

      // Batch Amazon updates into a single feed
      const amazonMskus = filtered.filter(m => m.marketplace === 'amazon')
      const bmMskus = filtered.filter(m => m.marketplace === 'backmarket')

      if (amazonMskus.length > 0) {
        const accountId = amazonMskus[0].accountId ?? (await prisma.amazonAccount.findFirst({ where: { isActive: true } }))?.id
        if (accountId) {
          try {
            const feedUpdates = amazonMskus.map(m => ({ sku: m.sellerSku, quantity: qtyMap.get(m.id) ?? 0 }))
            await submitInventoryFeed(accountId, feedUpdates)
            for (const msku of amazonMskus) {
              const finalQty = qtyMap.get(msku.id) ?? 0
              await prisma.productGradeMarketplaceSku.update({
                where: { id: msku.id },
                data: { lastPushedQty: finalQty, lastPushedAt: new Date() },
              }).catch(() => {})
              await prisma.sellerListing.updateMany({
                where: { sku: msku.sellerSku },
                data: { quantity: finalQty, updatedAt: new Date() },
              }).catch(() => {})
              console.log(`[pushQtyForProducts] Pushed ${msku.sellerSku} → ${finalQty}`)
            }
          } catch (err) {
            console.error('[pushQtyForProducts] Feed submission failed:', err instanceof Error ? err.message : err)
          }
        }
      }

      for (const msku of bmMskus) {
        const finalQty = qtyMap.get(msku.id) ?? 0
        try {
          if (!bmClient || !bmListingsCache) throw new Error('No active Back Market credentials')
          const listingId = bmListingsCache.get(msku.sellerSku)
          if (!listingId) throw new Error(`BM listing not found for SKU ${msku.sellerSku}`)
          await bmClient.updateListingQuantity(listingId, finalQty)
          await prisma.productGradeMarketplaceSku.update({
            where: { id: msku.id },
            data: { lastPushedQty: finalQty, lastPushedAt: new Date() },
          }).catch(() => {})
          console.log(`[pushQtyForProducts] Pushed ${msku.sellerSku} → ${finalQty}`)
        } catch (err) {
          console.error(`[pushQtyForProducts] Failed for ${msku.sellerSku}:`, err instanceof Error ? err.message : err)
        }
      }
    } catch (err) {
      console.error(
        '[pushQtyForProducts] Error:',
        err instanceof Error ? err.message : err,
      )
    }
  })()
}

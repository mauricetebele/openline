/**
 * Fire-and-forget helper to push marketplace quantities for specific products.
 * Called after inventory-changing events (order processing, cancellation, FBA
 * reservations, etc.) to minimize the window where Amazon shows stale quantities.
 *
 * Errors are logged but never thrown — this must never block the main operation.
 */
import { prisma } from '@/lib/prisma'
import {
  pushOneQuantity,
  getBmContext,
} from '@/app/api/marketplace-skus/push-qty/route'

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

      const { bmClient, bmListingsCache } = await getBmContext(filtered)

      for (const msku of filtered) {
        try {
          const result = await pushOneQuantity(msku, bmClient, bmListingsCache)
          console.log(
            `[pushQtyForProducts] Pushed ${msku.sellerSku} → ${result.quantity}`,
          )
        } catch (err) {
          console.error(
            `[pushQtyForProducts] Failed for ${msku.sellerSku}:`,
            err instanceof Error ? err.message : err,
          )
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

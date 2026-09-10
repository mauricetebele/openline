import { prisma } from '@/lib/prisma'

/** Target margins are a "queue" — a suggested price waiting to be pushed. If left
 *  unpushed for this long, they expire and are cleared automatically. */
export const TARGET_MARGIN_TTL_MS = 30 * 60 * 1000

/**
 * Clear any target margin that was set more than TTL ago and never pushed (pushing
 * a target-margin price clears it). Safe to call on every grid load — it's a single
 * indexed updateMany and a no-op when nothing is stale. Rows with no timestamp
 * (legacy) are left alone. Optionally scope to a set of product IDs.
 */
export async function expireStaleTargetMargins(productIds?: string[]): Promise<number> {
  const cutoff = new Date(Date.now() - TARGET_MARGIN_TTL_MS)
  const res = await prisma.productGradeMarketplaceSku.updateMany({
    where: {
      targetMarginPct: { not: null },
      targetMarginSetAt: { lt: cutoff },
      ...(productIds ? { productId: { in: productIds } } : {}),
    },
    data: { targetMarginPct: null, targetMarginSetAt: null },
  })
  return res.count
}

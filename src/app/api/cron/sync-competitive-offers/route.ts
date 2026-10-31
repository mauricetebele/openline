/**
 * GET /api/cron/sync-competitive-offers — Vercel Cron (hourly)
 * Refreshes competitor offers per ASIN + Amazon condition for active listings
 * (stalest first, ~4 min budget per run, 20 h cache) so the repricing
 * suggestion feed always has competition data that's at most ~a day old.
 */
export const maxDuration = 300

import { prisma } from '@/lib/prisma'
import { syncCompetitivePricing } from '@/lib/amazon/competitive-pricing'
import { fillMissingListingTitles } from '@/lib/amazon/listing-titles'
import { cronGet } from '@/lib/cron-handler'

export const GET = cronGet('sync-competitive-offers', async () => {
  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true }, select: { id: true } })
  const started = Date.now()
  const results = []
  for (const a of accounts) {
    const remaining = 240_000 - (Date.now() - started)
    if (remaining <= 0) break
    try {
      const titles = await fillMissingListingTitles(a.id, { budgetMs: 30_000 }).catch(() => null)
      results.push({ accountId: a.id, titles, ...(await syncCompetitivePricing(a.id, { budgetMs: Math.max(0, 240_000 - (Date.now() - started)) })) })
    } catch (err) {
      results.push({ accountId: a.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  console.log('[cron/sync-competitive-offers]', JSON.stringify(results))
  return { status: 'success', results }
})

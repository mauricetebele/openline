/**
 * GET /api/cron/refresh-pricing  (Vercel cron, every 30 min)
 * Refreshes live price + listing status + Buy Box / BackBox for all sync-enabled
 * marketplace SKUs.
 */
import { refreshAllPricing } from '@/lib/marketplace-pricing-refresh'
import { cronGet } from '@/lib/cron-handler'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = cronGet('refresh-pricing', async () => {
  const result = await refreshAllPricing()
  return { ok: true, ...result }
})

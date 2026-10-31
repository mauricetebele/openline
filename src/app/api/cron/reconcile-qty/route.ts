/**
 * GET /api/cron/reconcile-qty — Vercel Cron (daily at midnight)
 * Auto-heals any inventory qty drift by reconciling against serial counts.
 */
import { reconcileSerialQty } from '@/lib/reconcile-serial-qty'
import { cronGet } from '@/lib/cron-handler'

export const dynamic = 'force-dynamic'

export const GET = cronGet('reconcile-qty', async () => {
  const result = await reconcileSerialQty(false)
  console.log(`[cron/reconcile-qty] checked=${result.checked} mismatches=${result.mismatches.length} fixed=${result.fixed}`)

  return result
})

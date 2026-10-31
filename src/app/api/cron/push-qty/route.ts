/**
 * GET /api/cron/push-qty — Vercel Cron (every 10 min)
 * Pushes available inventory quantities to all marketplaces for MSKUs with syncQty enabled.
 */
import { pushAllQuantities } from '@/app/api/marketplace-skus/push-qty/route'
import { cronGet } from '@/lib/cron-handler'

export const maxDuration = 120

export const GET = cronGet('push-qty', async () => {
  const { results } = await pushAllQuantities()
  const pushed = results.filter((r) => !r.error)
  const errors = results.filter((r) => r.error)

  console.log(`[cron/push-qty] Pushed ${pushed.length} SKUs, ${errors.length} errors`)
  if (errors.length > 0) {
    console.error('[cron/push-qty] Errors:', errors)
  }

  return { pushed: pushed.length, errors: errors.length, details: results }
})

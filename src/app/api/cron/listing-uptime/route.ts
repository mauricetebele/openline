/**
 * GET /api/cron/listing-uptime — Vercel Cron (every 30 min)
 * Checks Amazon for each relevant SKU's live state (BUYABLE + qty > 0) and logs
 * up/down transitions — the repricing feed's "live window" source of truth.
 */
export const maxDuration = 300

import { checkListingUptime } from '@/lib/amazon/listing-uptime'
import { cronGet } from '@/lib/cron-handler'

export const GET = cronGet('listing-uptime', async () => {
  const r = await checkListingUptime({ budgetMs: 210_000 })
  console.log('[cron/listing-uptime]', JSON.stringify(r))
  return { status: 'success', ...r }
})

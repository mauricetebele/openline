/**
 * GET /api/cron/sync-replacements — Vercel Cron (every 6 hours)
 * Syncs free replacement orders for all active Amazon accounts.
 */
export const maxDuration = 300

import { prisma } from '@/lib/prisma'
import { syncReplacementOrders } from '@/lib/amazon/sync-replacements'
import { cronGet } from '@/lib/cron-handler'

export const GET = cronGet('sync-replacements', async () => {
  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) {
    return { message: 'No active accounts' }
  }

  const results: { accountId: string; status: string; message?: string }[] = []

  for (const account of accounts) {
    try {
      const result = await syncReplacementOrders(account.id)
      results.push({
        accountId: account.id,
        status: 'ok',
        message: `${result.created} created, ${result.updated} updated, ${result.trackingRefreshed} tracking refreshed`,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Cron] sync-replacements account ${account.id} failed:`, message)
      results.push({ accountId: account.id, status: 'error', message })
    }
  }

  console.log('[Cron] sync-replacements complete:', results)
  return { ok: true, results }
})

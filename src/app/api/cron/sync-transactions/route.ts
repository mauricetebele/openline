/**
 * GET /api/cron/sync-transactions — Vercel Cron (every 6 hours)
 * Syncs all Amazon financial transactions for the last 14 days.
 */
export const maxDuration = 300

import { prisma } from '@/lib/prisma'
import { syncAmazonTransactions } from '@/lib/amazon/sync-transactions'
import { cronGet } from '@/lib/cron-handler'

export const GET = cronGet('sync-transactions', async () => {
  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  const results: { source: string; status: string; message?: string }[] = []

  const end = new Date(Date.now() - 5 * 60 * 1000)
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000) // 14 days back

  for (const account of accounts) {
    try {
      const result = await syncAmazonTransactions(account.id, start, end)
      results.push({ source: `amazon:${account.id}`, status: 'ok', message: `${result.found} fetched, ${result.upserted} upserted` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-transactions] account=${account.id}`, message)
      results.push({ source: `amazon:${account.id}`, status: 'error', message })
    }
  }

  return { status: 'success', results }
})

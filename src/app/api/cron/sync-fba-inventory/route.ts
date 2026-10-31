/**
 * GET /api/cron/sync-fba-inventory — Vercel Cron
 * Syncs FBA inventory (quantities + FNSKUs) for all active Amazon accounts.
 */
import { prisma } from '@/lib/prisma'
import { syncFbaInventory } from '@/lib/amazon/fba-inventory'
import { cronGet } from '@/lib/cron-handler'

export const maxDuration = 300

export const GET = cronGet('sync-fba-inventory', async () => {
  const accounts = await prisma.amazonAccount.findMany({
    where: { isActive: true },
    select: { id: true, sellerId: true },
  })

  const results: { accountId: string; sellerId: string; updated?: number; total?: number; error?: string }[] = []

  for (const account of accounts) {
    try {
      const { updated, total } = await syncFbaInventory(account.id)
      results.push({ accountId: account.id, sellerId: account.sellerId, updated, total })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-fba-inventory] Error for ${account.sellerId}:`, message)
      results.push({ accountId: account.id, sellerId: account.sellerId, error: message })
    }
  }

  return { synced: results.length, results }
})

/**
 * Auto-sync scheduler — runs a catalog sync for every active Amazon account
 * every 30 minutes.  Called once at server startup via src/instrumentation.ts.
 *
 * Design notes:
 *  - Uses globalThis to prevent duplicate intervals across Next.js hot-reloads.
 *  - Skips any account that already has a sync job running.
 *  - Creates a real ListingSyncJob row so the existing sync infrastructure
 *    (status tracking, error logging) works exactly as it does for manual syncs.
 *  - Errors are caught and logged; a failing account never stops the others.
 */
import { prisma } from '@/lib/prisma'
import { syncListings } from '@/lib/amazon/listings'

const INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

// Prevent duplicate timers when Next.js hot-reloads modules in development.
const g = globalThis as typeof globalThis & {
  _autoSyncTimer?: ReturnType<typeof setInterval>
}

export function scheduleAutoSync(): void {
  if (g._autoSyncTimer) {
    // Already registered — nothing to do.
    return
  }

  console.log('[AutoSync] Scheduler started — syncing all active accounts every 30 minutes')
  g._autoSyncTimer = setInterval(runAutoSync, INTERVAL_MS)
}

async function runAutoSync(): Promise<void> {
  try {
    const accounts = await prisma.amazonAccount.findMany({
      where: { isActive: true },
    })

    if (accounts.length === 0) return

    console.log(`[AutoSync] Scheduled sync starting for ${accounts.length} account(s)`)

    for (const account of accounts) {
      // Skip if a sync job is already running for this account.
      const running = await prisma.listingSyncJob.findFirst({
        where: { accountId: account.id, status: 'RUNNING' },
      })
      if (running) {
        console.log(`[AutoSync] ${account.sellerId}: sync already in progress, skipping`)
        continue
      }

      const job = await prisma.listingSyncJob.create({
        data: { accountId: account.id, status: 'RUNNING' },
      })

      // Fire-and-forget — each account syncs independently.
      syncListings(account.id, job.id)
        .then(() => console.log(`[AutoSync] ${account.sellerId}: sync completed`))
        .catch(async (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[AutoSync] ${account.sellerId}: sync failed —`, msg)
          await prisma.listingSyncJob.update({
            where: { id: job.id },
            data: { status: 'FAILED', errorMessage: msg, completedAt: new Date() },
          }).catch(() => { /* server may be shutting down */ })
        })
    }
  } catch (err: unknown) {
    console.error('[AutoSync] Scheduler error:', err instanceof Error ? err.message : err)
  }
}

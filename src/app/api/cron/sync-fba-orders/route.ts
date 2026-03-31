/**
 * GET /api/cron/sync-fba-orders — Vercel Cron (every 12 hours)
 * Syncs AFN/FBA shipped orders for profitability reporting.
 * Separated from the main sync-orders cron (MFN only, every 10 min)
 * to avoid slowing down the fulfillment page.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncUnshippedOrders } from '@/lib/amazon/sync-orders'

export const maxDuration = 300

const STALE_MINUTES = 10

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Clean up stale FBA sync jobs
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
  await prisma.orderSyncJob.updateMany({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      trigger: 'cron-fba',
      startedAt: { lt: staleThreshold },
    },
    data: { status: 'FAILED', errorMessage: 'Stale FBA job cleaned up by cron', completedAt: new Date() },
  })

  const accounts = await prisma.amazonAccount.findMany({
    where: { isActive: true },
    select: { id: true, sellerId: true },
  })

  const results: { accountId: string; sellerId: string; jobId?: string; skipped?: boolean; error?: string }[] = []

  for (const account of accounts) {
    // Skip if there's already an active FBA sync
    const activeJob = await prisma.orderSyncJob.findFirst({
      where: { accountId: account.id, trigger: 'cron-fba', status: { in: ['PENDING', 'RUNNING'] } },
    })
    if (activeJob) {
      results.push({ accountId: account.id, sellerId: account.sellerId, skipped: true })
      continue
    }

    try {
      const job = await prisma.orderSyncJob.create({
        data: { accountId: account.id, status: 'PENDING', trigger: 'cron-fba' },
      })
      await syncUnshippedOrders(account.id, job.id, 'afn-only')
      results.push({ accountId: account.id, sellerId: account.sellerId, jobId: job.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-fba-orders] Error syncing account ${account.sellerId}:`, message)
      results.push({ accountId: account.id, sellerId: account.sellerId, error: message })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}

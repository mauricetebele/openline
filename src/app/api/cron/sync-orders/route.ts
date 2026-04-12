/**
 * GET /api/cron/sync-orders — Vercel Cron (every 15 min)
 * Syncs unshipped orders for all active Amazon accounts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncUnshippedOrders } from '@/lib/amazon/sync-orders'
import { syncBackMarketOrders } from '@/lib/backmarket/sync-orders'
import { enrichOrdersFromShipStation } from '@/lib/shipstation/enrich-orders'

export const maxDuration = 300

const STALE_MINUTES = 10

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends Authorization: Bearer <CRON_SECRET>)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Clean up stale jobs (PENDING/RUNNING > 10 min old)
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
  await prisma.orderSyncJob.updateMany({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      startedAt: { lt: staleThreshold },
    },
    data: { status: 'FAILED', errorMessage: 'Stale job cleaned up by cron', completedAt: new Date() },
  })

  // Fetch all active accounts
  const accounts = await prisma.amazonAccount.findMany({
    where: { isActive: true },
    select: { id: true, sellerId: true },
  })

  const results: { accountId: string; sellerId: string; jobId?: string; skipped?: boolean; error?: string }[] = []

  // Sync each account sequentially to avoid rate-limit issues
  for (const account of accounts) {
    // Skip if there's already a recent in-progress sync (prevents cron/manual overlap)
    const activeJob = await prisma.orderSyncJob.findFirst({
      where: { accountId: account.id, status: { in: ['PENDING', 'RUNNING'] } },
    })
    if (activeJob) {
      results.push({ accountId: account.id, sellerId: account.sellerId, skipped: true })
      continue
    }

    try {
      const job = await prisma.orderSyncJob.create({
        data: { accountId: account.id, status: 'PENDING', trigger: 'cron' },
      })
      await syncUnshippedOrders(account.id, job.id, 'mfn-only')
      results.push({ accountId: account.id, sellerId: account.sellerId, jobId: job.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-orders] Error syncing account ${account.sellerId}:`, message)
      results.push({ accountId: account.id, sellerId: account.sellerId, error: message })
    }
  }

  // ── BackMarket sync ──────────────────────────────────────────────────────
  let bmResult: { jobId?: string; skipped?: boolean; error?: string } | undefined
  const bmCredential = await prisma.backMarketCredential.findFirst({
    where: { isActive: true },
    select: { id: true },
  })
  if (bmCredential && accounts.length > 0) {
    const bmAccountId = accounts[0].id // reuse first active Amazon account
    try {
      const bmJob = await prisma.orderSyncJob.create({
        data: { accountId: bmAccountId, status: 'PENDING', source: 'backmarket', trigger: 'cron' },
      })
      await syncBackMarketOrders(bmAccountId, bmJob.id)
      bmResult = { jobId: bmJob.id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[cron/sync-orders] BackMarket sync error:', message)
      bmResult = { error: message }
    }
  }

  // ── ShipStation enrichment (auto-pull addresses + ssOrderId) ─────────────
  let ssEnrichResult: { enriched: number; addresses: number; total: number } | null = null
  for (const account of accounts) {
    try {
      const r = await enrichOrdersFromShipStation(account.id, msg => console.log(msg))
      if (r.total > 0) ssEnrichResult = r
    } catch (err) {
      console.error('[cron/sync-orders] SS enrich error:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ synced: results.length, results, backmarket: bmResult ?? null, ssEnrich: ssEnrichResult })
}

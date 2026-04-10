/**
 * POST /api/cron/sync-mfn-returns
 * Triggered daily at 6 AM UTC by Vercel cron.
 * 1. Syncs last 2 days of MFN returns for all active accounts
 * 2. Auto-runs SICKW iCloud checks on new Apple returns with serials
 * 3. Refreshes tracking status for all in-system returns from the last 30 days
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncMfnReturns, autoCheckNewReturns } from '@/lib/amazon/mfn-returns'
import { getCarrierStatus } from '@/lib/ups-tracking'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) {
    return NextResponse.json({ message: 'No active accounts' })
  }

  const end = new Date(Date.now() - 5 * 60 * 1000) // 5-min buffer
  const start = new Date(end.getTime() - 2 * 24 * 60 * 60 * 1000) // 2 days back

  const results: { accountId: string; step: string; status: string; message?: string }[] = []

  for (const account of accounts) {
    // Step 1: Sync MFN returns
    const job = await prisma.mFNReturnSyncJob.create({
      data: { accountId: account.id, startDate: start, endDate: end, status: 'IN_PROGRESS' },
    })

    try {
      const result = await syncMfnReturns(account.id, job.id, start, end)
      results.push({
        accountId: account.id,
        step: 'sync',
        status: 'ok',
        message: `${result.totalUpserted} returns upserted`,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.mFNReturnSyncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      results.push({ accountId: account.id, step: 'sync', status: 'error', message })
      continue // skip remaining steps if sync failed
    }

    // Step 2: Auto-check new returns via SICKW
    try {
      const checkResult = await autoCheckNewReturns(account.id)
      results.push({
        accountId: account.id,
        step: 'sickw',
        status: 'ok',
        message: `${checkResult.checked} checked, ${checkResult.alertsCreated} alerts`,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ accountId: account.id, step: 'sickw', status: 'error', message })
    }
  }

  // Step 3: Refresh tracking for in-system returns from the last 30 days with tracking numbers
  let trackingRefreshed = 0
  let trackingFailed = 0
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Get all known internal order IDs (non-cancelled)
    const knownOrders = await prisma.$queryRaw<{ amazonOrderId: string }[]>`
      SELECT DISTINCT "amazonOrderId" FROM "orders"
      WHERE "amazonOrderId" IS NOT NULL
        AND "orderStatus" != 'Canceled'
        AND "workflowStatus" != 'CANCELLED'
    `
    const knownOrderIds = new Set(knownOrders.map(o => o.amazonOrderId))

    // Fetch returns with tracking from last 30 days that aren't already delivered
    const trackable = await prisma.mFNReturn.findMany({
      where: {
        trackingNumber: { not: null },
        importedAt: { gte: thirtyDaysAgo },
        carrierStatus: { not: { contains: 'delivered' } },
      },
      select: { id: true, orderId: true, trackingNumber: true },
    })

    // Filter to in-system only
    const inSystem = trackable.filter(r => knownOrderIds.has(r.orderId))

    for (const ret of inSystem) {
      try {
        const result = await getCarrierStatus(ret.trackingNumber!)
        await prisma.mFNReturn.update({
          where: { id: ret.id },
          data: {
            carrierStatus: result.status,
            deliveredAt: result.deliveredAt,
            estimatedDelivery: result.estimatedDelivery,
            trackingUpdatedAt: new Date(),
          },
        })
        trackingRefreshed++
      } catch {
        trackingFailed++
      }
    }

    results.push({
      accountId: 'all',
      step: 'tracking',
      status: 'ok',
      message: `${trackingRefreshed} refreshed, ${trackingFailed} failed (of ${inSystem.length} in-system)`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.push({ accountId: 'all', step: 'tracking', status: 'error', message })
  }

  console.log('[Cron] sync-mfn-returns complete:', results)
  return NextResponse.json({ ok: true, results })
}

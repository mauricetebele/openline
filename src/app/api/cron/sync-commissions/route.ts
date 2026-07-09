/**
 * GET /api/cron/sync-commissions — Vercel Cron (every 6 hours)
 * Syncs Amazon marketplace commissions for all active accounts (last 30 days)
 * and BackMarket commissions (flat 12%).
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncAmazonCommissions, syncBackMarketCommissions } from '@/lib/amazon/sync-commissions'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  const results: { source: string; status: string; message?: string }[] = []

  const end = new Date(Date.now() - 5 * 60 * 1000)
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000) // 14 days back

  for (const account of accounts) {
    try {
      const result = await syncAmazonCommissions(account.id, start, end)
      results.push({ source: `amazon:${account.id}`, status: 'ok', message: `${result.updated} orders updated` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-commissions] Amazon account=${account.id}`, message)
      results.push({ source: `amazon:${account.id}`, status: 'error', message })
    }
  }

  // ── Backfill pass: catch orders that never got commissions synced ───────────
  // Find the oldest un-synced shipped Amazon order and widen the window, capped
  // at 30 days to stay within Vercel's 300s function timeout.
  const oldestUnsyncced = await prisma.order.findFirst({
    where: {
      orderSource: 'amazon',
      workflowStatus: 'SHIPPED',
      commissionSyncedAt: null,
    },
    orderBy: { purchaseDate: 'asc' },
    select: { purchaseDate: true },
  })
  if (oldestUnsyncced) {
    const MAX_BACKFILL_DAYS = 30
    const backfillStart = new Date(Math.max(
      oldestUnsyncced.purchaseDate.getTime() - 24 * 60 * 60 * 1000,
      end.getTime() - MAX_BACKFILL_DAYS * 24 * 60 * 60 * 1000,
    ))
    // Only run if it's outside the normal 14-day window
    if (backfillStart < start) {
      for (const account of accounts) {
        try {
          const result = await syncAmazonCommissions(account.id, backfillStart, end)
          results.push({ source: `amazon-backfill:${account.id}`, status: 'ok', message: `${result.updated} orders updated` })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[cron/sync-commissions] Amazon backfill account=${account.id}`, message)
          results.push({ source: `amazon-backfill:${account.id}`, status: 'error', message })
        }
      }
    }
  }

  // Age out unresolvable orders: a shipped Amazon order older than the reachable
  // 30-day Finances window that still has no commission will never get one (the
  // backfill fetch is capped at 30 days). Left alone, the single oldest such
  // order pins the backfill anchor and forces a full 30-day Finances re-fetch on
  // every run, indefinitely. Stamp commissionSyncedAt (marketplaceCommission is
  // left untouched) so it drops out of the anchor query.
  try {
    const AGE_OUT_DAYS = 30
    const ageOutCutoff = new Date(end.getTime() - AGE_OUT_DAYS * 24 * 60 * 60 * 1000)
    const agedOut = await prisma.order.updateMany({
      where: {
        orderSource: 'amazon',
        workflowStatus: 'SHIPPED',
        commissionSyncedAt: null,
        purchaseDate: { lt: ageOutCutoff },
      },
      data: { commissionSyncedAt: new Date() },
    })
    if (agedOut.count > 0) {
      results.push({ source: 'amazon-ageout', status: 'ok', message: `${agedOut.count} unresolvable orders aged out` })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.push({ source: 'amazon-ageout', status: 'error', message })
  }

  // Backfill: set commission to 0 for wholesale orders missing commissionSyncedAt
  try {
    const backfilled = await prisma.order.updateMany({
      where: {
        orderSource: 'wholesale',
        commissionSyncedAt: null,
      },
      data: {
        marketplaceCommission: 0,
        commissionSyncedAt: new Date(),
      },
    })
    if (backfilled.count > 0) {
      results.push({ source: 'wholesale', status: 'ok', message: `${backfilled.count} orders backfilled` })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.push({ source: 'wholesale', status: 'error', message })
  }

  // BackMarket fallback: apply 12% commission for shipped orders missing fee data
  try {
    const bmResult = await syncBackMarketCommissions()
    if (bmResult.updated > 0) {
      results.push({ source: 'backmarket', status: 'ok', message: `${bmResult.updated} orders updated (12% fallback)` })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron/sync-commissions] BackMarket fallback`, message)
    results.push({ source: 'backmarket', status: 'error', message })
  }

  return NextResponse.json({ status: 'success', results })
}

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
  // Find the oldest un-synced shipped Amazon order and widen the window to cover it.
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
    const backfillStart = new Date(oldestUnsyncced.purchaseDate.getTime() - 24 * 60 * 60 * 1000)
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

/**
 * GET /api/cron/sync-competitive-offers — Vercel Cron (hourly)
 * Refreshes competitor offers per ASIN + Amazon condition for active listings
 * (stalest first, ~4 min budget per run, 20 h cache) so the repricing
 * suggestion feed always has competition data that's at most ~a day old.
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncCompetitivePricing } from '@/lib/amazon/competitive-pricing'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true }, select: { id: true } })
  const started = Date.now()
  const results = []
  for (const a of accounts) {
    const remaining = 240_000 - (Date.now() - started)
    if (remaining <= 0) break
    try {
      results.push({ accountId: a.id, ...(await syncCompetitivePricing(a.id, { budgetMs: remaining })) })
    } catch (err) {
      results.push({ accountId: a.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  console.log('[cron/sync-competitive-offers]', JSON.stringify(results))
  return NextResponse.json({ status: 'success', results })
}

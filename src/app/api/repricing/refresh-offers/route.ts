/**
 * POST /api/repricing/refresh-offers — the Repricing Feed "Refresh" button.
 * Pulls competitor offers (incl. Prime flags) from Amazon for active ASIN +
 * condition pairs older than 1 hour, stalest first, for up to ~4 minutes
 * (Product Pricing is rate-limited to 0.5 req/s). Returns how many are still
 * stale so the page can say "click Refresh again".
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncCompetitivePricing } from '@/lib/amazon/competitive-pricing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true }, select: { id: true } })
  const started = Date.now()
  let fetched = 0, errors = 0, remainingStale = 0, pairs = 0
  for (const a of accounts) {
    const budgetMs = 240_000 - (Date.now() - started)
    if (budgetMs <= 0) break
    const r = await syncCompetitivePricing(a.id, { budgetMs, maxAgeMs: 60 * 60 * 1000 })
    fetched += r.fetched; errors += r.errors; remainingStale += r.remainingStale; pairs += r.pairs
  }
  return NextResponse.json({ pairs, fetched, errors, remainingStale })
}

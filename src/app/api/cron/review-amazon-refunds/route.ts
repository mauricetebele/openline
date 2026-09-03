/**
 * GET /api/cron/review-amazon-refunds — Vercel Cron (daily)
 * Refreshes recent Amazon transactions, then compiles new "Refund" transactions
 * into the Review Amazon Refunds queue as NOT_REVIEWED entries.
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncAmazonTransactions } from '@/lib/amazon/sync-transactions'
import { compileAmazonRefunds } from '@/lib/amazon/compile-refunds'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true }, select: { id: true } })
  const end = new Date(Date.now() - 5 * 60 * 1000)
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000) // 14 days

  let fetched = 0
  for (const account of accounts) {
    try {
      const r = await syncAmazonTransactions(account.id, start, end)
      fetched += r.found
    } catch (err) {
      console.error('[cron/review-amazon-refunds] sync failed:', err instanceof Error ? err.message : err)
    }
  }

  const compiled = await compileAmazonRefunds()
  console.log(`[cron/review-amazon-refunds] fetched=${fetched} created=${compiled.created} total=${compiled.total}`)
  return NextResponse.json({ status: 'success', fetched, created: compiled.created, totalRefunds: compiled.total })
}

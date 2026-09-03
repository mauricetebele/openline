/**
 * POST /api/amazon-refunds/sync
 * Refreshes recent Amazon transactions, then compiles new refunds into the
 * review queue. Used by the manual "Sync" button (the daily cron shares the
 * same logic).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncAmazonTransactions } from '@/lib/amazon/sync-transactions'
import { compileAmazonRefunds, REFUND_REVIEW_START } from '@/lib/amazon/compile-refunds'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true }, select: { id: true } })
  const end = new Date(Date.now() - 5 * 60 * 1000)
  // Pull enough history to cover the review window on the first run.
  const start = new Date(Math.min(REFUND_REVIEW_START.getTime(), end.getTime() - 14 * 24 * 60 * 60 * 1000))

  let fetched = 0
  const errors: string[] = []
  for (const account of accounts) {
    try {
      const r = await syncAmazonTransactions(account.id, start, end)
      fetched += r.found
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  const compiled = await compileAmazonRefunds()
  return NextResponse.json({ fetched, created: compiled.created, totalRefunds: compiled.total, errors })
}

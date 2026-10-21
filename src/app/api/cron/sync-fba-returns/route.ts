/**
 * GET /api/cron/sync-fba-returns — daily FBA Customer Returns sync.
 *
 * The 6-hourly sync-fba-refunds cron already refreshes the last 7 days; this
 * daily job uses a wider 30-day window so return reasons + customer comments
 * are backfilled for late-arriving / recently-amended returns.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncFbaReturns } from '@/lib/amazon/fba-returns'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const end = new Date()
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days back

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  const results: { accountId: string; status: string; message?: string }[] = []

  for (const account of accounts) {
    const job = await prisma.importJob.create({ data: { accountId: account.id, startDate: start, endDate: end, status: 'RUNNING' } })
    try {
      const r = await syncFbaReturns(account.id, job.id, start, end)
      results.push({ accountId: account.id, status: 'ok', message: `${r.totalUpserted} returns upserted` })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.importJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorMessage: message, completedAt: new Date() } }).catch(() => {})
      results.push({ accountId: account.id, status: 'error', message })
    }
  }

  return NextResponse.json({ ok: true, window: { start, end }, results })
}

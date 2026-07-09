/**
 * POST /api/cron/sync-fba-refunds
 * Triggered every 6 hours by Vercel cron.
 * Syncs last 7 days of FBA refunds for all active Amazon accounts.
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncFbaRefunds } from '@/lib/amazon/fba-refunds'
import { syncFbaReturns } from '@/lib/amazon/fba-returns'
import { syncFbaReimbursements } from '@/lib/amazon/fba-reimbursements'
import { autoValidateFbaRefunds } from '@/lib/fba-auto-validate'

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends Authorization: Bearer <CRON_SECRET>)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) {
    return NextResponse.json({ message: 'No active accounts' })
  }

  const end = new Date(Date.now() - 5 * 60 * 1000) // 5-min buffer
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days back

  const results: { accountId: string; status: string; message?: string }[] = []

  // Reap stale importJobs left RUNNING by a previous invocation that hit the
  // Vercel maxDuration and was killed before its catch could mark them FAILED.
  // Without this they linger RUNNING forever.
  const STALE_MINUTES = 15
  await prisma.importJob.updateMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: new Date(Date.now() - STALE_MINUTES * 60 * 1000) },
    },
    data: { status: 'FAILED', errorMessage: 'Stale job reaped by cron', completedAt: new Date() },
  })

  // Wraps one report sync: creates its importJob, runs it, and marks the job
  // FAILED on error. Returns a success message; rethrows a labelled error.
  const runReportSync = async (
    accountId: string,
    label: string,
    run: (jobId: string) => Promise<{ totalUpserted: number }>,
  ): Promise<string> => {
    const job = await prisma.importJob.create({
      data: { accountId, startDate: start, endDate: end, status: 'RUNNING' },
    })
    try {
      const result = await run(job.id)
      return `${result.totalUpserted} ${label} upserted`
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      throw new Error(`${label}: ${message}`)
    }
  }

  for (const account of accounts) {
    // Run refunds, returns, and reimbursements concurrently. They poll different
    // report types (independent SP-API rate buckets) and are otherwise fully
    // independent, so this cuts wall-clock from the sum of three sequential
    // report polls to the slowest single one — the difference between finishing
    // and being killed at maxDuration=300s.
    const settled = await Promise.allSettled([
      runReportSync(account.id, 'refunds', (jobId) => syncFbaRefunds(account.id, start, end, jobId)),
      runReportSync(account.id, 'returns', (jobId) => syncFbaReturns(account.id, jobId, start, end)),
      runReportSync(account.id, 'reimbursements', (jobId) => syncFbaReimbursements(account.id, jobId, start, end)),
    ])
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push({ accountId: account.id, status: 'ok', message: r.value })
      } else {
        const message = r.reason instanceof Error ? r.reason.message : String(r.reason)
        results.push({ accountId: account.id, status: 'error', message })
      }
    }
  }

  // Auto-validate newly qualifying refunds
  let validation = { validated: 0, manualReview: 0, unchanged: 0 }
  try {
    validation = await autoValidateFbaRefunds()
  } catch (err) {
    console.error('[Cron] Auto-validation failed:', err)
  }

  console.log('[Cron] FBA refunds + returns + reimbursements sync complete:', results, 'validation:', validation)
  return NextResponse.json({ ok: true, results, validation })
}

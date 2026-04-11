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

  for (const account of accounts) {
    const job = await prisma.importJob.create({
      data: { accountId: account.id, startDate: start, endDate: end, status: 'RUNNING' },
    })
    try {
      const result = await syncFbaRefunds(account.id, start, end, job.id)
      results.push({ accountId: account.id, status: 'ok', message: `${result.totalUpserted} refunds upserted` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      results.push({ accountId: account.id, status: 'error', message })
    }

    // Also sync FBA returns (last 7 days) for cross-reference
    const returnJob = await prisma.importJob.create({
      data: { accountId: account.id, startDate: start, endDate: end, status: 'RUNNING' },
    })
    try {
      const returnResult = await syncFbaReturns(account.id, returnJob.id, start, end)
      results.push({ accountId: account.id, status: 'ok', message: `${returnResult.totalUpserted} returns upserted` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.importJob.update({
        where: { id: returnJob.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      results.push({ accountId: account.id, status: 'error', message: `returns: ${message}` })
    }

    // Also sync FBA reimbursements (last 7 days) for cross-reference
    const reimbursementJob = await prisma.importJob.create({
      data: { accountId: account.id, startDate: start, endDate: end, status: 'RUNNING' },
    })
    try {
      const reimbursementResult = await syncFbaReimbursements(account.id, reimbursementJob.id, start, end)
      results.push({ accountId: account.id, status: 'ok', message: `${reimbursementResult.totalUpserted} reimbursements upserted` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.importJob.update({
        where: { id: reimbursementJob.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      results.push({ accountId: account.id, status: 'error', message: `reimbursements: ${message}` })
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

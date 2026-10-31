/**
 * GET/POST /api/cron/import
 *
 * Scheduled by Vercel cron (GET, Authorization: Bearer <CRON_SECRET>).
 * Imports the last 30 days of Amazon Seller Central refunds for all active
 * accounts into the Refund table (powers the /refunds review page).
 *
 * A POST variant (x-cron-secret header) is kept for manual/external triggers.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { importRefunds } from '@/lib/amazon/finances'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function runImport() {
  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) return { ok: true, message: 'No active accounts', results: [] }

  const end = new Date(Date.now() - 5 * 60 * 1000) // 5 min ago
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days before

  const results: { accountId: string; status: string; message?: string }[] = []
  for (const account of accounts) {
    const job = await prisma.importJob.create({
      data: { accountId: account.id, startDate: start, endDate: end, status: 'RUNNING' },
    })
    try {
      const result = await importRefunds(account.id, start, end, job.id)
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
      results.push({ accountId: account.id, status: 'ok', message: `${result.totalUpserted} upserted` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      results.push({ accountId: account.id, status: 'error', message })
    }
  }
  console.log('[Cron] Refund import complete:', results)
  return { ok: true, results }
}

// Vercel cron → GET with Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runImport())
}

// Manual/external trigger → POST with x-cron-secret header
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runImport())
}

/**
 * POST /api/cron/import
 *
 * Triggered every hour by a system cron job.
 * Imports the last 30 days of refunds for all active Amazon accounts.
 * Protected by CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { importRefunds } from '@/lib/amazon/finances'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) {
    return NextResponse.json({ message: 'No active accounts' })
  }

  const end = new Date(Date.now() - 5 * 60 * 1000) // 5 min ago
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days before that

  const results: { accountId: string; status: string; message?: string }[] = []

  for (const account of accounts) {
    const job = await prisma.importJob.create({
      data: { accountId: account.id, startDate: start, endDate: end, status: 'RUNNING' },
    })

    try {
      const result = await importRefunds(account.id, start, end, job.id)
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

  console.log('[Cron] Import complete:', results)
  return NextResponse.json({ ok: true, results })
}

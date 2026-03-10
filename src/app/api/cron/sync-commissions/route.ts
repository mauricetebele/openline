/**
 * GET /api/cron/sync-commissions — Vercel Cron (every 6 hours)
 * Syncs Amazon marketplace commissions for all active accounts (last 30 days).
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncAmazonCommissions } from '@/lib/amazon/sync-commissions'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  const results: { accountId: string; status: string; message?: string }[] = []

  const end = new Date(Date.now() - 5 * 60 * 1000)
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)

  for (const account of accounts) {
    try {
      const result = await syncAmazonCommissions(account.id, start, end)
      results.push({ accountId: account.id, status: 'ok', message: `${result.updated} orders updated` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-commissions] Amazon account=${account.id}`, message)
      results.push({ accountId: account.id, status: 'error', message })
    }
  }

  return NextResponse.json({ status: 'success', results })
}

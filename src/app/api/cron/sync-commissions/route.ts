/**
 * POST /api/cron/sync-commissions
 * Vercel cron — every 6 hours.
 * Syncs marketplace commissions for all active Amazon accounts (last 30 days)
 * and backfills BackMarket commissions (flat 12%).
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncAmazonCommissions, syncBackMarketCommissions } from '@/lib/amazon/sync-commissions'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: { source: string; status: string; message?: string }[] = []

  // ── Amazon accounts ───────────────────────────────────────────────────────
  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })

  const end = new Date(Date.now() - 5 * 60 * 1000) // 5-min buffer
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days back

  for (const account of accounts) {
    try {
      const result = await syncAmazonCommissions(account.id, start, end)
      results.push({ source: `amazon:${account.id}`, status: 'ok', message: `${result.updated} orders updated` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-commissions] Amazon account=${account.id}`, message)
      results.push({ source: `amazon:${account.id}`, status: 'error', message })
    }
  }

  // ── BackMarket ────────────────────────────────────────────────────────────
  try {
    const result = await syncBackMarketCommissions()
    results.push({ source: 'backmarket', status: 'ok', message: `${result.updated} orders updated` })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/sync-commissions] BackMarket', message)
    results.push({ source: 'backmarket', status: 'error', message })
  }

  return NextResponse.json({ status: 'success', results })
}

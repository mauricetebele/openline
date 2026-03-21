/**
 * POST /api/cron/sync-replacements
 * Triggered every 6 hours by Vercel cron.
 * Syncs free replacement orders for all active Amazon accounts.
 */
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncReplacementOrders } from '@/lib/amazon/sync-replacements'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) {
    return NextResponse.json({ message: 'No active accounts' })
  }

  const results: { accountId: string; status: string; message?: string }[] = []

  for (const account of accounts) {
    try {
      const result = await syncReplacementOrders(account.id)
      results.push({
        accountId: account.id,
        status: 'ok',
        message: `${result.created} created, ${result.updated} updated, ${result.trackingRefreshed} tracking refreshed`,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Cron] sync-replacements account ${account.id} failed:`, message)
      results.push({ accountId: account.id, status: 'error', message })
    }
  }

  console.log('[Cron] sync-replacements complete:', results)
  return NextResponse.json({ ok: true, results })
}

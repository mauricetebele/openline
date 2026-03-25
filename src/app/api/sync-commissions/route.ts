/**
 * POST /api/sync-commissions — Manual trigger for commission sync
 * Same logic as the cron job, but authenticated via session instead of CRON_SECRET.
 */
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncAmazonCommissions } from '@/lib/amazon/sync-commissions'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  const results: { source: string; status: string; message?: string }[] = []

  const end = new Date(Date.now() - 5 * 60 * 1000)
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000)

  for (const account of accounts) {
    try {
      const result = await syncAmazonCommissions(account.id, start, end)
      results.push({ source: `amazon:${account.id}`, status: 'ok', message: `${result.updated} orders updated` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ source: `amazon:${account.id}`, status: 'error', message })
    }
  }

  try {
    const backfilled = await prisma.order.updateMany({
      where: { orderSource: 'wholesale', commissionSyncedAt: null },
      data: { marketplaceCommission: 0, commissionSyncedAt: new Date() },
    })
    if (backfilled.count > 0) {
      results.push({ source: 'wholesale', status: 'ok', message: `${backfilled.count} orders backfilled` })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    results.push({ source: 'wholesale', status: 'error', message })
  }

  return NextResponse.json({ status: 'success', results })
}

export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { syncReplacementOrders, SyncResult } from '@/lib/amazon/sync-replacements'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) {
    return NextResponse.json({ ok: false, error: 'No active Amazon accounts found' })
  }

  const results: (SyncResult & { accountId: string })[] = []

  for (const account of accounts) {
    try {
      const result = await syncReplacementOrders(account.id)
      results.push({ accountId: account.id, ...result })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[sync-replacements] Account ${account.id} failed:`, errMsg)
      results.push({
        accountId: account.id,
        created: 0,
        updated: 0,
        trackingRefreshed: 0,
        debug: { totalOrdersFetched: 0, replacementsFound: 0, lookbackDays: 0, pagesFetched: 0, error: errMsg },
      } as SyncResult & { accountId: string })
    }
  }

  const totalCreated = results.reduce((s, r) => s + r.created, 0)
  const totalUpdated = results.reduce((s, r) => s + r.updated, 0)
  const totalTracking = results.reduce((s, r) => s + r.trackingRefreshed, 0)

  return NextResponse.json({
    ok: true,
    created: totalCreated,
    updated: totalUpdated,
    trackingRefreshed: totalTracking,
    results,
  })
}

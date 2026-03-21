export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { syncReplacementOrders } from '@/lib/amazon/sync-replacements'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.amazonAccount.findMany({ where: { isActive: true } })
  if (accounts.length === 0) {
    return NextResponse.json({ message: 'No active accounts' })
  }

  const results: { accountId: string; created: number; updated: number; trackingRefreshed: number }[] = []

  for (const account of accounts) {
    try {
      const result = await syncReplacementOrders(account.id)
      results.push({ accountId: account.id, ...result })
    } catch (err) {
      console.error(`[sync-replacements] Account ${account.id} failed:`, err)
      results.push({ accountId: account.id, created: 0, updated: 0, trackingRefreshed: 0 })
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

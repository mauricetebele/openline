/**
 * GET /api/cron/sync-fba-inventory — Vercel Cron
 * Syncs FBA inventory (quantities + FNSKUs) for all active Amazon accounts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncFbaInventory } from '@/lib/amazon/fba-inventory'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accounts = await prisma.amazonAccount.findMany({
    where: { isActive: true },
    select: { id: true, sellerId: true },
  })

  const results: { accountId: string; sellerId: string; updated?: number; total?: number; error?: string }[] = []

  for (const account of accounts) {
    try {
      const { updated, total } = await syncFbaInventory(account.id)
      results.push({ accountId: account.id, sellerId: account.sellerId, updated, total })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-fba-inventory] Error for ${account.sellerId}:`, message)
      results.push({ accountId: account.id, sellerId: account.sellerId, error: message })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}

/**
 * GET /api/cron/sync-listings — Vercel Cron
 * Syncs all Amazon listings (Active, Inactive, Incomplete) for every active account.
 * Uses the GET_MERCHANT_LISTINGS_ALL_DATA report.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncListings } from '@/lib/amazon/listings'

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

  const results: { accountId: string; sellerId: string; totalFound?: number; totalUpserted?: number; error?: string }[] = []

  for (const account of accounts) {
    // Skip if a sync is already running for this account
    const running = await prisma.listingSyncJob.findFirst({
      where: { accountId: account.id, status: 'RUNNING' },
    })
    if (running) {
      console.log(`[cron/sync-listings] ${account.sellerId}: sync already in progress, skipping`)
      results.push({ accountId: account.id, sellerId: account.sellerId, error: 'already running' })
      continue
    }

    const job = await prisma.listingSyncJob.create({
      data: { accountId: account.id, status: 'RUNNING' },
    })

    try {
      await syncListings(account.id, job.id)
      const completed = await prisma.listingSyncJob.findUnique({ where: { id: job.id } })
      results.push({
        accountId: account.id,
        sellerId: account.sellerId,
        totalFound: completed?.totalFound ?? 0,
        totalUpserted: completed?.totalUpserted ?? 0,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/sync-listings] Error for ${account.sellerId}:`, message)
      await prisma.listingSyncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      }).catch(() => {})
      results.push({ accountId: account.id, sellerId: account.sellerId, error: message })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}

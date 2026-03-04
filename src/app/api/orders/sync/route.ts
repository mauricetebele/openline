/**
 * POST   /api/orders/sync            — start a background sync
 * GET    /api/orders/sync?jobId=     — poll status
 * DELETE /api/orders/sync?accountId= — reset stuck RUNNING/PENDING jobs
 */
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { syncUnshippedOrders } from '@/lib/amazon/sync-orders'
import { syncBackMarketOrders } from '@/lib/backmarket/sync-orders'
import { requireAdmin, requireActiveAccount } from '@/lib/auth-helpers'

export const maxDuration = 300

/** How old (in minutes) a PENDING/RUNNING job must be before we consider it stale. */
const STALE_MINUTES = 10

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const { accountId, source = 'all' } = await req.json() as { accountId?: string; source?: 'amazon' | 'backmarket' | 'all' }
  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

  const accountOrErr = await requireActiveAccount(accountId)
  if (accountOrErr instanceof NextResponse) return accountOrErr

  // If a recent sync is already running, return its jobId instead of starting a new one
  const existingJob = await prisma.orderSyncJob.findFirst({
    where: {
      accountId,
      status: { in: ['PENDING', 'RUNNING'] },
      startedAt: { gt: new Date(Date.now() - STALE_MINUTES * 60 * 1000) },
    },
    orderBy: { startedAt: 'desc' },
  })
  if (existingJob) {
    return NextResponse.json({ jobId: existingJob.id, existing: true })
  }

  // Mark any stale PENDING/RUNNING jobs as failed before starting a new one.
  await prisma.orderSyncJob.updateMany({
    where: { accountId, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', errorMessage: 'Superseded by new sync', completedAt: new Date() },
  })

  const syncAmazon = source === 'amazon' || source === 'all'
  const syncBM     = source === 'backmarket' || source === 'all'

  // Start Amazon sync
  let jobId: string | undefined
  if (syncAmazon) {
    const job = await prisma.orderSyncJob.create({
      data: { accountId, status: 'PENDING' },
    })
    jobId = job.id
    waitUntil(
      syncUnshippedOrders(accountId, job.id).catch(err =>
        console.error('[orders/sync] background error:', err),
      ),
    )
  }

  // Start BackMarket sync if credentials exist
  let bmJobId: string | undefined
  if (syncBM) {
    const bmCredential = await prisma.backMarketCredential.findFirst({
      where: { isActive: true },
      select: { id: true },
    })
    if (bmCredential) {
      const bmJob = await prisma.orderSyncJob.create({
        data: { accountId, status: 'PENDING' },
      })
      bmJobId = bmJob.id
      waitUntil(
        syncBackMarketOrders(accountId, bmJob.id).catch(err =>
          console.error('[orders/sync] BackMarket background error:', err),
        ),
      )
    }
  }

  return NextResponse.json({ jobId, bmJobId })
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const jobId     = searchParams.get('jobId')
  const accountId = searchParams.get('accountId')

  // ?jobId= — poll a specific job
  if (jobId) {
    const job = await prisma.orderSyncJob.findUnique({ where: { id: jobId } })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json(job)
  }

  // ?accountId= — find the most recent active (PENDING or RUNNING) job for this account
  if (accountId) {
    const job = await prisma.orderSyncJob.findFirst({
      where:   { accountId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { startedAt: 'desc' },
    })
    return NextResponse.json(job ?? null)
  }

  return NextResponse.json({ error: 'Missing jobId or accountId' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const accountId = req.nextUrl.searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

  const { count } = await prisma.orderSyncJob.updateMany({
    where: { accountId, status: { in: ['PENDING', 'RUNNING'] } },
    data:  { status: 'FAILED', errorMessage: 'Manually reset by user', completedAt: new Date() },
  })

  return NextResponse.json({ reset: count })
}

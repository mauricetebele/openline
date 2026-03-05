/**
 * POST   /api/orders/sync            — start a background sync
 * GET    /api/orders/sync?jobId=     — poll status of a single job
 * GET    /api/orders/sync?accountId= — find all active (PENDING/RUNNING) jobs for reconnect
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

  const staleCutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
  const syncAmazon = source === 'amazon' || source === 'all'
  const syncBM     = source === 'backmarket' || source === 'all'

  // Check for existing in-progress jobs per source
  const existingJobs = await prisma.orderSyncJob.findMany({
    where: {
      accountId,
      status: { in: ['PENDING', 'RUNNING'] },
      startedAt: { gt: staleCutoff },
    },
    orderBy: { startedAt: 'desc' },
  })

  const existingAmazon = existingJobs.find(j => j.source === 'amazon')
  const existingBM = existingJobs.find(j => j.source === 'backmarket')

  // If all requested sources already have active jobs, return them
  if ((syncAmazon && existingAmazon) && (syncBM && existingBM)) {
    return NextResponse.json({ jobId: existingAmazon.id, bmJobId: existingBM.id, existing: true })
  }
  if (syncAmazon && !syncBM && existingAmazon) {
    return NextResponse.json({ jobId: existingAmazon.id, existing: true })
  }
  if (syncBM && !syncAmazon && existingBM) {
    return NextResponse.json({ bmJobId: existingBM.id, existing: true })
  }

  // Mark stale jobs as failed (only for sources we're about to start)
  if (syncAmazon && !existingAmazon) {
    await prisma.orderSyncJob.updateMany({
      where: { accountId, source: 'amazon', status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'FAILED', errorMessage: 'Superseded by new sync', completedAt: new Date() },
    })
  }
  if (syncBM && !existingBM) {
    await prisma.orderSyncJob.updateMany({
      where: { accountId, source: 'backmarket', status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'FAILED', errorMessage: 'Superseded by new sync', completedAt: new Date() },
    })
  }

  // Start Amazon sync
  let jobId: string | undefined = existingAmazon?.id
  if (syncAmazon && !existingAmazon) {
    const job = await prisma.orderSyncJob.create({
      data: { accountId, source: 'amazon', status: 'PENDING' },
    })
    jobId = job.id
    waitUntil(
      syncUnshippedOrders(accountId, job.id).catch(err =>
        console.error('[orders/sync] background error:', err),
      ),
    )
  }

  // Start BackMarket sync if credentials exist
  let bmJobId: string | undefined = existingBM?.id
  if (syncBM && !existingBM) {
    const bmCredential = await prisma.backMarketCredential.findFirst({
      where: { isActive: true },
      select: { id: true },
    })
    if (bmCredential) {
      const bmJob = await prisma.orderSyncJob.create({
        data: { accountId, source: 'backmarket', status: 'PENDING' },
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
  const lastSync  = searchParams.get('lastSync')

  // ?lastSync=true — return the most recent COMPLETED job per source
  if (lastSync) {
    const sources = ['amazon', 'backmarket'] as const
    const result: Record<string, { completedAt: string; trigger: string; totalSynced: number } | null> = {}
    for (const src of sources) {
      const job = await prisma.orderSyncJob.findFirst({
        where: { status: 'COMPLETED', source: src },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true, trigger: true, totalSynced: true },
      })
      result[src] = job ? { completedAt: job.completedAt!.toISOString(), trigger: job.trigger, totalSynced: job.totalSynced } : null
    }
    return NextResponse.json(result)
  }

  // ?jobId= — poll a specific job
  if (jobId) {
    const job = await prisma.orderSyncJob.findUnique({ where: { id: jobId } })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json(job)
  }

  // ?accountId= — find all active (PENDING or RUNNING) jobs for this account
  if (accountId) {
    const jobs = await prisma.orderSyncJob.findMany({
      where:   { accountId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { startedAt: 'desc' },
    })
    // Return as { amazon: job|null, backmarket: job|null } for easy client consumption
    const amazon = jobs.find(j => j.source === 'amazon') ?? null
    const backmarket = jobs.find(j => j.source === 'backmarket') ?? null
    return NextResponse.json({ amazon, backmarket })
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

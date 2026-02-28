/**
 * POST   /api/orders/sync            — start a background sync
 * GET    /api/orders/sync?jobId=     — poll status
 * DELETE /api/orders/sync?accountId= — reset stuck RUNNING/PENDING jobs
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'
import { syncUnshippedOrders } from '@/lib/amazon/sync-orders'
import { requireAdmin, requireActiveAccount } from '@/lib/auth-helpers'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const { accountId } = await req.json()
  if (!accountId) return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })

  const accountOrErr = await requireActiveAccount(accountId)
  if (accountOrErr instanceof NextResponse) return accountOrErr

  // Mark any stale PENDING/RUNNING jobs as failed before starting a new one.
  // This handles the case where a previous sync was killed (e.g. dev-server hot-reload)
  // before it could update its own status.
  await prisma.orderSyncJob.updateMany({
    where: { accountId, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', errorMessage: 'Superseded by new sync', completedAt: new Date() },
  })

  const job = await prisma.orderSyncJob.create({
    data: { accountId, status: 'PENDING' },
  })

  // Fire and forget
  syncUnshippedOrders(accountId, job.id).catch(err =>
    console.error('[orders/sync] background error:', err),
  )

  return NextResponse.json({ jobId: job.id })
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

/**
 * POST /api/returns/sync  — trigger MFN returns sync
 * GET  /api/returns/sync?jobId=xxx — poll sync job status
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { syncMfnReturns } from '@/lib/amazon/mfn-returns'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find the active Amazon account
  const account = await prisma.amazonAccount.findFirst({ where: { isActive: true } })
  if (!account) {
    return NextResponse.json({ error: 'No active Amazon account found' }, { status: 400 })
  }

  // Accept optional startDate / endDate from body, default to last 30 days
  let startDate: Date
  let endDate: Date
  try {
    const body = await req.json().catch(() => ({}))
    endDate = body.endDate ? new Date(body.endDate) : new Date()
    startDate = body.startDate ? new Date(body.startDate) : new Date(endDate.getTime() - 30 * 86_400_000)
  } catch {
    endDate = new Date()
    startDate = new Date(endDate.getTime() - 30 * 86_400_000)
  }

  // Create sync job
  const job = await prisma.mFNReturnSyncJob.create({
    data: {
      accountId: account.id,
      startDate,
      endDate,
      status: 'IN_PROGRESS',
    },
  })

  // Run sync in the background (don't await)
  syncMfnReturns(account.id, job.id, startDate, endDate).catch(async (err) => {
    console.error('[MFN Returns Sync] failed:', err)
    await prisma.mFNReturnSyncJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorMessage: String(err?.message ?? err), completedAt: new Date() },
    }).catch(() => {})
  })

  return NextResponse.json({
    id: job.id,
    status: 'IN_PROGRESS',
    totalFound: 0,
    totalUpserted: 0,
  })
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const job = await prisma.mFNReturnSyncJob.findUnique({ where: { id: jobId } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json({
    id: job.id,
    status: job.status === 'IN_PROGRESS' ? 'RUNNING' : job.status,
    totalFound: job.totalFound,
    totalUpserted: job.totalUpserted,
    errorMessage: job.errorMessage,
  })
}

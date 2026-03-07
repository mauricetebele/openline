/**
 * POST /api/fba-returns/sync — Trigger manual FBA customer returns sync
 * GET  /api/fba-returns/sync?jobId=X — Poll job status
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { syncFbaReturns } from '@/lib/amazon/fba-returns'
import { getAuthUser } from '@/lib/get-auth-user'

export const maxDuration = 300

const schema = z.object({
  accountId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
})

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const job = await prisma.importJob.findUnique({ where: { id: jobId } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json(job)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { accountId, startDate, endDate } = parsed.data
  const start = new Date(startDate)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
  const end = new Date(Math.min(new Date(endDate).getTime(), fiveMinutesAgo.getTime()))

  if (start >= end) {
    return NextResponse.json({ error: 'startDate must be before endDate' }, { status: 400 })
  }

  const account = await prisma.amazonAccount.findUnique({ where: { id: accountId, isActive: true } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const job = await prisma.importJob.create({
    data: { accountId, startDate: start, endDate: end, status: 'RUNNING' },
  })

  // Use waitUntil so the sync runs after the response is sent
  // (Vercel keeps the function alive for waitUntil promises)
  waitUntil(
    syncFbaReturns(accountId, job.id, start, end).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[FbaReturns] Sync job failed:', message)
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
    }),
  )

  return NextResponse.json({ jobId: job.id }, { status: 202 })
}

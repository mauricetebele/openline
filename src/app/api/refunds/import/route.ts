import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { importRefunds } from '@/lib/amazon/finances'
import { logAuditEvent } from '@/lib/audit'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

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
  const adminErr = requireAdmin(user)
  if (adminErr) return adminErr

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  }

  const { accountId, startDate, endDate } = parsed.data
  const start = new Date(startDate)
  // Cap end to 5 minutes ago to satisfy Amazon's "no later than 2 minutes from now" rule
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

  await logAuditEvent({
    entityType: 'ImportJob',
    entityId: job.id,
    action: 'IMPORT_STARTED',
    after: { accountId, startDate, endDate },
    actorId: user.dbId,
    actorLabel: user.email,
  })

  // Run import in background — do not await so we return immediately
  const actorId = user.dbId
  const actorLabel = user.email
  ;(async () => {
    try {
      const result = await importRefunds(accountId, start, end, job.id)
      await logAuditEvent({
        entityType: 'ImportJob',
        entityId: job.id,
        action: 'IMPORT_COMPLETED',
        after: result,
        actorId,
        actorLabel,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Import] Job failed:', message)
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      await logAuditEvent({
        entityType: 'ImportJob',
        entityId: job.id,
        action: 'IMPORT_FAILED',
        after: { error: message },
        actorId,
        actorLabel,
      })
    }
  })()

  // Return immediately with job ID — frontend will poll for status
  return NextResponse.json({ jobId: job.id }, { status: 202 })
}

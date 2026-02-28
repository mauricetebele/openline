import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { syncMFNReturns } from '@/lib/amazon/mfn-returns'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

const schema = z.object({
  accountId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate:   z.string().datetime(),
})

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const job = await prisma.mFNReturnSyncJob.findUnique({ where: { id: jobId } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json(job)
}

export async function POST(req: NextRequest) {
  try {
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

    const account = await prisma.amazonAccount.findUnique({ where: { id: accountId, isActive: true } })
    if (!account) return NextResponse.json({ error: 'Amazon account not found or inactive' }, { status: 404 })

    const start = new Date(startDate)
    const end   = new Date(Math.min(new Date(endDate).getTime(), Date.now() - 5 * 60_000))
    if (start >= end) return NextResponse.json({ error: 'startDate must be before endDate' }, { status: 400 })

    const job = await prisma.mFNReturnSyncJob.create({
      data: { accountId, startDate: start, endDate: end, status: 'IN_PROGRESS' },
    })

    // Run in background — return immediately
    ;(async () => {
      try {
        await syncMFNReturns(accountId, job.id, start, end)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[MFNReturnSync] Job failed:', message)
        await prisma.mFNReturnSyncJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
        })
      }
    })()

    return NextResponse.json({ jobId: job.id }, { status: 202 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

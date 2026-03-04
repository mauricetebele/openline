import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { syncListings } from '@/lib/amazon/listings'
import { getAuthUser } from '@/lib/get-auth-user'
import { requireAdmin } from '@/lib/auth-helpers'

export const maxDuration = 60

const schema = z.object({
  accountId: z.string().min(1),
})

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const jobId = req.nextUrl.searchParams.get('jobId')
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

    const job = await prisma.listingSyncJob.findUnique({ where: { id: jobId } })
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    return NextResponse.json(job)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/listings/sync]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
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

    const { accountId } = parsed.data

    const account = await prisma.amazonAccount.findUnique({ where: { id: accountId, isActive: true } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const job = await prisma.listingSyncJob.create({
      data: { accountId, status: 'RUNNING' },
    })

    try {
      await syncListings(accountId, job.id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ListingSync] Job failed:', message)
      await prisma.listingSyncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      })
      return NextResponse.json({ error: message }, { status: 500 })
    }

    const completed = await prisma.listingSyncJob.findUnique({ where: { id: job.id } })
    return NextResponse.json({ jobId: job.id, ...completed }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/listings/sync]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

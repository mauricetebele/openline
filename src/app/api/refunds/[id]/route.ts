import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAuditEvent } from '@/lib/audit'
import { getAuthUser } from '@/lib/get-auth-user'
import { InvalidReason, ReviewStatus } from '@prisma/client'

const reviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('VALID'), notes: z.string().optional() }),
  z.object({
    status: z.literal('INVALID'),
    invalidReason: z.nativeEnum(InvalidReason),
    customReason: z.string().optional(),
    notes: z.string().optional(),
  }),
])

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refund = await prisma.refund.findUnique({
    where: { id: params.id },
    include: {
      review: { include: { reviewedBy: { select: { name: true, email: true } } } },
      account: true,
      auditEvents: { orderBy: { timestamp: 'desc' }, take: 50 },
    },
  })

  if (!refund) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(refund)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = reviewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  if (
    parsed.data.status === 'INVALID' &&
    parsed.data.invalidReason === InvalidReason.OTHER &&
    !(parsed.data as { customReason?: string }).customReason?.trim()
  ) {
    return NextResponse.json({ error: 'customReason is required when invalidReason is OTHER' }, { status: 400 })
  }

  const refund = await prisma.refund.findUnique({
    where: { id: params.id },
    include: { review: true },
  })
  if (!refund) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const prevStatus = refund.review?.status ?? ReviewStatus.UNREVIEWED
  const data = parsed.data

  const updateData = {
    status: data.status as ReviewStatus,
    invalidReason: data.status === 'INVALID' ? (data as { invalidReason: InvalidReason }).invalidReason : null,
    customReason: data.status === 'INVALID' ? ((data as { customReason?: string }).customReason ?? null) : null,
    notes: data.notes ?? null,
    reviewedById: user.dbId,
    reviewedAt: new Date(),
  }

  const review = await prisma.review.upsert({
    where: { refundId: params.id },
    update: updateData,
    create: { refundId: params.id, ...updateData },
  })

  await logAuditEvent({
    entityType: 'Review',
    entityId: review.id,
    action: 'REVIEW_UPDATED',
    before: { status: prevStatus, invalidReason: refund.review?.invalidReason ?? null },
    after: {
      status: data.status,
      invalidReason: data.status === 'INVALID' ? (data as { invalidReason: string }).invalidReason : null,
    },
    actorId: user.dbId,
    actorLabel: user.email,
    refundId: params.id,
  })

  return NextResponse.json(review)
}

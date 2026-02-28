import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logAuditEvent } from '@/lib/audit'
import { getAuthUser } from '@/lib/get-auth-user'
import { InvalidReason, ReviewStatus } from '@prisma/client'

const schema = z.discriminatedUnion('status', [
  z.object({
    refundIds: z.array(z.string()).min(1).max(200),
    status: z.literal('VALID'),
    notes: z.string().optional(),
  }),
  z.object({
    refundIds: z.array(z.string()).min(1).max(200),
    status: z.literal('INVALID'),
    invalidReason: z.nativeEnum(InvalidReason),
    customReason: z.string().optional(),
    notes: z.string().optional(),
  }),
])

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  if (
    parsed.data.status === 'INVALID' &&
    parsed.data.invalidReason === InvalidReason.OTHER &&
    !(parsed.data as { customReason?: string }).customReason?.trim()
  ) {
    return NextResponse.json({ error: 'customReason required for OTHER reason' }, { status: 400 })
  }

  const { refundIds, status, notes } = parsed.data

  const existing = await prisma.review.findMany({
    where: { refundId: { in: refundIds } },
    select: { refundId: true, status: true, invalidReason: true },
  })
  const prevMap = new Map(existing.map((r) => [r.refundId, r]))

  const updateData = {
    status: status as ReviewStatus,
    invalidReason:
      status === 'INVALID' ? (parsed.data as { invalidReason: InvalidReason }).invalidReason : null,
    customReason:
      status === 'INVALID' ? ((parsed.data as { customReason?: string }).customReason ?? null) : null,
    notes: notes ?? null,
    reviewedById: user.dbId,
    reviewedAt: new Date(),
  }

  const results = await Promise.all(
    refundIds.map((refundId) =>
      prisma.review.upsert({
        where: { refundId },
        update: updateData,
        create: { refundId, ...updateData },
      }),
    ),
  )

  await Promise.all(
    refundIds.map((refundId) => {
      const prev = prevMap.get(refundId)
      return logAuditEvent({
        entityType: 'Review',
        entityId: refundId,
        action: 'BULK_REVIEW_UPDATED',
        before: { status: prev?.status ?? 'UNREVIEWED', invalidReason: prev?.invalidReason ?? null },
        after: { status, invalidReason: updateData.invalidReason },
        actorId: user.dbId,
        actorLabel: user.email,
        refundId,
      })
    }),
  )

  return NextResponse.json({ updated: results.length })
}

/**
 * PATCH /api/amazon-refunds/[id]
 * Body: { status?: 'NOT_REVIEWED'|'FLAGGED'|'VALIDATED', note?: string }
 *
 * Flag / validate (archive) a refund review entry, or update its note.
 * Never touches the source Amazon transaction.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

const STATUSES = ['NOT_REVIEWED', 'FLAGGED', 'VALIDATED'] as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const label = user.name || user.email

  const data: Record<string, unknown> = {}
  if ('note' in body) data.note = typeof body.note === 'string' ? body.note.trim() || null : null
  if ('status' in body) {
    const status = String(body.status)
    if (!(STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    data.status = status
    if (status === 'FLAGGED') { data.flaggedAt = new Date(); data.flaggedByLabel = label }
    if (status === 'VALIDATED') { data.validatedAt = new Date(); data.validatedByLabel = label }
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.amazonRefundReview.update({ where: { id: params.id }, data })
  return NextResponse.json({ data: { ...updated, amount: Number(updated.amount) } })
}

/**
 * POST /api/orders/[orderId]/weight-dims
 *
 * The warehouse person saves the free-form weight & dimensions text for an order
 * that was flagged with a weight & dims request. Empty text clears it.
 *
 * Body: { text: string | null }
 * Returns: { ok, id, weightDimsText, weightDimsEnteredAt }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { orderId: string } }) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = (body as { text?: unknown }).text
  const text = typeof raw === 'string' ? raw.trim() : ''

  const updated = await prisma.order.update({
    where: { id: params.orderId },
    data: text
      ? { weightDimsText: text, weightDimsEnteredAt: new Date() }
      : { weightDimsText: null, weightDimsEnteredAt: null },
    select: { id: true, weightDimsText: true, weightDimsEnteredAt: true },
  }).catch(() => null)

  if (!updated) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    id: updated.id,
    weightDimsText: updated.weightDimsText,
    weightDimsEnteredAt: updated.weightDimsEnteredAt?.toISOString() ?? null,
  })
}

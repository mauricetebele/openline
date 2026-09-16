/**
 * POST /api/orders/weight-dims-request
 *
 * Flag one or more orders as needing weight & dimensions from the warehouse
 * (highlights the row + shows the "Enter weight & dims" badge/text box), or
 * clear that request. Works for a single order or many selected orders.
 *
 * Body: { orderIds: string[], requested?: boolean }  // requested defaults to true
 * Returns: { ok, count, requested, requestedAt }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { orderIds, requested } = body as { orderIds?: unknown; requested?: unknown }
  const ids = Array.isArray(orderIds) ? orderIds.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
  if (ids.length === 0) return NextResponse.json({ error: 'No orders provided' }, { status: 400 })

  const wantRequested = requested !== false // default true
  const now = new Date()

  // Unshipped orders only — never flag a shipped/cancelled order.
  const result = await prisma.order.updateMany({
    where: { id: { in: ids }, workflowStatus: { notIn: ['SHIPPED', 'CANCELLED'] } },
    data: wantRequested
      ? { weightDimsRequested: true, weightDimsRequestedAt: now }
      : { weightDimsRequested: false },
  })

  return NextResponse.json({
    ok: true,
    count: result.count,
    requested: wantRequested,
    requestedAt: wantRequested ? now.toISOString() : null,
  })
}

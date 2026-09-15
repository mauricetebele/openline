/**
 * GET /api/label-print-info?id=<orderId | salesOrderId>
 * Returns how many times this order's shipping label was printed and when it was
 * last printed — used to warn before a re-print. Read-only (does NOT log a print).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const [count, last] = await Promise.all([
    prisma.auditEvent.count({ where: { entityType: 'orderLabel', action: 'label_printed', entityId: id } }),
    prisma.auditEvent.findFirst({
      where: { entityType: 'orderLabel', action: 'label_printed', entityId: id },
      orderBy: { timestamp: 'desc' }, select: { timestamp: true },
    }),
  ])

  return NextResponse.json({ count, lastPrintedAt: last?.timestamp ?? null })
}

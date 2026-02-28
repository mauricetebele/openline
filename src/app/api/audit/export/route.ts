import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'
import { stringify } from 'csv-stringify/sync'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const where: Prisma.AuditEventWhereInput = {}

  const refundId = searchParams.get('refundId')
  if (refundId) where.refundId = refundId

  const action = searchParams.get('action')
  if (action) where.action = action

  const search = searchParams.get('search')
  if (search) {
    where.OR = [
      { actorLabel: { contains: search, mode: 'insensitive' } },
      { action: { contains: search, mode: 'insensitive' } },
    ]
  }

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  if (startDate || endDate) {
    where.timestamp = {}
    if (startDate) where.timestamp.gte = new Date(startDate)
    if (endDate) where.timestamp.lte = new Date(endDate)
  }

  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: 10_000,
    include: { refund: { select: { orderId: true } } },
  })

  const rows = events.map((e) => ({
    timestamp: e.timestamp.toISOString(),
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    actor: e.actorLabel,
    orderId: e.refund?.orderId ?? '',
    before: JSON.stringify(e.before ?? ''),
    after: JSON.stringify(e.after ?? ''),
  }))

  const csv = stringify(rows, {
    header: true,
    columns: ['timestamp', 'action', 'entityType', 'entityId', 'actor', 'orderId', 'before', 'after'],
  })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

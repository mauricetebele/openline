/**
 * GET /api/label-print-history
 * Dedicated report of shipping-label print events (AuditEvent action=label_printed).
 * Supports search (order #, tracking, actor), date range, pagination, and CSV export.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

function buildWhere(searchParams: URLSearchParams): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = { action: 'label_printed', entityType: 'orderLabel' }

  const search = searchParams.get('search')?.trim()
  if (search) {
    where.OR = [
      { actorLabel: { contains: search, mode: 'insensitive' } },
      { entityId: { contains: search, mode: 'insensitive' } },
      { after: { path: ['orderNumber'], string_contains: search } },
      { after: { path: ['trackingNumber'], string_contains: search } },
    ]
  }

  const orderType = searchParams.get('orderType')
  if (orderType === 'marketplace' || orderType === 'wholesale') {
    where.after = { path: ['orderType'], equals: orderType }
  }

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  if (startDate || endDate) {
    where.timestamp = {}
    if (startDate) where.timestamp.gte = new Date(`${startDate}T00:00:00`)
    if (endDate) where.timestamp.lte = new Date(`${endDate}T23:59:59.999`)
  }
  return where
}

type AfterShape = {
  orderType?: string; orderSource?: string; orderNumber?: string
  trackingNumber?: string; carrier?: string; serviceCode?: string; pieces?: number
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const where = buildWhere(searchParams)

  // CSV export — all matching rows (bounded).
  if (searchParams.get('export') === 'csv') {
    const rows = await prisma.auditEvent.findMany({ where, orderBy: { timestamp: 'desc' }, take: 10000 })
    const header = ['Timestamp', 'Order Type', 'Order #', 'Tracking', 'Carrier', 'Service', 'Printed By']
    const csv = [header.join(',')]
    for (const r of rows) {
      const a = (r.after ?? {}) as AfterShape
      const cells = [
        r.timestamp.toISOString(),
        a.orderType ?? '',
        a.orderNumber ?? '',
        a.trackingNumber ?? '',
        a.carrier ?? '',
        a.serviceCode ?? '',
        r.actorLabel ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`)
      csv.push(cells.join(','))
    }
    return new NextResponse(csv.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="label-print-history.csv"`,
      },
    })
  }

  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? '50')))
  const skip = (page - 1) * pageSize

  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({ where, skip, take: pageSize, orderBy: { timestamp: 'desc' } }),
  ])

  const data = events.map(e => {
    const a = (e.after ?? {}) as AfterShape
    return {
      id: e.id,
      timestamp: e.timestamp,
      orderType: a.orderType ?? null,
      orderSource: a.orderSource ?? null,
      orderNumber: a.orderNumber ?? null,
      orderId: e.entityId,
      trackingNumber: a.trackingNumber ?? null,
      carrier: a.carrier ?? null,
      serviceCode: a.serviceCode ?? null,
      pieces: a.pieces ?? null,
      printedBy: e.actorLabel,
    }
  })

  return NextResponse.json({
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '50')))
  const skip = (page - 1) * pageSize

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
      { entityId: { contains: search, mode: 'insensitive' } },
    ]
  }

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  if (startDate || endDate) {
    where.timestamp = {}
    if (startDate) where.timestamp.gte = new Date(startDate)
    if (endDate) where.timestamp.lte = new Date(endDate)
  }

  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { timestamp: 'desc' },
      include: { refund: { select: { orderId: true, adjustmentId: true } } },
    }),
  ])

  return NextResponse.json({
    data: events,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

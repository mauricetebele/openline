/**
 * GET /api/removal-shipments — Paginated list of removal orders
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '25')))
  const skip = (page - 1) * pageSize

  const where: Prisma.RemovalShipmentWhereInput = {}

  const accountId = searchParams.get('accountId')
  if (accountId) where.accountId = accountId

  const search = searchParams.get('search')?.trim()
  if (search) {
    where.OR = [
      { removalOrderId: { contains: search, mode: 'insensitive' } },
      { orderStatus: { contains: search, mode: 'insensitive' } },
      { orderType: { contains: search, mode: 'insensitive' } },
      { items: { some: { sellerSku: { contains: search, mode: 'insensitive' } } } },
      { items: { some: { fnsku: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  const sortBy = searchParams.get('sortBy') ?? 'requestDate'
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  const sortMap: Record<string, Prisma.RemovalShipmentOrderByWithRelationInput> = {
    requestDate: { requestDate: sortDir },
    lastUpdatedDate: { lastUpdatedDate: sortDir },
    removalOrderId: { removalOrderId: sortDir },
    orderStatus: { orderStatus: sortDir },
    orderType: { orderType: sortDir },
    createdAt: { createdAt: sortDir },
  }
  const orderBy = sortMap[sortBy] ?? { requestDate: sortDir }

  const [total, shipments] = await Promise.all([
    prisma.removalShipment.count({ where }),
    prisma.removalShipment.findMany({
      where,
      skip,
      take: pageSize,
      orderBy,
      include: {
        _count: { select: { items: true } },
        items: {
          select: {
            requestedQty: true,
            shippedQty: true,
            inProcessQty: true,
            cancelledQty: true,
            disposedQty: true,
          },
        },
      },
    }),
  ])

  // Compute totals per order
  const data = shipments.map(s => {
    const totals = s.items.reduce(
      (acc, item) => ({
        requested: acc.requested + item.requestedQty,
        shipped: acc.shipped + item.shippedQty,
        inProcess: acc.inProcess + item.inProcessQty,
        cancelled: acc.cancelled + item.cancelledQty,
        disposed: acc.disposed + item.disposedQty,
      }),
      { requested: 0, shipped: 0, inProcess: 0, cancelled: 0, disposed: 0 },
    )
    const { items: _items, ...rest } = s
    return { ...rest, totals }
  })

  return NextResponse.json({
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

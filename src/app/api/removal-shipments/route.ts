/**
 * GET /api/removal-shipments — Paginated list of removal shipments
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
      { trackingNumber: { contains: search, mode: 'insensitive' } },
      { removalOrderId: { contains: search, mode: 'insensitive' } },
      { carrier: { contains: search, mode: 'insensitive' } },
      { items: { some: { sellerSku: { contains: search, mode: 'insensitive' } } } },
      { items: { some: { fnsku: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  const sortBy = searchParams.get('sortBy') ?? 'shipDate'
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc'

  const sortMap: Record<string, Prisma.RemovalShipmentOrderByWithRelationInput> = {
    shipDate: { shipDate: sortDir },
    trackingNumber: { trackingNumber: sortDir },
    removalOrderId: { removalOrderId: sortDir },
    carrier: { carrier: sortDir },
    requestDate: { requestDate: sortDir },
    createdAt: { createdAt: sortDir },
  }
  const orderBy = sortMap[sortBy] ?? { shipDate: sortDir }

  const [total, shipments] = await Promise.all([
    prisma.removalShipment.count({ where }),
    prisma.removalShipment.findMany({
      where,
      skip,
      take: pageSize,
      orderBy,
      include: {
        _count: { select: { items: true, fbaReturnReceipts: true, fbaRemovalCases: true } },
        items: { select: { quantity: true } },
      },
    }),
  ])

  const data = shipments.map(s => {
    const unitCount = s.items.reduce((sum, item) => sum + item.quantity, 0)
    const receivedCount = s._count.fbaReturnReceipts + s._count.fbaRemovalCases
    const { items: _items, ...rest } = s
    return { ...rest, unitCount, receivedCount }
  })

  return NextResponse.json({
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

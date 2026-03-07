/**
 * GET /api/returns
 *
 * Paginated list of MFN returns with search, enriched with Order data
 * (product title, ASIN, price, expected serial number).
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
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '25')))
  const skip = (page - 1) * pageSize

  const where: Prisma.MFNReturnWhereInput = {}

  const search = searchParams.get('search')?.trim()
  if (search) {
    where.OR = [
      { orderId: { contains: search, mode: 'insensitive' } },
      { rmaId: { contains: search, mode: 'insensitive' } },
      { asin: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [returns, total] = await Promise.all([
    prisma.mFNReturn.findMany({
      where,
      orderBy: { returnDate: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.mFNReturn.count({ where }),
  ])

  // Collect unique Amazon order IDs to enrich from internal Orders
  const orderIds = Array.from(new Set(returns.map((r) => r.orderId)))

  // Fetch matching internal orders with items + serial assignments
  const orders = orderIds.length > 0
    ? await prisma.order.findMany({
        where: { amazonOrderId: { in: orderIds } },
        include: {
          items: {
            include: {
              serialAssignments: {
                include: { inventorySerial: { select: { serialNumber: true } } },
              },
            },
          },
        },
      })
    : []

  const orderMap = new Map(orders.map((o) => [o.amazonOrderId, o]))

  const enriched = returns.map((ret) => {
    const order = orderMap.get(ret.orderId)

    // Find matching item by ASIN or SKU
    const matchingItem = order?.items.find(
      (item) =>
        (ret.asin && item.asin === ret.asin) ||
        (ret.sku && item.sellerSku === ret.sku),
    ) ?? order?.items[0]

    // Expected serial: only when the matching item had exactly 1 unit ordered
    let expectedSerial: string | null = null
    if (matchingItem && matchingItem.quantityOrdered === 1) {
      const assignment = matchingItem.serialAssignments[0]
      if (assignment) {
        expectedSerial = assignment.inventorySerial.serialNumber
      }
    }

    return {
      id: ret.id,
      orderId: ret.orderId,
      orderDate: ret.orderDate,
      rmaId: ret.rmaId,
      trackingNumber: ret.trackingNumber,
      returnDate: ret.returnDate,
      returnValue: ret.returnValue ? Number(ret.returnValue) : null,
      currency: ret.currency,
      asin: matchingItem?.asin ?? ret.asin,
      sku: ret.sku,
      title: matchingItem?.title ?? ret.title,
      itemPrice: matchingItem?.itemPrice ? Number(matchingItem.itemPrice) : null,
      orderAmount: ret.orderAmount
        ? (ret.orderQuantity && ret.orderQuantity > 1
          ? Number(ret.orderAmount) / ret.orderQuantity
          : Number(ret.orderAmount))
        : null,
      quantity: ret.quantity,
      returnReason: ret.returnReason,
      returnStatus: ret.returnStatus,
      resolution: ret.resolution,
      returnCarrier: ret.returnCarrier,
      carrierStatus: ret.carrierStatus,
      deliveredAt: ret.deliveredAt,
      estimatedDelivery: ret.estimatedDelivery,
      trackingUpdatedAt: ret.trackingUpdatedAt,
      refundedAmount: ret.refundedAmount ? Number(ret.refundedAmount) : null,
      expectedSerial,
    }
  })

  return NextResponse.json({
    data: enriched,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  })
}

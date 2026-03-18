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
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = Math.min(500, Math.max(1, Number(searchParams.get('limit') ?? '25')))
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

    const statusFilter = searchParams.get('trackingStatus')
    if (statusFilter) {
      switch (statusFilter) {
        case 'delivered':
          where.carrierStatus = { contains: 'delivered', mode: 'insensitive' }
          break
        case 'in_transit': {
          const transitConditions: Prisma.MFNReturnWhereInput[] = [
            { carrierStatus: { contains: 'transit', mode: 'insensitive' } },
            { carrierStatus: { contains: 'on the way', mode: 'insensitive' } },
            { carrierStatus: { contains: 'we have your package', mode: 'insensitive' } },
            { carrierStatus: { contains: 'dropped off', mode: 'insensitive' } },
            { carrierStatus: { contains: 'out for delivery', mode: 'insensitive' } },
            { carrierStatus: { contains: 'exception', mode: 'insensitive' } },
            { carrierStatus: { contains: 'delay', mode: 'insensitive' } },
          ]
          if (search) {
            const searchConditions = [
              { orderId: { contains: search, mode: 'insensitive' as const } },
              { rmaId: { contains: search, mode: 'insensitive' as const } },
              { asin: { contains: search, mode: 'insensitive' as const } },
              { sku: { contains: search, mode: 'insensitive' as const } },
              { title: { contains: search, mode: 'insensitive' as const } },
            ]
            delete where.OR
            where.AND = [
              { OR: searchConditions },
              { OR: transitConditions },
            ]
          } else {
            where.OR = transitConditions
          }
          break
        }
        case 'not_shipped':
          where.carrierStatus = { contains: 'ready for ups', mode: 'insensitive' }
          break
        case 'not_tracked':
          where.carrierStatus = null
          where.trackingNumber = { not: null }
          break
        case 'no_tracking':
          where.trackingNumber = null
          break
      }
    }

    // "In System" filter: only show returns that have a matching non-cancelled internal Order
    const inSystemFilter = searchParams.get('inSystem')
    if (inSystemFilter === 'true') {
      try {
        const knownOrders = await prisma.$queryRaw<{ amazonOrderId: string }[]>`
          SELECT DISTINCT "amazonOrderId" FROM "orders"
          WHERE "amazonOrderId" IS NOT NULL
            AND "orderStatus" != 'Canceled'
            AND "workflowStatus" != 'CANCELLED'
        `
        const knownOrderIds = knownOrders.map(o => o.amazonOrderId)
        where.orderId = { in: knownOrderIds }
      } catch (e) {
        console.error('[GET /api/returns] inSystem filter failed:', e)
        return NextResponse.json({ error: 'Failed to apply In System filter' }, { status: 500 })
      }
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
        fmiStatus: ret.fmiStatus,
        fmiCheckedAt: ret.fmiCheckedAt,
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
  } catch (err) {
    console.error('[GET /api/returns] Unhandled error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PATCH /api/returns — update fmiStatus on a return
 */
export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, fmiStatus } = (await req.json()) as { id?: string; fmiStatus?: string }
  if (!id || !fmiStatus) return NextResponse.json({ error: 'id and fmiStatus required' }, { status: 400 })

  await prisma.mFNReturn.update({
    where: { id },
    data: { fmiStatus, fmiCheckedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}

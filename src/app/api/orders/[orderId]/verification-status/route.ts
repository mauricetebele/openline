/**
 * GET /api/orders/[orderId]/verification-status
 * Returns serialization requirements for each order item in an AWAITING_VERIFICATION order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/get-auth-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where:   { id: params.orderId },
    include: {
      items:            { orderBy: { sellerSku: 'asc' }, include: { grade: { select: { id: true, grade: true } } } },
      label:            { select: { trackingNumber: true, labelData: true, labelFormat: true } },
      serialAssignments: {
        include: {
          inventorySerial: { select: { serialNumber: true } },
        },
      },
    },
  })

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const items = await Promise.all(order.items.map(async item => {
    let isSerializable = false
    if (item.sellerSku) {
      // Try direct product match first, then fall back to marketplace SKU mapping
      let product = await prisma.product.findUnique({
        where:  { sku: item.sellerSku },
        select: { isSerializable: true },
      })
      if (!product) {
        const msku = await prisma.productGradeMarketplaceSku.findFirst({
          where: { sellerSku: item.sellerSku },
          include: { product: { select: { isSerializable: true } } },
        })
        product = msku?.product ?? null
      }
      isSerializable = product?.isSerializable ?? false
    }

    const assignedSerials = order.serialAssignments
      .filter(a => a.orderItemId === item.id)
      .map(a => a.inventorySerial.serialNumber)

    return {
      orderItemId:     item.id,
      sellerSku:       item.sellerSku,
      title:           item.title,
      quantityOrdered: item.quantityOrdered,
      isSerializable,
      assignedSerials,
      gradeId:         item.gradeId ?? null,
      gradeName:       item.grade?.grade ?? null,
    }
  }))

  return NextResponse.json({
    orderId:        order.id,
    amazonOrderId:  order.amazonOrderId,
    trackingNumber: order.label?.trackingNumber ?? null,
    hasLabel:       !!order.label,
    items,
  })
}

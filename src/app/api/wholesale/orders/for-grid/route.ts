/**
 * GET /api/wholesale/orders/for-grid?fulfillmentStatus=PENDING|PROCESSING|SHIPPED|CANCELLED
 *
 * Returns SalesOrders in a shape compatible with the UnshippedOrders grid
 * (the same structure as the Amazon Order grid rows).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export const dynamic = 'force-dynamic'

type ShippingAddressJson = {
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const fulfillmentStatus = searchParams.get('fulfillmentStatus')
  const search            = searchParams.get('search')?.trim()

  const where: Record<string, unknown> = {
    status: { notIn: ['PENDING_APPROVAL', 'VOID'] },
  }
  if (fulfillmentStatus) where.fulfillmentStatus = fulfillmentStatus

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { customer: { companyName: { contains: search, mode: 'insensitive' } } },
      { items: { some: { sku: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  const salesOrders = await prisma.salesOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      customer: { select: { id: true, companyName: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, sku: true, title: true, quantity: true, unitPrice: true,
          gradeId: true,
          grade: { select: { grade: true } },
          product: { select: { isSerializable: true } },
        },
      },
      serialAssignments: {
        include: { inventorySerial: { select: { serialNumber: true } } },
      },
    },
  })

  // Adapt to grid Order shape
  const data = salesOrders.map(so => {
    const addr = (so.shippingAddress ?? {}) as ShippingAddressJson

    return {
      // Identity
      id:             so.id,
      orderSource:    'wholesale' as const,
      olmNumber:      null,
      amazonOrderId:  so.orderNumber,        // reuse field for SO number in grid
      wholesaleOrderNumber: so.orderNumber,
      wholesaleCustomerName: so.customer.companyName,

      // Status — map fulfillmentStatus to workflowStatus name used by grid
      orderStatus:    so.status,             // accounting status (DRAFT/CONFIRMED/…)
      workflowStatus: so.fulfillmentStatus,  // PENDING/PROCESSING/SHIPPED/CANCELLED

      // Dates
      purchaseDate:   so.orderDate.toISOString(),
      lastUpdateDate: so.updatedAt.toISOString(),
      lastSyncedAt:   so.updatedAt.toISOString(),
      processedAt:    so.processedAt?.toISOString() ?? null,
      latestShipDate: so.dueDate?.toISOString() ?? null,

      // Totals
      orderTotal: so.total.toString(),
      currency:   'USD',

      // Amazon-only fields — not applicable for wholesale
      isPrime:              false,
      isBuyerRequestedCancel: false,
      buyerCancelReason:    null,
      fulfillmentChannel:   null,
      shipmentServiceLevel: null,
      numberOfItemsUnshipped: so.items.reduce((s, i) => s + Math.round(Number(i.quantity)), 0),

      // Shipping address (from snapshot)
      shipToName:    so.customer.companyName,
      shipToAddress1: addr.addressLine1 ?? null,
      shipToAddress2: addr.addressLine2 ?? null,
      shipToCity:    addr.city    ?? null,
      shipToState:   addr.state   ?? null,
      shipToPostal:  addr.postalCode ?? null,
      shipToCountry: addr.country ?? null,
      shipToPhone:   null,

      // Shipping tracking (once shipped)
      shipCarrier:  so.shipCarrier  ?? null,
      shipTracking: so.shipTracking ?? null,
      shippedAt:    so.shippedAt?.toISOString() ?? null,

      // Items in grid-item shape
      items: so.items.map(i => ({
        id:              i.id,
        orderItemId:     i.id,
        asin:            null,
        sellerSku:       i.sku,
        title:           i.title,
        quantityOrdered: Math.round(Number(i.quantity)),
        quantityShipped: 0,
        itemPrice:       i.unitPrice.toString(),
        shippingPrice:   null,
        isSerializable:  i.product?.isSerializable ?? false,
        gradeId:         i.gradeId ?? null,
        mappedGradeName: i.grade?.grade ?? null,
      })),

      // No ShipStation label for wholesale
      label: null,

      // Serial assignments
      serialAssignments: so.serialAssignments.map(sa => ({
        id:             sa.id,
        orderItemId:    sa.salesOrderItemId ?? '',
        inventorySerial: { serialNumber: sa.inventorySerial.serialNumber },
      })),

      // Preset rate — not applicable for wholesale
      presetRateAmount:     null,
      presetRateCarrier:    null,
      presetRateService:    null,
      presetRateId:         null,
      presetRateError:      null,
      presetRateCheckedAt:  null,
    }
  })

  return NextResponse.json({ data })
}

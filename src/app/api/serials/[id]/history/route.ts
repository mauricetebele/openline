import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/get-auth-user'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const history = await prisma.serialHistory.findMany({
    where: { inventorySerialId: params.id },
    include: {
      receipt: {
        select: { id: true, receivedAt: true },
      },
      purchaseOrder: {
        select: {
          id:       true,
          poNumber: true,
          vendor:   { select: { name: true } },
        },
      },
      order: {
        select: {
          id:             true,
          olmNumber:      true,
          amazonOrderId:  true,
          orderSource:    true,
          shipToName:     true,
          shipToCity:     true,
          shipToState:    true,
          orderTotal:     true,
          currency:       true,
          label: {
            select: {
              trackingNumber: true,
              carrier:        true,
              serviceCode:    true,
              shipmentCost:   true,
            },
          },
        },
      },
      salesOrder: {
        select: {
          id:           true,
          orderNumber:  true,
          shipCarrier:  true,
          shipTracking: true,
          shippingCost: true,
          total:        true,
          customer:     { select: { companyName: true } },
        },
      },
      location: {
        select: { name: true, warehouse: { select: { name: true } } },
      },
      fromLocation: {
        select: { name: true, warehouse: { select: { name: true } } },
      },
      fromProduct: { select: { id: true, description: true, sku: true } },
      toProduct:   { select: { id: true, description: true, sku: true } },
      user:        { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ data: history })
}
